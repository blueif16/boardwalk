"""Build the light inventory of the prototype slice: lights.json and masks.png (shapes cut from the painting).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I tests/night-lights/tools/build_lights.py

Inputs: gen/park/world_v2_hd.png (2.5 HD px per park px), work/win_town.json + work/win_town_mask_ids.npy
(tools/detect_windows.py on the town band), rides/coaster/track.json, and the hand list below (measured on gridded
crops, tools/crops.py). Everything is in park px (the 3840 x 2560 frame).

Each light has a kind (what it is), a group (what switches it), a slot (under: drawn under the rides and the crowd;
over: above the crowd; or a live layer's name), z (the ground y it stands on, for a future shared depth sort) and its
shape: a mask cut from the painting (globes, panes, signs), a polygon (stall fronts lit through the painting's own
colours), points (bulb strings) and a pool (light on the ground, a ground-plane radius).
"""
import json, os, zlib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
K = 2.5
ROOT = "tests/night-lights"
OUT = "tests/night-lights"  # lights_centre.json + masks_centre.png; tools/merge.py joins the pieces into rides/lights/
SLICE = (1900, 0, 3000, 1700)  # the centre piece: park x 1900-3000, the town above included (the prototype slice was y 650-1650)
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")


def hd(box):
    x0, y0, x1, y1 = box
    return np.asarray(src.crop((round(x0 * K), round(y0 * K), round(x1 * K), round(y1 * K)))).astype(np.float32) / 255


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / np.maximum(mx, 1e-6), mx


def seed(i):
    return (zlib.crc32(i.encode()) % 100000) / 100000


# --- The hand list (park px) -------------------------------------------------------------------------------------
# Globe lamps: found by tools/detect_lamps.py (42 candidates over the strip, 5 in this slice), checked by eye; head box
# round the globes, foot = the bottom of the post's base (the centre of its pool).
LAMPS = [
    ("lamp_1934", (1912, 1268, 1958, 1316), (1935, 1372)),
    ("lamp_2290", (2263, 1336, 2322, 1388), (2288, 1452)),
    ("lamp_2468", (2447, 1397, 2489, 1438), (2467, 1491)),
    ("lamp_2692", (2672, 1452, 2712, 1482), (2692, 1538)),
]
# Rejected on the check: (2729, 1324) is a ride's ornamented pole top, not a lamp (the model lit it anyway).

# Stalls: the open front (counter, goods), lit through the painting's own colours; side windows by seed; the pool
# on the deck in front.
STALLS = [
    {"id": "stall_tent", "front": [], "seeds": [(2306, 1312)], "pool": (2313, 1362, 26)},
    {"id": "stall_green", "front": [[(2348, 1309), (2417, 1320), (2417, 1347), (2348, 1338)]], "seeds": [], "pool": (2383, 1362, 40)},
    {"id": "stall_teal", "front": [[(2322, 1416), (2413, 1430), (2413, 1448), (2322, 1438)]], "seeds": [(2429, 1434)], "pool": (2368, 1462, 44)},
    {"id": "stall_long", "front": [[(2794, 1331), (2828, 1337), (2828, 1361), (2794, 1355)],
                                   [(2834, 1338), (2870, 1344), (2870, 1368), (2834, 1362)],
                                   [(2876, 1345), (2914, 1352), (2914, 1376), (2876, 1369)],
                                   [(2919, 1352), (2944, 1357), (2944, 1380), (2919, 1375)]], "seeds": [], "pool": (2870, 1392, 70)},
    {"id": "stall_teal_e", "front": [[(2872, 1508), (2978, 1521), (2978, 1553), (2872, 1541)]], "seeds": [], "pool": (2925, 1565, 50)},
]
# Town windows: the detector's panes minus the false ones found on the check, plus seeds for panes it missed.
WIN_REJECT = {"w9", "w12", "w18", "w19", "w24", "w25", "w8"}
WIN_SEEDS = [(1957, 688), (1999, 675), (1987, 725), (2232, 680), (2232, 695), (2372, 695), (2384, 695), (2400, 690),
             (2421, 674), (2446, 674), (2283, 757), (2308, 757), (2325, 757), (2378, 757), (2402, 757), (2774, 680),
             (2793, 680), (2904, 656), (2942, 657), (2972, 657), (2723, 730), (2748, 730), (2788, 735), (2840, 725),
             (2896, 725), (2938, 715)]
SHOP_Y = 712  # panes lower than this sit at street level: shop windows (they close in the evening)
# Signs, doors, lanterns, flags.
SIGNS = [("sign_dipper", [(2749, 972), (2778, 968), (2779, 983), (2750, 987)])]
DOORS = [("castle_door", [(1913, 1212), (1916, 1207), (1920, 1209), (1921, 1225), (1913, 1225)])]
LANTERNS = [("castle_lantern", (1943, 1186), 6)]
FLAGS = [("flag_us", (2645, 990), (2683, 905), (44, 34)), ("flag_ca", (2735, 992), (2768, 915), (38, 34))]
# Painted rides that stay painted (not live layers yet): bulbs on the east carousel's valance (to move to the Sea
# Swings when rides/swings replaces it), the kiddie tub ride's rim.
CAROUSEL_E = {"c": (2790, 1430), "a": 76, "b": 23, "rot": -4, "n": 28, "inner": [(2735, 1445), (2850, 1440), (2855, 1490), (2730, 1495)]}
KIDDIE = {"c": (2046, 1338), "a": 50, "b": 18, "rot": 0, "n": 18}


def region_at(x, y, max_area=900, glass=True):
    """The ink-enclosed region round (x, y): a pane, a sign face, a door. The seed may sit a few px off (it moves to the
    nearest open pixel of the right colour); a frame with a gap is closed by thickening the ink step by step. None if
    no closed region of a sensible size is found."""
    R = 34
    box = (x - R, y - R, x + R, y + R)
    a = hd(box)
    h, s, v = hsv(a)
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ink0 = (v < 0.62) | (lum < ndi.uniform_filter(lum, 9) - 0.12)
    cool = (h > 180) & (h < 270) & (s > 0.05) if glass else np.ones_like(ink0)
    c = int(R * K)
    yy, xx = np.mgrid[-10:11, -10:11]
    order = np.argsort((yy ** 2 + xx ** 2).ravel())
    for dil in (1, 2, 3):
        ink = ndi.binary_dilation(ink0, iterations=dil)
        lab, _ = ndi.label(~ink)
        k = 0
        for o in order:
            py, px = c + yy.ravel()[o], c + xx.ravel()[o]
            if lab[py, px] and cool[py, px]:
                k = lab[py, px]; break
        if not k:
            continue
        m = lab == k
        ar = m.sum() / K / K
        if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any() or ar > max_area:
            continue
        if ar < 3:
            return None
        m = ndi.binary_dilation(m, iterations=dil - 1) & ~ink0 if dil > 1 else m
        return box, m
    return None


masks, lights = [], []


def add_mask(box, m):
    """Store an HD mask (a park-px box) for the atlas; returns its index."""
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = m[y0:y1, x0:x1]
    rect = [round(box[0] + x0 / K, 2), round(box[1] + y0 / K, 2), round((x1 - x0) / K, 2), round((y1 - y0) / K, 2)]
    masks.append(sub)
    return {"rect": rect, "i": len(masks) - 1}


# Lamps: globe masks = globe yellow plus the highlights inside the globes' outlines.
for lid, box, foot in LAMPS:
    a = hd(box)
    h, s, v = hsv(a)
    yel = (h > 40) & (h < 64) & (s > 0.36) & (v > 0.8)
    strong = (h > 42) & (h < 60) & (s > 0.5) & (v > 0.85)
    lab0, n0 = ndi.label(yel)
    keep0 = np.unique(lab0[strong]); keep0 = keep0[keep0 > 0]
    yel = np.isin(lab0, keep0)  # only the patches with real globe yellow in them (the planks are paler)
    m = ndi.binary_closing(yel, np.ones((3, 3)))
    m = ndi.binary_fill_holes(m)  # the white highlights inside the globes are holes in the yellow
    m = ndi.binary_opening(m, np.ones((2, 2)))
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    globes = []
    for j, sz in enumerate(sizes, 1):
        if sz < 20:
            m[lab == j] = False
            continue
        cy, cx = ndi.center_of_mass(lab == j)
        globes.append([round(box[0] + cx / K, 1), round(box[1] + cy / K, 1), round(float(np.sqrt(sz / np.pi) / K), 1)])
    # The post: blue under the head down to the foot, so the pool's warm filter can leave the painted post alone.
    pb = (foot[0] - 14, box[3] - 6, foot[0] + 14, foot[1] + 4)
    pa = hd(pb)
    ph, ps, pv = hsv(pa)
    post = (ph > 160) & (ph < 225) & (ps > 0.25) & (pv > 0.25)
    post = ndi.binary_closing(post, np.ones((3, 3)))
    plab, pn = ndi.label(post)
    if pn:
        big = np.argmax(ndi.sum(post, plab, range(1, pn + 1))) + 1
        post = ndi.binary_dilation(plab == big, iterations=2)
    hx = sum(g[0] * g[2] ** 2 for g in globes) / sum(g[2] ** 2 for g in globes)
    hy = sum(g[1] * g[2] ** 2 for g in globes) / sum(g[2] ** 2 for g in globes)
    lights.append({"id": lid, "kind": "lamp", "group": "promenade", "slot": "over", "z": foot[1], "src": [round(hx, 1), round(hy, 1)],
                   "ground": list(foot), "colour": "#ffd9a0", "globes": globes, "mask": add_mask(box, m),
                   "post": add_mask(pb, post) if post.any() else None, "halo": round(max(box[2] - box[0], box[3] - box[1]) * 0.75, 1), "pool": {"c": [foot[0], foot[1] - 4], "r": 64, "colour": "#ffa82e"}})

# Stalls.
for st in STALLS:
    for k, poly in enumerate(st["front"]):
        lights.append({"id": f"{st['id']}_front{k}", "kind": "stall", "group": "stall", "slot": "under", "z": max(p[1] for p in poly),
                       "poly": [list(p) for p in poly], "colour": "#ffb850", "stall": st["id"]})
    for k, (x, y) in enumerate(st["seeds"]):
        r = region_at(x, y)
        if r is None:
            print("no pane at", st["id"], (x, y)); continue
        lights.append({"id": f"{st['id']}_win{k}", "kind": "window", "group": "stall", "slot": "under", "z": y, "src": [x, y],
                       "colour": "#ffd590", "mask": add_mask(*r), "stall": st["id"]})
    x, y, r = st["pool"]
    lights.append({"id": f"{st['id']}_pool", "kind": "spill", "group": "stall", "slot": "under", "z": y, "ground": [x, y],
                   "pool": {"c": [x, y], "r": r, "colour": "#ffb446"}, "stall": st["id"]})

# Town windows.
town = []
for run in ("win_town", "win_hills"):  # tools/detect_windows.py on y 650-830 and on y 0-650
    wins = json.load(open(f"{ROOT}/work/{run}.json"))
    ids = np.load(f"{ROOT}/work/{run}_mask_ids.npy")
    bx0, by0 = wins["box"][:2]
    for k, w in enumerate(wins["windows"]):
        if run == "win_town" and w["id"] in WIN_REJECT:
            continue
        m = ids == k + 1
        town.append(((bx0, by0, bx0 + ids.shape[1] / K, by0 + ids.shape[0] / K), m, w["c"], "detector"))
for (x, y) in WIN_SEEDS:
    r = region_at(x, y)
    if r is None:
        print("no pane at seed", (x, y)); continue
    box, m = r
    a = hd(box)
    h, s, v = hsv(a)
    cool = ((h > 180) & (h < 270) & (s > 0.05))[m].mean()
    if cool < 0.3:
        print("seed not glass", (x, y), round(float(cool), 2)); continue
    # skip seeds that land in a pane the detector already has
    if any(abs(c[0] - x) < 4 and abs(c[1] - y) < 4 for _, _, c, _ in town):
        continue
    town.append((box, m, [x, y], "seed"))
for k, (box, m, c, how) in enumerate(town):
    shop = SHOP_Y < c[1] < 830
    lights.append({"id": f"town_{round(c[0])}_{round(c[1])}", "kind": "window", "group": "shop" if shop else "home", "slot": "under",
                   "z": round(c[1] + (20 if shop else 60)), "src": [round(c[0], 1), round(c[1], 1)], "found": how,
                   "colour": "#ffd27e", "mask": add_mask(box, m)})

# Street lamps painted in the town (a pink globe on a post on the hill street).
for sid, (x, y), foot, r in [("street_2662_486", (2662, 486), (2666, 548), 4.2)]:
    lights.append({"id": sid, "kind": "lantern", "group": "photocell", "slot": "over", "z": foot[1], "src": [x, y], "ground": list(foot),
                   "colour": "#ffd9a0", "halo": r * 3.2, "core": r, "pool": {"c": list(foot), "r": 30, "colour": "#ffb867"}})
# Signs, doors, lanterns, flags.
for sid, poly in SIGNS:
    y = max(p[1] for p in poly)
    lights.append({"id": sid, "kind": "sign", "group": "ride", "slot": "under", "z": y + 10, "poly": [list(p) for p in poly], "colour": "#fff2d8"})
for did, poly in DOORS:
    x, y = poly[0][0] + 3, max(p[1] for p in poly)
    lights.append({"id": did, "kind": "door", "group": "ride", "slot": "under", "z": y, "poly": [list(p) for p in poly], "colour": "#ffb86a",
                   "pool": {"c": [x, y + 3], "r": 12, "colour": "#ffb86a"}})
for lid, (x, y), r in LANTERNS:
    lights.append({"id": lid, "kind": "lantern", "group": "ride", "slot": "under", "z": y + 30, "src": [x, y], "colour": "#ffbe6e", "halo": r * 2.5, "core": r * 0.6})
for fid, base, centre, (w, hh) in FLAGS:
    lights.append({"id": fid, "kind": "flood", "group": "photocell", "slot": "under", "z": base[1], "src": list(base), "colour": "#fff0d8",
                   "flood": {"c": list(centre), "rx": w / 2 + 6, "ry": hh / 2 + 8}})


def ring(c, a, b, rot, n, phase=0.0):
    t = np.radians(rot)
    out = []
    for k in range(n):
        p = 2 * np.pi * (k + phase) / n
        u, v = a * np.cos(p), b * np.sin(p)
        out.append([round(c[0] + u * np.cos(t) - v * np.sin(t), 1), round(c[1] + u * np.sin(t) + v * np.cos(t), 1)])
    return out


# The east carousel is gone: the Sea Swings (rides/swings) replaced it, and its lights come from that layer
# (rides/lights/adapters.js swingsLights: canopy bulbs and a pool on its deck).
pts = [p for p in ring(KIDDIE["c"], KIDDIE["a"], KIDDIE["b"], KIDDIE["rot"], KIDDIE["n"], 0.5)]
lights.append({"id": "kiddie_rim", "kind": "bulbs", "group": "ride", "slot": "under", "z": 1360, "pts": pts, "colour": "#fff3cf", "pattern": "alternate"})

# The Giant Dipper: bulbs along the outer edge of the painted track where it is in front (mode 0) and behind the
# lattice (mode 1, where the lattice cut-out covers them), every 7 px; none on the hidden run.
track = json.load(open("rides/coaster/track.json"))
P = np.array(track["points"]); mode = np.array(track["mode"])
L = len(P)
EDGE = 4.0
for name, sel, slot in [("front", 0, "under"), ("back", 1, "under")]:
    pts = []
    for i in range(0, L, 7):
        if mode[i] != sel:
            continue
        a, b = P[(i - 3) % L], P[(i + 3) % L]
        dx, dy = b - a
        n = np.hypot(dx, dy) or 1
        nx, ny = -dy / n, dx / n
        if ny > 0:
            nx, ny = -nx, -ny  # the normal pointing up the screen: the top edge of the band
        pts.append([round(P[i][0] + nx * EDGE, 1), round(P[i][1] + ny * EDGE, 1)])
    lights.append({"id": f"dipper_track_{name}", "kind": "bulbs", "group": "ride", "slot": slot, "z": 1150 if sel else 1250, "pts": pts,
                   "colour": "#fff4dc", "pattern": "twinkle", "ride": "coaster", "layer": "coaster", "dim": 0.55 if sel else 1})

# Keep what lies in the slice.
x0, y0, x1, y1 = SLICE
def inside(L):
    p = L.get("src") or L.get("ground") or (L["poly"][0] if "poly" in L else None) or (L["pts"][0] if "pts" in L else None)
    return p is None or (x0 <= p[0] <= x1 and y0 <= p[1] <= y1)
lights = [L for L in lights if inside(L) or L["kind"] == "bulbs"]
for L in lights:
    if "pts" in L and L.get("layer") != "coaster":  # the Dipper's bulbs belong to its layer, the whole track
        L["pts"] = [p for p in L["pts"] if x0 - 40 <= p[0] <= x1 + 40 and y0 <= p[1] <= y1]
lights = [L for L in lights if "pts" not in L or L["pts"]]
for L in lights:
    L["seed"] = round(seed(L["id"]), 5)

# The atlas: masks packed in rows at HD resolution (2.5 px per park px), one channel.
W = 1024
x = y = rowh = 0
place = []
for m in masks:
    hh, ww = m.shape
    if x + ww + 2 > W:
        x, y, rowh = 0, y + rowh + 2, 0
    place.append((x, y)); x += ww + 2; rowh = max(rowh, hh)
H = y + rowh + 2
atlas = np.zeros((H, W), np.uint8)
for (ax, ay), m in zip(place, masks):
    atlas[ay:ay + m.shape[0], ax:ax + m.shape[1]] = np.where(m, 255, 0)
# Soften the cut edge by half a pixel so lit shapes sit inside their painted outline.
atlas = ndi.gaussian_filter(atlas.astype(np.float32), 0.6).clip(0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(atlas).save(f"{OUT}/masks_centre.png", optimize=True)
for L in lights:
    for key in ("mask", "post"):
        if L.get(key):
            i = L[key].pop("i"); m = masks[i]
            L[key]["atlas"] = [place[i][0], place[i][1], m.shape[1], m.shape[0]]

kinds = {}
for L in lights:
    kinds[L["kind"]] = kinds.get(L["kind"], 0) + (len(L["pts"]) if "pts" in L else 1)
out = {"about": "Light inventory of the prototype slice (tests/night-lights/tools/build_lights.py). Park px. slot: under = under the rides "
                "and the crowd, over = above the crowd. mask.rect is where the atlas cut (masks.png, 2.5 px per park px) sits on the park.",
       "slice": SLICE, "piece": "centre", "atlas": {"file": "masks_centre.png", "density": K, "size": [W, H]}, "counts": kinds, "lights": lights}
json.dump(out, open(f"{OUT}/lights_centre.json", "w"), separators=(",", ":"))
print(json.dumps(kinds), len(lights), "lights,", len(masks), "masks", (W, H))
