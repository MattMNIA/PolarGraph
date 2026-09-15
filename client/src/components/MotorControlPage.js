import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Cpu, Loader2, Pause, Play, RefreshCcw, Square, Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { cn, theme } from '../theme';
import { buildApiUrl, fetchPathStatus } from '../utils/api';
import { Button, Card, CardHeader, Container, Pill, ProgressBar } from './ui';

const ACTION_ENDPOINTS = {
  pause: '/api/send-path/pause',
  resume: '/api/send-path/resume',
  cancel: '/api/send-path/cancel',
};

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running', 'cancelling']);
const FINAL_JOB_STATUSES = new Set(['idle', 'cancelled', 'completed', 'failed']);

const normalizeFinalStatus = (payload, previous) => {
  const controllerStatus = payload?.controllerStatus ?? previous?.controllerStatus ?? null;
  const error = payload?.error ?? null;
  const result = {
    status: payload?.status || 'idle',
    controllerStatus,
  };
  if (error) {
    result.error = error;
  }
  if (payload?.previousJob) {
    result.previousJob = payload.previousJob;
  }
  if (payload?.lastState) {
    result.lastState = payload.lastState;
  }
  return result;
};

const mergeStatus = (update, previous) => {
  if (!update) {
    return previous || null;
  }
  if (update.status && FINAL_JOB_STATUSES.has(update.status)) {
    return normalizeFinalStatus(update, previous);
  }
  const base = previous ? { ...previous } : {};
  const merged = { ...base, ...update };
  if (!merged.status && previous?.status) {
    merged.status = previous.status;
  }
  if (!merged.controllerStatus && previous?.controllerStatus) {
    merged.controllerStatus = previous.controllerStatus;
  }
  if (merged.status && FINAL_JOB_STATUSES.has(merged.status)) {
    return normalizeFinalStatus(merged, previous);
  }
  return merged;
};

const statusTone = (status) => {
  if (status === 'failed') return 'danger';
  if (status && ACTIVE_JOB_STATUSES.has(status)) return 'accent';
  return 'neutral';
};

const MotorControlPage = ({ onBack }) => {
  const { darkMode, toggleTheme } = useTheme();
  const [status, setStatus] = useState(null);
  const [statusIssues, setStatusIssues] = useState('initial-load');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const consecutiveFailureRef = useRef(0);
  const [lastUpdateAt, setLastUpdateAt] = useState(null);

  const applyStatusUpdate = useCallback((update) => {
    if (!update) {
      return;
    }
    setStatus((prev) => {
      const merged = mergeStatus(update, prev);
      if (!merged) {
        setStatusIssues('initial-load');
        setLastUpdateAt(null);
        return null;
      }
      const jobIsActive = merged.status ? ACTIVE_JOB_STATUSES.has(merged.status) : false;
      const hasHeartbeat = Boolean(merged.controllerStatus && merged.controllerStatus.status != null);
      setLastUpdateAt(Date.now());
      setStatusIssues(jobIsActive ? (hasHeartbeat ? null : 'missing-controller-status') : null);
      return merged;
    });
  }, []);

  const fetchStatus = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) {
        setIsLoading(true);
      }
      try {
        const data = await fetchPathStatus();
        if (!data) {
          consecutiveFailureRef.current += 1;
          if (consecutiveFailureRef.current >= 3) {
            setError('Unable to contact the visualization service. Retrying…');
          }
          setStatusIssues('polling-error');
          return;
        }
        applyStatusUpdate(data);
        setError(null);
        consecutiveFailureRef.current = 0;
      } catch (err) {
        if (err?.name !== 'AbortError') {
          consecutiveFailureRef.current += 1;
          if (consecutiveFailureRef.current >= 3) {
            setError(err?.message || 'Failed to fetch controller status');
          }
          setStatusIssues('polling-error');
        }
      } finally {
        if (showSpinner) {
          setIsLoading(false);
        }
      }
    },
    [applyStatusUpdate]
  );

  useEffect(() => {
    fetchStatus(true);
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleAction = useCallback(
    async (endpoint) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(buildApiUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch (parseError) {
          payload = null;
        }
        if (!response.ok) {
          throw new Error(payload?.error || 'Controller action failed');
        }
        applyStatusUpdate(payload);
        await fetchStatus();
      } catch (err) {
        if (err?.name !== 'AbortError') {
          setError(err?.message || 'Controller action failed');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [applyStatusUpdate, fetchStatus]
  );

  const handlePause = useCallback(() => handleAction(ACTION_ENDPOINTS.pause), [handleAction]);
  const handleResume = useCallback(() => handleAction(ACTION_ENDPOINTS.resume), [handleAction]);
  const handleCancel = useCallback(() => handleAction(ACTION_ENDPOINTS.cancel), [handleAction]);
  const handleRefresh = useCallback(() => fetchStatus(true), [fetchStatus]);

  const jobStatus = status?.status || 'idle';
  const isActive = ACTIVE_JOB_STATUSES.has(jobStatus);
  const canPause = isActive && !status?.paused;
  const canResume = isActive && Boolean(status?.paused);
  const canCancel = isActive || status?.paused;

  const progressPercent = useMemo(() => {
    if (!status) {
      return 0;
    }
    if (!ACTIVE_JOB_STATUSES.has(status.status)) {
      return 0;
    }
    if (!status.totalPoints || !Number.isFinite(status.totalPoints) || status.totalPoints <= 0) {
      return 0;
    }
    const sent = Number(status.sentPoints || 0);
    return Math.min(100, Math.round((sent / status.totalPoints) * 100));
  }, [status]);

  const startedLabel = useMemo(() => {
    if (!status?.startedAt) {
      return null;
    }
    const date = new Date(status.startedAt * 1000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  }, [status]);

  const finishedLabel = useMemo(() => {
    if (!status?.finishedAt) {
      return null;
    }
    const date = new Date(status.finishedAt * 1000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  }, [status]);

  const backHandler = typeof onBack === 'function' ? onBack : null;

  const overlayMessage = useMemo(() => {
    switch (statusIssues) {
      case 'initial-load':
        return 'Loading latest job status…';
      case 'polling-error':
        return 'Status unavailable — waiting for the next update…';
      case 'missing-controller-status':
        return 'Awaiting controller heartbeat…';
      default:
        return null;
    }
  }, [statusIssues]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdateAt) {
      return null;
    }
    const date = new Date(lastUpdateAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleTimeString();
  }, [lastUpdateAt]);

  const controllerStatus = status?.controllerStatus;
  const controllerError = controllerStatus?.error;
  const controllerStale = controllerStatus?.stale;

  const timeline = [
    startedLabel && { label: 'Started', value: startedLabel },
    finishedLabel && { label: 'Finished', value: finishedLabel },
    lastUpdatedLabel && { label: 'Last update', value: lastUpdatedLabel },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-white">
      <motion.header
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-x-0 top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-lg dark:border-gray-800 dark:bg-gray-900/80"
      >
        <Container className="flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {backHandler && (
              <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={backHandler}>
                <span className="hidden sm:inline">Designer</span>
              </Button>
            )}
            <span className="truncate text-xl font-bold text-blue-600 dark:text-blue-400">Motor Control</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCcw}
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="icon"
              size="icon"
              onClick={toggleTheme}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
          </div>
        </Container>
      </motion.header>

      <main className="pt-16">
        <section className="bg-gray-100 py-12 transition-colors duration-300 dark:bg-gray-800 md:py-16">
          <Container>
            <motion.div {...theme.animations.fadeInUp} className="mb-10 text-center md:mb-12">
              <h1 className="text-3xl font-bold md:text-4xl">Motor Control</h1>
              <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-blue-600 dark:bg-blue-500" />
              <p className="mx-auto mt-6 max-w-2xl text-lg opacity-90">
                Monitor the active job and manage the microcontroller while it draws.
              </p>
            </motion.div>

            <Card className="space-y-6 p-6 md:p-8">
              <CardHeader
                icon={Cpu}
                title="Controller job status"
                description="Live progress and batch information for the most recent job."
                actions={
                  <div className="flex items-center gap-3">
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />}
                    <Pill tone={statusTone(status?.status)}>
                      {status?.status || 'idle'}
                      {status?.paused ? ' · paused' : ''}
                    </Pill>
                  </div>
                }
              />

              {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className={cn('relative p-5', theme.surface.well)}>
                {overlayMessage && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-gray-100/70 dark:bg-gray-900/60">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                    <span className="mt-2 px-4 text-center text-sm font-medium">{overlayMessage}</span>
                  </div>
                )}

                <div
                  className={cn(
                    'space-y-4',
                    overlayMessage && 'pointer-events-none opacity-50 transition-opacity duration-200'
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">Transmission</span>
                    {status?.jobId && <span className="font-mono text-xs opacity-60">{status.jobId}</span>}
                  </div>

                  {status?.totalPoints ? (
                    <div className="space-y-2">
                      <ProgressBar value={progressPercent} />
                      <div className="flex flex-wrap justify-between gap-2 text-xs opacity-70">
                        <span>
                          {(status?.sentPoints || 0).toLocaleString()} / {(status?.totalPoints || 0).toLocaleString()} points
                        </span>
                        <span>
                          {status?.sentBatches || 0} / {status?.totalBatches || 0} batches
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs opacity-70">
                      {status
                        ? 'Awaiting transmission data…'
                        : 'No active controller job yet. Start a drawing from the Designer to monitor it here.'}
                    </p>
                  )}

                  {status?.error && (
                    <p className="text-xs text-red-600 dark:text-red-400">Controller error: {status.error}</p>
                  )}
                  {controllerError && (
                    <p className="text-xs text-red-600 dark:text-red-400">Status poller error: {controllerError}</p>
                  )}
                  {controllerStale && (
                    <p className="text-xs opacity-70">Controller status is stale; awaiting refresh…</p>
                  )}
                  {status?.status === 'idle' && status?.lastState && (
                    <p className="text-xs opacity-70">Last job: {status.lastState}</p>
                  )}

                  {timeline.length > 0 && (
                    <dl className="grid gap-3 border-t border-gray-200 pt-4 text-xs dark:border-gray-700 sm:grid-cols-3">
                      {timeline.map((item) => (
                        <div key={item.label}>
                          <dt className="uppercase tracking-wide opacity-60">{item.label}</dt>
                          <dd className="mt-0.5 font-medium">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>

              {(canPause || canResume || canCancel) && (
                <div className="flex flex-wrap gap-3">
                  {canPause && (
                    <Button variant="secondary" size="md" icon={Pause} onClick={handlePause} disabled={isLoading}>
                      Pause
                    </Button>
                  )}
                  {canResume && (
                    <Button variant="secondary" size="md" icon={Play} onClick={handleResume} disabled={isLoading}>
                      Resume
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="danger" size="md" icon={Square} onClick={handleCancel} disabled={isLoading}>
                      Stop job
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </Container>
        </section>
      </main>
    </div>
  );
};

export default MotorControlPage;
