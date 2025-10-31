from polargraph.kinematics import Polargraph


def test_lengths_and_inverse():
    pg = Polargraph(1150, 730)
    points = [(100, 100), (400, 300), (799, 599), (0, 599), (400, 10)]
    for x, y in points:
        l, r = pg.lengths_for_xy(x, y)
        x2, y2 = pg.xy_from_lengths(l, r)
        # allow small numerical errors
        assert abs(x - x2) < 1e-6
        assert abs(y - y2) < 1e-6
