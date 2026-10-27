"""Beach Street's lanes, stalls and crosswalks, traced on the park painting (park px, 3840 x 2560).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/make_lanes.py

The painted street, south of the town: north sidewalk, a strip of angled parking, the westbound carriageway, a median
with palms (between the dark line and the yellow line), the eastbound carriageway, the south kerb with palms, then the
park. At the east end the street bends north-east towards the river. Its north half ends at a small plaza (a statue, bike racks) where the
median line meets the kerb, so cars turn round in the south half, past the end of the median, and come back west
just south of the median line before joining the westbound lane at x 3290.
Lines below are read off 2x gridded crops (tests/park-crowd/tools/grid_crops.py); the yellow line is refined on its
colour mask. Wheel lines (where a car's ground centre runs):
  eastbound = yellow + 38 (less past the coaster's crest, where the crest stands just in front of the road)
  westbound = median - 0.38 x (median - north kerb): through the painted cars' own wheels
Writes rides/traffic/lanes.json and rides/traffic/gen/lanes_check.png.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))

NORTH = [(0, 545), (600, 620), (1200, 708), (1500, 745), (1840, 784), (2120, 807), (2440, 812), (2800, 792),
         (3040, 755), (3200, 725), (3350, 695), (3470, 690)]
MEDIAN = [(0, 635), (600, 707), (1220, 791), (1840, 874), (2025, 892), (2105, 900), (2440, 916), (2700, 905),
          (2950, 870), (3200, 825), (3300, 805), (3400, 790)]
YELLOW = [(0, 665), (600, 733), (1220, 820), (1500, 860), (1820, 901), (2120, 935), (2420, 942), (2750, 932),
          (2950, 897), (3200, 842), (3400, 785), (3450, 777)]
KERB = [(0, 745), (600, 812), (1240, 890), (1500, 940), (1820, 983), (2120, 1010), (2440, 1035)]

# Crosswalks: x where the stripes cross, which carriageway, and the walk across it (park px, north to south).
CROSSWALKS = [
    {"id": "cw_1460", "lane": "wb", "x": 1462, "walk": [(1500, 748), (1440, 835)]},
    {"id": "cw_2080", "lane": "wb", "x": 2080, "walk": [(2118, 808), (2050, 893)]},
    {"id": "cw_2870", "lane": "wb", "x": 2875, "walk": [(2915, 790), (2845, 885)]},
    {"id": "cw_2910", "lane": "eb", "x": 2912, "walk": [(2945, 905), (2890, 1005)]},
]
# Angled stalls on the north side of the westbound carriageway (nose to the kerb, facing north).
STALLS_X = [140, 300, 470, 1080, 1250, 2950, 3030]


def along(line, x):
    xs, ys = zip(*line)
    return float(np.interp(x, xs, ys))


def refine_yellow():
    m = np.asarray(Image.open(os.path.join(RIDE, "gen/mask_yellow.png"))) > 127
    out = []
    for x in range(0, 3460, 20):
        y0 = along(YELLOW, x)
        band = m[int(y0) - 14:int(y0) + 15, x:x + 20]
        ys = np.where(band.any(1))[0]
        out.append((x + 10, y0 if len(ys) < 3 else int(y0) - 14 + float(np.median(ys))))
    xs = np.array([p[0] for p in out]); ys = np.array([p[1] for p in out])
    # robust smoothing: median of 5, then mean of 5
    ys = np.array([np.median(ys[max(0, i - 2):i + 3]) for i in range(len(ys))])
    ys = np.convolve(np.pad(ys, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    return list(zip(xs.tolist(), ys.tolist()))


def resample(pts, step=1.0):
    pts = np.asarray(pts, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.r_[0, np.cumsum(seg)]
    n = int(s[-1] / step) + 1
    t = np.linspace(0, s[-1], n)
    return np.c_[np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])]


def smooth(pts, k=9):
    pts = np.asarray(pts, float)
    pad = np.pad(pts, ((k, k), (0, 0)), mode="edge")
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    return np.c_[np.convolve(pad[:, 0], ker, "valid"), np.convolve(pad[:, 1], ker, "valid")]


def catmull(ctrl, per=24):
    """Centripetal Catmull-Rom through control points."""
    P = np.asarray(ctrl, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0; t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5; t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5; t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        for t in np.linspace(t1, t2, per, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[-2])
    return np.array(out)


yel = refine_yellow()
# Eastbound wheel line, west (off screen) to the turn-round.
eb_off = lambda x: 38 if x < 2480 else 38 - 16 * min(1, (x - 2480) / 120) if x < 2900 else 22 + 8 * min(1, (x - 2900) / 150)
EB = [(x, along(yel, x) + eb_off(x)) for x in range(-160, 3330, 10)]
WB = []
for x in range(3290, -170, -10):
    m, n = along(MEDIAN, x), along(NORTH, x)
    WB.append((x, m - 0.38 * (m - n)))
EB, WB = smooth(resample(EB, 4), 3), smooth(resample(WB, 4), 3)
# The turn-round at the river end: from the eastbound line, out towards the river and back on the westbound line.
e_end, w_start = EB[-1], WB[0]
turn = catmull([tuple(EB[-8]), tuple(e_end), (3395, 834), (3442, 821), (3461, 801), (3443, 785), (3395, 784), (3340, 778), tuple(w_start), tuple(WB[8])], 30)
turn = turn[1:-1]
loop = np.vstack([EB[:-1], turn, WB[1:]])
loop = smooth(resample(loop, 1.0), 6)
loop = resample(loop, 1.0)
L = len(loop)


def s_at(pts, x, prefer_wb=None):
    """Arc position on the loop nearest to x on the given side."""
    idx = np.arange(len(pts))
    half = np.argmax(pts[:, 0])  # the turn's far point splits east- and westbound
    sel = idx[half:] if prefer_wb else idx[:half]
    return int(sel[np.argmin(np.abs(pts[sel, 0] - x))])


# Crosswalk stop positions: a car stops with its front bumper 10 px before the stripes (car half-length ~ 40).
for cw in CROSSWALKS:
    wb = cw["lane"] == "wb"
    s_cw = s_at(loop, cw["x"], wb)
    cw["s"] = s_cw
    cw["stop"] = s_cw - 62  # the car's centre at stop (both directions run with increasing s)

# Stalls: a spur from the westbound line, curving right (north) into a stall, nose to the kerb.
stalls = []
for i, x in enumerate(STALLS_X):
    s_b = s_at(loop, x + 70, True)  # branch point, upstream (east) of the stall
    bx, by = loop[s_b]
    n_y = along(NORTH, x)
    wy = by
    end = (x - 6, n_y + 0.42 * (wy - n_y) + 6)  # the stall's ground centre
    ctrl = [tuple(loop[s_b - 40]), (bx, by), (bx - 34, by - 2), (x + 10, (end[1] + wy) / 2 + 2), end, (end[0] - 4, end[1] - 30)]
    spur = catmull(ctrl, 30)
    # keep from the branch point to the stall centre
    k0 = int(np.argmin(np.hypot(*(spur - [bx, by]).T)))
    k1 = int(np.argmin(np.hypot(*(spur - end).T)))
    spur = resample(spur[k0:k1 + 1], 1.0)
    stalls.append({"id": f"stall_{i}", "x": x, "branch": s_b, "path": np.round(spur, 2).tolist()})

out = {
    "about": "Beach Street, made by rides/traffic/tools/make_lanes.py: park px (3840 x 2560). loop: one car route, eastbound from off screen at the west, round the turn at the river, westbound back off screen; 1 px steps, so an index is an arc length. Stalls branch off the westbound side at loop index 'branch' and end at the stall's centre, nose to the kerb. Crosswalks: 'stop' is where a waiting car's centre stops; 'walk' is the walkers' path across.",
    "lines": {"north": NORTH, "median": MEDIAN, "yellow": [(round(x, 1), round(y, 1)) for x, y in yel], "kerb": KERB},
    "loop": np.round(loop, 2).tolist(),
    "turn": [int(len(EB) * 4 * 0.98), int(len(EB) * 4 + len(turn) * 1.3)],
    "crosswalks": CROSSWALKS,
    "stalls": stalls,
}
json.dump(out, open(os.path.join(RIDE, "lanes.json"), "w"))

# Check image: the street band with lines, the loop, stalls and crosswalks.
park = Image.open(os.path.join(ROOT, "site/park/world_3840.webp")).convert("RGB")
d = ImageDraw.Draw(park, "RGBA")
for line, col in ((NORTH, (0, 120, 255, 200)), (MEDIAN, (0, 0, 0, 200)), (yel, (255, 0, 0, 220)), (KERB, (255, 255, 255, 220))):
    d.line([tuple(p) for p in line], fill=col, width=2)
d.line([tuple(p) for p in loop[::3]], fill=(255, 0, 255, 230), width=3)
for st in stalls:
    d.line([tuple(p) for p in st["path"][::3]], fill=(0, 220, 120, 230), width=3)
for cw in CROSSWALKS:
    d.line(cw["walk"], fill=(255, 200, 0, 255), width=4)
    x, y = loop[cw["stop"]]
    d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 0, 0, 255), width=3)
park.crop((0, 480, 3840, 1120)).save(os.path.join(RIDE, "gen/lanes_check.png"))
print(f"loop {L} px; stalls {len(stalls)}; crosswalk stops {[cw['stop'] for cw in CROSSWALKS]}")
