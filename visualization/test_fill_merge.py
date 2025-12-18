
import sys
import os
import numpy as np
from PIL import Image
import cv2

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from polargraph.image_processing import image_to_dark_fill_paths

def test_fill_merge():
    # Create a small black image (should be fully filled)
    # 20x20 pixels
    img = Image.new('L', (20, 20), color=0)
    img_path = 'temp_test_fill.png'
    img.save(img_path)

    try:
        # Run fill generation
        # spacing=2. So we expect lines at roughly y=0, 2, 4...
        # With merging, we expect very few paths (ideally 1 continuous path if fully connected)
        pixel_paths, scaled_paths, _ = image_to_dark_fill_paths(
            img_path, 
            board_width=100, 
            board_height=100, 
            width=20, 
            height=20, 
            spacing=2, 
            threshold=128, 
            angle=0 # Horizontal lines for easy checking
        )

        print(f"Generated {len(pixel_paths)} paths.")
        for i, path in enumerate(pixel_paths):
            print(f"Path {i} length: {len(path)} points. Start: {path[0]}, End: {path[-1]}")

        # If merging works, we should have 1 path (snake)
        # Or at least significantly fewer than 10 (20/2)
        if len(pixel_paths) == 1:
            print("SUCCESS: Paths merged into a single continuous path.")
        elif len(pixel_paths) < 5:
            print("PARTIAL SUCCESS: Paths merged significantly.")
        else:
            print("FAILURE: Paths not merged effectively.")

    finally:
        if os.path.exists(img_path):
            os.remove(img_path)

if __name__ == "__main__":
    test_fill_merge()
