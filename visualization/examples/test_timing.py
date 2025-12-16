"""Test script to draw shapes and measure timing."""
from __future__ import annotations

import argparse
import math
import sys
import time
import requests
from typing import List, Tuple

from polargraph.path_planner import plan_pen_aware_path
from polargraph.path_sender import PathSender, PathSenderBusyError

Point = Tuple[float, float]
PenPoint = Tuple[float, float, bool]

DEFAULT_BOARD_WIDTH = 1150.0
DEFAULT_BOARD_HEIGHT = 730.0

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

def _to_payload(points: List[PenPoint]) -> List[dict]:
    return [{"x": float(x), "y": float(y), "penDown": bool(pen)} for x, y, pen in points]

def main():
    parser = argparse.ArgumentParser(description="Draw shapes and measure timing")
    parser.add_argument("--controller", required=True, help="Controller URL (e.g. http://192.168.1.100/api/path)")
    parser.add_argument("--shape", choices=["square", "circle"], default="square", help="Shape to draw")
    parser.add_argument("--size", type=float, default=100.0, help="Size in mm (side length or radius)")
    parser.add_argument("--speed", type=int, default=5000, help="Drawing speed")
    parser.add_argument("--step", type=float, default=1.0, help="Interpolation step size in mm")
    
    args = parser.parse_args()
    
    center_x = DEFAULT_BOARD_WIDTH / 2
    center_y = DEFAULT_BOARD_HEIGHT / 2
    
    print(f"Generating {args.shape} path with step={args.step}mm...")
    
    if args.shape == "square":
        origin = (center_x - args.size/2, center_y - args.size/2)
        points = _square_path(args.step, args.size, origin)
    else:
        points = _circle_path(args.step, (center_x, center_y), args.size)
        
    payload_points = _to_payload(points)
    print(f"Generated {len(payload_points)} points")
    
    sender = PathSender(batch_size=200)
    
    # Fix potential double-protocol in URL
    controller_url = args.controller
    if controller_url.startswith("http://http://"):
        controller_url = controller_url.replace("http://http://", "http://")
        print(f"Fixed malformed URL: {controller_url}")

    # Determine start position
    start_pos = None
    status_url = controller_url.replace("/path", "/status")
    
    try:
        # Quick check to see if we can get status, otherwise default to center
        resp = requests.get(status_url, timeout=2.0)
        if not resp.ok:
             print(f"Status check failed ({resp.status_code}). Assuming start at center.")
             start_pos = {"x": center_x, "y": center_y, "penDown": False}
    except Exception:
        print("Status check failed (connection error). Assuming start at center.")
        start_pos = {"x": center_x, "y": center_y, "penDown": False}

    try:
        print(f"Sending to {controller_url}...")
        start_time = time.time()
        
        job = sender.start_job(
            controller_url=controller_url,
            points=payload_points,
            start_position=start_pos,
            speed=args.speed,
            reset=True,
            status_url=status_url
        )
        
        print(f"Job started: {job.job_id}")
        
        while job.status in {"pending", "running"}:
            time.sleep(0.5)
            status = sender.status()
            if status:
                sent = status.get("sentPoints", 0)
                total = status.get("totalPoints", 0)
                print(f"Progress: {sent}/{total} points", end="\r")
                
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"\nJob finished with status: {job.status}")
        if job.error:
            print(f"Error: {job.error}")
        else:
            print(f"Total time: {duration:.2f} seconds")
            
    except Exception as e:
        print(f"\nError: {e}")

if __name__ == "__main__":
    main()
