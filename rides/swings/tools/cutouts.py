"""Cut-outs the layer draws among the chairs, from the plate (gen/plate_hd.webp) and the canopy take:
  drum.webp    the drum and its leaf ring: back chairs hang behind it
  fence.webp   the front half of the white railing (rails and posts only): chairs inside it pass behind it
  finial.webp  the gold ball and pennant on the cupola's tip (gen/ride_v1_0.png), moved with the canopy
and cutouts.json ({name: {file, rect (park px), anchor?}}).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/swings/tools/cutouts.py
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, RIDE, ring, hull, polar  # noqa: E402

F = 2.5
OUT = 3.0  # px per park px of the shipped cut-outs
GEN = os.path.join(RIDE, "gen")


def plate():
    meta = json.load(open(os.path.join(RIDE, "plate.json")))
    im = np.asarray(Image.open(os.path.join(GEN, "plate_hd.webp")).convert("RGBA")).astype(np.float32)
    return im, meta["rect"]


def poly_mask(shape, rect, pts, s=F):
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([((x - rect[0]) * s, (y - rect[1]) * s) for x, y in pts], fill=255)
    return np.asarray(m).astype(np.float32) / 255


def save(name, rgba, rect, alpha, s=F, extra=None):
    a = rgba.copy()
    a[..., 3] = a[..., 3] * alpha
    ys, xs = np.where(a[..., 3] > 2)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = Image.fromarray(np.clip(a[y0:y1, x0:x1], 0, 255).astype(np.uint8), "RGBA")
    r = [rect[0] + x0 / s, rect[1] + y0 / s, (x1 - x0) / s, (y1 - y0) / s]
    crop = crop.resize((max(1, round(r[2] * OUT)), max(1, round(r[3] * OUT))), Image.LANCZOS)
    fn = f"{name}.webp"
    crop.save(os.path.join(RIDE, fn), quality=92, alpha_quality=100, method=6)
    out = {"file": fn, "rect": [round(float(v), 2) for v in r]}
    if extra:
        out.update(extra)
    print(name, out, f"{os.path.getsize(os.path.join(RIDE, fn)) // 1024} KB")
    return out


def main():
    im, rect = plate()
    res = {}
    pl, fe, dr = G["platform"], G["fence"], G["drum"]
    # the drum from the floor up, with the leaf ring (not the column's stub: the live column turns, the stub wouldn't)
    # (traced on a gridded zoom of gen/ride_v1_1.png: the gold rim's top ellipse, the leaf ring round the column's foot; the floor between the leaf tips and the rim's back edge stays out)
    cx = G["hub"][0]
    e = lambda c, a, b_, n=72: [(c[0] + a * math.cos(2 * math.pi * i / n), c[1] + b_ * math.sin(2 * math.pi * i / n)) for i in range(n)]
    side = ring(dr["r"] + 0.4, pl["h"] - 0.3, 0, 180) + [(cx - dr["r"] - 0.4, 1469), (cx + dr["r"] + 0.4, 1469)]
    parts = [side, e((cx, 1469), dr["r"] + 0.3, 6.2), e((cx, 1467.2), 14.3, 4.9)]
    m = np.max([poly_mask(im.shape, rect, q) for q in parts], axis=0)
    m = ndimage.gaussian_filter(m, 0.5)
    res["drum"] = save("drum", im, rect, m)
    # the front railing: white rails and posts in a band round the platform's front edge, with their ink outline
    top = pl["h"] + fe["h"] + 2
    band = ring(fe["r"] + 2.5, pl["h"] - 1.5, 0, 180) + ring(fe["r"] + 2.5, top, 0, 180)[::-1]
    inner = ring(fe["r"] - 2.5, pl["h"] - 1.5, 0, 180) + ring(fe["r"] - 2.5, top, 0, 180)[::-1]
    region = np.maximum(poly_mask(im.shape, rect, band), poly_mask(im.shape, rect, inner)) > 0.5
    rgb = im[..., :3]
    white = (rgb.min(-1) > 196) & (rgb.max(-1) - rgb.min(-1) < 48)
    keep = ndimage.binary_dilation(white, iterations=2) & region
    # never the skirt (red) or the floor seen between the rails
    lum = rgb.mean(-1)
    keep &= ~((rgb[..., 0] - rgb[..., 2] > 60) & (lum > 120) & ~ndimage.binary_dilation(white, iterations=1))
    alpha = ndimage.gaussian_filter(keep.astype(np.float32), 0.6)
    res["fence"] = save("fence", im, rect, np.clip(alpha * 1.3, 0, 1))
    # the finial: gold ball and pennant, from the 4K canopy take, keyed against the background behind it
    X0, Y0 = G["region"][0], G["region"][1]
    S4 = 3840 / (G["region"][2] - X0)
    take = np.asarray(Image.open(os.path.join(GEN, "ride_v1_0.png")).convert("RGB")).astype(np.float32)
    fx0, fy0, fx1, fy1 = 2780.5, 1355.5, 2797.5, 1365.2
    sub = take[round((fy0 - Y0) * S4):round((fy1 - Y0) * S4), round((fx0 - X0) * S4):round((fx1 - X0) * S4)]
    # traced on a gridded zoom: the ball, the pennant to its right, the neck under it
    fin = G["painted"]["finial"]
    (bx, by), br = fin["c"], fin["r"] + 0.35
    ball = [(bx + br * math.cos(2 * math.pi * i / 48), by + br * math.sin(2 * math.pi * i / 48)) for i in range(48)]
    pennant = [(2788.6, 1360.6), (2789.4, 1360.5), (2796.3, 1363.2), (2795.9, 1364.1), (2789.4, 1362.9), (2788.6, 1362.8)]
    neck = [(2784.4, 1363.2), (2787.0, 1363.2), (2787.2, 1364.9), (2784.2, 1364.9)]
    keep = np.max([poly_mask(sub.shape, [fx0, fy0], q, s=S4) for q in (ball, pennant, neck)], axis=0)
    alpha = ndimage.gaussian_filter(keep, 1.2)
    rgba = np.dstack([sub, np.full(sub.shape[:2], 255, np.float32)])
    res["finial"] = save("finial", rgba, [fx0, fy0], np.clip(alpha * 1.2, 0, 1), s=S4, extra={"anchor": fin["c"]})
    json.dump(res, open(os.path.join(RIDE, "cutouts.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
