"""Front cut-outs from base/stage_4k.png that characters can walk behind: the rail, lamps, stalls and a palm.

  uv run --with pillow --with numpy --with scipy python -I tests/characters/tools/make_occluders.py   (from the repo root)

Each object is a rough outline (stage px) whose deck-coloured pixels are keyed out, cut into vertical strips, and
given a sort line: the front of its base. A strip is drawn over every character whose feet are above (behind) the
sort line at the strip's centre. Outlines and positions are in stage px; the pixels are cut at the 4K image's density
(F image px per stage px, stored as each strip's "scale"). Writes gen/occluders.npz + gen/occluders.json and a
preview at stage size, gen/occluders.png.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.dirname(HERE)
GEN = os.path.join(TEST, "gen")
walk = json.load(open(os.path.join(TEST, "walk.json")))
stage = np.asarray(Image.open(os.path.join(TEST, "..", "..", "base", "stage_4k.png")).convert("RGB")).astype(np.float32)
H, W = stage.shape[:2]
SW, SH = 1536, 1024
F = W / SW


def it(n):
    return max(1, round(n * F))


def along(line, x):
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        if x <= bx:
            return ay + (x - ax) / (bx - ax) * (by - ay)
    return line[-1][1]


DECK = [(300, 555, 380, 590), (700, 670, 800, 690), (1180, 640, 1228, 690), (90, 530, 200, 552), (820, 690, 880, 720), (1000, 600, 1040, 640), (1380, 790, 1430, 830)]


def deck_model(k=10):
    px = np.concatenate([stage[round(y0 * F):round(y1 * F), round(x0 * F):round(x1 * F)].reshape(-1, 3) for x0, y0, x1, y1 in DECK])
    rng = np.random.default_rng(0)
    c = px[rng.choice(len(px), k, replace=False)]
    for _ in range(25):
        lab = ((px[:, None] - c[None]) ** 2).sum(-1).argmin(1)
        c = np.array([px[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
    return c


CENTERS = deck_model()


def deck_distance(region):
    d = np.sqrt(((region[..., None, :] - CENTERS[None, None]) ** 2).sum(-1)).min(-1)
    return d


def poly_mask(poly):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(x * F, y * F) for x, y in poly], fill=255)
    return np.asarray(m) > 0


def keyed(mask, fill_holes, lo=16, hi=34, solid_inside=0):
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    region = stage[y0:y1, x0:x1]
    d = deck_distance(region)
    a = np.clip((d - lo) / (hi - lo), 0, 1) * mask[y0:y1, x0:x1]
    if solid_inside:
        inner = ndimage.binary_erosion(mask[y0:y1, x0:x1], iterations=it(solid_inside))
        return (x0, y0), np.dstack([region / 255.0, np.maximum(a, inner.astype(np.float32))])
    solid = ndimage.binary_opening(a > 0.5, iterations=it(1))
    if fill_holes:
        solid = ndimage.binary_fill_holes(ndimage.binary_closing(solid, iterations=it(3))) & mask[y0:y1, x0:x1]
        a = np.maximum(a * ndimage.binary_dilation(solid, iterations=it(1)), solid.astype(np.float32))
    else:
        a = a * ndimage.binary_dilation(solid, iterations=it(1))
    return (x0, y0), np.dstack([region / 255.0, a])


out, meta = {}, {}


def emit(name, origin, rgba, base, strip):
    x0, y0 = origin
    h, w = rgba.shape[:2]
    strip = round(strip * F)
    for s in range(0, w, strip):
        part = rgba[:, s:s + strip]
        cols = np.where(part[..., 3].max(0) > 0.02)[0]
        rows = np.where(part[..., 3].max(1) > 0.02)[0]
        if not len(cols):
            continue
        part = part[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
        key = f"{name}_{s // strip:02d}"
        cx = (x0 + s + min(strip, w - s) / 2) / F
        out[key] = part.astype(np.float32)
        meta[key] = {"at": [round((x0 + s + cols.min()) / F, 2), round((y0 + rows.min()) / F, 2)], "anchor": [0, 0],
                     "scale": F, "sortY": round(float(base(cx)), 1)}


rail = walk["rail"]
for i, x in enumerate(range(0, SW, 384)):
    xs = list(range(x, min(SW, x + 384) + 1, 8))
    poly = [(xx, along(rail, xx) - 9) for xx in xs] + [(xx, along(rail, xx) + 19) for xx in reversed(xs)]
    origin, rgba = keyed(poly_mask(poly), False, lo=20, hi=40)
    emit(f"rail{i}", origin, rgba, lambda cx: along(rail, cx) + 17, 24)

def lamp_mask(lx, ly):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for cx, cy, r in [(lx - 10, ly - 76, 9), (lx + 13, ly - 77, 9), (lx + 2, ly - 93, 9)]:
        d.ellipse([(cx - r) * F, (cy - r) * F, (cx + r) * F, (cy + r) * F], fill=255)
    d.rectangle([(lx - 4) * F, (ly - 90) * F, (lx + 6) * F, (ly - 30) * F], fill=255)
    d.rectangle([(lx - 14) * F, (ly - 34) * F, (lx + 15) * F, (ly + 4) * F], fill=255)
    return np.asarray(m) > 0


for i, (lx, ly) in enumerate(walk["lamps"]):
    origin, rgba = keyed(lamp_mask(lx, ly), False, lo=9, hi=22)
    emit(f"lamp{i}", origin, rgba, lambda cx, ly=ly: ly, 64)

STALLS = {
    "teal": ([(445, 577), (472, 545), (584, 570), (598, 586), (597, 628), (562, 666), (447, 643), (444, 600)], [(448, 641), (561, 664), (595, 627)]),
    "blue": ([(1013, 708), (1046, 672), (1152, 692), (1169, 715), (1165, 762), (1126, 804), (1016, 780)], [(1018, 778), (1125, 801), (1163, 760)]),
    "red_east": ([(1250, 755), (1254, 730), (1277, 724), (1292, 690), (1364, 702), (1384, 728), (1382, 770), (1336, 808), (1252, 786)], [(1253, 785), (1335, 806), (1381, 770)]),
}
for name, (poly, base) in STALLS.items():
    origin, rgba = keyed(poly_mask(poly), False, solid_inside=3)
    emit(f"stall_{name}", origin, rgba, lambda cx, base=base: along(base, cx), 24)

palm = [(1160, 720), (1180, 686), (1226, 683), (1254, 712), (1242, 762), (1226, 800), (1232, 826), (1180, 826), (1186, 795), (1170, 760)]
origin, rgba = keyed(poly_mask(palm), False)
emit("palm", origin, rgba, lambda cx: 818, 128)

np.savez_compressed(os.path.join(GEN, "occluders.npz"), **out)
json.dump(meta, open(os.path.join(GEN, "occluders.json"), "w"))

prev = np.zeros((H, W, 4), np.float32)
prev[..., :3] = [0.2, 0.6, 1.0]
prev[..., 3] = 1
for k, m in meta.items():
    x0, y0 = round(m["at"][0] * F), round(m["at"][1] * F)
    a = out[k]
    h, w = a.shape[:2]
    sl = prev[y0:y0 + h, x0:x0 + w]
    sl[..., :3] = sl[..., :3] * (1 - a[..., 3:]) + a[..., :3] * a[..., 3:]
Image.fromarray((prev[..., :3] * 255).astype(np.uint8)).resize((SW, SH), Image.LANCZOS).save(os.path.join(GEN, "occluders.png"))
print(f"{len(out)} occluder strips")
