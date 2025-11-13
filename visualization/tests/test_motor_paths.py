import math
from polargraph.kinematics import Polargraph
from polargraph.path_planner import plan_pen_aware_path


def _points_only(path):
    return [(x, y) for x, y, _ in path]


def _length_series(pg, points):
    return [pg.lengths_for_xy(x, y) for x, y in points]


def test_square_motor_path_closes_and_axis_aligned():
    pg = Polargraph(1000, 1000)
    size = 200.0
    start_x = 300.0
    start_y = 300.0
    anchors = [
        (start_x, start_y),
        (start_x + size, start_y),
        (start_x + size, start_y + size),
        (start_x, start_y + size),
        (start_x, start_y),
    ]

    path = plan_pen_aware_path(anchors, step_mm=10)
    points = _points_only(path)

    assert all(pen_down for _, _, pen_down in path)
    assert math.isclose(points[0][0], points[-1][0], abs_tol=1e-6)
    assert math.isclose(points[0][1], points[-1][1], abs_tol=1e-6)

    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx = x1 - x0
        dy = y1 - y0
        if math.isclose(dx, 0.0, abs_tol=1e-9) and math.isclose(dy, 0.0, abs_tol=1e-9):
            continue
        assert math.isclose(dx, 0.0, abs_tol=1e-9) or math.isclose(dy, 0.0, abs_tol=1e-9)

    left_right = _length_series(pg, points)
    left_lengths = [entry[0] for entry in left_right]
    right_lengths = [entry[1] for entry in left_right]

    assert math.isclose(left_lengths[0], left_lengths[-1], rel_tol=1e-6, abs_tol=1e-6)
    assert math.isclose(right_lengths[0], right_lengths[-1], rel_tol=1e-6, abs_tol=1e-6)
    assert len({round(val, 4) for val in left_lengths}) > 1
    assert len({round(val, 4) for val in right_lengths}) > 1


def test_circle_motor_path_stays_within_radius():
    pg = Polargraph(1000, 1000)
    center_x = 500.0
    center_y = 400.0
    radius = 120.0
    segments = 16

    anchors = []
    for i in range(segments):
        theta = (2.0 * math.pi * i) / segments
        anchors.append(
            (
                center_x + radius * math.cos(theta),
                center_y + radius * math.sin(theta),
            )
        )
    anchors.append(anchors[0])

    path = plan_pen_aware_path(anchors, step_mm=8)
    points = _points_only(path)

    assert all(pen_down for _, _, pen_down in path)
    assert math.isclose(points[0][0], points[-1][0], abs_tol=1e-5)
    assert math.isclose(points[0][1], points[-1][1], abs_tol=1e-5)

    distances = []
    for x, y in points:
        dist = math.hypot(x - center_x, y - center_y)
        distances.append(dist)
        assert dist <= radius + 1e-6
    assert any(dist < radius - 1.0 for dist in distances)

    left_right = _length_series(pg, points)
    left_lengths = [entry[0] for entry in left_right]
    right_lengths = [entry[1] for entry in left_right]

    assert math.isclose(left_lengths[0], left_lengths[-1], rel_tol=1e-5, abs_tol=1e-5)
    assert math.isclose(right_lengths[0], right_lengths[-1], rel_tol=1e-5, abs_tol=1e-5)
    assert len({round(val, 4) for val in left_lengths}) > 4
    assert len({round(val, 4) for val in right_lengths}) > 4


def test_triangle_motor_path_has_three_directions():
    pg = Polargraph(1000, 1000)
    anchors = [
        (400.0, 200.0),
        (650.0, 600.0),
        (200.0, 600.0),
        (400.0, 200.0),
    ]

    path = plan_pen_aware_path(anchors, step_mm=12)
    points = _points_only(path)

    assert all(pen_down for _, _, pen_down in path)
    assert len(points) > len(anchors)
    assert math.isclose(points[0][0], points[-1][0], abs_tol=1e-6)
    assert math.isclose(points[0][1], points[-1][1], abs_tol=1e-6)

    directions = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx = x1 - x0
        dy = y1 - y0
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        directions.append((round(dx / length, 3), round(dy / length, 3)))

    assert len(set(directions)) == 3

    left_right = _length_series(pg, points)
    left_lengths = [entry[0] for entry in left_right]
    right_lengths = [entry[1] for entry in left_right]

    assert math.isclose(left_lengths[0], left_lengths[-1], rel_tol=1e-6, abs_tol=1e-6)
    assert math.isclose(right_lengths[0], right_lengths[-1], rel_tol=1e-6, abs_tol=1e-6)
    assert len({round(val, 4) for val in left_lengths}) > 2
    assert len({round(val, 4) for val in right_lengths}) > 2
