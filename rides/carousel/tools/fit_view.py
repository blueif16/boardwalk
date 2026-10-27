"""Draw the carousel surface models (rides/carousel/geom.json) over the HD painting, to fit them by eye.

  uv run -q --no-project --with pillow --with numpy python -I rides/carousel/tools/fit_view.py NAME OUT.png [--zoom 2] [--src PNG]

NAME is a carousel in geom.json ("east", "west"). Ellipses are drawn red (roof rim), orange (valance bottom), cyan
(platform top), blue (platform bottom); apex rays every 15 degrees in green; the column box in magenta. --src lays the
models over another image of the same park region box instead (a plate check, a capture).
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
F = 2.5
args = sys.argv[1:]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
zoom, src = float(opt("--zoom", 2)), opt("--src", None)
name, out = args[0], args[1]
g = json.load(open("rides/carousel/geom.json"))[name]
x0, y0, x1, y1 = g["box"]
if src:
    im = Image.open(src).convert("RGB").resize((round((x1 - x0) * F), round((y1 - y0) * F)), Image.LANCZOS)
else:
    im = Image.open("gen/park/world_v2_hd.png").convert("RGB").crop((round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F)))
im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
s = F * zoom
P = lambda x, y: ((x - x0) * s, (y - y0) * s)


def ell(e, phi):
    cx, cy, a, b = e["c"][0], e["c"][1], e["a"], e["b"]
    r = math.radians(e.get("rot", 0))
    u, v = a * math.cos(phi), b * math.sin(phi)
    return cx + u * math.cos(r) - v * math.sin(r), cy + u * math.sin(r) + v * math.cos(r)


def draw_ell(e, col, front_only=False):
    pts = [P(*ell(e, math.radians(k))) for k in range(0 if front_only else -180, 181 if front_only else 181, 2)]
    d.line(pts, fill=col, width=2)


for key, col in (("rim", (255, 40, 40, 220)), ("val", (255, 150, 0, 220)), ("top", (0, 220, 255, 220)), ("bot", (40, 80, 255, 220))):
    if key in g:
        draw_ell(g[key], col)
ax, ay = g["apex"]
for k in range(0, 360, 15):
    ex, ey = ell(g["rim"], math.radians(k))
    if math.sin(math.radians(k)) > -0.6:
        d.line([P(ax, ay), P(ex, ey)], fill=(0, 200, 60, 140), width=1)
if "column" in g:
    cx0, cy0, cx1, cy1 = g["column"]
    d.rectangle([P(cx0, cy0), P(cx1, cy1)], outline=(255, 0, 255, 220), width=2)
for v in range(int(x0) - int(x0) % 10 + 10, int(x1), 10):
    X = (v - x0) * s
    d.line([(X, 0), (X, 6 if v % 50 else 14)], fill=(255, 0, 80, 255))
    if v % 50 == 0: d.text((X + 2, 2), str(v), fill=(200, 0, 60))
for v in range(int(y0) - int(y0) % 10 + 10, int(y1), 10):
    Y = (v - y0) * s
    d.line([(0, Y), (6 if v % 50 else 14, Y)], fill=(255, 0, 80, 255))
    if v % 50 == 0: d.text((2, Y + 2), str(v), fill=(200, 0, 60))
im.save(out)
print(out, im.size)
