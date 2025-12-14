"""Send a 50mm diameter circle centered on the board to the controller."""
from __future__ import annotations

import argparse
import json
import math
from typing import Any, Dict, List

import requests

BOARD_WIDTH_MM = 1150.0
BOARD_HEIGHT_MM = 730.0
CIRCLE_DIAMETER_MM = 50.0
CIRCLE_RADIUS_MM = CIRCLE_DIAMETER_MM / 2.0
CIRCLE_SEGMENTS = 72
DEFAULT_SPEED = 1200
DEFAULT_URL = "http://192.168.50.95/api/path"


def build_circle_points() -> List[Dict[str, Any]]:
    cx = BOARD_WIDTH_MM / 2.0
    cy = BOARD_HEIGHT_MM / 2.0
    start_x = cx + CIRCLE_RADIUS_MM
    start_y = cy

    points: List[Dict[str, Any]] = []
    # Move to the first circumference point with pen up
    points.append({"x": start_x, "y": start_y, "penDown": False})
    # Put the pen down at the start point
    points.append({"x": start_x, "y": start_y, "penDown": True})

    for i in range(1, CIRCLE_SEGMENTS + 1):
        theta = (2.0 * math.pi * i) / CIRCLE_SEGMENTS
        x = cx + CIRCLE_RADIUS_MM * math.cos(theta)
        y = cy + CIRCLE_RADIUS_MM * math.sin(theta)
        points.append({"x": x, "y": y, "penDown": True})

    # Lift pen after completing the loop (already returns to start point at i == segments)
    points.append({"x": start_x, "y": start_y, "penDown": False})
    return points


def build_payload(speed: int) -> Dict[str, Any]:
    center_x = BOARD_WIDTH_MM / 2.0
    center_y = BOARD_HEIGHT_MM / 2.0
    points = build_circle_points()
    return {
        "reset": True,
        "speed": speed,
        "startPosition": {"x": center_x, "y": center_y},
        "points": points,
    }


def send_circle(controller_url: str, speed: int) -> None:
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
    parser = argparse.ArgumentParser(description="Draw a 50mm diameter circle centered on the board.")
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

    send_circle(args.controller_url.rstrip("/"), args.speed)


if __name__ == "__main__":
    main()
