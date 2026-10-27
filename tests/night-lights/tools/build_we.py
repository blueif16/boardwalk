"""West and east light inventories, in the format of rides/lights/lights.json (tests/night-lights/tools/build_lights.py).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I build_we.py west|east SCRATCH_DIR

Lamps: tests/night-lights/work/lamps_park.json (detect_lamps.py over the strip) checked by eye, plus hand-added misses.
Windows: detect_windows.py (ink-enclosed glass) and a blue-pane blob finder (blobwin.py) over the town and the park
buildings, minus a reject list from the eye check. Stalls, arcade arches, doors, signs: hand-traced on gridded crops.
"""
import json, sys, zlib
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
K = 2.5
PIECE, SCR = sys.argv[1], sys.argv[2]
ROOT = "tests/night-lights"
SLICE = {"west": (0, 0, 1900, 2560), "east": (3000, 0, 3840, 2560)}[PIECE]
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


# --- Hand list (park px), measured on gridded crops ---------------------------------------------------------------
# Lamps: (id, head box round the globes, foot = bottom of the post's base). "how": detector (lamps_park.json id) or hand.
LAMPS = {
    "west": [
        ("lamp_425", (404, 1082, 449, 1122), (424, 1181), "hand"),       # orange-tinted globes: the detector's yellow misses them
        ("lamp_617", (604, 1166, 636, 1200), (618, 1228), "lamp1"),
        ("lamp_810", (796, 1186, 834, 1224), (811, 1268), "lamp2"),      # detector box also took the yellow sculpture behind
        ("lamp_1050", (1028, 1230, 1070, 1258), (1051, 1318), "lamp4"),
        ("lamp_1095", (1074, 1230, 1134, 1258), (1088, 1307), "hand"),   # pink-and-yellow globes
        ("lamp_1287", (1264, 1196, 1308, 1228), (1286, 1269), "hand"),   # pale globes
        ("lamp_1418", (1404, 1158, 1432, 1198), (1418, 1250), "lamp9"),  # pale globes; detector foot was on the stall
        ("lamp_1544", (1528, 1204, 1560, 1238), (1542, 1285), "lamp11"),
        ("lamp_1774", (1752, 1184, 1800, 1280), (1772, 1340), "lamp16+17"),  # two tiers of globes on one post
    ],
    "east": [
        ("lamp_3027", (3004, 1520, 3050, 1552), (3026, 1607), "hand"),
        ("lamp_3066", (3042, 1430, 3092, 1552), (3067, 1615), "lamp35"),  # two tiers
        ("lamp_3344", (3331, 1601, 3357, 1627), (3346, 1667), "hand"),
        ("lamp_3375", (3363, 1601, 3389, 1641), (3375, 1686), "hand"),
    ],
}[PIECE]
# Stalls: open fronts lit through their own colours, a pool on the deck in front.
STALLS = {
    "west": [
        {"id": "stall_w452", "front": [[(458, 1150), (530, 1156), (530, 1200), (458, 1194)], [(532, 1154), (555, 1149), (555, 1196), (532, 1200)]], "pool": (505, 1218, 42)},
        {"id": "stall_w687", "front": [[(690, 1203), (782, 1212), (784, 1252), (692, 1234)]], "pool": (740, 1272, 44)},
        {"id": "stall_w1153", "front": [[(1156, 1243), (1242, 1238), (1242, 1277), (1157, 1273)]], "pool": (1200, 1296, 44)},
        {"id": "stall_w1320", "front": [[(1322, 1207), (1400, 1210), (1400, 1247), (1322, 1245)]], "pool": (1362, 1266, 40)},
        {"id": "stall_w1432", "front": [[(1437, 1225), (1527, 1231), (1525, 1272), (1440, 1258)]], "pool": (1482, 1291, 44)},
        {"id": "stall_w1795", "front": [[(1800, 1295), (1905, 1300), (1905, 1336), (1802, 1328)]], "pool": (1855, 1356, 48)},  # the pink stall cut by the centre's edge
        # The Casino arcade (Cocoanut Grove's ground floor): the arches' dark interiors, goods and games lit through their colours.
        {"id": "casino_arcade", "front": [[(x0, y1), (x0, y0 + 6), ((x0 + x1) / 2, y0), (x1, y0 + 6), (x1, y1)] for x0, y0, x1, y1 in
                                          [(482, 1080, 502, 1110), (530, 1080, 552, 1108), (585, 1095, 605, 1140), (617, 1102, 635, 1142), (647, 1105, 667, 1145),
                                           (680, 1115, 697, 1150), (710, 1120, 727, 1152), (745, 1125, 765, 1155), (775, 1130, 795, 1160), (807, 1137, 825, 1162)]],
         "pool": (660, 1185, 120)},
        {"id": "bandstand", "front": [[(310, 1080), (400, 1080), (402, 1135), (308, 1135)]], "pool": (355, 1150, 50)},
    ],
    "east": [
        {"id": "stall_e_tent", "front": [[(3412, 1625), (3478, 1640), (3545, 1625), (3545, 1680), (3478, 1697), (3412, 1680)]], "pool": (3478, 1714, 56)},
        {"id": "stall_e_yellow", "front": [[(3552, 1560), (3590, 1556), (3590, 1612), (3552, 1615)]], "pool": (3572, 1628, 30)},
    ],
}[PIECE]
SIGNS = {"west": [("sign_booth_1367", [(1357, 1142), (1377, 1142), (1377, 1156), (1357, 1156)])], "east": []}[PIECE]
DOORS = {
    "west": [("castle_arch", [(1856, 1222), (1856, 1195), (1862, 1186), (1873, 1182), (1884, 1186), (1890, 1195), (1890, 1222)], "ride"),
             ("door_shop_1517", [(1506, 1143), (1530, 1143), (1530, 1175), (1506, 1175)], "stall"),
             ("door_shop_1579", [(1571, 1148), (1587, 1148), (1587, 1180), (1571, 1180)], "stall")],
    "east": [],
}[PIECE]
# Windows: finder outputs (scratch), the eye-check reject lists, the road bands where only car windows are found.
FINDS = {"west": [("win_w", "ink"), ("blob_w", "blob"), ("win_wp", "ink"), ("blob_wp", "blob")],
         "east": [("win_e", "ink"), ("blob_e", "blob"), ("win_ep", "ink"), ("blob_ep", "blob")]}[PIECE]
REJECT = json.load(open(f"{SCR}/reject_{PIECE}.json"))  # {"win_w": ["w5", ...], ...}; "accept" lists for the park boxes
PARK_Y = {"west": 740, "east": 760}[PIECE]  # below this: park buildings (only accepted ids kept); above: the town


def road(x, y):
    if PIECE == "west":
        return (x < 450 and y > 545) or (450 <= x < 640 and y > 612) or (640 <= x < 1280 and y > 650) or (x >= 1280 and y > 745)
    return (x < 3340 and y > 700) or (3340 <= x < 3760 and y > 380)  # the river and its bridges east of 3340


SHOP = {"west": [(0, 485, 450, 545), (450, 525, 650, 615), (640, 585, 925, 652), (925, 612, 1280, 652), (1280, 488, 1600, 535),
                 (1600, 478, 1900, 535), (1280, 680, 1900, 748)],
        "east": [(3000, 490, 3220, 565), (3080, 630, 3340, 702), (3250, 485, 3370, 565), (3760, 490, 3840, 600)]}[PIECE]
BLDG = {"west": [("bowling", (150, 740, 380, 880)), ("casino", (230, 860, 620, 1070)), ("bandstand", (290, 1010, 410, 1140)),
                 ("cocoanut_grove", (450, 860, 960, 1170))], "east": []}[PIECE]

masks, lights = [], []


def add_mask(box, m):
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    masks.append(m[y0:y1, x0:x1])
    return {"rect": [round(box[0] + x0 / K, 2), round(box[1] + y0 / K, 2), round((x1 - x0) / K, 2), round((y1 - y0) / K, 2)], "i": len(masks) - 1}


# Lamps (the lights agent's cut: globe yellow plus the highlights inside; the blue post under the head).
for lid, box, foot, how in LAMPS:
    a = hd(box)
    h, s, v = hsv(a)
    for lo, slo in ((40, 0.36), (28, 0.30), (20, 0.22)):  # widen to orange / pale globes when the strict yellow finds nothing
        yel = (h > lo) & (h < 64) & (s > slo) & (v > 0.78)
        strong = (h > lo + 2) & (h < 60) & (s > slo + 0.12) & (v > 0.83)
        lab0, _ = ndi.label(yel)
        keep0 = np.unique(lab0[strong]); keep0 = keep0[keep0 > 0]
        yel = np.isin(lab0, keep0)
        m = ndi.binary_opening(ndi.binary_fill_holes(ndi.binary_closing(yel, np.ones((3, 3)))), np.ones((2, 2)))
        lab, n = ndi.label(m)
        sizes = ndi.sum(m, lab, range(1, n + 1))
        globes = []
        for j, sz in enumerate(sizes, 1):
            if sz < 20:
                m[lab == j] = False; continue
            cy, cx = ndi.center_of_mass(lab == j)
            globes.append([round(box[0] + cx / K, 1), round(box[1] + cy / K, 1), round(float(np.sqrt(sz / np.pi) / K), 1)])
        if globes:
            break
    if not globes:
        print("no globes", lid); continue
    pb = (foot[0] - 14, box[3] - 6, foot[0] + 14, foot[1] + 4)
    ph, ps, pv = hsv(hd(pb))
    post = ndi.binary_closing((ph > 160) & (ph < 225) & (ps > 0.25) & (pv > 0.25), np.ones((3, 3)))
    plab, pn = ndi.label(post)
    if pn:
        post = ndi.binary_dilation(plab == np.argmax(ndi.sum(post, plab, range(1, pn + 1))) + 1, iterations=2)
    w2 = sum(g[2] ** 2 for g in globes)
    hx, hy = sum(g[0] * g[2] ** 2 for g in globes) / w2, sum(g[1] * g[2] ** 2 for g in globes) / w2
    lights.append({"id": lid, "kind": "lamp", "group": "promenade", "slot": "over", "z": foot[1], "src": [round(hx, 1), round(hy, 1)],
                   "ground": list(foot), "colour": "#ffd9a0", "globes": globes, "mask": add_mask(box, m),
                   "post": add_mask(pb, post) if post.any() else None, "halo": round(min(48, max(box[2] - box[0], box[3] - box[1]) * 0.75), 1),
                   "pool": {"c": [foot[0], foot[1] - 4], "r": 64, "colour": "#ffa82e"}, "found": how})

for st in STALLS:
    for k, poly in enumerate(st["front"]):
        lights.append({"id": f"{st['id']}_front{k}", "kind": "stall", "group": "stall", "slot": "under", "z": round(max(p[1] for p in poly)),
                       "poly": [[round(p[0], 1), round(p[1], 1)] for p in poly], "colour": "#ffb850", "stall": st["id"]})
    x, y, r = st["pool"]
    lights.append({"id": f"{st['id']}_pool", "kind": "spill", "group": "stall", "slot": "under", "z": y, "ground": [x, y],
                   "pool": {"c": [x, y], "r": r, "colour": "#ffb446"}, "stall": st["id"]})

# Windows from both finders.
stats = {}
kept = []  # (box, mask, centre, how, bldg)
for name, how in FINDS:
    d = json.load(open(f"{SCR}/{name}.json"))
    ids = np.load(f"{SCR}/{name}_mask_ids.npy" if how == "blob" else f"{SCR}/{name}_mask_ids.npy")
    bx0, by0 = d["box"][:2]
    fullbox = (bx0, by0, bx0 + ids.shape[1] / K, by0 + ids.shape[0] / K)
    rej, acc = set(REJECT.get(name, [])), REJECT.get(name + "_accept")
    st = stats.setdefault(name, {"found": len(d["windows"]), "road": 0, "rejected": 0, "dup": 0, "kept": 0})
    for k, w in enumerate(d["windows"]):
        cx, cy = w["c"]
        if cy < PARK_Y and road(cx, cy):
            st["road"] += 1; continue
        if (acc is not None and w["id"] not in acc) or w["id"] in rej or any(abs(cx - a) < 3 and abs(cy - b) < 3 for a, b in REJECT.get("xy", [])):
            st["rejected"] += 1; continue
        m = ids == k + 1
        ys, xs = np.nonzero(m)
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        sub = m[sl]
        box = (bx0 + xs.min() / K, by0 + ys.min() / K, bx0 + (xs.max() + 1) / K, by0 + (ys.max() + 1) / K)
        if any(abs(c[0] - cx) < 5 and abs(c[1] - cy) < 5 for _, _, c, _, _ in kept) or \
           any(b[0] < cx < b[2] and b[1] < cy < b[3] for b, _, _, _, _ in kept):
            st["dup"] += 1; continue
        bl = next((n for n, (a0, a1, a2, a3) in BLDG if a0 <= cx < a2 and a1 <= cy < a3), None)
        kept.append((box, sub, [cx, cy], how, bl)); st["kept"] += 1
for box, m, c, how, bl in kept:
    x, y = c
    if y >= PARK_Y:
        grp, z = "stall", round(y + 10)
    else:
        grp = "shop" if any(a0 <= x < a2 and a1 <= y < a3 for a0, a1, a2, a3 in SHOP) else "home"
        z = round(y + (20 if grp == "shop" else 60))
    L = {"id": f"{'bldg' if bl else 'town'}_{round(x)}_{round(y)}", "kind": "window", "group": grp, "slot": "under", "z": z,
         "src": [round(x, 1), round(y, 1)], "found": how, "colour": "#ffd27e" if grp != "stall" else "#ffd590", "mask": add_mask(box, m)}
    if bl:
        L["bldg"] = bl
    lights.append(L)

for sid, poly in SIGNS:
    lights.append({"id": sid, "kind": "sign", "group": "stall", "slot": "under", "z": max(p[1] for p in poly) + 10, "poly": [list(p) for p in poly], "colour": "#fff2d8"})
for did, poly, grp in DOORS:
    x, y = sum(p[0] for p in poly) / len(poly), max(p[1] for p in poly)
    lights.append({"id": did, "kind": "door", "group": grp, "slot": "under", "z": y, "poly": [list(p) for p in poly], "colour": "#ffb86a",
                   "pool": {"c": [round(x), y + 3], "r": 14, "colour": "#ffb86a"}})

for L in lights:
    L["seed"] = round(seed(L["id"]), 5)

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
atlas = ndi.gaussian_filter(atlas.astype(np.float32), 0.6).clip(0, 255).astype(np.uint8)
Image.fromarray(atlas).save(f"{ROOT}/masks_{PIECE}.png", optimize=True)
for L in lights:
    for key in ("mask", "post"):
        if L.get(key):
            i = L[key].pop("i"); m = masks[i]
            L[key]["atlas"] = [place[i][0], place[i][1], m.shape[1], m.shape[0]]
kinds = {}
for L in lights:
    kinds[L["kind"]] = kinds.get(L["kind"], 0) + (len(L["pts"]) if "pts" in L else 1)
out = {"about": f"Light inventory of the {PIECE} piece (West and east inventory, tests/night-lights/INVENTORY_WE.md). Park px. slot: under = under the rides "
                "and the crowd, over = above the crowd. mask.rect is where the atlas cut (masks_%s.png, 2.5 px per park px) sits on the park." % PIECE,
       "slice": list(SLICE), "piece": PIECE, "atlas": {"file": f"masks_{PIECE}.png", "density": K, "size": [W, H]}, "counts": kinds, "lights": lights}
json.dump(out, open(f"{ROOT}/lights_{PIECE}.json", "w"), separators=(",", ":"))
json.dump(stats, open(f"{SCR}/stats_{PIECE}.json", "w"), indent=1)
print(json.dumps(kinds), len(lights), "lights,", len(masks), "masks", (W, H))
print(json.dumps(stats))
