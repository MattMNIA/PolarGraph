"""Image -> drawing path utilities.

This module uses OpenCV (if available) to find contours and return ordered points scaled to the board size.
"""
from typing import Any, List, Tuple, Optional
from PIL import Image, ImageOps
import numpy as np

try:
    import cv2  # type: ignore[import-not-found]
except ImportError:
    cv2 = None

Point = Tuple[float, float]

def smooth_path(path, radius=3):
    """Fast rolling average smoothing for contour paths."""
    if radius <= 0 or len(path) < 3:
        return list(path)

    window = radius * 2 + 1
    pts = np.asarray(path, dtype=np.float32)
    # Pad with edge values so the smoothing window is well-defined at ends
    pad_front = np.repeat(pts[:1], radius, axis=0)
    pad_back = np.repeat(pts[-1:], radius, axis=0)
    padded = np.vstack((pad_front, pts, pad_back))
    # Sliding window sum via cumulative sum
    cumsum = np.cumsum(padded, axis=0)
    cumsum = np.vstack((np.zeros((1, padded.shape[1]), dtype=np.float32), cumsum))
    smoothed = (cumsum[window:] - cumsum[:-window]) / window
    return [tuple(pt) for pt in smoothed]


def image_to_contour_paths(image_path: str, board_width: int, board_height: int,
                          x: float = 0, y: float = 0, width: Optional[float] = None, height: Optional[float] = None,
                          threshold: int = 128, simplify: float = 0.5) -> Tuple[List[List[Point]], List[List[Point]], dict]:
    """Load an image and return (pixel_paths, scaled_paths).

    pixel_paths: contours in resized image pixel coordinates.
    scaled_paths: contours scaled and centered on the board.
    - threshold: not used anymore, kept for compatibility.
    - simplify: approx polygon epsilon in pixels (smaller -> more detailed). Default 0.5.
    Uses Canny edge detection for cleaner contours.
    Requires OpenCV. Raises ImportError with guidance if cv2 not present.
    """
    if cv2 is None:
        raise ImportError("OpenCV, numpy, and scikit-image are required for image->contour conversion. Install via `pip install opencv-python numpy scikit-image`.")

    img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    # Determine target size
    w, h = img.size
    if width is not None and height is not None:
        # Use specified dimensions
        target_w = max(1, int(width))  # Ensure minimum of 1
        target_h = max(1, int(height))  # Ensure minimum of 1
    else:
        # Auto-scale to fit board while preserving aspect ratio
        scale = min(board_width / w, board_height / h)
        target_w = max(1, int(round(w * scale)))
        target_h = max(1, int(round(h * scale)))

    # Oversampling for smoother contours
    oversample = 2.0
    process_w = int(target_w * oversample)
    process_h = int(target_h * oversample)

    # Use high-quality resampling for processing
    img_process = img.resize((process_w, process_h), 3)  # 3 = BICUBIC/LANCZOS
    arr = np.array(img_process)

    # Use milder CLAHE (lower clipLimit, larger tiles) and blend with original to reduce the effect
    clahe = cv2.createCLAHE(clipLimit=1.0, tileGridSize=(16, 16))
    equalized = clahe.apply(arr)
    arr_equalized = cv2.addWeighted(arr, 0.7, equalized, 0.3, 0)

    # Apply Bilateral Filter to preserve edges while smoothing noise (texture)
    # Reduced sigma values to catch finer details (windows) while still suppressing noise
    blurred = cv2.bilateralFilter(arr_equalized, 7, 50, 50)
    # Detect edges using Canny with fixed thresholds
    # Calculate median and sigma-based thresholds for Canny
    v = float(np.median(blurred.astype(np.float32)))
    sigma = 0.4
    lower = int(max(0, (1.0 - sigma) * v))
    upper = int(min(255, (1.0 + sigma) * v))
    edges = cv2.Canny(blurred, lower, upper)
    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    # Filter out small contours
    contours = [cnt for cnt in contours if len(cnt) > 10]

    paths = []
    for cnt in contours:
        if simplify > 0:
            cnt = cv2.approxPolyDP(cnt, simplify, False)

        path = [(float(p[0][0]), float(p[0][1])) for p in cnt]
        if len(path) > 1:
            path = smooth_path(path, radius=2)  # restored smoothing
            paths.append(path)

    # Scale to board with specified position
    pixel_paths = []
    scaled_paths = []
    for path in paths:
        # Downscale back to target resolution for pixel_paths
        pixel_path = [(px / oversample, py / oversample) for px, py in path]
        pixel_paths.append(pixel_path)
        
        # Scale to board
        scaled = [((px / oversample + x), (py / oversample + y)) for px, py in path]
        scaled_paths.append(scaled)

    # Create intermediates for display (at target resolution)
    img_display = img.resize((target_w, target_h), 3)
    arr_display = np.array(img_display)
    
    intermediates = {
        'resized': arr_display,
        'blurred': cv2.resize(blurred, (target_w, target_h)),
        'edges': cv2.resize(edges, (target_w, target_h))
    }
    return pixel_paths, scaled_paths, intermediates


def rotate_point(x, y, angle_deg, center):
    rad = np.radians(angle_deg)
    cx, cy = center
    # Clockwise rotation
    xr = (x - cx) * np.cos(rad) + (y - cy) * np.sin(rad) + cx
    yr = -(x - cx) * np.sin(rad) + (y - cy) * np.cos(rad) + cy
    return int(xr), int(yr)


def generate_hatch_lines(gray, spacing=4, angle=0, brightness_threshold=180):
    if cv2 is None:
        raise ImportError("OpenCV is required for hatch line generation. Install via `pip install opencv-python numpy`.")
    """
    Generate line paths based on image brightness.
    - spacing: pixels between lines
    - angle: rotation angle for hatch lines (0 = horizontal)
    - brightness_threshold: how dark a pixel must be to draw
    """
    h, w = gray.shape
    center = (w // 2, h // 2)
    paths = []

    # Original fixed spacing implementation
    if angle == 90:
        # Special case for vertical lines
        for x in range(0, w, spacing):
            current_path = []
            for y in range(0, h):
                brightness = gray[y, x]
                if brightness < brightness_threshold:
                    current_path.append((x, y))
                else:
                    if current_path:
                        paths.append(current_path)
                        current_path = []
            if current_path:
                paths.append(current_path)
        return paths
    elif angle == 45:
        # 45 degree lines
        for d in range(-h, w + h, spacing):
            current_path = []
            start_i = max(0, -d)
            end_i = min(w, h - d)
            for i in range(start_i, end_i):
                x = i
                y = i + d
                if 0 <= y < h and gray[y, x] < brightness_threshold:
                    current_path.append((x, y))
                else:
                    if current_path:
                        paths.append(current_path)
                        current_path = []
            if current_path:
                paths.append(current_path)
        return paths
    elif angle == 135:
        # 135 degree lines
        for d in range(-h, w + h, spacing):
            current_path = []
            start_i = max(0, d - h + 1)
            end_i = min(d + 1, w)
            for i in range(start_i, end_i):
                x = i
                y = d - i
                if 0 <= y < h and gray[y, x] < brightness_threshold:
                    current_path.append((x, y))
                else:
                    if current_path:
                        paths.append(current_path)
                        current_path = []
            if current_path:
                paths.append(current_path)
        return paths
    # Rotate image if angle != 0
    if angle != 0:
        rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated_gray = cv2.warpAffine(gray, rot_mat, (w, h), flags=cv2.INTER_LINEAR)
    else:
        rotated_gray = gray.copy()

    h_rot = h
    w_rot = w
    center_rot = center

    for y in range(0, h_rot, spacing):
        current_path = []
        for x in range(0, w_rot):
            brightness = rotated_gray[y, x]
            if brightness < brightness_threshold:
                current_path.append((x, y))
            else:
                if current_path:
                    # Save the completed segment
                    paths.append(current_path)
                    current_path = []
        if current_path:
            paths.append(current_path)

    # Rotate points back to original orientation
    if angle != 0:
        rotated_paths = []
        for path in paths:
            rotated_paths.append([rotate_point(x, y, -angle, center_rot) for (x, y) in path])
        return rotated_paths
    else:
        return paths


def image_to_hatch_paths(image_path: str, board_width: int, board_height: int,
                        x: float = 0, y: float = 0, width: Optional[float] = None, height: Optional[float] = None,
                        spacing: int = 4, horizontal_threshold: int = 160, cross_threshold: int = 140) -> Tuple[List[List[Point]], List[List[Point]], dict]:
    """Load an image and return (pixel_paths, scaled_paths) using crosshatching.

    pixel_paths: hatch lines in resized image pixel coordinates.
    scaled_paths: hatch lines scaled and centered on the board.
    - spacing: pixels between hatch lines
    - horizontal_threshold: brightness threshold for horizontal lines
    - cross_threshold: brightness threshold for cross lines
    """
    if cv2 is None:
        raise ImportError("OpenCV and numpy are required for image->hatch conversion. Install via `pip install opencv-python numpy`.")

    img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    # Determine target size
    w, h = img.size
    if width is not None and height is not None:
        # Use specified dimensions
        target_w = max(1, int(width))  # Ensure minimum of 1
        target_h = max(1, int(height))  # Ensure minimum of 1
    else:
        # Auto-scale to fit board while preserving aspect ratio
        scale = min(board_width / w, board_height / h)
        target_w = max(1, int(round(w * scale)))
        target_h = max(1, int(round(h * scale)))

    # Use high-quality resampling
    img_resized = img.resize((target_w, target_h), 3)  # 3 = BICUBIC/LANCZOS
    arr = np.array(img_resized)

    # Smooth small noise
    gray = cv2.GaussianBlur(arr, (9, 9), 0)
    # Normalize brightness
    gray = cv2.equalizeHist(gray)

    # Diagonal hatching (45 degrees)
    diagonal1_paths = generate_hatch_lines(gray, spacing=spacing, angle=45, brightness_threshold=horizontal_threshold)

    # Diagonal hatching (135 degrees)
    diagonal2_paths = generate_hatch_lines(gray, spacing=spacing, angle=135, brightness_threshold=cross_threshold)

    # Merge
    pixel_paths = diagonal1_paths + diagonal2_paths

    # Scale to board with specified position
    scaled_paths = []
    for path in pixel_paths:
        scaled = [((px + x), (py + y)) for px, py in path]
        scaled_paths.append(scaled)

    intermediates = {
        'resized': arr,
        'gray': gray
    }
    return pixel_paths, scaled_paths, intermediates


def image_to_dark_fill_paths(image_path: str, board_width: int, board_height: int,
                        x: float = 0, y: float = 0, width: Optional[float] = None, height: Optional[float] = None,
                        spacing: float = 2.0, threshold: int = 128, angle: int = 45) -> Tuple[List[List[Point]], List[List[Point]], dict]:
    """Load an image and return (pixel_paths, scaled_paths) using dark fill (hatching).

    pixel_paths: fill lines in resized image pixel coordinates.
    scaled_paths: fill lines scaled and centered on the board.
    - spacing: pixels between fill lines (approx mm if width is in mm)
    - threshold: brightness threshold (pixels darker than this are filled)
    - angle: angle of fill lines
    """
    if cv2 is None:
        raise ImportError("OpenCV and numpy are required for image->fill conversion. Install via `pip install opencv-python numpy`.")

    img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    # Determine target size
    w, h = img.size
    if width is not None and height is not None:
        # Use specified dimensions
        target_w = max(1, int(width))  # Ensure minimum of 1
        target_h = max(1, int(height))  # Ensure minimum of 1
    else:
        # Auto-scale to fit board while preserving aspect ratio
        scale = min(board_width / w, board_height / h)
        target_w = max(1, int(round(w * scale)))
        target_h = max(1, int(round(h * scale)))

    # Use high-quality resampling
    img_resized = img.resize((target_w, target_h), 3)  # 3 = BICUBIC/LANCZOS
    arr = np.array(img_resized)

    # Smooth small noise
    gray = cv2.GaussianBlur(arr, (9, 9), 0)
    
    # Generate fill lines
    # Use adaptive=False for fixed spacing (sweeping)
    pixel_paths = generate_hatch_lines(gray, spacing=spacing, angle=angle, brightness_threshold=threshold)

    # Optimize path order to minimize pen lifts
    # Sort paths by their starting point to find the nearest neighbor
    if pixel_paths:
        optimized_paths = []
        current_pos = pixel_paths[0][0]
        remaining_paths = list(pixel_paths)
        
        while remaining_paths:
            # Find the path that starts closest to current_pos
            best_idx = -1
            best_dist = float('inf')
            reverse_best = False
            
            for i, path in enumerate(remaining_paths):
                # Check distance to start of path
                d_start = (path[0][0] - current_pos[0])**2 + (path[0][1] - current_pos[1])**2
                if d_start < best_dist:
                    best_dist = d_start
                    best_idx = i
                    reverse_best = False
                
                # Check distance to end of path (if we traverse it backwards)
                d_end = (path[-1][0] - current_pos[0])**2 + (path[-1][1] - current_pos[1])**2
                if d_end < best_dist:
                    best_dist = d_end
                    best_idx = i
                    reverse_best = True
            
            next_path = remaining_paths.pop(best_idx)
            if reverse_best:
                next_path.reverse()
            
            # Check if we can merge with the previous path to avoid pen up
            merged = False
            if optimized_paths:
                last_path = optimized_paths[-1]
                last_point = last_path[-1]
                start_point = next_path[0]
                dist_sq = (last_point[0] - start_point[0])**2 + (last_point[1] - start_point[1])**2
                
                # Threshold for merging: if the jump is small (e.g. adjacent fill line), don't lift pen.
                # spacing is the hatch spacing. If dist is around spacing, it's a neighbor.
                # Use a slightly generous threshold (e.g. 3x spacing) to ensure we catch diagonal steps and small gaps.
                # We want to prioritize keeping the pen down in continuous areas.
                threshold_sq = (spacing * 3) ** 2
                
                if dist_sq <= threshold_sq:
                    # Merge paths
                    last_path.extend(next_path)
                    current_pos = last_path[-1]
                    merged = True
            
            if not merged:
                optimized_paths.append(next_path)
                current_pos = next_path[-1]
        
        pixel_paths = optimized_paths

    # Scale to board with specified position
    scaled_paths = []
    for path in pixel_paths:
        scaled = [((px + x), (py + y)) for px, py in path]
        scaled_paths.append(scaled)

    intermediates = {
        'resized': arr,
        'gray': gray
    }
    return pixel_paths, scaled_paths, intermediates
