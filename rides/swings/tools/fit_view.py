"""Draw the ride's surface models over a 4K take (or the HD painting with --hd), gridded in park px, for fitting by eye.

  uv run -q --no-project --with pillow --with numpy python -I rides/swings/tools/fit_view.py TAKE.png OUT.png [--fit FIT.json] [--box X0,Y0,X1,Y1] [--zoom 0.5]

TAKE.png is a 3840 x 2560 edit of geom.json's region. FIT.json (optional) overrides the canopy's fitted surfaces in
that take: {"hc": 97, "r": 54, "band": 9, "cone": 12, "collar": 12, "col_r": 7.5, "cup_r": 11, "cup_h": 14, "dx": 0, "dy": 0}
(dx, dy shift the whole canopy in park px). Lines: crown band top/bottom (red/orange), cone collar (yellow), cupola
(cyan), column edges (magenta), drum and platform (green).
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, P, ring, polar  # noqa: E402

args = sys.argv[1:]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
fitf, box, zoom = opt("--fit", None), opt("--box", None), float(opt("--zoom", 0.5))
take, out = args[0], args[1]
X0, Y0, X1, Y1 = G["region"]
im = Image.open(take).convert("RGB")
S = im.width / (X1 - X0)
c = G["canopy"]
fit = {"hc": G["rest"] + G["lift"], "r": c["r"], "band": c["band"], "cone": c["cone"], "collar": c["collar"],
       "col_r": G["column"]["r"], "cup_r": c["cupola_r"], "cup_h": c["cupola_h"], "dx": 0, "dy": 0}
if fitf:
    fit.update(json.load(open(fitf)))
d = ImageDraw.Draw(im)
def q(pts, dx=0, dy=0):
    return [((x + dx - X0) * S, (y + dy - Y0) * S) for x, y in pts]
def line(pts, col, w=3, dx=0, dy=0):
    d.line(q(pts, dx, dy), fill=col, width=w)
dx, dy = fit["dx"], fit["dy"]
hc = fit["hc"]
line(ring(fit["r"], hc), (255, 40, 40), dx=dx, dy=dy)
line(ring(fit["r"], hc + fit["band"]), (255, 150, 0), dx=dx, dy=dy)
line(ring(fit["collar"], hc + fit["band"] + fit["cone"]), (255, 230, 0), dx=dx, dy=dy)
zc = hc + fit["band"] + fit["cone"]
prof = [(fit["cup_r"] * math.cos(t), zc + fit["cup_h"] * math.sin(t)) for t in np.linspace(0, math.pi, 30)]
line([P(r_, 0, z) for r_, z in prof], (0, 220, 255), dx=dx, dy=dy)
for sgn in (-1, 1):
    line([P(sgn * fit["col_r"], 0, G["drum"]["z1"]), P(sgn * fit["col_r"], 0, hc)], (255, 0, 255), dx=dx, dy=dy)
pl, dr = G["platform"], G["drum"]
for pts in (ring(pl["r"], 0), ring(pl["r"], pl["h"]), ring(dr["r"], pl["h"]), ring(dr["r"], dr["z1"]),
            ring(G["fence"]["r"], pl["h"] + G["fence"]["h"])):
    line(pts, (0, 200, 60), w=2)
# grid every 10 park px
for v in range(int(X0) // 10 * 10 + 10, int(X1), 10):
    d.line([((v - X0) * S, 0), ((v - X0) * S, im.height)], fill=(255, 0, 80) if v % 50 == 0 else (255, 160, 190), width=1)
    if v % 50 == 0:
        d.text(((v - X0) * S + 3, 3), str(v), fill=(200, 0, 60))
for v in range(int(Y0) // 10 * 10 + 10, int(Y1), 10):
    d.line([(0, (v - Y0) * S), (im.width, (v - Y0) * S)], fill=(255, 0, 80) if v % 50 == 0 else (255, 160, 190), width=1)
    if v % 50 == 0:
        d.text((3, (v - Y0) * S + 3), str(v), fill=(200, 0, 60))
if box:
    bx0, by0, bx1, by1 = (float(v) for v in box.split(","))
    im = im.crop((round((bx0 - X0) * S), round((by0 - Y0) * S), round((bx1 - X0) * S), round((by1 - Y0) * S)))
im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS)
im.save(out)
print(out, im.size)
