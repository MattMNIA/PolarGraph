#!/usr/bin/env python3
"""
Flask API server for Whiteboard Designer visualization
"""

import os
import sys
import base64
import tempfile
import subprocess
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urlunparse
from flask import Flask, request, jsonify
try:
    from flask_cors import CORS  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency during static analysis
    CORS = None  # type: ignore
import traceback
import cv2
import numpy as np
from PIL import Image, ImageDraw

# Set matplotlib backend to non-interactive to prevent threading issues (if matplotlib is available)
try:
    import matplotlib
    matplotlib.use('Agg')
except ImportError:
    pass

# Add the current directory to Python path for imports
sys.path.insert(0, str(Path(__file__).parent))

from polargraph.path_sender import PathSender, PathSenderBusyError  # noqa: E402

app = Flask(__name__)
if CORS:
    CORS(app)  # Enable CORS for all routes

path_sender = PathSender(batch_size=100)


def _normalize_transmission_points(raw_points):
    if not isinstance(raw_points, (list, tuple)):
        raise ValueError('path must be a list of points')

    normalized = []
    for entry in raw_points:
        if isinstance(entry, dict):
            if 'x' not in entry or 'y' not in entry:
                raise ValueError("point objects must include 'x' and 'y'")
            x = float(entry['x'])
            y = float(entry['y'])
            pen_down = bool(entry.get('penDown', entry.get('pen_down', entry.get('pen'))))
        elif isinstance(entry, (list, tuple)):
            if len(entry) < 2:
                raise ValueError('point arrays must include at least x and y values')
            x = float(entry[0])
            y = float(entry[1])
            pen_down = bool(entry[2]) if len(entry) > 2 else True
        else:
            raise ValueError('points must be objects or [x, y, penDown] arrays')

        normalized.append({'x': x, 'y': y, 'penDown': pen_down})

    return normalized


def _derive_start_position(explicit_start, points):
    if isinstance(explicit_start, dict) and 'x' in explicit_start and 'y' in explicit_start:
        return {'x': float(explicit_start['x']), 'y': float(explicit_start['y'])}
    if not points:
        return None
    first_point = points[0]
    return {'x': first_point['x'], 'y': first_point['y']}


def _derive_status_url(controller_url: Optional[str], explicit_status_url: Optional[str] = None) -> Optional[str]:
    if explicit_status_url:
        return explicit_status_url.rstrip('/')
    if not controller_url:
        return None

    if not isinstance(controller_url, str):
        controller_url = str(controller_url)

    controller_url = controller_url.strip()
    parsed = urlparse(controller_url)
    path = (parsed.path or '').rstrip('/')

    if not path:
        status_path = '/api/status'
    elif path.endswith('/status'):
        status_path = path
    elif path.endswith('/path'):
        base_path = path[: -len('/path')]
        if not base_path:
            base_path = '/api'
        status_path = f"{base_path}/status"
    else:
        status_path = f"{path}/status"

    cleaned = parsed._replace(path=status_path, params='', query='', fragment='')
    return urlunparse(cleaned)


def _derive_path_url(controller_url: Optional[str], explicit_path_url: Optional[str] = None) -> Optional[str]:
    if explicit_path_url:
        return explicit_path_url.rstrip('/')
    if not controller_url:
        return None

    if not isinstance(controller_url, str):
        controller_url = str(controller_url)

    controller_url = controller_url.strip()
    if not controller_url:
        return None

    parsed = urlparse(controller_url)
    path = (parsed.path or '').rstrip('/')

    if not path:
        path_path = '/api/path'
    elif path.endswith('/path'):
        path_path = path
    elif path.endswith('/api'):
        path_path = f"{path}/path"
    else:
        path_path = f"{path}/path"

    cleaned = parsed._replace(path=path_path, params='', query='', fragment='')
    return urlunparse(cleaned)


def _flatten_path_for_transmission(path_points):
    flattened = []
    for entry in path_points:
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            x, y = entry[0], entry[1]
            pen_down = bool(entry[2]) if len(entry) > 2 else True
        elif isinstance(entry, dict):
            x = entry.get('x')
            y = entry.get('y')
            if x is None or y is None:
                continue
            pen_down = entry.get('penDown', True)
        else:
            continue
        flattened.append({'x': float(x), 'y': float(y), 'penDown': bool(pen_down)})
    return flattened


def _as_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)

@app.route('/hello')
def hello():
    return "Hello, World!"

@app.route('/api/visualize', methods=['POST'])
def visualize():
    """API endpoint for running polargraph visualization"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        images = data.get('images', [])
        positions = data.get('positions', [])
        text_elements = data.get('textElements', [])
        board_width = data.get('boardWidth', 1150)
        board_height = data.get('boardHeight', 730)
        method = data.get('method', 'contour')
        spacing = data.get('spacing', 4)
        adaptive = data.get('adaptive', True)
        send_to_controller = _as_bool(data.get('sendToController', False))
        include_path_points = _as_bool(data.get('includePathPoints', False))
        controller_url = data.get('controllerUrl') or data.get('controllerURL') or data.get('controller')
        if isinstance(controller_url, str):
            controller_url = controller_url.strip()
        controller_path_override = data.get('controllerPathUrl') or data.get('controllerPathURL')
        if isinstance(controller_path_override, str):
            controller_path_override = controller_path_override.strip()
        else:
            controller_path_override = None
        controller_speed_value = data.get('controllerSpeed', data.get('controller_speed', 1800))
        controller_reset = _as_bool(data.get('controllerReset', True))
        controller_start = data.get('controllerStartPosition') or data.get('startPosition')

        if not images and not text_elements:
            return jsonify({'error': 'No images or text elements provided'}), 400

        if images and len(positions) != len(images) * 4:
            return jsonify({
                'error': f'Expected {len(images) * 4} position values, got {len(positions)}'
            }), 400

        # Create temporary directory for images
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save base64 images to temporary files
            image_paths = []
            for i, image_data in enumerate(images):
                # Remove data URL prefix if present
                if image_data.startswith('data:image/'):
                    image_data = image_data.split(',')[1]

                # Decode base64
                image_bytes = base64.b64decode(image_data)
                image_path = os.path.join(temp_dir, f'image_{i}.png')

                with open(image_path, 'wb') as f:
                    f.write(image_bytes)

                image_paths.append(image_path)

            # Prepare command line arguments for the Python script
            script_path = os.path.join(os.path.dirname(__file__), 'examples', 'run_simulation.py')
            cmd = [
                sys.executable, script_path,
                '--board-width', str(board_width),
                '--board-height', str(board_height),
                '--method', method,
                '--spacing', str(spacing),
                '--images'
            ] + image_paths + [
                '--positions'
            ] + [str(p) for p in positions]

            # Process images and create path visualization directly
            try:
                import cv2
                import numpy as np
                from polargraph.image_processing import image_to_contour_paths, image_to_hatch_paths
                from polargraph.path_planner import combine_image_paths
                from PIL import Image, ImageDraw, ImageFont

                # Create a white background image for path visualization
                board_img = np.ones((board_height, board_width, 3), dtype=np.uint8) * 255

                # Process each image and text element using the selected method and collect all paths
                all_image_paths = []
                total_path_length = 0

                # Process image elements
                for i, image_path in enumerate(image_paths):
                    pos_idx = i * 4
                    x, y, width, height = positions[pos_idx:pos_idx+4]

                    # Use the selected method
                    if method == 'contour':
                        pixel_paths, paths, intermediates = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )
                    elif method == 'hatch':
                        # For hatch mode, get both contour and hatch paths
                        pixel_paths_contour, paths_contour, intermediates_contour = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )
                        pixel_paths_hatch, paths_hatch, intermediates_hatch = image_to_hatch_paths(
                            image_path, board_width, board_height, x, y, width, height, spacing=spacing, adaptive=adaptive
                        )
                        # Combine contour and hatch paths
                        paths = paths_contour + paths_hatch if paths_contour and paths_hatch else (paths_contour or paths_hatch or [])
                        pixel_paths = pixel_paths_contour  # Use contour pixel paths for consistency
                        intermediates = intermediates_contour  # Use contour intermediates for consistency
                    else:
                        # Default to contour
                        pixel_paths, paths, intermediates = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )

                    if paths:
                        all_image_paths.append(paths)
                        total_path_length += sum(len(path) for path in paths)

                # Process text elements - convert each text to paths
                for text_element in text_elements:
                    text = text_element.get('text', '')
                    if not text.strip():
                        continue

                    x = text_element.get('x', 0)
                    y = text_element.get('y', 0)
                    width = text_element.get('width', 150)
                    height = text_element.get('height', 50)
                    font_size = max(text_element.get('fontSize', 36), 36)
                    font_family = text_element.get('fontFamily', 'arial')
                    is_bold = text_element.get('isBold', False)
                    is_italic = text_element.get('isItalic', False)
                    color = text_element.get('color', '#000000')
                    text_rendering_style = text_element.get('textRenderingStyle', 'filled')

                    # Create a small image just for this text element's bounding box
                    text_img = np.ones((height, width, 3), dtype=np.uint8) * 255
                    pil_text_img = Image.fromarray(text_img)
                    draw = ImageDraw.Draw(pil_text_img)

                    # Create font
                    font_weight = 'bold' if is_bold else 'normal'
                    font_style = 'italic' if is_italic else 'normal'

                    try:
                        # Try to load the specified font, fallback to default if not available
                        font = ImageFont.truetype(f"{font_family.lower()}.ttf", font_size)
                    except:
                        try:
                            # Try system fonts
                            if font_weight == 'bold' and font_style == 'italic':
                                font = ImageFont.truetype("arialbi.ttf", font_size)
                            elif font_weight == 'bold':
                                font = ImageFont.truetype("arialbd.ttf", font_size)
                            elif font_style == 'italic':
                                font = ImageFont.truetype("ariali.ttf", font_size)
                            else:
                                font = ImageFont.truetype("arial.ttf", font_size)
                        except:
                            # Fallback to default font
                            font = ImageFont.load_default()

                    # Calculate text size
                    bbox = draw.textbbox((0, 0), text, font=font)
                    text_width = bbox[2] - bbox[0]
                    text_height = bbox[3] - bbox[1]

                    # Center the text in the bounding box
                    text_x = (width - text_width) // 2
                    text_y = (height - text_height) // 2

                    # Render text based on style
                    if text_rendering_style == 'outline':
                        # Draw outline (stroke) - use white background, black outline
                        draw.text((text_x, text_y), text, fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
                    else:
                        # Draw filled text - white background, black text
                        draw.text((text_x, text_y), text, fill=(0, 0, 0), font=font)

                    # Convert back to numpy array
                    text_img = np.array(pil_text_img)

                    # Save temporary text image
                    text_temp_path = os.path.join(temp_dir, f'text_{len(all_image_paths)}.png')
                    cv2.imwrite(text_temp_path, text_img)

                    # Process text image to paths using the element's position and size
                    pixel_paths, paths, intermediates = image_to_contour_paths(
                        text_temp_path, board_width, board_height, x, y, width, height
                    )

                    if paths:
                        all_image_paths.append(paths)
                        total_path_length += sum(len(path) for path in paths)

                # Initialize preview variables
                path_preview = None
                preview_image = None
                path_points = []
                job_info = None

                # Combine all paths from all images
                if all_image_paths:
                    combined_path = combine_image_paths(all_image_paths)
                    path_points = _flatten_path_for_transmission(combined_path)

                    # Draw only the pen-down paths (exclude travel paths)
                    for point in combined_path:
                        if len(point) >= 3 and point[2]:  # point[2] is pen_down boolean
                            x, y = point[0], point[1]
                            # Convert to image coordinates (Y increases downward in images, but we want Y=0 at top)
                            # The combined_path uses whiteboard coordinates where Y=0 is at the top
                            img_x, img_y = int(x), int(y)

                            # Draw a small dot for each point in the drawing path
                            cv2.circle(board_img, (img_x, img_y), 1, (0, 0, 0), -1)

                    # Create a combined whiteboard preview with drawing path overlaid
                    try:
                        from polargraph.whiteboard_manager import WhiteboardManager
                        wb_manager = WhiteboardManager(board_width, board_height)

                        for i, image_path in enumerate(image_paths):
                            pos_idx = i * 4
                            x, y, width, height = positions[pos_idx:pos_idx+4]
                            wb_manager.add_image(image_path, x, y, width, height)

                        combined_bg = wb_manager.get_combined_image()
                        preview_image = None
                        if combined_bg is not None:
                            # Start with the combined images
                            combined_img = Image.fromarray(combined_bg)

                            # Overlay the drawing path on top
                            draw = ImageDraw.Draw(combined_img)

                            # Draw the pen-down paths as dots on the combined image
                            for point in combined_path:
                                if len(point) >= 3 and point[2]:  # point[2] is pen_down boolean
                                    x, y = point[0], point[1]
                                    # Draw small dots for the path
                                    draw.ellipse([x-1, y-1, x+1, y+1], fill='black')

                            combined_path_file = os.path.join(os.path.dirname(__file__), 'combined_whiteboard.png')
                            combined_img.save(combined_path_file)

                            with open(combined_path_file, 'rb') as f:
                                image_data = f.read()
                                preview_image = f"data:image/png;base64,{base64.b64encode(image_data).decode()}"
                    except Exception as preview_error:
                        print(f"Combined preview creation failed: {preview_error}")
                        preview_image = None

                    if send_to_controller:
                        controller_path_url = _derive_path_url(controller_url, controller_path_override)
                        if not controller_path_url:
                            return jsonify({'error': 'controllerUrl must resolve to a valid /api/path endpoint when sendToController is true'}), 400
                        if not path_points:
                            return jsonify({'error': 'No path points available to send'}), 400
                        try:
                            controller_speed = int(controller_speed_value)
                        except (TypeError, ValueError):
                            return jsonify({'error': 'controllerSpeed must be an integer'}), 400

                        start_position_payload = _derive_start_position(controller_start, path_points)
                        status_override = data.get('controllerStatusUrl') or data.get('controllerStatusURL')
                        if isinstance(status_override, str):
                            status_override = status_override.strip()
                        else:
                            status_override = None
                        status_url = _derive_status_url(controller_url, status_override)
                        try:
                            job = path_sender.start_job(
                                controller_url=controller_path_url,
                                points=path_points,
                                start_position=start_position_payload,
                                speed=controller_speed,
                                reset=controller_reset,
                                status_url=status_url,
                            )
                            job_info = {
                                'jobId': job.job_id,
                                'status': job.status,
                                'totalPoints': len(path_points),
                                'batchSize': job.batch_size,
                                'paused': job.paused,
                            }
                        except PathSenderBusyError:
                            return jsonify({'error': 'A path transmission is already in progress'}), 409

                # Save the path visualization (separate from combined preview)
                if all_image_paths:
                    path_viz_path = os.path.join(os.path.dirname(__file__), 'path_visualization.png')
                    cv2.imwrite(path_viz_path, board_img)

                    # Convert to base64
                    with open(path_viz_path, 'rb') as f:
                        path_image_data = f.read()
                        path_preview = f"data:image/png;base64,{base64.b64encode(path_image_data).decode()}"

                response_payload = {
                    'success': True,
                    'boardWidth': board_width,
                    'boardHeight': board_height,
                    'imageCount': len(images),
                    'pathLength': total_path_length,
                    'previewImage': preview_image,
                    'pathImage': path_preview,
                    'animationUrl': '/api/animation',  # Placeholder
                    'downloadUrl': '/api/download',  # Placeholder
                    'output': f"Processed {len(images)} images using {method} method with spacing {spacing}"
                }
                if include_path_points:
                    response_payload['pathPoints'] = path_points
                if job_info:
                    response_payload['pathJob'] = job_info

                return jsonify(response_payload)

            except Exception as e:
                print(f"Processing failed: {e}")
                traceback.print_exc()
                return jsonify({
                    'error': 'Path processing failed',
                    'details': str(e)
                }), 500

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Visualization timed out'}), 500
    except Exception as e:
        print(f"Error in visualize endpoint: {e}")
        traceback.print_exc()
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

@app.route('/api/animation', methods=['POST'])
def create_animation():
    """Create a drawing animation from the path data"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        images = data.get('images', [])
        positions = data.get('positions', [])
        text_elements = data.get('textElements', [])
        board_width = data.get('boardWidth', 1150)
        board_height = data.get('boardHeight', 730)
        method = data.get('method', 'contour')
        spacing = data.get('spacing', 4)
        adaptive = data.get('adaptive', False)

        if not images and not text_elements:
            return jsonify({'error': 'No images or text elements provided'}), 400

        if images and len(positions) != len(images) * 4:
            return jsonify({
                'error': f'Expected {len(images) * 4} position values, got {len(positions)}'
            }), 400

        # Create temporary directory for images
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save base64 images to temporary files
            image_paths = []
            for i, image_data in enumerate(images):
                if image_data.startswith('data:image/'):
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
                image_path = os.path.join(temp_dir, f'image_{i}.png')
                with open(image_path, 'wb') as f:
                    f.write(image_bytes)
                image_paths.append(image_path)

            # Process images and get drawing paths
            try:
                from polargraph.image_processing import image_to_contour_paths, image_to_hatch_paths
                from polargraph.path_planner import combine_image_paths
                from PIL import Image, ImageDraw, ImageFont

                # Process each image using the selected method
                all_image_paths = []
                for i, image_path in enumerate(image_paths):
                    pos_idx = i * 4
                    x, y, width, height = positions[pos_idx:pos_idx+4]

                    if method == 'contour':
                        pixel_paths, paths, intermediates = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )
                    elif method == 'hatch':
                        pixel_paths_contour, paths_contour, intermediates_contour = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )
                        pixel_paths_hatch, paths_hatch, intermediates_hatch = image_to_hatch_paths(
                            image_path, board_width, board_height, x, y, width, height, spacing=spacing, adaptive=adaptive
                        )
                        paths = paths_contour + paths_hatch if paths_contour and paths_hatch else (paths_contour or paths_hatch or [])
                    else:
                        pixel_paths, paths, intermediates = image_to_contour_paths(
                            image_path, board_width, board_height, x, y, width, height
                        )

                    if paths:
                        all_image_paths.append(paths)

                # Process text elements - convert each text to paths
                for text_element in text_elements:
                    text = text_element.get('text', '')
                    if not text.strip():
                        continue

                    x = text_element.get('x', 0)
                    y = text_element.get('y', 0)
                    width = text_element.get('width', 150)
                    height = text_element.get('height', 50)
                    font_size = max(text_element.get('fontSize', 36), 36)
                    font_family = text_element.get('fontFamily', 'arial')
                    is_bold = text_element.get('isBold', False)
                    is_italic = text_element.get('isItalic', False)
                    color = text_element.get('color', '#000000')
                    text_rendering_style = text_element.get('textRenderingStyle', 'filled')

                    # Create a small image just for this text element's bounding box
                    text_img = np.ones((height, width, 3), dtype=np.uint8) * 255
                    pil_text_img = Image.fromarray(text_img)
                    draw = ImageDraw.Draw(pil_text_img)

                    # Create font
                    font_weight = 'bold' if is_bold else 'normal'
                    font_style = 'italic' if is_italic else 'normal'

                    try:
                        # Try to load the specified font, fallback to default if not available
                        font = ImageFont.truetype(f"{font_family.lower()}.ttf", font_size)
                    except:
                        try:
                            # Try system fonts
                            if font_weight == 'bold' and font_style == 'italic':
                                font = ImageFont.truetype("arialbi.ttf", font_size)
                            elif font_weight == 'bold':
                                font = ImageFont.truetype("arialbd.ttf", font_size)
                            elif font_style == 'italic':
                                font = ImageFont.truetype("ariali.ttf", font_size)
                            else:
                                font = ImageFont.truetype("arial.ttf", font_size)
                        except:
                            # Fallback to default font
                            font = ImageFont.load_default()

                    # Calculate text size
                    bbox = draw.textbbox((0, 0), text, font=font)
                    text_width = bbox[2] - bbox[0]
                    text_height = bbox[3] - bbox[1]

                    # Center the text in the bounding box
                    text_x = (width - text_width) // 2
                    text_y = (height - text_height) // 2

                    # Render text based on style
                    if text_rendering_style == 'outline':
                        # Draw outline (stroke) - use white background, black outline
                        draw.text((text_x, text_y), text, fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
                    else:
                        # Draw filled text - white background, black text
                        draw.text((text_x, text_y), text, fill=(0, 0, 0), font=font)

                    # Convert back to numpy array
                    text_img = np.array(pil_text_img)

                    # Save temporary text image
                    text_temp_path = os.path.join(temp_dir, f'text_{len(all_image_paths)}.png')
                    cv2.imwrite(text_temp_path, text_img)

                    # Process text image to paths using the element's position and size
                    pixel_paths, paths, intermediates = image_to_contour_paths(
                        text_temp_path, board_width, board_height, x, y, width, height
                    )

                    if paths:
                        all_image_paths.append(paths)

                if not all_image_paths:
                    return jsonify({'error': 'No paths found'}), 400

                # Combine all paths
                combined_path = combine_image_paths(all_image_paths)

                # Filter to only pen-down points
                drawing_points = [point for point in combined_path if len(point) >= 3 and point[2]]

                if not drawing_points:
                    return jsonify({'error': 'No drawing points found'}), 400

                # Create animation frames using PIL (much more lightweight)
                from PIL import Image, ImageDraw, ImageFont

                # Create base white image
                base_image = Image.new('RGB', (board_width, board_height), 'white')

                frames = []

                # Calculate frame step for performance
                total_points = len(drawing_points)
                max_frames = min(100, total_points)  # Limit frames for performance
                step = max(1, total_points // max_frames)

                # Create frames - draw dots exactly like the preview
                for i in range(0, total_points, step):
                    # Copy base image
                    frame = base_image.copy()
                    draw = ImageDraw.Draw(frame)

                    # Draw dots for all points up to current frame (exactly like preview)
                    points_to_draw = drawing_points[:i+1]
                    for point in points_to_draw:
                        x, y = point[0], point[1]
                        # Draw small dots exactly like the preview (cv2.circle with radius 1)
                        draw.ellipse([x-1, y-1, x+1, y+1], fill='black')

                    frames.append(frame)

                # Ensure we have at least one frame
                if not frames:
                    frames.append(base_image.copy())

                # Add a final pause frame (3 seconds)
                if frames:
                    final_frame = frames[-1].copy()
                    frames.append(final_frame)

                # Create duration list: 50ms for all frames except the last one (3000ms)
                durations = [50] * (len(frames) - 1) + [3000]

                # Save as GIF
                animation_path = os.path.join(os.path.dirname(__file__), 'drawing_animation.gif')
                frames[0].save(
                    animation_path,
                    save_all=True,
                    append_images=frames[1:],
                    duration=durations,  # 50ms for drawing, 3000ms for final frame
                    loop=0  # Infinite loop
                )

                # Convert to base64
                with open(animation_path, 'rb') as f:
                    animation_data = f.read()
                    animation_b64 = f"data:image/gif;base64,{base64.b64encode(animation_data).decode()}"

                return jsonify({
                    'success': True,
                    'animationGif': animation_b64,
                    'frameCount': len(frames),
                    'totalPoints': total_points,
                    'duration': f"{len(frames) * 0.05:.1f}s"
                })

            except Exception as e:
                print(f"Animation creation failed: {e}")
                traceback.print_exc()
                return jsonify({'error': 'Animation creation failed', 'details': str(e)}), 500

    except Exception as e:
        print(f"Animation endpoint error: {e}")
        traceback.print_exc()
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@app.route('/api/send-path', methods=['POST'])
def queue_path_transmission():
    """Queue a path transmission job to the microcontroller."""
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        controller_url = data.get('controllerUrl') or data.get('controllerURL') or data.get('controller')
        if isinstance(controller_url, str):
            controller_url = controller_url.strip()
        controller_path_override = data.get('controllerPathUrl') or data.get('controllerPathURL')
        if isinstance(controller_path_override, str):
            controller_path_override = controller_path_override.strip()
        else:
            controller_path_override = None
        raw_points = data.get('path') or data.get('points') or data.get('pathPoints')
        if not controller_url:
            return jsonify({'error': 'controllerUrl is required'}), 400
        if not raw_points:
            return jsonify({'error': 'path points are required'}), 400

        try:
            points = _normalize_transmission_points(raw_points)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        start_position = _derive_start_position(data.get('startPosition'), points)
        speed = int(data.get('speed', 1800))
        reset = bool(data.get('reset', True))
        status_override = data.get('controllerStatusUrl') or data.get('controllerStatusURL')
        if isinstance(status_override, str):
            status_override = status_override.strip()
        else:
            status_override = None
        status_url = _derive_status_url(controller_url, status_override)

        controller_path_url = _derive_path_url(controller_url, controller_path_override)
        if not controller_path_url:
            return jsonify({'error': 'controllerUrl must resolve to a valid /api/path endpoint'}), 400

        try:
            job = path_sender.start_job(
                controller_url=controller_path_url,
                points=points,
                start_position=start_position,
                speed=speed,
                reset=reset,
                status_url=status_url,
            )
        except PathSenderBusyError:
            return jsonify({'error': 'A path transmission is already in progress'}), 409

        return jsonify({
            'success': True,
            'jobId': job.job_id,
            'status': job.status,
            'totalPoints': len(points),
            'batchSize': job.batch_size,
            'paused': job.paused,
        }), 200

    except Exception as exc:
        print(f"Failed to queue path transmission: {exc}")
        traceback.print_exc()
        return jsonify({'error': 'Failed to queue path transmission', 'details': str(exc)}), 500


@app.route('/api/send-path/status', methods=['GET'])
def path_transmission_status():
    """Return status for the current or most recent path transmission job."""
    status = path_sender.status()
    if status is None:
        return jsonify({'status': 'idle'}), 200
    return jsonify(status), 200


@app.route('/api/send-path/cancel', methods=['POST'])
def cancel_path_transmission():
    """Attempt to cancel the current transmission job."""
    job = path_sender.cancel_current()
    if not job:
        return jsonify({'status': 'idle'}), 200
    return jsonify({'status': job.status, 'jobId': job.job_id, 'paused': job.paused}), 202


@app.route('/api/send-path/pause', methods=['POST'])
def pause_path_transmission():
    """Pause sending new batches for the active job."""
    job = path_sender.pause_current()
    if not job:
        return jsonify({'status': 'idle'}), 200
    return jsonify({'status': job.status, 'jobId': job.job_id, 'paused': job.paused}), 200


@app.route('/api/send-path/resume', methods=['POST'])
def resume_path_transmission():
    """Resume batch sending if the current job is paused."""
    job = path_sender.resume_current()
    if not job:
        return jsonify({'status': 'idle'}), 200
    return jsonify({'status': job.status, 'jobId': job.job_id, 'paused': job.paused}), 200

if __name__ == '__main__':
    # Try to import required modules
    try:
        from polargraph.kinematics import Polargraph
        print("✓ Polargraph module imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import polargraph: {e}")
        print("Make sure you're running from the visualization directory")
        sys.exit(1)

    port = int(os.environ.get('PORT', 3001))
    print(f"Starting Flask server on port {port}")
    print(f"Visualization endpoint: http://localhost:{port}/api/visualize")
    app.run(host='0.0.0.0', port=port, debug=False)