# Backend

Flask API and the `polargraph` package behind PHINEAS. See the [root README](../README.md) for the
project overview and setup.

## Package

| Module | Role |
|---|---|
| `polargraph/kinematics.py` | The geometry: belt lengths for an (x, y) pen position, and the inverse. |
| `polargraph/image_processing.py` | Image → pen strokes. `image_to_contour_paths`, `image_to_hatch_paths`, `image_to_dark_fill_paths`, plus the hatch-line generator and path smoothing. |
| `polargraph/path_planner.py` | Stroke ordering and interpolation: split and merge contours at near-touches, nearest-neighbour ordering, fixed-step interpolation, pen-up/down marking. |
| `polargraph/path_sender.py` | Batched, non-blocking transmission to the ESP32 with progress, pause, resume, and cancel. |
| `polargraph/whiteboard_manager.py` | Multi-image board layout: placement, bounds checking, composite rendering. |
| `polargraph/plot.py` | Matplotlib preview and animation of the pen and belts. |

## Running

```bash
python -m venv .venv && .venv/Scripts/activate   # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
python app.py                                    # :8001, or set PORT
```

`app.py` also serves `../client/build/` at `/`, so once the front end is built the Flask process is
the whole application.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/visualize` | Plan a drawing from a board layout; returns preview images and path stats. Pass `sendToController: true` (with `controllerUrl`) to start streaming at the same time. |
| `POST /api/animation` | Render an animated preview of the planned path. |
| `POST /api/send-path` | Queue a path for transmission. Takes `controllerUrl`, `path` (a list of `{x, y, penDown}`), and optional `speed`, `reset`, `startPosition`. Returns a job id immediately; a background worker handles the batches. |
| `GET /api/send-path/status` | Poll the active or most recent job — progress, totals, errors. |
| `POST /api/send-path/cancel` | Cancel the in-flight job. |
| `POST /api/send-path/pause`, `/resume` | Hold and release the in-flight job. |
| `GET /api/controller/status` | Read the cached ESP32 status (a background poller keeps it fresh). |
| `POST /api/controller/status` | Point the poller at a controller URL. |

## Scripts

```bash
# Plan a drawing from the command line
python examples/run_simulation.py --images images/mona_lisa.jpg --method hatch --board-width 900 --board-height 550

# Hardware shakedown: shapes, a calibration square, a centered circle, timing
python examples/draw_square_calibration.py
python examples/diagnostic_suite.py

# Interactive multi-image layout
python layout_tool.py
```

`run_simulation.py` takes `--images`, `--positions` (`x,y,width,height` per image), `--board-width`,
`--board-height`, `--step-mm`, `--method` (`contour` or `hatch`), and `--spacing`.

## Tests

```bash
pip install pytest
python -m pytest tests
```

## Notes

- Contour extraction needs `opencv-python`; the image processing module raises a clear error if it
  isn't installed.
- `visualization/images/` holds the test images used while developing the tracing modes.
