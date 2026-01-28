import React, { useState } from 'react';

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
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-5xl mx-auto py-10 px-6">
        <h1 className="text-3xl font-semibold mb-6">Motor Controller Test</h1>
        <div className="bg-white rounded-xl shadow-md p-6 mb-8">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col">
              <span className="font-medium mb-1">Controller Base URL</span>
              <input
                className="border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                placeholder="http://192.168.x.x"
                value={controllerUrl}
                onChange={(event) => setControllerUrl(event.target.value)}
              />
            </label>
            <label className="flex flex-col">
              <span className="font-medium mb-1">Motor</span>
              <select
                className="border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                value={motor}
                onChange={(event) => setMotor(event.target.value)}
              >
                {motors.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="font-medium mb-1">Step Count</span>
              <input
                type="number"
                className="border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                value={steps}
                onChange={(event) => setSteps(event.target.value)}
              />
            </label>
            <label className="flex flex-col">
              <span className="font-medium mb-1">Speed (steps/sec)</span>
              <input
                type="number"
                className="border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-blue-200"
                value={speed}
                onChange={(event) => setSpeed(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => handleMove('forward')}
            >
              Move Forward
            </button>
            <button
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => handleMove('backward')}
            >
              Move Backward
            </button>
            <button
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg shadow hover:bg-gray-300 disabled:opacity-60"
              disabled={busy}
              onClick={handleStatus}
            >
              Check Status
            </button>
          </div>
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-4">Activity Log</h2>
          <div className="bg-gray-900 text-gray-100 rounded-xl p-4 h-64 overflow-auto text-sm">
            {log.length === 0 ? (
              <p className="opacity-60">No requests yet. Commands and responses will appear here.</p>
            ) : (
              <ul className="space-y-3">
                {log.map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`}>
                    <div className="flex justify-between text-xs uppercase tracking-wide opacity-70 mb-1">
                      <span>{entry.type}</span>
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="font-medium">{entry.message}</div>
                    {entry.payload && (
                      <pre className="mt-1 bg-gray-800 rounded-lg p-2 overflow-auto">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default MotorTestPage;
