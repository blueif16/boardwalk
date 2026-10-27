"""Second window finder: compact blobs of painted window blue (the dark-blue panes that detect_windows.py reads as ink).
args: OUT.json X0,Y0,X1,Y1 [--check CHECK.png]. Writes OUT.json and OUT_mask_ids.npy (HD, same layout as detect_windows)."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS = None
K = 2.5
out = sys.argv[1]; x0, y0, x1, y1 = map(int, sys.argv[2].split(","))
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
a = np.asarray(src.crop((round(x0*K), round(y0*K), round(x1*K), round(y1*K)))).astype(np.float32) / 255
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1); d = np.maximum(mx - mn, 1e-6)
h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
s = (mx - mn) / np.maximum(mx, 1e-6)
pane = (h > 185) & (h < 232) & (s > 0.28) & (mx > 0.28) & (mx < 0.9)
pane = ndi.binary_opening(ndi.binary_closing(pane, np.ones((3, 3))), np.ones((2, 2)))
lab, n = ndi.label(pane)
objs = ndi.find_objects(lab)
area = ndi.sum(pane, lab, np.arange(1, n + 1))
wins, M = [], np.zeros(pane.shape, np.uint16)
for i, sl in enumerate(objs, 1):
    ar = area[i-1]
    if ar < 8*K*K or ar > 260*K*K: continue
    hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if min(hh, ww) < 2.5*K or ar / (hh*ww) < 0.5 or max(hh, ww) / min(hh, ww) > 3.5: continue
    if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == pane.shape[0] or sl[1].stop == pane.shape[1]: continue
    pad = int(5*K)
    S = (slice(max(0, sl[0].start-pad), sl[0].stop+pad), slice(max(0, sl[1].start-pad), sl[1].stop+pad))
    reg = lab[S] == i
    ring = ndi.binary_dilation(reg, iterations=pad) & ~ndi.binary_dilation(reg, iterations=int(1.5*K))
    hr, sr, vr = h[S][ring], s[S][ring], mx[S][ring]
    green = ((hr > 65) & (hr < 175) & (sr > 0.2)).mean()
    cool = ((hr > 180) & (hr < 260) & (sr > 0.2)).mean()
    grey = ((sr < 0.12) & (vr < 0.8) & (vr > 0.45)).mean()  # asphalt
    if green > 0.3 or cool > 0.4 or grey > 0.5: continue
    cy, cx = ndi.center_of_mass(reg)
    k = len(wins) + 1
    M[sl][lab[sl] == i] = k
    wins.append({"id": f"b{k-1}", "bbox": [round(x0+sl[1].start/K, 1), round(y0+sl[0].start/K, 1), round(ww/K, 1), round(hh/K, 1)],
                 "c": [round(x0+(S[1].start+cx)/K, 1), round(y0+(S[0].start+cy)/K, 1)], "area": round(float(ar)/K/K, 1)})
np.save(out.replace(".json", "_mask_ids.npy"), M)
json.dump({"about": "blue-pane blobs (scratch finder)", "box": [x0, y0, x1, y1], "windows": wins}, open(out, "w"), indent=1)
print(len(wins), "blobs")
