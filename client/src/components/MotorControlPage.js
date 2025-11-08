import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, Pause, Play, RefreshCcw, Square, Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { getThemeClasses, theme } from '../theme';
import { buildApiUrl, fetchPathStatus } from '../utils/api';

const ACTION_ENDPOINTS = {
  pause: '/api/send-path/pause',
  resume: '/api/send-path/resume',
  cancel: '/api/send-path/cancel',
};

const mergeStatus = (update, previous) => {
  if (!update) {
    return null;
  }
  if (update.status === 'idle') {
    return null;
  }
  if (!previous) {
    return { ...update };
  }
  const merged = { ...previous, ...update };
  if (!merged.status && previous.status) {
    merged.status = previous.status;
  }
  return merged;
};

const MotorControlPage = ({ onBack }) => {
  const { darkMode, toggleTheme } = useTheme();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const applyStatusUpdate = useCallback((update) => {
    setStatus((prev) => mergeStatus(update, prev));
  }, []);

  const fetchStatus = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) {
        setIsLoading(true);
      }
      try {
        const data = await fetchPathStatus();
        if (data?.status && data.status !== 'idle') {
          applyStatusUpdate(data);
        } else if (data?.status === 'idle') {
          setStatus(null);
        }
        setError(null);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          setError(err?.message || 'Failed to fetch controller status');
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
  const isActive = ['pending', 'running', 'cancelling'].includes(jobStatus);
  const canPause = isActive && !status?.paused;
  const canResume = isActive && Boolean(status?.paused);
  const canCancel = isActive || status?.paused;

  const progressPercent = useMemo(() => {
    if (!status?.totalPoints || !Number.isFinite(status.totalPoints) || status.totalPoints <= 0) {
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

  return (
    <div className={getThemeClasses('min-h-screen', { light: 'bg-gray-100 text-gray-900', dark: 'bg-gray-950 text-white' }, darkMode)}>
      <header className={getThemeClasses('border-b', { light: 'bg-white border-gray-200', dark: 'bg-gray-900 border-gray-800' }, darkMode)}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            {backHandler && (
              <motion.button
                onClick={backHandler}
                className={getThemeClasses(
                  'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                  { light: 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100', dark: 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700' },
                  darkMode
                )}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Designer</span>
              </motion.button>
            )}
            <div>
              <h1 className="text-xl font-semibold">Motor Control</h1>
              <p className="text-sm opacity-70">Monitor active jobs and manage the microcontroller.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={handleRefresh}
              disabled={isLoading}
              className={getThemeClasses(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-70 disabled:cursor-not-allowed',
                { light: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100', dark: 'bg-blue-900 border-blue-700 text-blue-200 hover:bg-blue-800' },
                darkMode
              )}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <RefreshCcw className="w-4 h-4" />
              <span>Refresh</span>
            </motion.button>
            <motion.button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </motion.button>
          </div>
        </div>
      </header>

      <main className="py-10">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={getThemeClasses(
              `${theme.styles.card.base} space-y-6`,
              { light: theme.styles.card.light, dark: theme.styles.card.dark },
              darkMode
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Controller Job Status</h2>
                <p className="text-sm opacity-70">Live progress and batch information for the most recent job.</p>
              </div>
              {isLoading && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
            </div>

            {error && (
              <div className={getThemeClasses(
                'p-3 rounded-md text-sm border',
                { light: 'bg-red-50 border-red-200 text-red-700', dark: 'bg-red-900 border-red-700 text-red-200' },
                darkMode
              )}>
                {error}
              </div>
            )}

            {status ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="font-medium">
                      Status: {status.status || 'unknown'}{status.paused ? ' (paused)' : ''}
                    </span>
                    {status.jobId && (
                      <span className="text-xs opacity-70">Job ID: {status.jobId}</span>
                    )}
                  </div>

                  {status.totalPoints ? (
                    <>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs opacity-70">
                        <span>{status.sentPoints || 0} / {status.totalPoints} points</span>
                        <span>{status.sentBatches || 0} / {status.totalBatches || 0} batches</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs opacity-70">Awaiting transmission data...</p>
                  )}

                  {status.error && (
                    <p className="text-xs text-red-500">Controller error: {status.error}</p>
                  )}

                  {(startedLabel || finishedLabel) && (
                    <div className="flex flex-col sm:flex-row sm:gap-6 text-xs opacity-70">
                      {startedLabel && <span>Started: {startedLabel}</span>}
                      {finishedLabel && <span>Finished: {finishedLabel}</span>}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {canPause && (
                    <motion.button
                      onClick={handlePause}
                      disabled={isLoading}
                      className={getThemeClasses(
                        'px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed',
                        { light: 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100', dark: 'bg-yellow-900 border-yellow-700 text-yellow-200 hover:bg-yellow-800' },
                        darkMode
                      )}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Pause className="w-4 h-4" />
                      Pause
                    </motion.button>
                  )}

                  {canResume && (
                    <motion.button
                      onClick={handleResume}
                      disabled={isLoading}
                      className={getThemeClasses(
                        'px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed',
                        { light: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100', dark: 'bg-green-900 border-green-700 text-green-200 hover:bg-green-800' },
                        darkMode
                      )}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Play className="w-4 h-4" />
                      Resume
                    </motion.button>
                  )}

                  {canCancel && (
                    <motion.button
                      onClick={handleCancel}
                      disabled={isLoading}
                      className={getThemeClasses(
                        'px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed',
                        { light: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100', dark: 'bg-red-900 border-red-700 text-red-200 hover:bg-red-800' },
                        darkMode
                      )}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Square className="w-4 h-4" />
                      Cancel
                    </motion.button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm opacity-75">
                No active controller job. Start a drawing from the Designer view to monitor it here.
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default MotorControlPage;
