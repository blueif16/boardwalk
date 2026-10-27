"""Gridded crops of the HD painting (gen/park/world_v2_hd.png) labelled in park px, for tracing by eye.

  uv run -q --no-project --with pillow python -I rides/teacups/tools/hd_grid.py X0 Y0 X1 Y1 OUT.png [--step 10] [--zoom 1]

zoom is output px per HD px (HD = 2.5 px per park px). Light lines every --step park px, labelled every 50.
"""
import sys
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
a = [x for x in sys.argv[1:] if not x.startswith("--")]
opt = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
x0, y0, x1, y1 = map(float, a[:4]); out = a[4]
step, zoom = opt("--step", 10), opt("--zoom", 1.0)
F = 2.5 * zoom
im = Image.open("gen/park/world_v2_hd.png").convert("RGB").crop((round(x0 * 2.5), round(y0 * 2.5), round(x1 * 2.5), round(y1 * 2.5)))
im = im.resize((round((x1 - x0) * F), round((y1 - y0) * F)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
v = (x0 // step + 1) * step
while v < x1:
    X = (v - x0) * F; major = v % 50 == 0
    d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 140 if major else 40))
    if major: d.rectangle([X + 1, 1, X + 34, 13], fill=(255, 255, 255, 210)); d.text((X + 3, 2), str(int(v)), fill=(200, 0, 60))
    v += step
v = (y0 // step + 1) * step
while v < y1:
    Y = (v - y0) * F; major = v % 50 == 0
    d.line([(0, Y), (im.width, Y)], fill=(255, 0, 80, 140 if major else 40))
    if major: d.rectangle([1, Y + 1, 34, Y + 13], fill=(255, 255, 255, 210)); d.text((3, Y + 2), str(int(v)), fill=(200, 0, 60))
    v += step
im.save(out)
print(out, im.size)
