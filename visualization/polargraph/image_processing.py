"""Image -> drawing path utilities.

This module uses OpenCV (if available) to find contours and return ordered points scaled to the board size.
"""
from typing import List, Tuple, Optional
from PIL import Image
import math
import numpy as np

try:
    import cv2
    import numpy as np
    from skimage.morphology import skeletonize
except ImportError:
    cv2 = None

Point = Tuple[float, float]

def smooth_path(path, radius=3):
    # rolling average smoothing
    smoothed = []
    for i in range(len(path)):
        neighbors = path[max(0, i - radius):min(len(path), i + radius)]
        avg_x = int(np.mean([p[0] for p in neighbors]))
        avg_y = int(np.mean([p[1] for p in neighbors]))
        smoothed.append((avg_x, avg_y))
    return smoothed


def image_to_contour_paths(image_path: str, board_width: int, board_height: int,
                          x: float = 0, y: float = 0, width: Optional[float] = None, height: Optional[float] = None,
                          threshold: int = 128, simplify: int = 10) -> Tuple[List[List[Point]], List[List[Point]], dict]:
    """Load an image and return (pixel_paths, scaled_paths).

    pixel_paths: contours in resized image pixel coordinates.
    scaled_paths: contours scaled and centered on the board.
    - threshold: not used anymore, kept for compatibility.
    - simplify: approx polygon epsilon in pixels (smaller -> more detailed)
    Uses Canny edge detection for cleaner contours.
    Requires OpenCV. Raises ImportError with guidance if cv2 not present.
    """
    if cv2 is None:
        raise ImportError("OpenCV, numpy, and scikit-image are required for image->contour conversion. Install via `pip install opencv-python numpy scikit-image`.")

    img = Image.open(image_path).convert("L")
    # Determine target size
    w, h = img.size
    if width is not None and height is not None:
        # Use specified dimensions
        target_w = int(width)
        target_h = int(height)
    else:
        # Auto-scale to fit board while preserving aspect ratio
        scale = min(board_width / w, board_height / h)
        target_w = max(1, int(round(w * scale)))
        target_h = max(1, int(round(h * scale)))

    # Use high-quality resampling
    img_resized = img.resize((target_w, target_h), 3)  # 3 = BICUBIC/LANCZOS
    arr = np.array(img_resized)

    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(arr, (5, 5), 0)
    # Detect edges using Canny with fixed thresholds
    # Calculate median and sigma-based thresholds for Canny
    v = np.median(blurred)
    sigma = 0.2
    lower = int(max(0, (1.0 - sigma) * v))
    upper = int(min(255, (1.0 + sigma) * v))
    edges = cv2.Canny(blurred, lower, upper)
    # Save the processed image
    cv2.imwrite("polargraph_ready.png", edges)
    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    # Filter out small contours
    contours = [cnt for cnt in contours if len(cnt) > 1]

    paths = []
    for cnt in contours:
        path = [(int(p[0][0]), int(p[0][1])) for p in cnt]
        if len(path) > 1:
            path = smooth_path(path, radius=2)  # optional smoothing
            paths.append(path)

    # Scale to board with specified position
    pixel_paths = paths
    scaled_paths = []
    for path in paths:
        scaled = [((px + x), (py + y)) for px, py in path]
        scaled_paths.append(scaled)

    intermediates = {
        'resized': arr,
        'blurred': blurred,
        'edges': edges
    }
    return pixel_paths, scaled_paths, intermediates


def rotate_point(x, y, angle_deg, center):
    rad = np.radians(angle_deg)
    cx, cy = center
    # Clockwise rotation
    xr = (x - cx) * np.cos(rad) + (y - cy) * np.sin(rad) + cx
    yr = -(x - cx) * np.sin(rad) + (y - cy) * np.cos(rad) + cy
    return int(xr), int(yr)


def generate_hatch_lines(gray, spacing=8, angle=0, brightness_threshold=180):
    """
    Generate line paths based on image brightness.
    - spacing: pixels between lines
    - angle: rotation angle for hatch lines (0 = horizontal)
    - brightness_threshold: how dark a pixel must be to draw
    """
    h, w = gray.shape
    center = (w // 2, h // 2)
    paths = []

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
                        spacing: int = 4, horizontal_threshold: int = 200, cross_threshold: int = 120) -> Tuple[List[List[Point]], List[List[Point]], dict]:
    """Load an image and return (pixel_paths, scaled_paths) using crosshatching.

    pixel_paths: hatch lines in resized image pixel coordinates.
    scaled_paths: hatch lines scaled and centered on the board.
    - spacing: pixels between hatch lines
    - horizontal_threshold: brightness threshold for horizontal lines
    - cross_threshold: brightness threshold for cross lines
    """
    if cv2 is None:
        raise ImportError("OpenCV and numpy are required for image->hatch conversion. Install via `pip install opencv-python numpy`.")

    img = Image.open(image_path).convert("L")
    # Determine target size
    w, h = img.size
    if width is not None and height is not None:
        # Use specified dimensions
        target_w = int(width)
        target_h = int(height)
    else:
        # Auto-scale to fit board while preserving aspect ratio
        scale = min(board_width / w, board_height / h)
        target_w = max(1, int(round(w * scale)))
        target_h = max(1, int(round(h * scale)))

    # Use high-quality resampling
    img_resized = img.resize((target_w, target_h), 3)  # 3 = BICUBIC/LANCZOS
    arr = np.array(img_resized)

    # Smooth small noise
    gray = cv2.GaussianBlur(arr, (3, 3), 0)
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
