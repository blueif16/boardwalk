"""Build the Pirate Ship's art from the generated sprite and the plate.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/pirate/tools/build_ship.py   (repo root)

1. The ship (gen/ship_v2_0.png, on flat magenta): keyed; the hub and the two arm pins found by their yellow dots; the
   arms above the hull's far gunwale replaced by the same arms stretched to a higher hub, so that the ship hangs from
   the painted A-frame's hub with its keel just over the platform (the sprite's own arms are a third too short for
   it). The arm stubs inside the hull stay as drawn: the kink where they meet is about 6 degrees on a 4 px bar.
   Split along the near gunwale (traced by eye on gen/ship_grid_hull.png) into ship_back.webp (the whole ship) and
   ship_front.webp (the near hull side), so riders sit between them. Written at 2.5 px per park px, the painting's
   HD density, with the pivot and the seats in ship.json.
2. The front: front.webp, the parts of the scene that stand in front of the swinging ship (the front A-frame legs and
   the hub from the plate, three lamps from the painting), keyed against the deck's colours so only the objects
   themselves are kept. Over the ship in the layer.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
sys.path.insert(0, HERE)
from key_view import key  # noqa: E402

F = 2.5                 # output px per park px (the painting's HD density)
PIVOT = (933.0, 1110.0) # park px: the centre of the painted hub's lower ball, where the arms hang from
KEEL = 1290.0           # park px: the keel's lowest point at rest, just over the platform
LENGTH = 200.0          # park px: bow tip to stern scroll at rest (the painted ship was 184)
# Measured on the keyed sprite's grid (input px of gen/ship_v2_0.png, 3840 x 2560): the crop origin of
# gen/ship_keyed.png is (597, 177).
O = np.array([597, 177])
GUESS = {"hub": (1325, 94), "pin_l": (579, 1440), "pin_r": (2084, 1494)}
CUT = {"l": (659, 1290), "r": (1968, 1320)}     # where each arm crosses the far gunwale (top of the hull)
# The near gunwale's top edge (cropped px): riders are hidden below it.
GUNWALE = [(200, 1300), (400, 1450), (599, 1530), (799, 1580), (999, 1615), (1199, 1635), (1399, 1643), (1598, 1640),
           (1798, 1623), (1998, 1590), (2198, 1530), (2398, 1440), (2498, 1340), (2577, 1260)]
SEATS_X = [699, 933, 1199, 1518, 1812, 2198]    # cropped px: between the benches, clear of the arm pins
HULL_SPAN = (0, 2600)                            # cropped px: figurehead tip to stern scroll (the flag goes past it)


def yellow_centroid(rgba, guess, r=70):
    x0, y0 = guess
    sub = rgba[y0 - r:y0 + r, x0 - r:x0 + r].astype(np.float32)
    R, G, B, A = sub[..., 0], sub[..., 1], sub[..., 2], sub[..., 3]
    m = (R > 200) & (G > 160) & (B < 120) & (A > 200)
    lab, n = ndimage.label(m)
    if not n:
        raise SystemExit(f"no yellow dot near {guess}")
    # The blob nearest the guess.
    cs = ndimage.center_of_mass(m, lab, range(1, n + 1))
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    best = min(range(n), key=lambda i: (cs[i][0] - r) ** 2 + (cs[i][1] - r) ** 2 - sizes[i])
    cy, cx = cs[best]
    return np.array([x0 - r + cx, y0 - r + cy])


def seg_dist(px, py, a, b):
    ab = b - a
    t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / (ab @ ab), 0, 1)
    return np.hypot(px - (a[0] + t * ab[0]), py - (a[1] + t * ab[1])), t


def sample(img, xs, ys):
    """Bilinear sample of an H x W x C float image at float coords (outside -> 0)."""
    out = np.stack([ndimage.map_coordinates(img[..., c], [ys, xs], order=1, mode="constant", cval=0) for c in range(img.shape[2])], -1)
    return out


def build_ship():
    src = np.asarray(Image.open(os.path.join(RIDE, "gen/ship_v2_0.png")).convert("RGB"))
    rgba = key(src)[0].astype(np.float32)
    H, W = rgba.shape[:2]
    g = {k: v + O for k, v in ((k, np.array(v)) for k, v in GUESS.items())}
    hub = yellow_centroid(rgba.astype(np.uint8), tuple(int(v) for v in g["hub"]))
    pins = {s: yellow_centroid(rgba.astype(np.uint8), tuple(int(v) for v in g["pin_" + s])) for s in ("l", "r")}
    cuts = {s: np.array(CUT[s]) + O for s in ("l", "r")}
    ys, xs = np.nonzero(rgba[..., 3] > 128)
    keel = ys.max()
    s = LENGTH / (HULL_SPAN[1] - HULL_SPAN[0])          # park px per sprite px
    hub2 = np.array([hub[0], keel - (KEEL - PIVOT[1]) / s])  # the new, higher hub (sprite px; may be above the image)
    print(f"hub {hub.round(1)}, pins {pins['l'].round(1)} {pins['r'].round(1)}, keel y {keel}, scale {s:.4f} park px per px, new hub y {hub2[1]:.0f}")

    # Remove the arms above the far gunwale (and the hub dot) from the hull.
    yy, xx = np.mgrid[0:H, 0:W]
    hull = rgba.copy()
    strips = {}
    HW = 30  # px, half the arm's width with its outline
    for sd in ("l", "r"):
        c = cuts[sd]
        d, t = seg_dist(xx, yy, hub, pins[sd])
        band = (d <= HW + 22) & (yy < c[1])
        hull[band] = 0
        # The arm as a straight strip from the hub to the cut: rows along the arm, columns across it.
        L = np.hypot(*(c - hub))
        u = (c - hub) / L
        n = np.array([-u[1], u[0]])
        rows = np.arange(int(L))
        cols = np.arange(-HW, HW + 1)
        sx = hub[0] + rows[:, None] * u[0] + cols[None, :] * n[0]
        sy = hub[1] + rows[:, None] * u[1] + cols[None, :] * n[1]
        strips[sd] = (sample(rgba, sx, sy), L)
    hull[(np.hypot(xx - hub[0], yy - hub[1]) < 95)] = 0
    # Between the arms and above the hull there is nothing but the old arms: clear it (keyed fringes of their outlines).
    hull[(yy < min(cuts['l'][1], cuts['r'][1]) - 25) & (xx > pins['l'][0] - 40) & (xx < pins['r'][0] + 40)] = 0

    # Canvas tall enough for the new hub.
    top = int(np.floor(hub2[1])) - 80
    pad_top = max(0, -top)
    comp = np.zeros((H + pad_top, W, 4), np.float32)
    off = np.array([0, pad_top])
    # Arms first (under the hull, so the hull's own stubs win at the joins), stretched from the new hub to the cut.
    yy2, xx2 = np.mgrid[0:comp.shape[0], 0:W]
    for sd in ("l", "r"):
        strip, L0 = strips[sd]
        a, b = hub2 + off, cuts[sd] + off
        L1 = np.hypot(*(b - a))
        u = (b - a) / L1
        n = np.array([-u[1], u[0]])
        dx, dy = xx2 - a[0], yy2 - a[1]
        along = dx * u[0] + dy * u[1]
        across = dx * n[0] + dy * n[1]
        m = (along >= -HW) & (along <= L1 + 2) & (np.abs(across) <= HW)
        r = np.clip(along[m] / L1 * L0, 0, strip.shape[0] - 1)
        cidx = across[m] + HW
        val = np.stack([ndimage.map_coordinates(strip[..., k], [r, cidx], order=1, mode="nearest") for k in range(4)], -1)
        cur = comp[m]
        aa = val[:, 3:4] / 255
        comp[m] = val * aa + cur * (1 - aa)
        comp[m, 3] = np.maximum(cur[:, 3], val[:, 3])
    # The hull over the arms.
    hp = hull.copy()
    region = comp[pad_top:pad_top + H]
    ah = hp[..., 3:4] / 255
    region[..., :3] = hp[..., :3] * ah + region[..., :3] * (1 - ah)
    region[..., 3] = hp[..., 3] + region[..., 3] * (1 - ah[..., 0])

    # Near hull side: below the gunwale line.
    gx = np.array([p[0] for p in GUNWALE]) + O[0]
    gy = np.array([p[1] for p in GUNWALE]) + O[1] + pad_top
    line = np.interp(np.arange(W), gx, gy)
    front = comp.copy()
    front[yy2 < line[None, :]] = 0

    # Crop to the content and scale to F px per park px.
    alpha = comp[..., 3] > 4
    ys, xs = np.nonzero(alpha)
    x0, y0 = max(0, xs.min() - 4), max(0, ys.min() - 4)
    x1, y1 = min(comp.shape[1], xs.max() + 5), min(comp.shape[0], ys.max() + 5)
    k = s * F
    size = (round((x1 - x0) * k), round((y1 - y0) * k))

    def out(arr, name):
        im = arr[y0:y1, x0:x1]
        # Premultiplied resize, so the keyed edges don't pick up dark fringes.
        a = im[..., 3:4] / 255
        pm = np.dstack([im[..., :3] * a, im[..., 3]])
        chans = [np.asarray(Image.fromarray(np.ascontiguousarray(pm[..., c], dtype=np.float32), "F").resize(size, Image.LANCZOS)) for c in range(4)]
        al = np.clip(chans[3], 0, 255)
        rgb = np.stack(chans[:3], -1) / np.maximum(al[..., None] / 255, 1e-3)
        res = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
        Image.fromarray(res, "RGBA").save(os.path.join(RIDE, name), lossless=False, quality=92)
    out(comp, "ship_back.webp")
    out(front, "ship_front.webp")

    to_local = lambda p: [round((p[0] - x0) * k / F, 2), round((p[1] - y0) * k / F, 2)]  # park px from the image corner
    piv = to_local(hub2 + off)
    seats = []
    for sxc in SEATS_X:
        X = sxc + O[0]
        seats.append({"x": round((X - hub2[0]) * s, 2), "gunwale": round((np.interp(X, gx, gy) - (hub2[1] + off[1])) * s, 2)})
    meta = {"image_park": [round(size[0] / F, 2), round(size[1] / F, 2)], "pivot_in_image": piv, "density": F,
            "pivot": list(PIVOT), "keel_at_rest": KEEL, "length": LENGTH, "seats": seats,
            "note": "image_park is the sprite's size in park px; pivot_in_image is the hub's position in it (park px). seats: x and the near gunwale's y relative to the pivot at rest (park px)."}
    json.dump(meta, open(os.path.join(RIDE, "ship.json"), "w"), indent=1)
    print(f"ship sprite {size[0]} x {size[1]} px = {size[0] / F:.0f} x {size[1] / F:.0f} park px, pivot {piv}")
    # Check sheet: back, front, and the composite over grey.
    prev = Image.new("RGBA", (size[0] * 2 + 10, size[1]), (150, 150, 150, 255))
    prev.alpha_composite(Image.open(os.path.join(RIDE, "ship_back.webp")))
    prev.alpha_composite(Image.open(os.path.join(RIDE, "ship_front.webp")), (size[0] + 10, 0))
    prev.convert("RGB").save(os.path.join(RIDE, "gen/ship_build_check.png"))


# ---- the front occluders ----------------------------------------------------------------------------------------
FRONT_BOX = (790, 1060, 1140, 1325)  # park px
LEG_L = ((919, 1115), (848, 1257))
LEG_R = ((947, 1115), (1019, 1262))
FRONT_POLYS = {
    # Each front leg's polygon keeps clear of the back leg beside it (they only meet under the hub).
    "leg_l": [(912, 1106), (927, 1110), (891, 1190), (866, 1240), (868, 1262), (867, 1272), (832, 1271), (832, 1250), (842, 1246)],
    "leg_r": [(941, 1110), (955, 1106), (1022, 1246), (1036, 1252), (1036, 1273), (1004, 1272), (1004, 1250), (976, 1190)],
    "hub": [(910, 1090), (918, 1076), (936, 1074), (953, 1082), (960, 1094), (952, 1104), (950, 1121), (932, 1124), (915, 1120), (913, 1104)],
    "lamp_l": [(798, 1203), (828, 1203), (828, 1232), (822, 1240), (822, 1279), (800, 1279), (800, 1240), (797, 1232)],
    "lamp_r": [(1030, 1224), (1074, 1224), (1074, 1262), (1060, 1266), (1061, 1322), (1038, 1322), (1040, 1266), (1030, 1262)],
    "lamp_rr": [(1076, 1210), (1132, 1210), (1132, 1300), (1076, 1312)],
}
DECK = [(900, 1255, 980, 1285), (1000, 1288, 1030, 1300), (930, 1150, 940, 1200), (968, 1125, 995, 1140),
        (1062, 1282, 1076, 1300), (870, 1295, 900, 1305), (868, 1236, 885, 1250)]  # deck and platform only, clear of the legs


def build_front():
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        bx0, by0, bx1, by1 = FRONT_BOX
        base = im.convert("RGBA").crop((round(bx0 * F), round(by0 * F), round(bx1 * F), round(by1 * F)))
    pm = json.load(open(os.path.join(RIDE, "plate.json")))
    plate = Image.open(os.path.join(RIDE, "plate.webp")).convert("RGBA")
    base.alpha_composite(plate, (round((pm["rect"][0] - bx0) * F), round((pm["rect"][1] - by0) * F)))
    a = np.asarray(base).astype(np.float32)[..., :3]
    # Deck colour model (k-means over deck samples), as tests/characters/tools/make_occluders.py.
    px = np.concatenate([a[round((y0 - by0) * F):round((y1 - by0) * F), round((x0 - bx0) * F):round((x1 - bx0) * F)].reshape(-1, 3) for x0, y0, x1, y1 in DECK])
    rng = np.random.default_rng(0)
    c = px[rng.choice(len(px), 12, replace=False)]
    for _ in range(25):
        lab = ((px[:, None] - c[None]) ** 2).sum(-1).argmin(1)
        c = np.array([px[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(len(c))])
    d = np.sqrt(((a[..., None, :] - c[None, None]) ** 2).sum(-1)).min(-1)
    alpha = np.clip((d - 18) / (40 - 18), 0, 1)
    m = Image.new("L", base.size, 0)
    dr = ImageDraw.Draw(m)
    for poly in FRONT_POLYS.values():
        dr.polygon([((x - bx0) * F, (y - by0) * F) for x, y in poly], fill=255)
    inside = np.asarray(m) > 127
    solid = ndimage.binary_opening(alpha > 0.5, iterations=1) & inside
    solid = ndimage.binary_closing(solid, iterations=2) & inside
    alpha = np.maximum(alpha * ndimage.binary_dilation(solid, iterations=1), ndimage.binary_erosion(solid, iterations=1)) * inside
    rgba = np.dstack([np.asarray(base)[..., :3], (alpha * 255).astype(np.uint8)])
    ys, xs = np.nonzero(alpha > 0.01)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    Image.fromarray(rgba[y0:y1, x0:x1], "RGBA").save(os.path.join(RIDE, "front.webp"), lossless=True)
    rect = [round(bx0 + x0 / F, 2), round(by0 + y0 / F, 2), round((x1 - x0) / F, 2), round((y1 - y0) / F, 2)]
    json.dump({"rect": rect, "parts": list(FRONT_POLYS)}, open(os.path.join(RIDE, "front.json"), "w"))
    prev = np.dstack([np.full(a.shape[:2] + (3,), (40, 200, 90), np.float32), np.full(a.shape[:2], 255, np.float32)])
    prev[..., :3] = prev[..., :3] * (1 - alpha[..., None]) + a * alpha[..., None]
    Image.fromarray(prev[..., :3].astype(np.uint8)).save(os.path.join(RIDE, "gen/front_check.png"))
    print(f"front {rect}")


if __name__ == "__main__":
    build_ship()
    build_front()
