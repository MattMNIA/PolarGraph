"""Diagnostic test suite for the polargraph plotter.

Implements the step-by-step geometry and motion checks described in the
provided test plan. Uses batching via PathSender to avoid oversized POSTs.

Supported tests:
 1: 200mm vertical line (center, downward)
 2: 300mm horizontal line at low Y (y=100)
 3: 300mm horizontal line at high Y (y=400)
 4: 100mm square near center
 5: 100mm diagonal at 45°
 8: Pen lift drift check (same line pen-up vs pen-down)

Tests 6 and 7 rely on direct step control/telemetry and are not automated here.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from typing import Any, Dict, Iterable, List, Sequence, Tuple

import requests

from polargraph.path_sender import FINAL_JOB_STATUSES, PathSender, PathSenderBusyError

BOARD_WIDTH_MM = 1150.0
BOARD_HEIGHT_MM = 730.0
CENTER_X = BOARD_WIDTH_MM / 2.0
CENTER_Y = BOARD_HEIGHT_MM / 2.0

DEFAULT_SPEED = 1200
DEFAULT_URL = "http://192.168.50.95/api/path"
DEFAULT_BATCH = 50
DEFAULT_STEP_MM = 1.0

Point = Tuple[float, float]
PenPoint = Dict[str, Any]


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


def _wait_until_idle(status_url: str, *, poll_interval: float = 0.5, timeout: float = 300.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(status_url, timeout=5)
            if resp.status_code == 404:
                return True
            resp.raise_for_status()
            data = resp.json() if resp.content else {}
            queue = data.get("queue", {}) if isinstance(data, dict) else {}
            is_exec = bool(queue.get("isExecuting")) if isinstance(queue, dict) else False
            qsize = queue.get("size") if isinstance(queue, dict) else None
            if not is_exec and (qsize is None or int(qsize) == 0):
                return True
        except Exception:
            # On transient errors, just wait and retry until timeout
            pass
        time.sleep(poll_interval)
    return False


def _interpolate_line(a: Point, b: Point, pen_down: bool, step_mm: float) -> List[PenPoint]:
    x0, y0 = a
    x1, y1 = b
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    steps = max(1, int(dist // step_mm))
    pts: List[PenPoint] = []
    for i in range(1, steps + 1):
        t = i / steps
        pts.append({"x": x0 + dx * t, "y": y0 + dy * t, "penDown": pen_down})
    if not pts or abs(pts[-1]["x"] - x1) > 1e-6 or abs(pts[-1]["y"] - y1) > 1e-6:
        pts.append({"x": x1, "y": y1, "penDown": pen_down})
    return pts


def _travel_and_draw(path: Iterable[PenPoint]) -> List[PenPoint]:
    pts = list(path)
    if not pts:
        return pts
    # ensure first point is pen-up travel
    first = pts[0]
    pts[0] = {**first, "penDown": False}
    return pts


def build_test_points(test: str, step_mm: float) -> List[PenPoint]:
    t = test.lower()
    pts: List[PenPoint] = []

    if t == "1":
        # 200mm vertical down from center
        start = (CENTER_X, CENTER_Y)
        end = (CENTER_X, CENTER_Y - 200.0)
        pts = [
            {"x": start[0], "y": start[1], "penDown": False},
            {"x": start[0], "y": start[1], "penDown": True},
            *_interpolate_line(start, end, True, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ]
    elif t == "2":
        # 300mm horizontal at y=100
        start = (CENTER_X - 150.0, 100.0)
        end = (CENTER_X + 150.0, 100.0)
        pts = [
            {"x": start[0], "y": start[1], "penDown": False},
            {"x": start[0], "y": start[1], "penDown": True},
            *_interpolate_line(start, end, True, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ]
    elif t == "3":
        # 300mm horizontal at y=400
        start = (CENTER_X - 150.0, 400.0)
        end = (CENTER_X + 150.0, 400.0)
        pts = [
            {"x": start[0], "y": start[1], "penDown": False},
            {"x": start[0], "y": start[1], "penDown": True},
            *_interpolate_line(start, end, True, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ]
    elif t == "4":
        # 100mm square centered
        half = 50.0
        x0, y0 = CENTER_X - half, CENTER_Y - half
        x1, y1 = CENTER_X + half, CENTER_Y - half
        x2, y2 = CENTER_X + half, CENTER_Y + half
        x3, y3 = CENTER_X - half, CENTER_Y + half
        pts = [
            {"x": x0, "y": y0, "penDown": False},
            {"x": x0, "y": y0, "penDown": True},
            *_interpolate_line((x0, y0), (x1, y1), True, step_mm),
            *_interpolate_line((x1, y1), (x2, y2), True, step_mm),
            *_interpolate_line((x2, y2), (x3, y3), True, step_mm),
            *_interpolate_line((x3, y3), (x0, y0), True, step_mm),
            {"x": x0, "y": y0, "penDown": False},
        ]
    elif t == "5":
        # 100mm at 45 degrees
        dx = dy = 70.710678
        start = (CENTER_X, CENTER_Y)
        end = (CENTER_X + dx, CENTER_Y + dy)
        pts = [
            {"x": start[0], "y": start[1], "penDown": False},
            {"x": start[0], "y": start[1], "penDown": True},
            *_interpolate_line(start, end, True, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ]
    elif t == "8":
        # Pen-up vs pen-down drift on same line (300mm horizontal at y=200)
        start = (CENTER_X - 150.0, 200.0)
        end = (CENTER_X + 150.0, 200.0)
        # pass 1: pen up (travel only)
        pts.extend(_travel_and_draw([
            {"x": start[0], "y": start[1], "penDown": False},
            * _interpolate_line(start, end, False, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ]))
        # pass 2: pen down
        pts.extend([
            {"x": start[0], "y": start[1], "penDown": False},
            {"x": start[0], "y": start[1], "penDown": True},
            *_interpolate_line(start, end, True, step_mm),
            {"x": end[0], "y": end[1], "penDown": False},
        ])
    else:
        raise ValueError(f"Unsupported test id: {test}")

    return pts


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


def send_test(controller_url: str, test_id: str, speed: int, step_mm: float, batch_size: int) -> None:
    points = build_test_points(test_id, step_mm)
    payload = {
        "reset": True,
        "speed": speed,
        "startPosition": {"x": points[0]["x"], "y": points[0]["y"]},
        "points": points,
    }

    sender = PathSender(batch_size=max(1, batch_size))
    status_url = _derive_status_url(controller_url)
    cancel_url = _derive_cancel_url(controller_url)

    # Ensure controller queue is idle before starting
    if not _wait_until_idle(status_url):
        raise RuntimeError("Controller did not become idle before sending test")

    print(f"Test {test_id}: sending {len(points)} points in batches of {sender.batch_size} to {controller_url}...")
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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run diagnostic motion tests on the polargraph.")
    parser.add_argument("test", nargs="?", default="1", choices=["1", "2", "3", "4", "5", "8", "all"],
                        help="Which test to run (1,2,3,4,5,8, or 'all'). Tests 6/7 are not automated.")
    parser.add_argument("controller_url", nargs="?", default=DEFAULT_URL,
                        help=f"Controller /api/path endpoint (default: {DEFAULT_URL})")
    parser.add_argument("--speed", type=int, default=DEFAULT_SPEED,
                        help=f"Feed speed (default: {DEFAULT_SPEED})")
    parser.add_argument("--step-mm", type=float, default=DEFAULT_STEP_MM,
                        help=f"Interpolation step (default: {DEFAULT_STEP_MM} mm)")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH,
                        help=f"Points per HTTP batch (default: {DEFAULT_BATCH})")
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    controller_url = args.controller_url.rstrip("/")
    step_mm = max(0.25, float(args.step_mm))
    batch_size = max(1, int(args.batch_size))

    tests = [args.test] if args.test != "all" else ["1", "2", "3", "4", "5", "8"]

    for tid in tests:
        try:
            send_test(controller_url, tid, args.speed, step_mm, batch_size)
        except PathSenderBusyError:
            print("Controller already has an active transmission; wait or cancel first.")
            return 1
        except RuntimeError as exc:
            print(f"Test {tid} aborted: {exc}")
            return 1
        except Exception as exc:  # noqa: BLE001
            print(f"Test {tid} failed to start/send: {exc}")
            return 1
        print()

    print("All requested tests completed (or attempted).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
