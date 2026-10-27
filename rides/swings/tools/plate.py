"""The Sea Swings' plate: the old east carousel filled in (erase take) with the ride's static base painted on it (ride
take), as one RGBA patch the layer lays over the painting (ctx.addPatch). Also writes the look-matched takes the
surfaces and cut-outs are built from.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/swings/tools/plate.py

1. The reference: geom.json's region of gen/park/world_v2_hd.png (2.5 HD px per park px) with the erase patch
   (gen/erase_v1_0_p.webp, made with tools/park_patch.py paste ... --mask gen/erase_mask.png --feather 2.5 --match)
   laid over it. park_patch's own colour match compares against the master, which still shows the old carousel under
   the base; this compares against the erased deck instead.
2. Each ride take (gen/ride_v1_0.png: canopy; gen/ride_v1_1.png: base and column) is brought to HD density, its shift
   measured and removed, and its look matched (park_patch.match_look: sharpness and per-channel spread, then the
   median offset) in a ring of deck around the ride. Saved as gen/ride_v1_N_matched.png (HD density, the region).
3. The base (platform, skirt, fence, drum, leaf ring) is cut from the matched base take by the hull of its fitted
   rings, grown 1.5 park px, feathered 1.2 park px, and laid over the erase patch.
4. Writes plate.webp (lossy RGBA, 2 px per park px) and plate.json ({rect, file}), and gen/plate_check.png
   (painting | plate laid over, at HD density).
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, ROOT, RIDE, ring, hull  # noqa: E402
sys.path.insert(0, os.path.join(ROOT, "tools"))
import park_patch as pp  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
F = 2.5
SHIP = 2.0  # px per park px in the shipped plate
X0, Y0, X1, Y1 = G["region"]
# the master crop is round(X0 F)..round(X1 F), as park_patch.hd_crop cuts it
W, H = round(X1 * F) - round(X0 * F), round(Y1 * F) - round(Y0 * F)
GEN = os.path.join(RIDE, "gen")


def load_patch(name):
    meta = json.load(open(os.path.join(GEN, name + ".json")))
    return Image.open(os.path.join(GEN, name + ".webp")).convert("RGBA"), meta["rect"]


def reference():
    im = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGBA").crop(
        (round(X0 * F), round(Y0 * F), round(X1 * F), round(Y1 * F)))
    p, rect = load_patch("erase_v1_0_p")
    im.alpha_composite(p, (round((rect[0] - X0) * F), round((rect[1] - Y0) * F)))
    return np.asarray(im.convert("RGB")).astype(np.float32)


def mask_of(pts, grow=0.0):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([((x - X0) * F, (y - Y0) * F) for x, y in pts], fill=255)
    m = np.asarray(m) > 127
    if grow:
        m = ndimage.binary_dilation(m, iterations=round(grow * F))
    return m


def base_outline():
    pl, fe = G["platform"], G["fence"]
    return hull(ring(pl["r"] + 0.8, 0) + ring(pl["r"] + 0.5, pl["h"]) + ring(fe["r"] + 0.8, pl["h"] + fe["h"] + 1.5))


def ride_outline():
    # everything the ride takes drew: the base, the column and the canopy at full lift (with its finial)
    return hull(base_outline() + [(2728, 1392), (2845, 1392), (2730, 1404), (2844, 1404), (2786, 1353), (2730, 1380), (2842, 1380), (2786, 1426)])


def matched_take(name, ref):
    take = Image.open(os.path.join(GEN, name + ".png")).convert("RGB").resize((W, H), Image.LANCZOS)
    t = np.asarray(take).astype(np.float32)
    q = 4
    dy, dx = pp.shift_of(ref[::q, ::q], t[::q, ::q])
    dy, dx = dy * q, dx * q
    if max(abs(dy), abs(dx)) > 40:
        dy = dx = 0
    t = ndimage.shift(t, (dy, dx, 0), order=1, mode="nearest")
    ride = mask_of(ride_outline(), grow=3)
    ringm = ndimage.binary_dilation(ride, iterations=round(14 * F)) & ~ride
    # sharpness only (park_patch.match_look also scales each channel's spread to the ring's, but the takes redrew
    # the deck's plank lines fainter than the painting, which would push the ride's own contrast up by up to 1.3)
    target = pp.hipass_energy(ref, ringm)
    best = (abs(np.log(pp.hipass_energy(t, ringm) / target)), 0.0)
    for sigma in (0.4, 0.6, 0.8, 1.1, 1.5):
        err = abs(np.log(pp.hipass_energy(ndimage.gaussian_filter(t, (sigma, sigma, 0)), ringm) / target))
        if err < best[0]:
            best = (err, sigma)
    if best[1]:
        t = ndimage.gaussian_filter(t, (best[1], best[1], 0))
    print(f"{name}: blur sigma {best[1]} HD px to the painting's sharpness")
    off = np.median(ref[ringm] - t[ringm], axis=0)
    t = np.clip(t + off, 0, 255)
    print(f"{name}: shift ({dy}, {dx}) HD px, colour offset {np.round(off, 1).tolist()}")
    Image.fromarray(t.astype(np.uint8)).save(os.path.join(GEN, name + "_matched.png"))
    return t


def main():
    ref = reference()
    base = matched_take("ride_v1_1", ref)
    matched_take("ride_v1_0", ref)
    m = mask_of(base_outline(), grow=1.5)
    feather = 1.2 * F
    sd = ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)
    alpha = np.clip(0.5 + sd / feather, 0, 1)
    # plate = erase patch with the base over it, over the union of both rects
    ep, erect = load_patch("erase_v1_0_p")
    full = np.zeros((H, W, 4), np.float32)
    ex, ey = round((erect[0] - X0) * F), round((erect[1] - Y0) * F)
    e = np.asarray(ep).astype(np.float32)
    full[ey:ey + e.shape[0], ex:ex + e.shape[1]] = e
    a0 = full[..., 3:] / 255
    a1 = alpha[..., None]
    rgb = base * a1 + full[..., :3] * (1 - a1)
    acc = a1 + a0 * (1 - a1)
    rgb = np.where(acc > 0, (base * a1 + full[..., :3] * a0 * (1 - a1)) / np.maximum(acc, 1e-6), 0)
    out = np.dstack([rgb, acc[..., 0] * 255])
    ys, xs = np.where(out[..., 3] > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rect = [X0 + x0 / F, Y0 + y0 / F, (x1 - x0) / F, (y1 - y0) / F]
    hd = Image.fromarray(np.clip(out[y0:y1, x0:x1], 0, 255).astype(np.uint8), "RGBA")
    hd.save(os.path.join(GEN, "plate_hd.webp"), lossless=True)
    small = hd.resize((round(rect[2] * SHIP), round(rect[3] * SHIP)), Image.LANCZOS)
    small.save(os.path.join(RIDE, "plate.webp"), quality=90, alpha_quality=100, method=6)
    json.dump({"file": "plate.webp", "rect": [round(float(v), 2) for v in rect], "px_per_park_px": SHIP,
               "sources": {"erase": "gen/erase_v1_0.png", "base": "gen/ride_v1_1.png"}},
              open(os.path.join(RIDE, "plate.json"), "w"), indent=1)
    # check: painting | plate over it
    after = ref * (1 - a1) + base * a1
    orig = np.asarray(Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGB").crop(
        (round(X0 * F), round(Y0 * F), round(X1 * F), round(Y1 * F)))).astype(np.float32)
    check = np.concatenate([orig, np.full((H, 8, 3), 255, np.float32), after], 1)
    Image.fromarray(np.clip(check, 0, 255).astype(np.uint8)).save(os.path.join(GEN, "plate_check.png"))
    print(f"plate.webp {small.size} rect {[round(float(v), 2) for v in rect]} ({os.path.getsize(os.path.join(RIDE, 'plate.webp')) // 1024} KB)")


if __name__ == "__main__":
    main()
