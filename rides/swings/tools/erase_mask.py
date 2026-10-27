"""The paste mask for the erase (the old east carousel filled in): its silhouette grown past its painted outline and
the soft shadow on its right, clipped hard against the neighbours that must keep their own pixels.

  uv run -q --no-project --with pillow --with numpy python -I rides/swings/tools/erase_mask.py OUT.png

OUT.png covers the region (geom.json "region") at the master's density (2.5 HD px per park px), white = replace.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, RIDE, hull  # noqa: E402

F = 2.5
X0, Y0, X1, Y1 = G["region"]
# neighbours, park px: the stall east of the ride (its roof's left edge slants up to the right), the green bin, the lamp
PROTECT = [
    [(2859, 1489), (2899, 1449), (2960, 1449), (2960, 1600), (2859, 1600)],
    [(2844, 1520), (2859, 1520), (2859, 1560), (2844, 1560)],
    [(2672, 1446), (2709, 1446), (2709, 1481), (2705, 1481), (2705, 1546), (2676, 1546), (2676, 1481), (2672, 1481)],
]


def silhouette():
    g = json.load(open(os.path.join(RIDE, "gen/east_geom.json")))
    pts = [(g["apex"][0] - 12, g["apex"][1] - 17), (g["apex"][0] + 12, g["apex"][1] - 17)]
    for key, grow in (("rim", 8), ("val", 8), ("top", 8), ("bot", 11)):
        e = g[key]
        r = math.radians(e.get("rot", 0))
        for i in range(180):
            t = 2 * math.pi * i / 180
            u, v = (e["a"] + grow) * math.cos(t), (e["b"] + grow) * math.sin(t)
            pts.append((e["c"][0] + u * math.cos(r) - v * math.sin(r), e["c"][1] + u * math.sin(r) + v * math.cos(r)))
    # the cast shadow on the right, up to the stall
    pts += [(2866, 1432), (2866, 1500), (2856, 1530)]
    return hull(pts)


def main():
    out = sys.argv[1]
    w, h = round((X1 - X0) * F), round((Y1 - Y0) * F)
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    q = lambda pts: [((x - X0) * F, (y - Y0) * F) for x, y in pts]
    d.polygon(q(silhouette()), fill=255)
    for p in PROTECT:
        d.polygon(q(p), fill=0)
    m.save(out)
    print(out, m.size, f"{(np.asarray(m) > 0).mean():.3f} of the region")


if __name__ == "__main__":
    main()
