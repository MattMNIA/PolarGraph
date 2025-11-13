"""Send simple geometric drawing paths to the ESP32 polargraph controller.

Usage examples::

    # Draw all shapes with default layout
    python -m visualization.examples.draw_shapes --controller http://192.168.50.139/api/path --shapes all

    # Draw only the square at double speed
    python -m visualization.examples.draw_shapes --controller http://192.168.50.139/api/path --shapes square --speed 2400

The script uses the same planning utilities as the simulation code but streams the
resulting path to the microcontroller over HTTP using the async ``PathSender``.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from typing import Iterable, List, Sequence, Tuple

import requests

from polargraph.kinematics import Polargraph
from polargraph.path_planner import plan_pen_aware_path
from polargraph.path_sender import FINAL_JOB_STATUSES, PathSender, PathSenderBusyError

Point = Tuple[float, float]
PenPoint = Tuple[float, float, bool]

DEFAULT_BOARD_WIDTH = 900.0
DEFAULT_BOARD_HEIGHT = 550.0


def _ensure_within_board(points: Iterable[Point], width: float, height: float) -> None:
    for x, y in points:
        if not (0.0 <= x <= width and 0.0 <= y <= height):
            raise ValueError(f"Point ({x:.2f}, {y:.2f}) is outside the board {width}x{height}")


def _square_path(step_mm: float, side_mm: float, origin: Point) -> List[PenPoint]:
    x0, y0 = origin
    anchors = [
        (x0, y0),
        (x0 + side_mm, y0),
        (x0 + side_mm, y0 + side_mm),
        (x0, y0 + side_mm),
        (x0, y0),
    ]
    return plan_pen_aware_path([anchors], step_mm=step_mm)


def _circle_path(step_mm: float, center: Point, radius_mm: float, segments: int = 64) -> List[PenPoint]:
    cx, cy = center
    anchors = []
    for i in range(segments):
        theta = (2.0 * math.pi * i) / segments
        anchors.append((cx + radius_mm * math.cos(theta), cy + radius_mm * math.sin(theta)))
    anchors.append(anchors[0])
    return plan_pen_aware_path([anchors], step_mm=step_mm)


def _triangle_path(step_mm: float, a: Point, b: Point, c: Point) -> List[PenPoint]:
    anchors = [a, b, c, a]
    return plan_pen_aware_path([anchors], step_mm=step_mm)


def _combine_paths(paths: Sequence[Sequence[PenPoint]]) -> List[PenPoint]:
    combined: List[PenPoint] = []
    for idx, segment in enumerate(paths):
        if not segment:
            continue
        if combined and segment[0][2]:
            # the first entry should be pen-up for travel; ensure it is
            x, y, _ = segment[0]
            segment = [(x, y, False), *segment[1:]]
        combined.extend(segment)
    if combined:
        # add a final pen-up entry so the pen is raised after drawing
        last_x, last_y, _ = combined[-1]
        combined.append((last_x, last_y, False))
    return combined


def _to_payload(points: Sequence[PenPoint]) -> List[dict]:
    return [{"x": float(x), "y": float(y), "penDown": bool(pen)} for x, y, pen in points]


def _derive_status_url(controller_path_url: str) -> str:
    if controller_path_url.endswith('/path'):
        base = controller_path_url[: -len('/path')]
    else:
        base = controller_path_url.rstrip('/')
    return f"{base}/status"


def _derive_cancel_url(controller_path_url: str) -> str:
    if controller_path_url.endswith('/path'):
        base = controller_path_url[: -len('/path')]
    else:
        base = controller_path_url.rstrip('/')
    return f"{base}/cancel"


def _normalize_controller_url(raw: str) -> str:
    if not raw:
        raise ValueError("controller URL must be provided")
    url = raw.strip()
    if not url:
        raise ValueError("controller URL must be provided")
    if url.endswith('/'):
        url = url[:-1]
    if not url.endswith('/api/path'):
        url = f"{url}/api/path"
    return url


def _wait_for_completion(sender: PathSender, poll_interval: float = 0.5) -> None:
    try:
        while True:
            status = sender.status()
            if not status:
                time.sleep(poll_interval)
                continue
            state = status.get('status')
            if state in FINAL_JOB_STATUSES or state == 'idle':
                final_state = status.get('lastState', state)
                print(f"Transmission finished with status: {final_state}")
                if status.get('error'):
                    print(f"Controller reported error: {status['error']}")
                return
            sent = status.get('sentPoints', 0)
            total = status.get('totalPoints', 0)
            print(f"Progress: {sent}/{total} points sent", end='\r', flush=True)
            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\nCancel requested, attempting to stop current job...")
        sender.cancel_current()
        raise


def build_paths(args: argparse.Namespace, board_width: float, board_height: float) -> List[PenPoint]:
    step = args.step_mm
    paths: List[List[PenPoint]] = []

    if 'square' in args.shapes or 'all' in args.shapes:
        square = _square_path(step, args.square_size_mm, (args.square_origin_x, args.square_origin_y))
        _ensure_within_board([(x, y) for x, y, _ in square], board_width, board_height)
        paths.append(square)

    if 'circle' in args.shapes or 'all' in args.shapes:
        circle = _circle_path(step, (args.circle_center_x, args.circle_center_y), args.circle_radius_mm, args.circle_segments)
        _ensure_within_board([(x, y) for x, y, _ in circle], board_width, board_height)
        paths.append(circle)

    if 'triangle' in args.shapes or 'all' in args.shapes:
        triangle = _triangle_path(
            step,
            (args.triangle_ax, args.triangle_ay),
            (args.triangle_bx, args.triangle_by),
            (args.triangle_cx, args.triangle_cy),
        )
        _ensure_within_board([(x, y) for x, y, _ in triangle], board_width, board_height)
        paths.append(triangle)

    if not paths:
        raise ValueError('No shapes selected; nothing to draw')

    return _combine_paths(paths)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Send simple geometric paths to the polargraph controller')
    parser.add_argument('--controller', required=True, help='Controller base URL or full /api/path endpoint')
    parser.add_argument('--speed', type=int, default=1200, help='Drawing speed in controller units (default: 1200)')
    parser.add_argument('--step-mm', type=float, default=8.0, help='Interpolation step in millimetres (default: 8.0)')
    parser.add_argument('--board-width', type=float, default=DEFAULT_BOARD_WIDTH, help='Board width in millimetres')
    parser.add_argument('--board-height', type=float, default=DEFAULT_BOARD_HEIGHT, help='Board height in millimetres')
    parser.add_argument('--shapes', nargs='+', default=['all'], choices=['square', 'circle', 'triangle', 'all'],
                        help='Shapes to draw (default: all)')
    parser.add_argument('--square-size-mm', type=float, default=120.0)
    parser.add_argument('--square-origin-x', type=float, default=320.0)
    parser.add_argument('--square-origin-y', type=float, default=220.0)
    parser.add_argument('--circle-radius-mm', type=float, default=90.0)
    parser.add_argument('--circle-center-x', type=float, default=780.0)
    parser.add_argument('--circle-center-y', type=float, default=280.0)
    parser.add_argument('--circle-segments', type=int, default=72)
    parser.add_argument('--triangle-ax', type=float, default=460.0)
    parser.add_argument('--triangle-ay', type=float, default=540.0)
    parser.add_argument('--triangle-bx', type=float, default=660.0)
    parser.add_argument('--triangle-by', type=float, default=600.0)
    parser.add_argument('--triangle-cx', type=float, default=540.0)
    parser.add_argument('--triangle-cy', type=float, default=360.0)
    parser.add_argument('--batch-size', type=int, default=150, help='Number of points per HTTP batch (default: 150)')
    parser.add_argument('--no-reset', action='store_true', help='Do not reset controller state before drawing')
    parser.add_argument('--status-url', help='Override controller status URL (defaults to derived value)')
    parser.add_argument('--cancel-url', help='Override controller cancel URL (defaults to derived value)')
    parser.add_argument('--http-timeout', type=float, default=60.0,
                        help='HTTP request timeout in seconds; must cover the time the controller needs to execute one batch (default: 60)')
    parser.add_argument('--status-timeout', type=float, default=600.0,
                        help='Maximum time to wait for the controller to become idle between batches (default: 600)')
    parser.add_argument('--retry-timeout', type=float, default=600.0,
                        help='Maximum time to keep retrying a failed HTTP POST (default: 600)')
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        controller_url = _normalize_controller_url(args.controller)
    except ValueError as exc:
        print(f"Invalid controller URL: {exc}")
        return 2

    board_width = args.board_width
    board_height = args.board_height

    try:
        combined_path = build_paths(args, board_width, board_height)
    except ValueError as exc:
        print(f"Path planning error: {exc}")
        return 2

    payload = _to_payload(combined_path)
    first_entry = payload[0]
    start_position = {
        'x': first_entry['x'],
        'y': first_entry['y'],
        'penDown': False,
    }

    status_url = args.status_url or _derive_status_url(controller_url)
    cancel_url = args.cancel_url or _derive_cancel_url(controller_url)

    sender = PathSender(
        batch_size=max(1, args.batch_size),
        timeout=max(1.0, float(args.http_timeout)),
        status_timeout=max(float(args.http_timeout), float(args.status_timeout)),
        send_retry_timeout=max(float(args.http_timeout), float(args.retry_timeout)),
    )

    try:
        print(f"Sending {len(payload)} points to {controller_url} at speed {args.speed}...")
        job = sender.start_job(
            controller_url=controller_url,
            points=payload,
            start_position=start_position,
            speed=max(1, int(args.speed)),
            reset=not args.no_reset,
            status_url=status_url,
            cancel_url=cancel_url,
        )
        print(f"Job {job.job_id} started (batch size {job.batch_size}).")
    except PathSenderBusyError:
        print('Controller already has an active transmission; wait for it to finish or cancel it first.')
        return 1
    except requests.RequestException as exc:
        print(f"Failed to contact controller: {exc}")
        return 1

    try:
        _wait_for_completion(sender)
    except KeyboardInterrupt:
        print('Draw cancelled by user.')
        return 130

    status = sender.status()
    if status and status.get('status') == 'completed':
        print('Drawing completed successfully!')
        return 0

    print('Drawing did not complete successfully. Check controller logs for details.')
    if status:
        print(status)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
