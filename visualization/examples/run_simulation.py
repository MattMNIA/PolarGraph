"""Example runner to animate a polargraph drawing from an image or a generated spiral.

Usage:
    python examples/run_simulation.py --image ../images/my_image.png --board-width 1150 --board-height 730
"""
import argparse
import math
import os
import sys

from PIL import Image
import matplotlib.pyplot as plt
import cv2
import numpy as np

from polargraph.kinematics import Polargraph
from polargraph.path_planner import plan_pen_aware_path, optimize_contour_order, optimize_path_directions, combine_image_paths
from polargraph.plot import animate_path
from polargraph.whiteboard_manager import WhiteboardManager


def make_spiral(width, height, turns=5, points=2000):
    cx = width / 2.0
    cy = height / 2.0
    max_r = min(width, height) * 0.45
    pts = []
    for i in range(points):
        t = i / (points - 1)
        ang = t * turns * 2 * math.pi
        r = t * max_r
        x = cx + r * math.cos(ang)
        y = cy + r * math.sin(ang)
        pts.append((x, y))
    return pts


def main():
    parser = argparse.ArgumentParser(description='Polargraph drawing simulation with multiple image support')
    parser.add_argument('--images', nargs='*', help='List of image files to draw (can specify multiple)')
    parser.add_argument('--positions', nargs='*', type=float, help='Positions for images as x,y,width,height (repeat for each image)')
    parser.add_argument('--board-width', type=int, default=1150)
    parser.add_argument('--board-height', type=int, default=730)
    parser.add_argument('--step-mm', type=float, default=2.0)
    parser.add_argument('--method', choices=['contour', 'hatch'], default='contour', help='Image processing method: contour or hatch')
    parser.add_argument('--spacing', type=int, default=4, help='Minimum spacing between hatch lines in pixels (for hatch method - adaptive spacing used)')
    parser.add_argument('--adaptive', action='store_true', default=True, help='Use adaptive spacing for hatch method (default: True)')
    parser.add_argument('--no-adaptive', action='store_false', dest='adaptive', help='Use fixed spacing for hatch method')
    # Legacy single image support
    parser.add_argument('--image', help='Single input image to trace (legacy, use --images instead)')
    args = parser.parse_args()

    pg = Polargraph(args.board_width, args.board_height)

    # Handle legacy single image mode
    if args.image and not args.images:
        args.images = [args.image]
        # Default position: center the image
        img = Image.open(args.image)
        w, h = img.size
        scale = min(args.board_width / w, args.board_height / h)
        width = max(1, int(round(w * scale)))
        height = max(1, int(round(h * scale)))
        x = (args.board_width - width) / 2
        y = (args.board_height - height) / 2
        args.positions = [x, y, width, height]

    # Check if we have images to process
    if not args.images:
        print("No images specified. Use --images to specify image files.")
        return

    # Validate positions
    if args.positions:
        if len(args.positions) != len(args.images) * 4:
            print(f"Error: Expected {len(args.images) * 4} position values (x,y,width,height for each image), got {len(args.positions)}")
            return
    else:
        # Auto-position images in a grid
        num_images = len(args.images)
        cols = int(math.ceil(math.sqrt(num_images)))
        rows = int(math.ceil(num_images / cols))

        img_width = args.board_width / cols
        img_height = args.board_height / rows

        args.positions = []
        for i in range(num_images):
            row = i // cols
            col = i % cols
            x = col * img_width
            y = row * img_height
            args.positions.extend([x, y, img_width, img_height])

    try:
        from polargraph.image_processing import image_to_contour_paths, image_to_hatch_paths
    except Exception as e:
        print('Image processing not available:', e)
        return

    # Create whiteboard manager
    wb_manager = WhiteboardManager(args.board_width, args.board_height)

    # Process each image
    all_image_paths = []
    debug_info = []

    for i, image_path in enumerate(args.images):
        pos_idx = i * 4
        x, y, width, height = args.positions[pos_idx:pos_idx+4]

        wb_manager.add_image(image_path, x, y, width, height)

        print(f"Processing image {i+1}/{len(args.images)}: {image_path} at ({x:.1f}, {y:.1f}) size {width:.1f}x{height:.1f}")

        pixel_paths = []
        paths = []
        intermediates = []

        if args.method == 'contour':
            pixel_paths, paths, intermediates = image_to_contour_paths(image_path, args.board_width, args.board_height,
                                                                     x, y, width, height)
        elif args.method == 'hatch':
            pixel_paths, paths, intermediates = image_to_hatch_paths(image_path, args.board_width, args.board_height,
                                                                   x, y, width, height, spacing=args.spacing, adaptive=args.adaptive)

        if not paths:
            print(f'Warning: No paths found in image {image_path}')
            continue

        all_image_paths.append(paths)
        debug_info.append((pixel_paths, paths, intermediates, image_path))

    if not all_image_paths:
        print('No valid paths found in any images')
        return

    # Combine all paths from all images
    path = combine_image_paths(all_image_paths, step_mm=args.step_mm)

    # Create combined background image
    combined_bg = wb_manager.get_combined_image()
    if combined_bg is not None:
        bg_img = Image.fromarray(combined_bg)
        bg_img.save("combined_whiteboard.png")
        bg = "combined_whiteboard.png"
    else:
        bg = None

    # Show layout info
    layout_info = wb_manager.get_layout_info()
    print(f"Whiteboard layout: {layout_info['num_images']} images on {layout_info['board_size'][0]}x{layout_info['board_size'][1]} board")
    for i, img_info in enumerate(layout_info['images']):
        print(f"  Image {i+1}: {img_info['path']} at {img_info['position']} size {img_info['size']}")

    animate_path(pg, path, interval_ms=10, show=True, background_image=bg)


if __name__ == '__main__':
    main()
