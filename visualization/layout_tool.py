#!/usr/bin/env python3
"""Interactive whiteboard layout tool for positioning multiple images."""

import argparse
import os
import sys
from pathlib import Path

# Add the parent directory to the path so we can import polargraph
sys.path.insert(0, str(Path(__file__).parent.parent))

from polargraph.whiteboard_manager import WhiteboardManager


def interactive_layout(board_width: int = 900, board_height: int = 550):
    """Interactive mode for positioning images on the whiteboard."""
    wb = WhiteboardManager(board_width, board_height)

    print(f"Interactive Whiteboard Layout Tool")
    print(f"Board size: {board_width} x {board_height}")
    print("Commands:")
    print("  add <image_path> <x> <y> <width> <height> - Add image at position")
    print("  auto <image_path> - Auto-position image in next available slot")
    print("  remove <index> - Remove image by index")
    print("  list - Show current layout")
    print("  preview - Generate preview image")
    print("  save <filename> - Save layout positions to file")
    print("  load <filename> - Load layout positions from file")
    print("  run - Generate command to run simulation")
    print("  quit - Exit")

    while True:
        try:
            cmd = input("\n> ").strip().split()
            if not cmd:
                continue

            command = cmd[0].lower()

            if command == 'add' and len(cmd) >= 6:
                image_path = cmd[1]
                x, y, width, height = map(float, cmd[2:6])
                if os.path.exists(image_path):
                    wb.add_image(image_path, x, y, width, height)
                    print(f"Added {image_path} at ({x}, {y}) size {width}x{height}")
                else:
                    print(f"Image file not found: {image_path}")

            elif command == 'auto' and len(cmd) >= 2:
                image_path = cmd[1]
                if os.path.exists(image_path):
                    # Simple auto-positioning: place in a grid
                    num_images = len(wb.images)
                    cols = int(num_images ** 0.5) + 1
                    rows = (num_images // cols) + 1
                    col = num_images % cols
                    row = num_images // cols

                    img_width = board_width / cols
                    img_height = board_height / rows
                    x = col * img_width
                    y = row * img_height

                    wb.add_image(image_path, x, y, img_width, img_height)
                    print(f"Auto-positioned {image_path} at ({x:.1f}, {y:.1f}) size {img_width:.1f}x{img_height:.1f}")
                else:
                    print(f"Image file not found: {image_path}")

            elif command == 'remove' and len(cmd) >= 2:
                try:
                    index = int(cmd[1])
                    if 0 <= index < len(wb.images):
                        removed = wb.images.pop(index)
                        print(f"Removed image: {removed.image_path}")
                    else:
                        print("Invalid index")
                except ValueError:
                    print("Invalid index")

            elif command == 'list':
                layout = wb.get_layout_info()
                if layout['num_images'] == 0:
                    print("No images on whiteboard")
                else:
                    print(f"Whiteboard: {layout['board_size'][0]}x{layout['board_size'][1]}")
                    for i, img in enumerate(layout['images']):
                        print(f"  {i}: {os.path.basename(img['path'])} at {img['position']} size {img['size']}")

            elif command == 'preview':
                combined = wb.get_combined_image()
                if combined is not None:
                    wb.export_layout("whiteboard_preview.png")
                    print("Preview saved as 'whiteboard_preview.png'")
                else:
                    print("No images to preview")

            elif command == 'save' and len(cmd) >= 2:
                filename = cmd[1]
                layout = wb.get_layout_info()
                with open(filename, 'w') as f:
                    f.write(f"{board_width} {board_height}\n")
                    for img in layout['images']:
                        f.write(f"{img['path']} {img['position'][0]} {img['position'][1]} {img['size'][0]} {img['size'][1]}\n")
                print(f"Layout saved to {filename}")

            elif command == 'load' and len(cmd) >= 2:
                filename = cmd[1]
                try:
                    with open(filename, 'r') as f:
                        lines = f.readlines()
                        if lines:
                            # First line: board dimensions
                            bw, bh = map(int, lines[0].split())
                            wb = WhiteboardManager(bw, bh)
                            # Subsequent lines: image data
                            for line in lines[1:]:
                                parts = line.strip().split()
                                if len(parts) >= 5:
                                    path, x, y, w, h = parts[0], float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
                                    wb.add_image(path, x, y, w, h)
                    print(f"Layout loaded from {filename}")
                except Exception as e:
                    print(f"Error loading layout: {e}")

            elif command == 'run':
                layout = wb.get_layout_info()
                if layout['num_images'] == 0:
                    print("No images to draw")
                    continue

                # Build command
                images = [f'"{img["path"]}"' for img in layout['images']]
                positions = []
                for img in layout['images']:
                    pos = img['position'] + img['size']
                    positions.extend([str(p) for p in pos])

                cmd_parts = ["python", "examples/run_simulation.py"]
                cmd_parts.extend(["--images"] + images)
                cmd_parts.extend(["--positions"] + positions)
                cmd_parts.extend([f"--board-width {board_width}", f"--board-height {board_height}"])

                print("Run this command:")
                print(" ".join(cmd_parts))

            elif command in ['quit', 'exit', 'q']:
                break

            else:
                print("Unknown command. Type 'help' for available commands.")

        except KeyboardInterrupt:
            print("\nExiting...")
            break
        except Exception as e:
            print(f"Error: {e}")


def main():
    parser = argparse.ArgumentParser(description='Interactive whiteboard layout tool')
    parser.add_argument('--board-width', type=int, default=900)
    parser.add_argument('--board-height', type=int, default=550)
    parser.add_argument('--interactive', action='store_true', help='Start interactive mode')

    args = parser.parse_args()

    if args.interactive:
        interactive_layout(args.board_width, args.board_height)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()