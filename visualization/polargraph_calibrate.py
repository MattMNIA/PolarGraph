import requests
import time

ESP32_URL = "http://192.168.1.50"   # CHANGE THIS TO YOUR CONTROLLER IP

CAL_RECT = [
    {"x": 100, "y": 100, "penDown": True},
    {"x": 500, "y": 100, "penDown": True},
    {"x": 500, "y": 500, "penDown": True},
    {"x": 100, "y": 500, "penDown": True},
    {"x": 100, "y": 100, "penDown": True}
]

def send_path(points):
    print("\nSending calibration rectangle to ESP32...")
    payload = {
        "reset": True,
        "startPosition": {"x": 100, "y": 100, "penDown": False},
        "speed": 800,
        "points": points
    }
    res = requests.post(f"{ESP32_URL}/api/path", json=payload)
    print("ESP32 Response:", res.json())
    print("\nMachine is drawing calibration rectangle...\n")


def wait_until_done():
    print("Waiting for machine to finish...")
    while True:
        time.sleep(1)
        r = requests.get(f"{ESP32_URL}/api/status").json()
        if not r["queue"]["isExecuting"]:
            print("✓ Drawing complete!\n")
            break


def compute_corrections(
    BW_assumed, H_offset_assumed, connOffset_assumed,
    W_meas, H_meas, skew
):
    ideal = 400.0

    widthScale = ideal / W_meas
    heightScale = ideal / H_meas

    BW_new = BW_assumed * widthScale
    H_offset_new = H_offset_assumed * heightScale
    connOffset_new = connOffset_assumed + skew * 0.5

    return BW_new, H_offset_new, connOffset_new, widthScale, heightScale


def main():
    print("=== POLARGRAPH CALIBRATION ===\n")
    print("This script will:")
    print("  1. Draw a 400×400 mm square")
    print("  2. Ask for three measurements")
    print("  3. Output corrected geometric constants\n")

    input("Press ENTER when ready...")

    # DRAW
    send_path(CAL_RECT)
    wait_until_done()

    print("Now measure:")
    print("  - width  (left → right)")
    print("  - height (bottom → top)")
    print("  - skew   (mm difference between top-left and bottom-left X positions)\n")

    W_meas = float(input("Measured WIDTH  (mm): "))
    H_meas = float(input("Measured HEIGHT (mm): "))
    skew = float(input("Measured SKEW   (mm): "))

    # Existing firmware constants — CHANGE to match your .ino
    BW_assumed = 1150.0
    H_offset_assumed = 60.0
    connOffset_assumed = 29.0

    BW_new, H_new, C_new, widthScale, heightScale = compute_corrections(
        BW_assumed, H_offset_assumed, connOffset_assumed,
        W_meas, H_meas, skew
    )

    print("\n=== RESULTS ===")
    print(f"Width scaling factor:  {widthScale:.5f}")
    print(f"Height scaling factor: {heightScale:.5f}\n")

    print("Paste these into your firmware:")
    print(f"constexpr float BOARD_WIDTH_MM = {BW_new:.3f}f;")
    print(f"constexpr float MOTOR_OFFSET_Y  = {H_new:.3f}f;")
    print(f"constexpr float CONNECTION_TO_PEN_DISTANCE = {C_new:.3f}f;\n")

    print("Recompile firmware → Upload → Done!")


if __name__ == "__main__":
    main()
