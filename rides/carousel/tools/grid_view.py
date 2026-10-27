"""Gridded HD view of a park region, with plate patches applied, for measuring by eye.

  uv run -q --no-project --with pillow python -I rides/wheel/tools/grid_view.py X0 Y0 X1 Y1 OUT.png [--zoom 1.2] [--step 10] [--patch rides/wheel/plate]
"""
import json, sys
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
F = 2.5
args = [a for a in sys.argv[1:]]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
zoom, step, patch = float(opt("--zoom", 1.2)), int(opt("--step", 10)), opt("--patch", None)
x0, y0, x1, y1 = (int(v) for v in args[:4]); out = args[4]
im = Image.open("gen/park/world_v2_hd.png").convert("RGBA")
if patch:
    meta = json.load(open(patch + ".json")); p = Image.open(patch + ".webp").convert("RGBA")
    im.alpha_composite(p, (round(meta["rect"][0] * F), round(meta["rect"][1] * F)))
im = im.crop((round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F))).convert("RGB")
im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA"); s = F * zoom
for v in range(x0 - x0 % step + step, x1, step):
    X = (v - x0) * s; big = v % (step * 5) == 0
    d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 140 if big else 40))
    if big: d.rectangle([X + 2, 2, X + 34, 14], fill=(255, 255, 255, 210)); d.text((X + 3, 2), str(v), fill=(200, 0, 60))
for v in range(y0 - y0 % step + step, y1, step):
    Y = (v - y0) * s; big = v % (step * 5) == 0
    d.line([(0, Y), (im.width, Y)], fill=(255, 0, 80, 140 if big else 40))
    if big: d.rectangle([2, Y + 2, 34, Y + 14], fill=(255, 255, 255, 210)); d.text((3, Y + 2), str(v), fill=(200, 0, 60))
im.save(out); print(out, im.size)
