"""Find the painted window panes on the HD painting: regions closed by the painting's ink and filled with glass colour.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I tests/night-lights/tools/detect_windows.py \
      OUT.json MASK.png X0,Y0,X1,Y1 [--check CHECK.png] [--region town|park]

Box in park px. A pane is a region enclosed by ink (value < 0.62 or a dark tinted line) whose mean colour is glass:
cool (hue 185-265) with saturation >= 0.07, or a saturated window blue; 6-700 park px^2, compact (fills >= 55% of its
box), not thinner than 2 park px. Writes each window's bbox, centre, area and a mask of the box at HD resolution (pane
pixels exactly as painted; each pane's id in OUT.json is its label order). --check draws the outlines.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
K = 2.5
argv = sys.argv[1:]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
check = opt("--check")
pos = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or not argv[i - 1].startswith("--"))]
out, mask_out = pos[0], pos[1]
x0, y0, x1, y1 = (int(v) for v in pos[2].split(","))
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
crop = src.crop((round(x0 * K), round(y0 * K), round(x1 * K), round(y1 * K)))
a = np.asarray(crop).astype(np.float32) / 255
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1)
d = np.maximum(mx - mn, 1e-6)
h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
s = (mx - mn) / np.maximum(mx, 1e-6)
# Ink: dark lines, plus anything much darker than its neighbourhood (tinted outlines).
lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
local = ndi.uniform_filter(lum, 9)
ink = (mx < 0.62) | (lum < local - 0.12)
ink = ndi.binary_dilation(ink, iterations=1)
glass_px = ((h > 185) & (h < 265) & (s > 0.07) & (mx > 0.42)) | ((h > 190) & (h < 228) & (s > 0.25) & (mx > 0.4))
regions, n = ndi.label(~ink)
idx = np.arange(1, n + 1)
area = ndi.sum(np.ones_like(lum), regions, idx)
gl = ndi.sum(glass_px.astype(np.float32), regions, idx)
objs = ndi.find_objects(regions)
wins, keep = [], np.zeros(n + 1, bool)
A0, A1 = 6 * K * K, 700 * K * K
for i, sl in enumerate(objs, 1):
    ar = area[i - 1]
    if ar < A0 or ar > A1 or gl[i - 1] / ar < 0.6:
        continue
    hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if min(hh, ww) < 2 * K or ar / (hh * ww) < 0.55 or max(hh, ww) / min(hh, ww) > 4.5:
        continue
    if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == lum.shape[0] or sl[1].stop == lum.shape[1]:
        continue  # cut by the box edge: can't tell
    # The wall round it: just outside the frame, mostly not foliage, sky or glass.
    pad = int(6 * K)
    S = (slice(max(0, sl[0].start - pad), sl[0].stop + pad), slice(max(0, sl[1].start - pad), sl[1].stop + pad))
    reg = regions[S] == i
    ring = ndi.binary_dilation(reg, iterations=pad) & ~ndi.binary_dilation(reg, iterations=int(2 * K)) & ~ink[S]
    if ring.sum() < 10:
        continue
    hr, sr, vr = h[S][ring], s[S][ring], mx[S][ring]
    green = ((hr > 65) & (hr < 170) & (sr > 0.2)).mean()
    cool = ((hr > 185) & (hr < 265) & (sr > 0.12)).mean()
    if green > 0.25 or cool > 0.45:
        continue
    keep[i] = True
mask = keep[regions]
# A pane split by its glazing bars is one window: merge kept regions that touch across a thin bar.
merged, m = ndi.label(ndi.binary_closing(mask, np.ones((6, 6))))
for j, sl in enumerate(ndi.find_objects(merged), 1):
    if sl is None:
        continue
    sub = (merged[sl] == j) & mask[sl]
    ar = int(sub.sum())
    if ar < A0:
        continue
    cy, cx = ndi.center_of_mass(sub)
    hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    wins.append({
        "id": f"w{len(wins)}",
        "bbox": [round(x0 + sl[1].start / K, 1), round(y0 + sl[0].start / K, 1), round(ww / K, 1), round(hh / K, 1)],
        "c": [round(x0 + (sl[1].start + cx) / K, 1), round(y0 + (sl[0].start + cy) / K, 1)],
        "area": round(ar / K / K, 1),
    })
M = np.zeros(mask.shape, np.uint16)
for k, w in enumerate(wins):
    bx, by, bw, bh = w["bbox"]
    sl = (slice(round((by - y0) * K), round((by - y0 + bh) * K)), slice(round((bx - x0) * K), round((bx - x0 + bw) * K)))
    M[sl][mask[sl]] = k + 1
Image.fromarray((M > 0).astype(np.uint8) * 255).save(mask_out, optimize=True)
np.save(mask_out.rsplit(".", 1)[0] + "_ids.npy", M)
json.dump({"about": "Window panes found by tools/detect_windows.py; park px; mask at 2.5 px per park px over box", "box": [x0, y0, x1, y1], "windows": wins}, open(out, "w"), indent=1)
print(len(wins), "windows")
if check:
    arr = np.asarray(crop).copy()
    edge = (M > 0) & ~ndi.binary_erosion(M > 0, iterations=2)
    arr[edge] = [255, 0, 255]
    im = Image.fromarray(arr).resize((round((x1 - x0) * 2.4), round((y1 - y0) * 2.4)), Image.LANCZOS)
    dd = ImageDraw.Draw(im)
    for w in wins:
        dd.text(((w["c"][0] - x0) * 2.4 + 5, (w["c"][1] - y0) * 2.4 - 6), w["id"][1:], fill=(255, 0, 140))
    im.save(check)
