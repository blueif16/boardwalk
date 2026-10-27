"""Road masks on the park painting, for tracing lanes.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/road_masks.py

Writes rides/traffic/gen/mask_yellow.png (the painted centre line), mask_asphalt.png (grey road surface) and
mask_overlay.png (both over the painting at park size), plus centre-line samples per 20 px column to stdout.
Works on site/park/world_3840.webp (park px).
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
im = np.asarray(Image.open(os.path.join(ROOT, "site/park/world_3840.webp")).convert("RGB")).astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx, mn = im.max(-1), im.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
# yellow paint: warm, saturated, bright
yellow = (r > 170) & (g > 140) & (b < 120) & (r - b > 90) & (g - b > 60) & (np.abs(r - g) < 70)
# asphalt: grey, low saturation, mid brightness
asphalt = (sat < 0.10) & (mx > 140) & (mx < 215)
asphalt = ndimage.binary_opening(asphalt, iterations=2)
band = np.zeros_like(yellow); band[450:1150] = True
yellow &= band; asphalt &= band
Image.fromarray((yellow * 255).astype(np.uint8)).save(os.path.join(RIDE, "gen/mask_yellow.png"))
Image.fromarray((asphalt * 255).astype(np.uint8)).save(os.path.join(RIDE, "gen/mask_asphalt.png"))
ov = im.copy() * 0.55
ov[asphalt] = ov[asphalt] * 0.4 + np.array([60, 120, 255]) * 0.6
ov[yellow] = [255, 40, 40]
Image.fromarray(np.clip(ov, 0, 255).astype(np.uint8)[400:1200]).save(os.path.join(RIDE, "gen/mask_overlay.png"))
for x in range(0, 3840, 80):
    col = yellow[:, x:x + 20].any(1)
    ys = np.where(col)[0]
    print(x, ys.tolist()[:1], ys.tolist()[-1:] if len(ys) else [], len(ys))
