"""Whiteboard manager for handling multiple images with position and size control."""

from typing import List, Tuple, Dict, Optional, Any
from dataclasses import dataclass
import math
from PIL import Image
import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None


@dataclass
class ImagePlacement:
    """Represents an image placement on the whiteboard."""
    image_path: str
    x: float  # Top-left x coordinate
    y: float  # Top-left y coordinate
    width: float  # Width on whiteboard
    height: float  # Height on whiteboard
    rotation: float = 0.0  # Rotation in degrees


class WhiteboardManager:
    """Manages multiple images on a whiteboard with position and size control."""

    def __init__(self, board_width: int, board_height: int):
        self.board_width = board_width
        self.board_height = board_height
        self.images: List[ImagePlacement] = []

    def add_image(self, image_path: str, x: float, y: float, width: float, height: float,
                  rotation: float = 0.0) -> None:
        """Add an image to the whiteboard at specified position and size."""
        placement = ImagePlacement(image_path, x, y, width, height, rotation)
        self.images.append(placement)

    def remove_image(self, index: int) -> None:
        """Remove an image by index."""
        if 0 <= index < len(self.images):
            self.images.pop(index)

    def clear_images(self) -> None:
        """Remove all images."""
        self.images.clear()

    def get_image_bounds(self) -> Tuple[float, float, float, float]:
        """Get the bounding box of all images (min_x, min_y, max_x, max_y)."""
        if not self.images:
            return 0, 0, self.board_width, self.board_height

        min_x = min(img.x for img in self.images)
        min_y = min(img.y for img in self.images)
        max_x = max(img.x + img.width for img in self.images)
        max_y = max(img.y + img.height for img in self.images)

        return min_x, min_y, max_x, max_y

    def validate_placement(self, placement: ImagePlacement) -> bool:
        """Check if an image placement is valid (within bounds, etc.)."""
        return (placement.x >= 0 and placement.y >= 0 and
                placement.x + placement.width <= self.board_width and
                placement.y + placement.height <= self.board_height and
                placement.width > 0 and placement.height > 0)

    def get_combined_image(self) -> Optional[np.ndarray]:
        """Create a combined image of all placed images on the whiteboard."""
        if not self.images:
            return None

        # Create a white canvas
        canvas = np.ones((self.board_height, self.board_width, 3), dtype=np.uint8) * 255

        for placement in self.images:
            try:
                # Load and resize image
                img = Image.open(placement.image_path).convert('RGB')
                # Use high-quality resampling (3 = BICUBIC/LANCZOS equivalent)
                img_resized = img.resize((int(placement.width), int(placement.height)), 3)
                img_array = np.array(img_resized)

                # Apply rotation if needed
                if placement.rotation != 0:
                    img_pil = Image.fromarray(img_array)
                    img_pil = img_pil.rotate(-placement.rotation, expand=True)
                    img_array = np.array(img_pil)

                    # Adjust position if rotation expanded the image
                    new_width, new_height = img_pil.size
                    placement.x -= (new_width - placement.width) / 2
                    placement.y -= (new_height - placement.height) / 2
                    placement.width = new_width
                    placement.height = new_height

                # Calculate placement coordinates
                x_start = max(0, int(placement.x))
                y_start = max(0, int(placement.y))
                x_end = min(self.board_width, int(placement.x + placement.width))
                y_end = min(self.board_height, int(placement.y + placement.height))

                # Handle partial placement at edges
                img_x_start = max(0, -int(placement.x))
                img_y_start = max(0, -int(placement.y))
                img_x_end = img_x_start + (x_end - x_start)
                img_y_end = img_y_start + (y_end - y_start)

                # Place image on canvas
                canvas[y_start:y_end, x_start:x_end] = img_array[img_y_start:img_y_end, img_x_start:img_x_end]

            except Exception as e:
                print(f"Error processing image {placement.image_path}: {e}")
                continue

        return canvas

    def export_layout(self, filename: str) -> None:
        """Export the current layout as an image."""
        combined = self.get_combined_image()
        if combined is not None:
            img = Image.fromarray(combined)
            img.save(filename)
            print(f"Layout exported to {filename}")

    def get_layout_info(self) -> Dict[str, Any]:
        """Get information about the current layout."""
        bounds = self.get_image_bounds()
        return {
            'board_size': (self.board_width, self.board_height),
            'num_images': len(self.images),
            'bounds': bounds,
            'images': [
                {
                    'path': img.image_path,
                    'position': (img.x, img.y),
                    'size': (img.width, img.height),
                    'rotation': img.rotation
                }
                for img in self.images
            ]
        }