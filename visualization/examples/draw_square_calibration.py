"""Draw a 400mm x 400mm calibration square with batched, interpolated points."""
from __future__ import annotations

import argparse
import time
from typing import Any, Dict, List, Tuple

from polargraph.path_sender import FINAL_JOB_STATUSES, PathSender, PathSenderBusyError

BOARD_WIDTH_MM = 1150.0
BOARD_HEIGHT_MM = 730.0
SQUARE_SIZE_MM = 100.0
# Default interpolation step; adjust via --step-mm if needed
POINT_STEP_MM = 0.1
DEFAULT_SPEED = 1200
DEFAULT_URL = "http://192.168.50.95/api/path"
DEFAULT_ORIGIN = (1150.0/2, 730.0/2)  # top-left corner of the square
DEFAULT_BATCH = 200


def _interpolate_segment(start: Tuple[float, float], end: Tuple[float, float], pen_down: bool, step_mm: float) -> List[Dict[str, Any]]:
    x0, y0 = start
    x1, y1 = end
    dx = x1 - x0
    dy = y1 - y0
    dist = (dx * dx + dy * dy) ** 0.5
    steps = max(1, int(dist // step_mm))
    points: List[Dict[str, Any]] = []
    for i in range(1, steps + 1):
        t = i / steps
        x = x0 + dx * t
        y = y0 + dy * t
        points.append({"x": x, "y": y, "penDown": pen_down})
    # Ensure exact end point
    if not points or (abs(points[-1]["x"] - x1) > 1e-6 or abs(points[-1]["y"] - y1) > 1e-6):
        points.append({"x": x1, "y": y1, "penDown": pen_down})
    return points


def build_square_points(origin_x: float, origin_y: float, step_mm: float) -> List[Dict[str, Any]]:
    x0, y0 = origin_x, origin_y
    x1, y1 = x0 + SQUARE_SIZE_MM, y0
    x2, y2 = x1, y0 + SQUARE_SIZE_MM
    x3, y3 = x0, y0 + SQUARE_SIZE_MM

    points: List[Dict[str, Any]] = []
    # Travel to start with pen up, then lower pen
    points.append({"x": x0, "y": y0, "penDown": False})
    points.append({"x": x0, "y": y0, "penDown": True})

    # Four sides with 1mm interpolation
    points.extend(_interpolate_segment((x0, y0), (x1, y1), True, step_mm))
    points.extend(_interpolate_segment((x1, y1), (x2, y2), True, step_mm))
    points.extend(_interpolate_segment((x2, y2), (x3, y3), True, step_mm))
    points.extend(_interpolate_segment((x3, y3), (x0, y0), True, step_mm))

    # Lift pen after finishing
    points.append({"x": x0, "y": y0, "penDown": False})
    return points


def build_payload(speed: int, origin_x: float, origin_y: float, step_mm: float) -> Dict[str, Any]:
    points = build_square_points(origin_x, origin_y, step_mm)
    return {
        "reset": True,
        "speed": speed,
        "startPosition": {"x": points[0]["x"], "y": points[0]["y"]},
        "points": points,
    }


def _derive_status_url(controller_path_url: str) -> str:
    if controller_path_url.endswith("/path"):
        base = controller_path_url[: -len("/path")]
    else:
        base = controller_path_url.rstrip("/")
    return f"{base}/status"


def _derive_cancel_url(controller_path_url: str) -> str:
    if controller_path_url.endswith("/path"):
        base = controller_path_url[: -len("/path")]
    else:
        base = controller_path_url.rstrip("/")
    return f"{base}/cancel"


def _wait_for_completion(sender: PathSender, poll_interval: float = 0.5) -> None:
    while True:
        status = sender.status()
        if not status:
            time.sleep(poll_interval)
            continue
        state = status.get("status")
        if state in FINAL_JOB_STATUSES or state == "idle":
            final_state = status.get("lastState", state)
            print(f"Transmission finished with status: {final_state}")
            if status.get("error"):
                print(f"Controller reported error: {status['error']}")
            return
        sent = status.get("sentPoints", 0)
        total = status.get("totalPoints", 0)
        print(f"Progress: {sent}/{total} points sent", end="\r", flush=True)
        time.sleep(poll_interval)


def send_square(controller_url: str, speed: int, origin_x: float, origin_y: float, step_mm: float, batch_size: int) -> None:
    payload = build_payload(speed, origin_x, origin_y, step_mm)

    sender = PathSender(batch_size=max(1, batch_size))

    status_url = _derive_status_url(controller_url)
    cancel_url = _derive_cancel_url(controller_url)

    print(f"Sending {len(payload['points'])} points in batches of {sender.batch_size} to {controller_url}...")
    job = sender.start_job(
        controller_url=controller_url,
        points=payload["points"],
        start_position=payload["startPosition"],
        speed=payload["speed"],
        reset=payload["reset"],
        status_url=status_url,
        cancel_url=cancel_url,
    )
    print(f"Job {job.job_id} started.")
    _wait_for_completion(sender)


def main() -> None:
    parser = argparse.ArgumentParser(description="Draw a 400mm x 400mm calibration square with 1mm interpolation.")
    parser.add_argument("controller_url", nargs="?", default=DEFAULT_URL,
                        help=f"Controller /api/path endpoint (default: {DEFAULT_URL})")
    parser.add_argument("--speed", type=int, default=DEFAULT_SPEED,
                        help=f"Feed speed for the move (default: {DEFAULT_SPEED})")
    parser.add_argument("--origin-x", type=float, default=DEFAULT_ORIGIN[0],
                        help=f"X coordinate of square's top-left corner (default: {DEFAULT_ORIGIN[0]})")
    parser.add_argument("--origin-y", type=float, default=DEFAULT_ORIGIN[1],
                        help=f"Y coordinate of square's top-left corner (default: {DEFAULT_ORIGIN[1]})")
    parser.add_argument("--step-mm", type=float, default=POINT_STEP_MM,
                        help=f"Interpolation step in mm (default: {POINT_STEP_MM})")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH,
                        help=f"Points per HTTP batch (default: {DEFAULT_BATCH})")
    args = parser.parse_args()

    # Basic bounds warning (non-fatal)
    if not (0 <= args.origin_x <= BOARD_WIDTH_MM and 0 <= args.origin_y <= BOARD_HEIGHT_MM):
        print("Warning: origin appears outside board bounds; continue at your own risk.")
    if (args.origin_x + SQUARE_SIZE_MM) > BOARD_WIDTH_MM or (args.origin_y + SQUARE_SIZE_MM) > BOARD_HEIGHT_MM:
        print("Warning: square may extend beyond board dimensions; adjust origin if needed.")

    step_mm = max(0.5, float(args.step_mm))
    batch_size = max(1, int(args.batch_size))

    try:
        send_square(args.controller_url.rstrip("/"), args.speed, args.origin_x, args.origin_y, step_mm, batch_size)
    except PathSenderBusyError:
        print("Controller already has an active transmission; wait for it to finish or cancel it first.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
