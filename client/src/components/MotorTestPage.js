import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Activity } from 'lucide-react';
import { Button, Card, CardHeader, Container, Field, Select, TextInput } from './ui';

const defaultControllerUrl = 'http://192.168.50.97';
const motors = [
  { id: 'left', label: 'Left Motor' },
  { id: 'right', label: 'Right Motor' },
];

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parsed = { raw: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

export function MotorTestPage() {
  const [controllerUrl, setControllerUrl] = useState(defaultControllerUrl);
  const [motor, setMotor] = useState(motors[0].id);
  const [steps, setSteps] = useState(800);
  const [speed, setSpeed] = useState(1400);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const appendLog = (entry) => {
    setLog((prev) => [{ timestamp: new Date().toISOString(), ...entry }, ...prev].slice(0, 20));
  };

  const handleMove = async (direction) => {
    if (!controllerUrl.trim()) {
      appendLog({ type: 'error', message: 'Controller URL required.' });
      return;
    }

    const signedSteps = Math.abs(Number(steps)) * (direction === 'forward' ? 1 : -1);
    if (!Number.isFinite(signedSteps) || signedSteps === 0) {
      appendLog({ type: 'error', message: 'Steps must be a non-zero number.' });
      return;
    }

    const payload = {
      motor,
      steps: signedSteps,
      speed: Number(speed) || undefined,
    };

    setBusy(true);
    appendLog({ type: 'info', message: `Sending move (${direction})`, payload });
    try {
      const result = await fetchJson(`${controllerUrl.replace(/\/$/, '')}/api/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      appendLog({ type: result.ok ? 'success' : 'error', message: `Move response (${result.status})`, payload: result.body });
    } catch (error) {
      appendLog({ type: 'error', message: 'Request failed', payload: { error: error.message } });
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async () => {
    if (!controllerUrl.trim()) {
      appendLog({ type: 'error', message: 'Controller URL required.' });
      return;
    }

    setBusy(true);
    appendLog({ type: 'info', message: 'Fetching status' });
    try {
      const result = await fetchJson(`${controllerUrl.replace(/\/$/, '')}/api/status`);
      appendLog({ type: result.ok ? 'success' : 'error', message: `Status response (${result.status})`, payload: result.body });
    } catch (error) {
      appendLog({ type: 'error', message: 'Status request failed', payload: { error: error.message } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 text-gray-900 transition-colors duration-300 dark:bg-gray-800 dark:text-white md:py-16">
      <Container className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">Motor Controller Test</h1>
          <div className="mt-4 h-1 w-20 rounded-full bg-blue-600 dark:bg-blue-500" />
          <p className="mt-6 max-w-2xl text-lg opacity-90">
            Drive a single motor directly to check wiring, direction and step calibration.
          </p>
        </div>

        <Card className="space-y-6 p-6 md:p-8">
          <CardHeader title="Move command" description="Sent straight to the controller, bypassing the path queue." />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Controller base URL" htmlFor="test-url">
              <TextInput
                id="test-url"
                placeholder="http://192.168.x.x"
                value={controllerUrl}
                onChange={(event) => setControllerUrl(event.target.value)}
                inputMode="url"
                autoComplete="off"
                spellCheck="false"
              />
            </Field>

            <Field label="Motor" htmlFor="test-motor">
              <Select id="test-motor" value={motor} onChange={(event) => setMotor(event.target.value)}>
                {motors.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Step count" htmlFor="test-steps">
              <TextInput
                id="test-steps"
                type="number"
                value={steps}
                onChange={(event) => setSteps(event.target.value)}
              />
            </Field>

            <Field label="Speed" hint="Steps per second" htmlFor="test-speed">
              <TextInput
                id="test-speed"
                type="number"
                value={speed}
                onChange={(event) => setSpeed(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="md" icon={ArrowUpRight} disabled={busy} onClick={() => handleMove('forward')}>
              Move forward
            </Button>
            <Button variant="secondary" size="md" icon={ArrowDownLeft} disabled={busy} onClick={() => handleMove('backward')}>
              Move backward
            </Button>
            <Button variant="secondary" size="md" icon={Activity} disabled={busy} onClick={handleStatus}>
              Check status
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-6 md:p-8">
          <CardHeader title="Activity log" description="The last 20 requests and responses." />

          <div className="h-72 overflow-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100 dark:bg-gray-950">
            {log.length === 0 ? (
              <p className="opacity-60">No requests yet. Commands and responses will appear here.</p>
            ) : (
              <ul className="space-y-4">
                {log.map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`}>
                    <div className="mb-1 flex justify-between text-xs uppercase tracking-wide opacity-60">
                      <span>{entry.type}</span>
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="font-medium">{entry.message}</div>
                    {entry.payload && (
                      <pre className="mt-2 overflow-auto rounded-lg bg-gray-800 p-3 text-xs">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </Container>
    </div>
  );
}

export default MotorTestPage;
