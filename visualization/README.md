# Polargraph Simulator

Simple simulation and path-planning toolkit for a two-motor polargraph (top-left and top-right motors) intended for planning drawings on a whiteboard before building the hardware.

Features
- Geometry model: lengths and inverse kinematics
- Path planning: convert images (contours) to ordered drawing points
- Visualization: matplotlib animation of the pen and strings
- Example runner and a basic unit test for kinematics

Requirements
- Python 3.8+
- For image processing: OpenCV (optional) and Pillow
- For visualization: matplotlib

Install

pip install -r requirements.txt

Quick run (example)

python examples/run_simulation.py --image examples/sample.png --board-width 800 --board-height 600

Notes
- Image processing requires `opencv-python` for contour extraction. If not available, the image processing module will raise a helpful error.

## Microcontroller Path Streaming

The Flask backend now streams drawing paths to the ESP32 motion controller in non-blocking batches (100 points at a time). Use the new endpoints:

- `POST /api/send-path` – queue a path for transmission. Payload should include `controllerUrl`, `path` (list of `{x, y, penDown}` objects), and optional `speed`, `reset`, `startPosition`. Responds immediately with a job id while a background worker handles the batches.
- `GET /api/send-path/status` – poll the active or most recent job (progress, totals, errors).
- `POST /api/send-path/cancel` – request cancellation of the in-flight job.

Inside `/api/visualize`, supply `sendToController: true` (and `controllerUrl`, etc.) to automatically kick off streaming using the generated path while still receiving the preview data.
