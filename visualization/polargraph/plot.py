"""Matplotlib-based polargraph visualizer and animator.

Features:
- Optional background image of the board
- Pen-up travel shown as dashed gray line, pen-down trace shown as solid black
- Interactive timeline slider and play/pause control
"""
from typing import List, Tuple, Optional
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.widgets import Button, Slider
from matplotlib.animation import Animation
from PIL import Image
import numpy as np
from .kinematics import Polargraph

Point = Tuple[float, float]


def animate_path(pg: Polargraph, path: List, interval_ms: int = 20, show: bool = True, background_image: Optional[str] = None):
    """Animate pen moving along `path` on the board.

    - `path` entries can be (x,y) or (x,y,pen_down).
    - `background_image` if provided is a path to an image file that will be shown behind the drawing.
    Returns the matplotlib figure.
    """
    fig, ax = plt.subplots()
    ax.set_xlim(-10, pg.width + 10)
    ax.set_ylim(pg.height + 10, -10)  # invert y for screen-like coords
    ax.set_aspect('equal')
    ax.set_title('Polargraph simulation')

    left = pg.left_motor
    right = pg.right_motor

    # Optional background image
    bg_img = None
    if background_image:
        try:
            img = Image.open(background_image).convert('RGBA')
            # Pillow varying attribute across versions; choose a resampling constant safely
            resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.BICUBIC)
            w, h = img.size
            scale = min(pg.width / w, pg.height / h)
            new_w = w * scale
            new_h = h * scale
            img = img.resize((max(1, int(new_w)), max(1, int(new_h))), resample)
            offset_x = (pg.width - new_w) / 2
            offset_y = (pg.height - new_h) / 2
            extent = (offset_x, offset_x + new_w, pg.height - offset_y, pg.height - offset_y - new_h)
            bg_img = ax.imshow(img, extent=extent, alpha=0.7)
        except Exception:
            # if PIL or image load fails, continue without background
            pass

    motor_scatter = ax.scatter([left[0], right[0]], [left[1], right[1]], c='red', zorder=5)
    string_lines, = ax.plot([], [], c='gray', linewidth=1, zorder=4)
    pen_trace, = ax.plot([], [], c='black', linewidth=.1, zorder=3)
    pen_point, = ax.plot([], [], 'o', c='blue', zorder=6)

    pen_down_x: List[float] = []
    pen_down_y: List[float] = []
    travel_x: List[float] = []
    travel_y: List[float] = []

    def update_plot(i):
        nonlocal pen_down_x, pen_down_y
        # Reset traces
        pen_down_x = []
        pen_down_y = []
        x, y = 0, 0  # default
        for j in range(min(i + 1, len(path))):
            entry = path[j]
            if len(entry) == 2:
                x, y = entry
                pen_down = True
            else:
                x, y, pen_down = entry

            # update strings to current position
            string_lines.set_data([left[0], x, right[0]], [left[1], y, right[1]])

            # manage pen-down traces, insert NaN for pen-up to break the line
            if pen_down:
                pen_down_x.append(x)
                pen_down_y.append(y)
            else:
                pen_down_x.append(float('nan'))
                pen_down_y.append(float('nan'))

        pen_trace.set_data(pen_down_x, pen_down_y)
        pen_point.set_data([x] if i < len(path) else [], [y] if i < len(path) else [])
        fig.canvas.draw_idle()

    # Initial draw
    update_plot(0)

    # Add slider
    slider_ax = plt.axes((0.1, 0.02, 0.65, 0.03))
    slider = Slider(slider_ax, 'Frame', 0, len(path) - 1, valinit=0, valstep=1)
    slider.on_changed(lambda val: update_plot(int(val)))

    # Add speed slider
    speed_ax = plt.axes((0.1, 0.06, 0.3, 0.03))
    speed_slider = Slider(speed_ax, 'Speed', 1, 100, valinit=1, valstep=1)

    # Add play/pause button
    timer = [None]  # mutable for closure

    def play_pause(event):
        if timer[0] is not None:
            timer[0].stop()
            timer[0] = None
        else:
            def advance():
                val = slider.val + int(speed_slider.val)
                if val >= len(path):
                    val = 0  # loop back to start
                slider.set_val(val)
            timer[0] = fig.canvas.new_timer(interval_ms)
            timer[0].add_callback(advance)
            timer[0].start()

    play_ax = plt.axes((0.8, 0.05, 0.1, 0.075))
    play_btn = Button(play_ax, 'Play/Pause')
    play_btn.on_clicked(play_pause)

    # Add toggle background button
    def toggle_bg(event):
        if bg_img:
            current_alpha = bg_img.get_alpha()
            bg_img.set_alpha(0 if current_alpha > 0 else 0.7)
            fig.canvas.draw_idle()

    toggle_ax = plt.axes((0.8, 0.15, 0.1, 0.075))
    toggle_btn = Button(toggle_ax, 'Toggle BG')
    toggle_btn.on_clicked(toggle_bg)

    if show:
        plt.show()
    return fig
