"""How well the cars sit on the painted road.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/measure.py

1. Footprint on asphalt: for every 4 px of the loop and of every stall path, a car's ground footprint (80 x 42 ground
   units, the hatchback with a margin of none) at that point and heading, projected with the park camera; the share
   of its pixels that are road (asphalt grey or road paint) on the painting with the erase patches. Prints the worst
   places.
2. Offset from the painted carriageway's centre: eastbound, (yellow line + south kerb) / 2, where both are traced.
Writes rides/traffic/gen/measure.json.
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
lanes = json.load(open(os.path.join(RIDE, "lanes.json")))
park = json.load(open(os.path.join(ROOT, "tests/park-crowd/park.json")))
yaw, pitch = math.radians(park["camera"]["yawDeg"]), math.radians(park["camera"]["pitchDeg"])
ex = (math.cos(yaw), math.sin(pitch) * math.sin(yaw))
ez = (-math.sin(yaw), math.sin(pitch) * math.cos(yaw))
det = ex[0] * ez[1] - ez[0] * ex[1]

img = Image.open(os.path.join(ROOT, "site/park/world_3840.webp")).convert("RGBA")
for p in json.load(open(os.path.join(RIDE, "patches.json"))):
    x, y, w, h = p["rect"]
    im = Image.open(os.path.join(RIDE, p["file"])).convert("RGBA").resize((round(w), round(h)), Image.LANCZOS)
    img.alpha_composite(im, (round(x), round(y)))
a = np.asarray(img.convert("RGB")).astype(np.float32)
mx, mn = a.max(-1), a.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
yel_y = np.interp(np.arange(3840), *zip(*lanes["lines"]["yellow"]))
near_yellow = np.abs(np.arange(a.shape[0])[:, None] - yel_y[None, :]) < 12
road = ((sat < 0.14) & (mx > 110) & (mx < 236)) | ((r > 170) & (g > 140) & (b < 125) & (r - b > 80) & near_yellow)
# Pixels a front cut-out covers (palms, the pin, ride tops over the street) are drawn over the car anyway: they count
# as road here, so the test only catches a car standing on something flat that isn't street.
occ = json.load(open(os.path.join(RIDE, "occ.json")))
oim = np.asarray(Image.open(os.path.join(RIDE, "occ.webp")).convert("RGBA"))
for pc in occ["pieces"]:
    sx, sy, sw, sh = pc["rect"]
    x, y, w, h = pc["at"]
    al = Image.fromarray(oim[sy:sy + sh, sx:sx + sw, 3]).resize((max(1, round(w)), max(1, round(h))))
    m = np.asarray(al) > 100
    x0, y0 = round(x), round(y)
    road[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] |= m[:road.shape[0] - y0, :road.shape[1] - x0]


def heading(pts, i):
    p0, p1 = pts[max(0, i - 4)], pts[min(len(pts) - 1, i + 4)]
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    gx, gz = (dx * ez[1] - ez[0] * dy) / det, (ex[0] * dy - dx * ex[1]) / det
    return math.atan2(gz, gx)


def footprint(x, y, th, L=80, Wd=42):
    c, s = math.cos(th), math.sin(th)
    pts = []
    for u, v in ((L / 2, Wd / 2), (L / 2, -Wd / 2), (-L / 2, -Wd / 2), (-L / 2, Wd / 2)):
        gx, gz = u * c - v * s, u * s + v * c
        pts.append((x + gx * ex[0] + gz * ez[0], y + gx * ex[1] + gz * ez[1]))
    return pts


def on_road(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0, x1, y1 = int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1
    if x1 < 0 or x0 >= 3840:
        return None
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(m).polygon([(px - x0, py - y0) for px, py in pts], fill=255)
    m = np.asarray(m) > 0
    sub = road[max(0, y0):y1, max(0, x0):min(3840, x1)]
    mm = m[max(0, y0) - y0:max(0, y0) - y0 + sub.shape[0], max(0, x0) - x0:max(0, x0) - x0 + sub.shape[1]]
    return float(sub[mm].mean()) if mm.any() else None


res = {"loop": [], "stalls": {}}
loop = lanes["loop"]
for i in range(0, len(loop), 4):
    f = on_road(footprint(*loop[i], heading(loop, i)))
    if f is not None:
        res["loop"].append((i, loop[i], round(f, 3)))
for st in lanes["stalls"]:
    pts = st["path"]
    res["stalls"][st["id"]] = [(i, pts[i], round(on_road(footprint(*pts[i], heading(pts, i))) or 0, 3)) for i in range(0, len(pts), 4)]
fr = np.array([f for _, _, f in res["loop"]])
print(f"loop: footprint on road median {np.median(fr):.3f}, p5 {np.percentile(fr, 5):.3f}, min {fr.min():.3f}")
worst = sorted(res["loop"], key=lambda t: t[2])[:8]
for i, p, f in worst:
    print(f"  s {i} at ({p[0]:.0f}, {p[1]:.0f}): {f:.2f}")
for k, v in res["stalls"].items():
    print(f"  {k}: min {min(f for _, _, f in v):.2f}")
# Offset from the eastbound carriageway centre.
yel = lanes["lines"]["yellow"]; kerb = lanes["lines"]["kerb"]
half = int(np.argmax([p[0] for p in loop]))
eb = np.array(loop[:half])
xs = np.arange(40, 2440, 10)
ey = np.interp(xs, eb[:, 0], eb[:, 1])
cy = (np.interp(xs, *zip(*yel)) + np.interp(xs, *zip(*kerb))) / 2
off = ey - cy
print(f"eastbound offset from the carriageway centre: median {np.median(off):+.1f}, worst {off[np.argmax(np.abs(off))]:+.1f} px at x {xs[np.argmax(np.abs(off))]}")
res["eb_offset"] = {"median": float(np.median(off)), "worst": float(off[np.argmax(np.abs(off))]), "at_x": int(xs[np.argmax(np.abs(off))])}
json.dump(res, open(os.path.join(RIDE, "gen/measure.json"), "w"))
