"""Edit inputs: each region of the base (painting + traffic patches) at full HD detail with rough grey sketches of
the street lights at their positions, for the image model to repaint in the painting's style.
  py sketch.py   -> gen/in_<region>.png (+ gen/in_<region>_marks.png, the sketches alone for the check)"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from base import base_crop, ROOT, F

D = os.path.join(ROOT, "rides/streetlights")
REGIONS = {"W": [0, 380, 1200, 1180], "M": [1250, 520, 2450, 1320], "E": [2250, 450, 3450, 1250],
           # v2: the north poles again (arm toward the viewer) and the west south poles
           "W2": [0, 380, 1500, 1380], "N2": [1700, 380, 2860, 1153]}
poles = json.load(open(os.path.join(D, "positions.json")))["poles"]


def inside(p, r):
    return r[0] + 30 < p["foot"][0] < r[2] - 30 and r[1] + 20 < p["top"][1] - 20 and p["foot"][1] + 20 < r[3]


def draw_pole(d, p, r, s=F):
    X = lambda x: (x - r[0]) * s
    Y = lambda y: (y - r[1]) * s
    fx, fy = p["foot"]; tx, ty = p["top"]; hx, hy = p["head"]
    ink, metal, dark, lens = (58, 52, 58), (128, 136, 146), (92, 98, 108), (236, 238, 232)
    # shaft (slight taper) with ink outline
    for w, c in ((2.6, ink), (1.7, metal)):
        d.polygon([(X(fx - w), Y(fy)), (X(fx + w), Y(fy)), (X(tx + w * 0.7), Y(ty + 2)), (X(tx - w * 0.7), Y(ty + 2))], fill=c)
    # base
    d.rectangle([X(fx - 3.6), Y(fy - 6), X(fx + 3.6), Y(fy + 1)], fill=ink)
    d.rectangle([X(fx - 2.8), Y(fy - 5.4), X(fx + 2.8), Y(fy + 0.2)], fill=dark)
    # arm: from the shaft top out to the head, a gentle rise
    mx, my = (tx + hx) / 2, min(ty, hy) - 2.5
    pts = [(X((1 - t) ** 2 * tx + 2 * (1 - t) * t * mx + t * t * hx), Y((1 - t) ** 2 * (ty + 1) + 2 * (1 - t) * t * my + t * t * hy)) for t in np.linspace(0, 1, 12)]
    d.line(pts, fill=ink, width=round(2.8 * s))
    d.line(pts, fill=metal, width=round(1.5 * s))
    # head: a flat LED fixture along the arm's direction, lens underneath
    ux, uy = hx - tx, hy - ty
    n = np.hypot(ux, uy); ux, uy = ux / n, uy / n
    a, b = (hx - ux * 6, hy - uy * 6), (hx + ux * 6, hy + uy * 6)
    d.polygon([(X(a[0]), Y(a[1] - 2.8)), (X(b[0]), Y(b[1] - 2.0)), (X(b[0]), Y(b[1] + 1.8)), (X(a[0]), Y(a[1] + 2.2))], fill=ink)
    d.polygon([(X(a[0] + 0.5), Y(a[1] - 1.4)), (X(b[0] - 0.5), Y(b[1] - 1.0)), (X(b[0] - 0.5), Y(b[1] + 0.2)), (X(a[0] + 0.5), Y(a[1] + 0.6))], fill=dark)
    d.line([(X(a[0] + 1), Y(a[1] + 1.4)), (X(b[0] - 1), Y(b[1] + 1.0))], fill=lens, width=round(0.9 * s))


if __name__ == "__main__":
    os.makedirs(os.path.join(D, "gen"), exist_ok=True)
    out = {}
    only = sys.argv[1:] or list(REGIONS)
    for name, r in REGIONS.items():
        if name not in only:
            continue
        im = Image.fromarray(base_crop(r))
        d = ImageDraw.Draw(im)
        ids = [p["id"] for p in poles if inside(p, r)]
        for p in poles:
            if p["id"] in ids:
                draw_pole(d, p, r)
        f = os.path.join(D, f"gen/in_{name}.png")
        im.save(f)
        out[name] = {"region": r, "poles": ids}
        print(name, r, ids, f)
    old = json.load(open(os.path.join(D, "gen/regions.json"))) if os.path.exists(os.path.join(D, "gen/regions.json")) else {}
    old.update(out)
    json.dump(old, open(os.path.join(D, "gen/regions.json"), "w"), indent=1)
