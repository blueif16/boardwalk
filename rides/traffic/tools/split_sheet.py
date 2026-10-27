"""Split a 2 x 2 car turnaround sheet (front | side, back | three-quarter) into four view images for Meshy.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/split_sheet.py NAME

Reads rides/traffic/gen/car_NAME_0.png, finds the car in each quadrant (non-white), crops it with a 6% margin onto a
white square-ish canvas and writes rides/traffic/gen/meshy/NAME/{front,side,back,threequarter}.png.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
name = sys.argv[1]
im = Image.open(os.path.join(RIDE, f"gen/car_{name}_0.png")).convert("RGB")
a = np.asarray(im).astype(int)
H, W = a.shape[:2]
fg = ~((a.min(-1) > 232) & (a.max(-1) - a.min(-1) < 20))
fg = ndimage.binary_opening(fg, iterations=2)
out = os.path.join(RIDE, f"gen/meshy/{name}")
os.makedirs(out, exist_ok=True)
for (r, c), view in {(0, 0): "front", (0, 1): "side", (1, 0): "back", (1, 1): "threequarter"}.items():
    sub = fg[r * H // 2:(r + 1) * H // 2, c * W // 2:(c + 1) * W // 2]
    lab, n = ndimage.label(sub)
    sizes = ndimage.sum(sub, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 0.01 * sizes.max()])
    ys, xs = np.where(keep)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = int(0.06 * max(y1 - y0, x1 - x0))
    crop = im.crop((c * W // 2 + x0 - m, r * H // 2 + y0 - m, c * W // 2 + x1 + m, r * H // 2 + y1 + m))
    crop.save(os.path.join(out, f"{view}.png"))
    print(view, crop.size)
