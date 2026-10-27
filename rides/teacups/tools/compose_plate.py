"""The painting with this ride's plate patch laid over it, as a gridded crop, plus optional projected ground circles
(the painting's camera: a ground circle of radius r is an ellipse r wide and r * sin(28.7 deg) tall).

  uv run -q --no-project --with pillow --with numpy python -I rides/teacups/tools/compose_plate.py PATCH_PREFIX OUT.png
      [--box X0,Y0,X1,Y1] [--zoom Z] [--circle CX,CY,R ...]
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
args = sys.argv[1:]
prefix, out = args[0], args[1]
opt = lambda k, d: args[args.index(k) + 1] if k in args else d
x0, y0, x1, y1 = map(float, opt("--box", "3060,1380,3360,1680").split(","))
Z = float(opt("--zoom", "3"))
circles = [tuple(map(float, args[i + 1].split(","))) for i, a in enumerate(args) if a == "--circle"]
F = 2.5
hd = Image.open("gen/park/world_v2_hd.png").convert("RGB").crop((round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F))).convert("RGBA")
meta = json.load(open(prefix + ".json"))
patch = Image.open(prefix + ".webp").convert("RGBA")
rx, ry, rw, rh = meta["rect"]
hd.alpha_composite(patch, (round((rx - x0) * F), round((ry - y0) * F)))
im = hd.convert("RGB").resize((round((x1 - x0) * Z), round((y1 - y0) * Z)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
for v in range(int(x0 // 10 + 1) * 10, int(x1), 10):
    X = (v - x0) * Z; d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 110 if v % 50 == 0 else 30))
    if v % 50 == 0: d.text((X + 2, 2), str(v), fill=(200, 0, 60))
for v in range(int(y0 // 10 + 1) * 10, int(y1), 10):
    Y = (v - y0) * Z; d.line([(0, Y), (im.width, Y)], fill=(255, 0, 80, 110 if v % 50 == 0 else 30))
    if v % 50 == 0: d.text((2, Y + 2), str(v), fill=(200, 0, 60))
sp = math.sin(math.radians(28.7))
for k, (cx, cy, r) in enumerate(circles):
    col = [(0, 140, 255, 255), (0, 200, 90, 255), (255, 120, 0, 255)][k % 3]
    pts = [((cx + r * math.cos(a) - x0) * Z, (cy + r * sp * math.sin(a) - y0) * Z) for a in np.linspace(0, 2 * math.pi, 120)]
    d.line(pts, fill=col, width=2)
im.save(out)
print(out, im.size)
