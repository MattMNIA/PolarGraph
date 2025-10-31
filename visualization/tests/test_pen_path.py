from polargraph.kinematics import Polargraph
from polargraph.path_planner import plan_pen_aware_path


def test_pen_aware_segments():
    pg = Polargraph(200, 200)
    # two short segments separated by distance
    seg1 = [(10, 10), (50, 10)]
    seg2 = [(150, 150), (160, 150)]
    segments = [seg1, seg2]
    path = plan_pen_aware_path(segments, step_mm=10)
    # path should include pen-up travel before first segment start and between segments
    # check that there exists at least one entry with pen_down=False
    assert any(not e[2] for e in path)
    # and at least one pen-down entry
    assert any(e[2] for e in path)
    # ensure final point corresponds to last segment end and is pen-down
    assert path[-1][0] == seg2[-1][0] and path[-1][1] == seg2[-1][1] and path[-1][2] is True
