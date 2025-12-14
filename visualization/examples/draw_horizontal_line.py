"""Send a 50mm horizontal test line from board center to the right."""
from __future__ import annotations

import argparse
import json
from typing import Dict, Any

import requests

BOARD_WIDTH_MM = 1150.0
BOARD_HEIGHT_MM = 730.0
LINE_LENGTH_MM = 50.0
POINT_STEP_MM = 1.0
DEFAULT_SPEED = 1200
DEFAULT_URL = "http://192.168.50.95/api/path"


def _interpolate_line(center_x: float, center_y: float) -> list[Dict[str, Any]]:
    end_x = center_x + LINE_LENGTH_MM
    points: list[Dict[str, Any]] = []

    # Travel to start with pen up, then lower pen
    points.append({"x": center_x, "y": center_y, "penDown": False})
    points.append({"x": center_x, "y": center_y, "penDown": True})

    steps = max(1, int(LINE_LENGTH_MM / POINT_STEP_MM))
    for i in range(1, steps + 1):
        x = center_x + min(LINE_LENGTH_MM, i * POINT_STEP_MM)
        points.append({"x": x, "y": center_y, "penDown": True})

    # Ensure the final point is exactly at the end
    if abs(points[-1]["x"] - end_x) > 1e-6:
        points.append({"x": end_x, "y": center_y, "penDown": True})

    # Lift pen after finishing the line
    points.append({"x": end_x, "y": center_y, "penDown": False})
    return points


def build_payload(speed: int) -> Dict[str, Any]:
    center_x = BOARD_WIDTH_MM / 2.0
    center_y = BOARD_HEIGHT_MM / 2.0

    points = _interpolate_line(center_x, center_y)

    return {
        "reset": True,
        "speed": speed,
        "startPosition": {"x": center_x, "y": center_y},
        "points": points,
    }


def send_line(controller_url: str, speed: int) -> None:
    payload = build_payload(speed)
    json_str = json.dumps(payload)
    response = requests.post(
        controller_url,
        data={"plain": json_str},
        timeout=30,
    )
    response.raise_for_status()
    print("Controller response:")
    print(response.text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Draw a 50mm horizontal line from board center to the right.")
    parser.add_argument(
        "controller_url",
        nargs="?",
        default=DEFAULT_URL,
        help=f"Controller /api/path endpoint (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--speed",
        type=int,
        default=DEFAULT_SPEED,
        help=f"Feed speed for the move (default: {DEFAULT_SPEED})",
    )
    args = parser.parse_args()

    send_line(args.controller_url.rstrip("/"), args.speed)


if __name__ == "__main__":
    main()
