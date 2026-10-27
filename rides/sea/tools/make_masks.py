"""Masks for the moving sea, derived from the painting's own colours (gen/park/world_v2_hd.png).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/sea/tools/make_masks.py

Works in park px (the 3840 x 2560 frame). Writes into rides/sea/:
  sea.json      the canvas rect (park px), texture scales, the shore direction, and every ripple dash (rect, centre,
                area, local shore normal)
  masks.png     RGBA at 0.5 px per park px over the rect: R = signed distance to the shoreline, s + 128 (park px;
                s > 0 on the sand), G = open water (1 away from the shore foam), B = the shore normal's angle, A = 255
  dashpaint.webp  RGBA at 1 px per park px over the rect: the ripple dashes split from the water under them
                (A = coverage, RGB = the dash's own colour unmixed), so dash over clean == painting
  strokes.png   RGB at 1 px per park px: the stroke id (R + 256 G) of every hole pixel; dashes in sea.json are strokes
  hole.png      L at 1 px per park px over the rect: where clean replaces the painting (each dash + 5 px)
  clean.webp    RGB at 0.5 px per park px: the water with the dashes painted out (normalised blur of the water around)
  shots/masks_check.png   the masks over the painting, quarter size
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
SEA = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(SEA))
W, H = 3840, 2560
TOP = 1150  # nothing above this is sea (the deck and the town)

hd = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGB")
img = np.asarray(hd.resize((W, H), Image.BOX)).astype(np.float32)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx, mn = img.max(-1), img.min(-1)
yy = np.arange(H)[:, None] * np.ones((1, W))
xx = np.ones((H, 1)) * np.arange(W)[None, :]

def morph(fn, a, it):
    """A binary morphology op with the frame's edges extended, so it does not eat the border."""
    k = it + 2
    return fn(np.pad(a, k, mode="edge"), iterations=it)[k:-k, k:-k]


water = (b - r > 38) & (b > 140) & (yy > TOP)
white = (mn > 196) & (mx - mn < 52) & (yy > TOP)

# The sea: water components that reach the bottom or left edge; the river is the water at the top right.
lab, n = ndimage.label(water)
edge = set(np.unique(np.concatenate([lab[-1], lab[:, 0]]))) - {0}
# Plus large water patches cut off by sand (the lagoon behind the spit), but not the river at the far right.
sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
cents = ndimage.center_of_mass(np.ones_like(lab), lab, range(1, n + 1))
edge |= {i + 1 for i in range(n) if sizes[i] > 4000 and cents[i][1] < 3450 and cents[i][0] > 1650}
sea_water = np.isin(lab, sorted(edge))
# Shore foam: white next to the sea; the sea side is water + foam with the lace holes closed.
near = ndimage.distance_transform_edt(~sea_water) < 70
foam = white & near
side = morph(ndimage.binary_closing, sea_water | foam, 3)
side = ndimage.binary_fill_holes(side | ~(yy > TOP)) & (yy > TOP)
lab2, _ = ndimage.label(side)
keep = np.unique(lab2[sea_water])
side = np.isin(lab2, keep[keep > 0])
side = morph(ndimage.binary_opening, side, 2)

# Signed distance to the shoreline (park px), positive on the sand.
s = ndimage.distance_transform_edt(~side) - ndimage.distance_transform_edt(side)
s = ndimage.gaussian_filter(s, 1.5)

# White components inside the sea: those touching the sand are the shore foam, the rest are ripple dashes.
wsea = white & side
labw, nw = ndimage.label(morph(ndimage.binary_closing, wsea, 1))
sand_adj = ndimage.binary_dilation(~side, iterations=3)
touch = np.unique(labw[sand_adj & (labw > 0)])
shore_foam = np.isin(labw, touch[touch > 0])
dash_lab = np.where(shore_foam, 0, labw)
objs = ndimage.find_objects(dash_lab)

# Open water: the sea away from the shore foam.
open_w = side & (s < -6) & ~ndimage.binary_dilation(shore_foam, iterations=6)
open_w = ndimage.gaussian_filter(open_w.astype(np.float32), 3)

# Canvas rect: the sea and the swash zone (shoreline + 90 px of sand), clipped to the frame.
zone = s < 90
ys, xs = np.where(zone & (yy > TOP))
x0, y0, x1, y1 = 0, int(max(TOP, ys.min() - 4)), W, H
rect = [x0, y0, x1 - x0, y1 - y0]

gy, gx = np.gradient(ndimage.gaussian_filter(s, 12))
# Strokes: dashes closer than 6 px are one painted stroke and move as one.
strokes, n_strokes = ndimage.label(ndimage.binary_dilation(dash_lab > 0, iterations=3) & side)
stroke_of_dash = np.zeros(dash_lab.max() + 1, np.int32)
stroke_of_dash[dash_lab[dash_lab > 0]] = strokes[dash_lab > 0]
dashes = []
for i, sl in enumerate(ndimage.find_objects(strokes), 1):
    if sl is None:
        continue
    m = (strokes[sl] == i) & (dash_lab[sl] > 0)
    area = int(m.sum())
    if area < 1:
        continue
    cy, cx = ndimage.center_of_mass(m)
    cy += sl[0].start; cx += sl[1].start
    ny, nx = gy[int(cy), int(cx)], gx[int(cy), int(cx)]
    nn = float(np.hypot(nx, ny)) or 1.0
    dashes.append({"id": i, "r": [sl[1].start - 3, sl[0].start - 3, sl[1].stop - sl[1].start + 6, sl[0].stop - sl[0].start + 6],
                   "c": [round(float(cx), 1), round(float(cy), 1)], "a": area,
                   "n": [round(float(nx / nn), 3), round(float(ny / nn), 3)], "d": round(float(s[int(cy), int(cx)]), 1)})


# The water with the dashes painted out: normalised blur of the water pixels around each dash.
hole = ndimage.binary_dilation(dash_lab > 0, iterations=5)
valid = (sea_water & ~hole).astype(np.float32)
num = np.stack([ndimage.gaussian_filter(img[..., k] * valid, 6) for k in range(3)], -1)
den = ndimage.gaussian_filter(valid, 6)[..., None]
clean = np.where(den > 1e-3, num / np.maximum(den, 1e-3), img)
clean = np.where(hole[..., None], clean, img)

crop = lambda a: a[y0:y1, x0:x1]
half = lambda a, mode=Image.BILINEAR: np.asarray(Image.fromarray(a).resize((rect[2] // 2, rect[3] // 2), mode))
R = np.clip(crop(s) + 128, 0, 255).astype(np.uint8)
G = np.clip(crop(open_w) * 255, 0, 255).astype(np.uint8)
# B: the shore normal's angle (toward the sand), from the smoothed distance field, 0..255 over -pi..pi.
B = ((np.arctan2(crop(gy), crop(gx)) + np.pi) / (2 * np.pi) * 255 + 0.5).astype(np.uint8)
masks = np.dstack([half(R), half(G), half(B), np.full((rect[3] // 2, rect[2] // 2), 255, np.uint8)])
Image.fromarray(masks, "RGBA").save(os.path.join(SEA, "masks.png"), optimize=True)
# The dashes split from the water under them, so that a * dash + (1 - a) * clean == painting at rest:
# a = 1 on each dash and its outline (2 px), a colour-difference matte in a 3 px ring around that, the dash colour
# unmixed.
core = ndimage.binary_dilation(dash_lab > 0, iterations=2)  # the dash and its thin dark outline
ring = hole & ~core
S0 = np.array([249, 244, 234], np.float32)
dv = S0 - clean
proj = ((img - clean) * dv).sum(-1) / np.maximum((dv * dv).sum(-1), 1.0)
alpha = np.where(core, 1.0, np.where(ring, np.clip(proj, 0, 1), 0.0)).astype(np.float32)
alpha[alpha < 0.04] = 0
unmixed = np.where(alpha[..., None] > 0, clean + (img - clean) / np.maximum(alpha[..., None], 0.04), S0)
dash_rgba = np.dstack([np.clip(crop(unmixed), 0, 255), crop(alpha) * 255]).astype(np.uint8)
Image.fromarray(dash_rgba, "RGBA").save(os.path.join(SEA, "dashpaint.webp"), lossless=True, quality=100)
# Which stroke each pixel of the hole belongs to (the nearest dash pixel's stroke), so a stroke's sprite draws only
# its own pixels: R + 256 G = stroke id, 0 outside.
_, (iy, ix) = ndimage.distance_transform_edt(dash_lab == 0, return_indices=True)
sid = np.where(hole, stroke_of_dash[dash_lab[iy, ix]], 0)
sid = crop(sid)
Image.fromarray(np.dstack([sid & 255, sid >> 8, np.zeros_like(sid)]).astype(np.uint8), "RGB").save(os.path.join(SEA, "strokes.png"))
hole_soft = ndimage.gaussian_filter(hole.astype(np.float32), 0.6)
Image.fromarray((np.clip(crop(np.maximum(hole_soft, hole)), 0, 1) * 255).astype(np.uint8), "L").save(os.path.join(SEA, "hole.png"), optimize=True)
Image.fromarray(np.clip(crop(clean), 0, 255).astype(np.uint8)).resize((rect[2] // 2, rect[3] // 2), Image.BOX).save(
    os.path.join(SEA, "clean.webp"), quality=92)

# Shore direction: the mean tangent of the shoreline.
edge_px = np.where((np.abs(s) < 1) & (yy > TOP))
A = np.vstack([edge_px[1], np.ones_like(edge_px[1])]).T
slope = float(np.linalg.lstsq(A, edge_px[0], rcond=None)[0][0])
json.dump({
    "about": "Masks for rides/sea, derived from gen/park/world_v2_hd.png by rides/sea/tools/make_masks.py. Park px; masks.png and clean.webp at 0.5 px per park px over rect, dashpaint.webp and hole.png at 1.",
    "rect": rect, "maskScale": 0.5, "dashScale": 1, "shoreSlope": round(slope, 4),
    "dashes": dashes,
}, open(os.path.join(SEA, "sea.json"), "w"), separators=(",", ":"))

prev = img.copy()
prev[shore_foam] = prev[shore_foam] * 0.4 + np.array([255, 60, 60]) * 0.6
prev[dash_lab > 0] = [255, 220, 0]
edge = np.abs(s) < 1.2
prev[edge] = [20, 20, 20]
band = (s > 0) & (s < 60)
prev[band] = prev[band] * 0.75 + np.array([120, 255, 120]) * 0.25
Image.fromarray(np.clip(prev, 0, 255).astype(np.uint8)).resize((W // 4, H // 4), Image.BOX).save(os.path.join(SEA, "shots", "masks_check.png"))
print(f"rect {rect}, {len(dashes)} strokes ({n_strokes}), shore slope {slope:.3f}, shore foam px {int(shore_foam.sum())}")
