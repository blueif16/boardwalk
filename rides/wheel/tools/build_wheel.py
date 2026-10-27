"""The Dream Wheel's art: the turning wheel and its hub, the cabins, and the front legs that stand over them.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/wheel/tools/build_wheel.py

Reads the generated sheets (gen/wheel_v1_0.png on flat green, gen/cabins_v1_0.png on flat magenta) and the plate
(plate.webp, made with tools/park_patch.py over the painting). Writes, in rides/wheel/:
  wheel.webp   the rim and spokes, keyed, square, centred on the hub
  hub.webp     the hub disc alone, drawn again over the front legs
  cabins.webp  the 12 cabins (6 colours, empty and with riders), anchored at the hanger ring
  legs.webp    the front A-frame legs, the plate's own pixels, drawn over wheel and cabins
  wheel.json   geometry (park px) and sprite metadata
and gen/build_check.png, every piece on a grey card.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
GEN = os.path.join(RIDE, "gen")
F = 2.5  # HD px per park px: every sprite is stored at the painting's own density

# Geometry, measured on the plate (gridded crops): the hub sits on the front A-frame's axle cap, the knob ring is the
# painted cabin ring's size (an upright ellipse, the painter's licence: no vertical wheel under this camera is taller
# than wide), the cabins match the painted ones.
HUB = (2579.0, 1305.0)
RING_A, RING_B = 90.0, 110.0  # knob ring half-axes, park px
CABIN_W = 38.0  # cabin body width, park px
WHEEL_PX = 640  # wheel sprite size (square)
# Front legs: centrelines from the apex to the foot (park px), run-extracted per row from the plate.
FRONT_LEGS = [((2578, 1318), (2512, 1460)), ((2582, 1318), (2628, 1490))]


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32)


def key(rgb, t0, t1):
    """Alpha from the distance to the flat background colour (median of the border), and the colours un-mixed from it."""
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    k = np.median(border, 0)
    d = np.sqrt(((rgb - k) ** 2).sum(-1))
    a = np.clip((d - t0) / (t1 - t0), 0, 1)
    # Islands of background colour enclosed by the art (gaps between spokes) are background too; tiny specks are not art.
    a = a * ndimage.binary_opening(a > 0.5, iterations=1)
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.clip((rgb - (1 - a[..., None]) * k) / safe, 0, 255)
    return np.dstack([np.where(a[..., None] > 0, col, 0), a * 255]), k


def save(arr, p, **kw):
    Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), "RGBA").save(p, **kw)


def resize(arr, w, h):
    """Premultiplied resize of an RGBA float array."""
    a = arr[..., 3:] / 255
    pm = np.dstack([arr[..., :3] * a, a * 255])
    out = np.stack([np.asarray(Image.fromarray(pm[..., c].astype(np.float32)).resize((w, h), Image.LANCZOS)) for c in range(4)], -1)
    al = np.clip(out[..., 3:] / 255, 0, 1)
    return np.dstack([np.clip(out[..., :3] / np.maximum(al, 1e-4), 0, 255), al * 255])


def wheel_sprites():
    rgba, k = key(load(os.path.join(GEN, "wheel_v1_0.png")), 70, 150)
    a = rgba[..., 3] > 127
    ys, xs = np.where(a)
    # The knobs: yellow blobs on the outer edge; their centroids give the centre, the radius and the cabins' angles.
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    yellow = a & (r > 200) & (g > 160) & (b < 130)
    lab, n = ndimage.label(ndimage.binary_opening(yellow, iterations=2))
    cents = np.array(ndimage.center_of_mass(yellow, lab, range(1, n + 1)))
    sizes = ndimage.sum(yellow, lab, range(1, n + 1))
    cy0, cx0 = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    rad = np.hypot(cents[:, 0] - cy0, cents[:, 1] - cx0)
    keep = (sizes > sizes.max() * 0.25) & (rad > 0.7 * rad.max())
    knobs = cents[keep]
    # Circle fit (least squares) through the knob centres.
    A = np.c_[knobs[:, 1], knobs[:, 0], np.ones(len(knobs))]
    bb = (knobs ** 2).sum(1)
    sx, sy, c = np.linalg.lstsq(A, bb, rcond=None)[0]
    cx, cy = sx / 2, sy / 2
    rk = np.sqrt(c + cx * cx + cy * cy)
    ang = np.sort(np.arctan2(knobs[:, 0] - cy, knobs[:, 1] - cx))
    print(f"wheel: {len(knobs)} knobs, centre ({cx:.1f}, {cy:.1f}), knob radius {rk:.1f} px, spread of knob radii {np.std(np.hypot(knobs[:, 0] - cy, knobs[:, 1] - cx)):.1f} px")
    # Square crop centred on the fitted centre, reaching just past the knobs, then resampled to WHEEL_PX.
    half = int(np.ceil(max(np.hypot(xs - cx, ys - cy).max() + 4, rk * 1.12)))
    pad = np.zeros((rgba.shape[0] + 2 * half, rgba.shape[1] + 2 * half, 4), np.float32)
    pad[half:half + rgba.shape[0], half:half + rgba.shape[1]] = rgba
    x0, y0 = int(round(cx)), int(round(cy))
    sq = pad[y0:y0 + 2 * half, x0:x0 + 2 * half]
    s = WHEEL_PX / sq.shape[0]
    wheel = resize(sq, WHEEL_PX, WHEEL_PX)
    save(wheel, os.path.join(RIDE, "wheel.webp"), lossless=True, quality=100)
    # The hub: the blue disc with the star, cut out with a soft edge.
    blue = a & (b > r + 40) & (b > g)
    blab, bn = ndimage.label(blue)
    # The hub is the blue blob whose centroid is nearest the centre (the rim band is blue too, but centred far out).
    cents_b = np.array(ndimage.center_of_mass(blue, blab, range(1, bn + 1)))
    sizes_b = ndimage.sum(blue, blab, range(1, bn + 1))
    near = np.hypot(cents_b[:, 0] - cy, cents_b[:, 1] - cx) + (sizes_b < 200) * 1e9
    hub_mask = ndimage.binary_fill_holes(blab == int(np.argmin(near)) + 1)
    hr = np.sqrt(hub_mask.sum() / np.pi) + 4  # plus the outline
    yy, xx = np.mgrid[0:WHEEL_PX, 0:WHEEL_PX]
    rr = np.hypot(xx - WHEEL_PX / 2, yy - WHEEL_PX / 2) / s
    hub = wheel.copy()
    hub[..., 3] *= np.clip(hr + 1.5 - rr, 0, 1)
    hpx = int(np.ceil((hr + 3) * s))
    c0 = WHEEL_PX // 2
    save(hub[c0 - hpx:c0 + hpx, c0 - hpx:c0 + hpx], os.path.join(RIDE, "hub.webp"), lossless=True, quality=100)
    return {"size": WHEEL_PX, "knob_radius": rk * s, "knob_angles": [round(float(v), 4) for v in ang], "hub_radius": hr * s, "hub_size": 2 * hpx}


def cabin_sprites():
    rgba, k = key(load(os.path.join(GEN, "cabins_v1_0.png")), 80, 160)
    a = rgba[..., 3] > 127
    lab, n = ndimage.label(ndimage.binary_closing(a, iterations=3))
    objs = ndimage.find_objects(lab)
    H, W = a.shape
    cells = {}
    for i, sl in enumerate(objs):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < 2000:
            continue
        cyy, cxx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        key_ = (min(2, int(cyy / (H / 3))), min(3, int(cxx / (W / 4))))
        prev = cells.get(key_)
        cells[key_] = sl if prev is None else (slice(min(prev[0].start, sl[0].start), max(prev[0].stop, sl[0].stop)), slice(min(prev[1].start, sl[1].start), max(prev[1].stop, sl[1].stop)))
    assert len(cells) == 12, f"found {len(cells)} cabin cells"
    # (colour, empty cell, full cell): rows 1-2 are four colours empty/full, row 3 is lavender and peach.
    pairs = [("yellow", (0, 0), (1, 0)), ("blue", (0, 1), (1, 1)), ("mint", (0, 2), (1, 2)), ("salmon", (0, 3), (1, 3)),
             ("lavender", (2, 0), (2, 2)), ("peach", (2, 1), (2, 3))]
    crops = {}
    for cell, sl in cells.items():
        sub = rgba[sl[0], sl[1]].copy()
        m = sub[..., 3] > 127
        body_w = np.percentile(m.sum(1)[m.sum(1) > 0], 95)  # the widest rows: the body
        cols = np.where(m.any(0))[0]
        rows = np.where(m.any(1))[0]
        # The hanger ring: the top rows; its centre is the anchor.
        top = rows.min()
        ring = m[top:top + int(0.08 * len(rows))]
        rc = np.where(ring.any(0))[0]
        crops[cell] = (sub, body_w, (rc.min() + rc.max()) / 2, top + 0.035 * len(rows))
    s_all = CABIN_W * F / np.median([c[1] for c in crops.values()])
    out = {}
    for name, ce, cf in pairs:
        se, sf = crops[ce][0], crops[cf][0]
        # Same colour for both states: the empty cabin's body moved onto the full one's (only where they differ).
        me, mf = se[..., 3] > 200, sf[..., 3] > 200
        lum = lambda x: x[..., :3] @ np.array([0.299, 0.587, 0.114])
        be, bf = me & (lum(se) > 120), mf & (lum(sf) > 120)
        mue, muf = se[..., :3][be].mean(0), sf[..., :3][bf].mean(0)
        if np.abs(mue - muf).max() > 18:
            se = se.copy()
            se[..., :3] = np.where(be[..., None], np.clip(se[..., :3] + (muf - mue), 0, 255), se[..., :3])
            print(f"{name}: empty cabin recoloured by {np.round(muf - mue).tolist()}")
        for state, (sub, bw, ax, ay) in (("empty", (se,) + crops[ce][1:]), ("full", (sf,) + crops[cf][1:])):
            w, h = round(sub.shape[1] * s_all), round(sub.shape[0] * s_all)
            spr = resize(sub, w, h)
            out[f"{name}_{state}"] = (spr, ax * s_all, ay * s_all)
    # Pack in one row.
    gap = 4
    W_ = sum(v[0].shape[1] + gap for v in out.values()) + gap
    H_ = max(v[0].shape[0] for v in out.values()) + 2 * gap
    atlas = np.zeros((H_, W_, 4), np.float32)
    meta, x = {}, gap
    for name, (spr, ax, ay) in out.items():
        h, w = spr.shape[:2]
        atlas[gap:gap + h, x:x + w] = spr
        meta[name] = {"rect": [x, gap, w, h], "anchor": [round(ax, 2), round(ay, 2)]}
        x += w + gap
    save(atlas, os.path.join(RIDE, "cabins.webp"), lossless=True, quality=100)
    return {"density": F, "frames": meta, "colours": [p[0] for p in pairs]}


def front_legs():
    """The front legs' own pixels from the painting with the plate laid over it, one row at a time: in each row, the
    run of blue leg pixels containing the leg's centreline, plus its dark outline on both sides."""
    patch = json.load(open(os.path.join(RIDE, "plate.json")))
    px, py, pw, ph = patch["rect"]
    x0, y0, x1, y1 = int(px - 10), int(py - 10), int(np.ceil(px + pw + 10)), int(np.ceil(py + ph + 10))
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        base = im.convert("RGBA").crop((round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F)))
    plate = Image.open(os.path.join(RIDE, "plate.webp")).convert("RGBA")
    base.alpha_composite(plate, (round((px - x0) * F), round((py - y0) * F)))
    rgb = np.asarray(base.convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    blue = (b > r + 30) & (b > g + 5)
    dark = rgb.mean(-1) < 95
    keep = np.zeros(blue.shape, bool)
    for (ax, ay), (fx, fy) in FRONT_LEGS:
        for Y in range(round((ay - y0) * F), round((fy - y0 + 4) * F)):
            yy = Y / F + y0
            t = (yy - ay) / (fy - ay)
            X = int(round(((ax + t * (fx - ax)) - x0) * F))
            if not (0 <= Y < blue.shape[0] and 0 <= X < blue.shape[1]):
                continue
            row = blue[Y]
            # Nearest blue pixel to the centreline, then the whole run around it.
            cand = np.where(row[max(0, X - 12):X + 13])[0]
            if not len(cand):
                continue
            c = max(0, X - 12) + cand[np.argmin(np.abs(cand - 12))] if X >= 12 else cand[0]
            lo = c
            while lo > 0 and row[lo - 1]:
                lo -= 1
            hi = c
            while hi < len(row) - 1 and row[hi + 1]:
                hi += 1
            # Clamp to the leg's own width around the centreline (the back frame's crossbar joins the run behind it).
            lo, hi = max(lo, X - 28), min(hi, X + 28)
            # The outline: dark pixels within 4 px outside the run.
            for d in range(1, 5):
                if lo - 1 >= 0 and dark[Y, lo - 1]:
                    lo -= 1
            for d in range(1, 5):
                if hi + 1 < len(row) and dark[Y, hi + 1]:
                    hi += 1
            keep[Y, lo:hi + 1] = True
    # The feet's bottom outlines and the leg ends: close small gaps, then feather 1 px.
    keep = ndimage.binary_closing(keep, iterations=2)
    alpha = ndimage.gaussian_filter(keep.astype(np.float32), 0.6)
    ys, xs = np.where(alpha > 0.02)
    sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    out = np.dstack([rgb, alpha * 255])[sl]
    save(out, os.path.join(RIDE, "legs.webp"), lossless=True, quality=100)
    rect = [round(float(x0 + xs.min() / F), 2), round(float(y0 + ys.min() / F), 2), round(out.shape[1] / F, 2), round(out.shape[0] / F, 2)]
    return {"rect": rect}


def check(meta):
    tiles = [np.asarray(Image.open(os.path.join(RIDE, f)).convert("RGBA")).astype(np.float32) for f in ("wheel.webp", "hub.webp", "cabins.webp", "legs.webp")]
    H = max(t.shape[0] for t in tiles) + 20
    W = sum(t.shape[1] for t in tiles) + 20 * (len(tiles) + 1)
    card = np.full((H, W, 3), 128, np.float32)
    x = 20
    for t in tiles:
        a = t[..., 3:] / 255
        card[10:10 + t.shape[0], x:x + t.shape[1]] = card[10:10 + t.shape[0], x:x + t.shape[1]] * (1 - a) + t[..., :3] * a
        x += t.shape[1] + 20
    Image.fromarray(card.astype(np.uint8)).save(os.path.join(GEN, "build_check.png"))


def main():
    wheel = wheel_sprites()
    cabins = cabin_sprites()
    legs = front_legs()
    meta = {
        "about": "Dream Wheel geometry and sprites (rides/wheel/tools/build_wheel.py). Park px. The wheel sprite is drawn centred on hub, rotated, then scaled to an upright ellipse: knob ring half-axes ring = [a, b]; sprite knob radius and angles (radians, sprite y down, increasing clockwise) give where each cabin hangs. Sprites are at density px per park px.",
        "hub": HUB, "ring": [RING_A, RING_B], "density": F,
        "wheel": wheel, "cabins": cabins, "legs": legs,
    }
    json.dump(meta, open(os.path.join(RIDE, "wheel.json"), "w"), indent=1)
    check(meta)
    print(f"cabins: {len(cabins['frames'])} sprites; legs rect {legs['rect']}")


if __name__ == "__main__":
    main()
