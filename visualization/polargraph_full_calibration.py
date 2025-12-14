import requests
import numpy as np
from scipy.optimize import least_squares

ESP32 = "http://192.168.50.95"   # CHANGE THIS

TARGET_POINTS = np.array([
    [100, 100],
    [550, 100],
    [100, 450],
    [550, 450],
    [325, 275],
    [100, 275]
])

def run_calibration_pattern():
    print("\nSending calibration test pattern to the robot...\n")
    res = requests.post(f"{ESP32}/api/calibrate", json={"run": True})
    print("ESP32 replied:", res.json())
    input("\nPress ENTER after the robot finishes drawing.\n")


def get_measured_points():
    print("Enter measured XY coordinates for each dot:")
    measured = []
    for i, (tx, ty) in enumerate(TARGET_POINTS):
        x = float(input(f"Measured X for point {i+1} (target {tx},{ty}): "))
        y = float(input("Measured Y: "))
        measured.append([x, y])
    return np.array(measured)


# forward-model cable lengths from geometry
def cable_lengths(params, pts):
    MLX, MRX, MY, CLX, CRX, steps_mm = params

    xs = pts[:,0]
    ys = pts[:,1]

    dxL = (xs + CLX) - MLX
    dxR = (xs + CRX) - MRX
    dy  = ys + MY

    L = np.sqrt(dxL*dxL + dy*dy)
    R = np.sqrt(dxR*dxR + dy*dy)
    return L, R


# Objective uses reverse IK → predicted XY
def objective(params, measured_pts):
    MLX, MRX, MY, CLX, CRX, steps_mm = params
    L, R = cable_lengths(params, TARGET_POINTS)

    d = MRX - MLX

    predicted = []
    for i in range(len(L)):
        l = L[i]
        r = R[i]

        a2 = l*l - MY*MY
        b2 = r*r - MY*MY

        # Solve for x from the two circles intersection geometry
        x = (d*d + a2 - b2) / (2*d)
        y = np.sqrt(max(0, a2 - x*x))

        predicted.append([x - CLX, y])

    predicted = np.array(predicted)
    return (predicted - measured_pts).ravel()


def main():
    print("\n=== FULL POLARGRAPH CALIBRATION ===\n")

    run_calibration_pattern()
    measured_pts = get_measured_points()

    # Initial guesses based on your firmware
    p0 = np.array([
        0.0,        # MLX
        1150.0,     # MRX
        60.0,       # MY
        -29.0,      # CLX
        +29.0,      # CRX
        848.0       # steps/mm initial guess
    ])

    print("\nSolving geometry using nonlinear least squares...")
    result = least_squares(objective, p0, args=(measured_pts,), verbose=2)

    MLX, MRX, MY, CLX, CRX, steps = result.x

    print("\n=== NEW CALIBRATED CONSTANTS ===")
    print(f"constexpr float MOTOR_LEFT_X     = {MLX:.3f}f;")
    print(f"constexpr float MOTOR_RIGHT_X    = {MRX:.3f}f;")
    print(f"constexpr float MOTOR_OFFSET_Y_V = {MY:.3f}f;")
    print(f"constexpr float CARRIAGE_LEFT_X  = {CLX:.3f}f;")
    print(f"constexpr float CARRIAGE_RIGHT_X = {CRX:.3f}f;")
    print(f"constexpr float STEPS_PER_MM_VAR = {steps:.6f}f;")

    print("\nPaste these into your firmware and upload.\n")


if __name__ == "__main__":
    main()
