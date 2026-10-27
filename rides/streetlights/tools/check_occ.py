"""Does any rides/traffic front cut-out (occ.webp, drawn over cars passing under it) cover a painted pole? Such a
piece shows the painting without the pole, so the pole would blink away while a car passes. Prints the overlaps."""
import json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from base import ROOT, F
D = os.path.join(ROOT, "rides/streetlights")
occ = json.load(open(os.path.join(ROOT, "rides/traffic/occ.json")))
sheet = np.asarray(Image.open(os.path.join(ROOT, "rides/traffic/occ.webp")).convert("RGBA"))[..., 3]
dens = occ["density"]
sl = json.load(open(os.path.join(D, "streetlights.json")))
bad = 0
for pl in sl["plates"]:
    a = np.asarray(Image.open(os.path.join(D, pl["file"])).convert("RGBA"))[..., 3]
    x0, y0 = pl["rect"][:2]
    ys, xs = np.nonzero(a > 128)
    X, Y = x0 + xs / F, y0 + ys / F
    for i, pc in enumerate(occ["pieces"]):
        ax, ay, aw, ah = pc["at"]
        m = (X >= ax) & (X < ax + aw) & (Y >= ay) & (Y < ay + ah)
        if not m.any():
            continue
        sx = np.clip(((X[m] - ax) * dens).astype(int) + pc["rect"][0], 0, sheet.shape[1] - 1)
        sy = np.clip(((Y[m] - ay) * dens).astype(int) + pc["rect"][1], 0, sheet.shape[0] - 1)
        hit = sheet[sy, sx] > 60
        if hit.sum() > 3:
            bad += 1
            print(f"{pl['file']}: traffic piece {i} at {pc['at']} (sortY {pc['sortY']}) covers {hit.sum()} pole px around ({X[m][hit].mean():.0f}, {Y[m][hit].mean():.0f})")
print("overlaps:", bad)
