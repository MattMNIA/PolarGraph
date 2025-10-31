"""Path planning utilities for polargraph drawing.

Handles interpolation, pen up/down states, and path optimization.
"""
from typing import Tuple, List, Union
import math

Point = Tuple[float, float]


def plan_linear_path(points: List[Point], step_mm: float = 1.0) -> List[Point]:
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


def plan_pen_aware_path(path: Union[List[Point], List[List[Point]]], pen_up_threshold_mm: float = 10.0, step_mm: float = 1.0) -> List[Tuple[float, float, bool]]:
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
        # travel to segment start with pen up
        if current_pos is None:
            # emit the first start point as pen-up so the animation shows travel
            out.append((start[0], start[1], False))
        else:
            out.extend(interpolate_line(current_pos, start, False))

        # draw the segment (pen down)
        for i in range(len(seg) - 1):
            out.extend(interpolate_line(seg[i], seg[i + 1], True))
        out.append((seg[-1][0], seg[-1][1], True))
        current_pos = seg[-1]

    return out


def optimize_contour_order(contours):
    """Optimize the order of contours to minimize travel distance."""
    if not contours:
        return []
    # Use first point of each contour as representative
    reps = [(i, c[0]) for i, c in enumerate(contours)]
    order = []
    visited = set()
    # Start with the leftmost
    start_idx = min(reps, key=lambda x: x[1][0])[0]
    current = reps[start_idx][1]
    order.append(start_idx)
    visited.add(start_idx)
    while len(order) < len(contours):
        # Find nearest unvisited
        nearest_idx = None
        min_dist = float('inf')
        for i, pt in reps:
            if i not in visited:
                dist = ((pt[0] - current[0])**2 + (pt[1] - current[1])**2)**0.5
                if dist < min_dist:
                    min_dist = dist
                    nearest_idx = i
        if nearest_idx is not None:
            order.append(nearest_idx)
            visited.add(nearest_idx)
            current = reps[nearest_idx][1]
    return [contours[i] for i in order]


def optimize_path_directions(paths):
    """Optimize the direction of each path to minimize travel between segments."""
    if not paths:
        return
    current_end = paths[0][-1]
    for i in range(1, len(paths)):
        next_path = paths[i]
        dist_to_start = ((next_path[0][0] - current_end[0])**2 + (next_path[0][1] - current_end[1])**2)**0.5
        dist_to_end = ((next_path[-1][0] - current_end[0])**2 + (next_path[-1][1] - current_end[1])**2)**0.5
        if dist_to_end < dist_to_start:
            paths[i] = list(reversed(next_path))
        current_end = paths[i][-1]


def combine_image_paths(image_path_sets: List[List[List[Point]]], step_mm: float = 1.0) -> List[Tuple[float, float, bool]]:
    """Combine paths from multiple images into a single optimized path.

    Args:
        image_path_sets: List of path sets, where each path set is a list of paths from one image
        step_mm: Step size for interpolation

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

    # Optimize the order of all segments across images
    all_segments = optimize_contour_order(all_segments)

    # Optimize directions
    optimize_path_directions(all_segments)

    # Convert to pen-aware path
    return plan_pen_aware_path(all_segments, step_mm=step_mm)