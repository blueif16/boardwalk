"""The painting as the page shows it under this layer: gen/park/world_v2_hd.png with rides/traffic's car-erase patches
(patch_R1..R3, laid in the plate slot) composited, so street-light patches never bring the painted cars back.

  from base import base_crop   # base_crop([x0, y0, x1, y1]) -> RGB uint8 array at HD (2.5 px per park px)
"""
import json, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
HD = os.path.join(ROOT, "gen/park/world_v2_hd.png")
F = 2.5
TRAFFIC = os.path.join(ROOT, "rides/traffic")


def base_crop(r):
    x0, y0, x1, y1 = r
    box = (round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F))
    with Image.open(HD) as im:
        out = np.asarray(im.convert("RGB").crop(box)).astype(np.float32)
    for p in json.load(open(os.path.join(TRAFFIC, "patches.json"))):
        px, py, pw, ph = p["rect"]
        pim = Image.open(os.path.join(TRAFFIC, p["file"])).convert("RGBA")
        pim = pim.resize((round(pw * F), round(ph * F)), Image.LANCZOS) if pim.size != (round(pw * F), round(ph * F)) else pim
        a = np.asarray(pim).astype(np.float32)
        ox, oy = round(px * F) - box[0], round(py * F) - box[1]
        # intersection
        sx0, sy0 = max(0, -ox), max(0, -oy)
        dx0, dy0 = max(0, ox), max(0, oy)
        w = min(a.shape[1] - sx0, out.shape[1] - dx0)
        h = min(a.shape[0] - sy0, out.shape[0] - dy0)
        if w <= 0 or h <= 0:
            continue
        src = a[sy0:sy0 + h, sx0:sx0 + w]
        al = src[..., 3:4] / 255
        dst = out[dy0:dy0 + h, dx0:dx0 + w]
        out[dy0:dy0 + h, dx0:dx0 + w] = dst * (1 - al) + src[..., :3] * al
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


if __name__ == "__main__":
    import sys
    r = [float(v) for v in sys.argv[1:5]]
    s = float(sys.argv[6]) if len(sys.argv) > 6 else 1
    im = Image.fromarray(base_crop(r))
    if s != 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im.save(sys.argv[5])
