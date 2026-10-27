"""Fit the painted canopy's ellipses in a ride take (rides/swings/gen/ride_v1_0.png): the crown band's top (the red
rim line) and bottom (the scallops' lowest ink), least squares over the front half with the half-width fixed by the
band's visible extent. Prints the ellipses in park px.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/swings/tools/fit_canopy.py TAKE.png
"""
import sys
import numpy as np
from PIL import Image
from scipy.optimize import least_squares

X0, Y0 = 2615, 1330
S = 3840 / 342
im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(float)


def region(x0, x1, y0, y1):
    return im[round((y0 - Y0) * S):round((y1 - Y0) * S), round((x0 - X0) * S):round((x1 - X0) * S)]


def fit(pts, a, guess):
    pts = np.array(pts)
    def res(p):
        cx, cy, B = p
        u = np.clip((pts[:, 0] - cx) / a, -1, 1)
        return cy + B * np.sqrt(1 - u * u) - pts[:, 1]
    s = least_squares(res, guess, loss="soft_l1", f_scale=0.6)
    return s.x, np.sqrt(np.median(s.fun ** 2))


# band top: the topmost red run per column
x0, x1, y0, y1 = 2725, 2848, 1385, 1415
a = region(x0, x1, y0, y1)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
red = (r > 170) & (g < 120) & (b < 120) & (r - g > 80)
top = []
for j in range(red.shape[1]):
    ys = np.where(red[:, j])[0]
    if len(ys) < 3:
        continue
    run = [ys[0]]
    for y in ys[1:]:
        if y - run[-1] <= 2:
            run.append(y)
        else:
            break
    top.append((x0 + j / S, y0 + np.mean(run) / S))
xs = np.array([p[0] for p in top])
A1 = (xs.max() - xs.min()) / 2 + 0.6
(cx, cy, B), e = fit(top, A1, [2786, 1390, 20])
print(f"band top    c=({cx:.1f}, {cy:.1f}) a={A1:.1f} b={B:.1f} k={B / A1:.3f} (median residual {e:.2f})")
# band bottom: the lowest ink per column, away from the column in the middle
x0, x1, y0, y1 = 2725, 2848, 1395, 1428
a = region(x0, x1, y0, y1)
ink = a.sum(-1) < 260
bot = []
for j in range(ink.shape[1]):
    X = x0 + j / S
    if 2774 < X < 2798:
        continue
    ys = np.where(ink[:, j])[0]
    if len(ys):
        bot.append((X, y0 + ys.max() / S))
xs = np.array([p[0] for p in bot])
A2 = (xs.max() - xs.min()) / 2 + 0.6
(cx2, cy2, B2), e2 = fit(bot, A2, [2786, 1406, 17])
print(f"band bottom c=({cx2:.1f}, {cy2:.1f}) a={A2:.1f} b={B2:.1f} k={B2 / A2:.3f} (median residual {e2:.2f})")
