"""Path planning utilities for polargraph drawing.

Handles interpolation, pen up/down states, and path optimization.
"""
from typing import Tuple, List, Union
import math

Point = Tuple[float, float]

step_mm = 0.05

def plan_linear_path(points: List[Point], step_mm: float = step_mm) -> List[Point]:
    """Given a series of anchor points, interpolate linearly between them with spacing approx step_mm.

    Returns a flat list of points including the anchors.
    """
    if step_mm <= 0:
        raise ValueError("step_mm must be > 0")
    out: List[Point] = []
    if not points:
        return out
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        dx = x1 - x0
        dy = y1 - y0
        dist = math.hypot(dx, dy)
        if dist == 0:
            out.append((x0, y0))
            continue
        steps = max(1, int(math.ceil(dist / step_mm)))
        for s in range(steps):
            t = s / steps
            out.append((x0 + dx * t, y0 + dy * t))
    out.append(points[-1])
    return out


def plan_pen_aware_path(path: Union[List[Point], List[List[Point]]], pen_up_threshold_mm: float = 1.0, step_mm: float = step_mm) -> List[Tuple[float, float, bool]]:
    """Create a path that includes pen-up/pen-down states.

    Input may be either a flat list of points (continuous drawing) or a list of segments
    (each segment is a list of points). Returned path is a list of (x, y, pen_down)
    tuples. Travel moves between segments are emitted with pen_down=False.
    """
    if step_mm <= 0:
        raise ValueError("step_mm must be > 0")

    # Detect if this is a list of segments (list of lists) or flat list
    is_segments = False
    if path:
        # if first element is a sequence of length 2 and not a float, assume segment
        first = path[0]
        if isinstance(first, (list, tuple)) and len(first) > 0 and isinstance(first[0], (list, tuple)):
            is_segments = True

    out: List[Tuple[float, float, bool]] = []

    def interpolate_line(a: Point, b: Point, pen_down: bool):
        ax, ay = a
        bx, by = b
        dx = bx - ax
        dy = by - ay
        dist = math.hypot(dx, dy)
        if dist == 0:
            return [(ax, ay, pen_down)]
        
        # If pen is UP, we don't need fine interpolation. Just go straight there.
        if not pen_down:
            return [(bx, by, pen_down)]

        steps = max(1, int(math.ceil(dist / step_mm)))
        res = []
        for s in range(steps):
            t = s / steps
            res.append((ax + dx * t, ay + dy * t, pen_down))
        return res

    if not is_segments:
        # flat continuous path
        pts: List[Point] = path  # type: ignore
        if not pts:
            return out
        for i in range(len(pts) - 1):
            out.extend(interpolate_line(pts[i], pts[i + 1], True))
        out.append((pts[-1][0], pts[-1][1], True))
        return out

    # handle segments: a list of segments where each segment is a list of points
    segments: List[List[Point]] = path  # type: ignore
    current_pos: Union[Point, None] = None
    for seg in segments:
        if not seg:
            continue
        start = seg[0]
        # travel to segment start
        if current_pos is None:
            # emit the first start point as pen-up so the animation shows travel
            out.append((start[0], start[1], False))
        else:
            # Check distance for pen-up optimization
            dist = math.hypot(start[0] - current_pos[0], start[1] - current_pos[1])
            should_keep_pen_down = dist < pen_up_threshold_mm
            
            # If we are keeping the pen down, we must ensure we don't accidentally emit a pen-up point
            # interpolate_line handles this based on the pen_down flag passed to it.
            out.extend(interpolate_line(current_pos, start, should_keep_pen_down))

        # draw the segment (pen down)
        for i in range(len(seg) - 1):
            out.extend(interpolate_line(seg[i], seg[i + 1], True))
        out.append((seg[-1][0], seg[-1][1], True))
        current_pos = seg[-1]

    return out


def optimize_contour_order(contours):
    """Optimize the order of contours to minimize travel distance, considering reversals."""
    if not contours:
        return []
    
    # Helper to get distance squared
    def dist_sq(p1, p2):
        return (p1[0]-p2[0])**2 + (p1[1]-p2[1])**2

    available = list(contours)
    ordered = []
    
    # Start with the one with min X (arbitrary start)
    start_idx = min(range(len(available)), key=lambda i: available[i][0][0])
    current_contour = available.pop(start_idx)
    ordered.append(current_contour)
    current_pos = current_contour[-1]
    
    while available:
        best_idx = -1
        best_dist_sq = float('inf')
        should_reverse = False
        
        for i, contour in enumerate(available):
            # Check start
            d_start = dist_sq(current_pos, contour[0])
            if d_start < best_dist_sq:
                best_dist_sq = d_start
                best_idx = i
                should_reverse = False
            
            # Check end
            d_end = dist_sq(current_pos, contour[-1])
            if d_end < best_dist_sq:
                best_dist_sq = d_end
                best_idx = i
                should_reverse = True
        
        next_contour = available.pop(best_idx)
        if should_reverse:
            next_contour = list(reversed(next_contour))
        
        ordered.append(next_contour)
        current_pos = next_contour[-1]
        
    return ordered


def merge_contours(contours: List[List[Point]], threshold: float = 1.0) -> List[List[Point]]:
    """Merge consecutive contours if the distance between them is less than the threshold."""
    if not contours:
        return []

    merged = []
    current_contour = list(contours[0])

    for i in range(1, len(contours)):
        next_contour = contours[i]
        if not next_contour:
            continue
        
        # Distance from end of current to start of next
        end_pt = current_contour[-1]
        start_pt = next_contour[0]
        dist = math.hypot(start_pt[0] - end_pt[0], start_pt[1] - end_pt[1])

        if dist < threshold:
            # Merge
            current_contour.extend(next_contour)
        else:
            merged.append(current_contour)
            current_contour = list(next_contour)
    
    merged.append(current_contour)
    return merged


def combine_image_paths(image_path_sets: List[List[List[Point]]], step_mm: float = step_mm, pen_up_threshold_mm: float = 1.0) -> List[Tuple[float, float, bool]]:
    """Combine paths from multiple images into a single optimized path.

    Args:
        image_path_sets: List of path sets, where each path set is a list of paths from one image
        step_mm: Step size for interpolation
        pen_up_threshold_mm: Distance threshold below which pen stays down between segments

    Returns:
        Combined path with pen-up/pen-down states
    """
    if not image_path_sets:
        return []

    # Flatten all paths from all images into one big list of segments
    all_segments = []
    for path_set in image_path_sets:
        all_segments.extend(path_set)

    if not all_segments:
        return []

    # Optimize the order of all segments across images (handles reversals too)
    all_segments = optimize_contour_order(all_segments)

    # Merge nearby contours
    all_segments = merge_contours(all_segments, threshold=pen_up_threshold_mm)

    # Convert to pen-aware path
    return plan_pen_aware_path(all_segments, step_mm=step_mm, pen_up_threshold_mm=pen_up_threshold_mm)