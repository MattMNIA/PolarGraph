# Client

React front end for the PHINEAS whiteboard plotter. See the [root README](../README.md) for the
project overview and setup.

## Screens

| Screen | File | What it does |
|---|---|---|
| Whiteboard | `src/components/Whiteboard.js` | The main workspace: drop in images or text, drag and resize them on a scale drawing of the board, pick a drawing method, preview the planned pen path, and start the job. |
| Motor control | `src/components/MotorControlPage.js` | Live job monitor — progress, pause/resume/cancel, pen and park controls. |
| Motor test | `src/components/MotorTestPage.js` | Jog each motor and exercise the pen servo directly. Hidden unless `REACT_APP_SHOW_MOTOR_TEST=true`. |

## Scripts

```bash
npm start     # dev server on :3000
npm run build # production bundle into build/, served by the Flask app
npm test      # react-scripts test runner
```

## Configuration

Create `client/.env` (gitignored) to override defaults:

| Variable | Default | Effect |
|---|---|---|
| `REACT_APP_API_BASE_URL` | `http://localhost:8001` in dev, same-origin in production | Where the Flask API lives. |
| `REACT_APP_PORT` | `8001` | API port, when the base URL isn't set outright. |
| `REACT_APP_SHOW_MOTOR_TEST` | unset | Set to `true` to expose the motor test screen. |

The UI system — tokens, primitives, and the rules that keep them consistent — is documented in
[THEME_README.md](THEME_README.md).
