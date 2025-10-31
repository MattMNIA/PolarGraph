"""Polargraph kinematics utilities.

Lightweight implementation that doesn't require numpy so basic tests can run in minimal environments.
"""
from typing import Tuple
import math

Point = Tuple[float, float]


class Polargraph:
    """Model of a polargraph with two motors at the top-left and top-right corners.

    Coordinates: origin (0,0) at top-left motor. X grows right, Y grows down (screen coordinates).
    """

    def __init__(self, board_width_mm: float, board_height_mm: float):
        self.width = float(board_width_mm)
        self.height = float(board_height_mm)
        # motor positions
        self.left_motor = (0.0, 0.0)
        self.right_motor = (self.width, 0.0)

    def lengths_for_xy(self, x: float, y: float) -> Tuple[float, float]:
        """Return (left_length, right_length) in same units as board (mm).

        x,y may be outside the board extents; caller should clamp if desired.
        """
        lx = math.hypot(x - self.left_motor[0], y - self.left_motor[1])
        rx = math.hypot(x - self.right_motor[0], y - self.right_motor[1])
        return lx, rx

    def xy_from_lengths(self, left_len: float, right_len: float) -> Point:
        """Given two string lengths, return the (x,y) pen coordinate.

        Solves intersection of two circles centered at motor positions.
        If there are two solutions, returns the one with the larger y (lower on board),
        which is the physically relevant pen position.
        Raises ValueError if no intersection.
        """
        x0, y0 = self.left_motor
        x1, y1 = self.right_motor
        r0 = float(left_len)
        r1 = float(right_len)

        dx = x1 - x0
        dy = y1 - y0
        d = math.hypot(dx, dy)
        if d == 0:
            raise ValueError("Motors are at the same location")

        # Check for solvability
        if r0 + r1 < d - 1e-9 or abs(r0 - r1) > d + 1e-9:
            raise ValueError("No intersection for given lengths")

        # a = (r0^2 - r1^2 + d^2) / (2d)
        a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
        # h^2 = r0^2 - a^2
        h_sq = max(0.0, r0 * r0 - a * a)
        h = math.sqrt(h_sq)

        xm = x0 + a * dx / d
        ym = y0 + a * dy / d

        # Intersection points
        rx = -dy * (h / d)
        ry = dx * (h / d)

        xi1 = xm + rx
        yi1 = ym + ry
        xi2 = xm - rx
        yi2 = ym - ry

        # choose solution with larger y (further down)
        if yi1 >= yi2:
            return (xi1, yi1)
        else:
            return (xi2, yi2)