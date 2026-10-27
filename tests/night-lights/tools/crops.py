"""Gridded crops of the HD painting (gen/park/world_v2_hd.png, 2.5 px per park px) labelled in park px.

  uv run -q --no-project --with pillow python -I tests/night-lights/tools/crops.py OUT_DIR X0,Y0,X1,Y1 [...]
      [--zoom Z] [--grid 10] [--marks lights.json]

Z is screen px per park px (default 2.5 = the HD painting's own pixels). A light line every --grid park px and a
labelled line every 50. With --marks, every light in lights.json is drawn as a ring (colour by kind) with its id.
"""
import json, os, sys
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
argv = sys.argv[1:]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
zoom = float(opt("--zoom", 2.5))
grid = int(opt("--grid", 10))
marks = opt("--marks", None)
args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or not argv[i - 1].startswith("--"))]
out, boxes = args[0], [tuple(int(v) for v in b.split(",")) for b in args[1:] if "," in b]
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
K = 2.5
COL = {"lamp": (255, 40, 40), "globe": (255, 40, 40), "window": (0, 160, 255), "bulbs": (255, 0, 255), "sign": (0, 200, 80),
       "street": (255, 140, 0), "door": (0, 220, 220)}
lights = json.load(open(marks))["lights"] if marks else []
os.makedirs(out, exist_ok=True)
for x0, y0, x1, y1 in boxes:
    im = src.crop((round(x0 * K), round(y0 * K), round(x1 * K), round(y1 * K)))
    im = im.resize((round((x1 - x0) * zoom), round((y1 - y0) * zoom)), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    for v in range(x0 - x0 % grid + grid, x1, grid):
        X = (v - x0) * zoom
        d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 140 if v % 50 == 0 else 35), width=1)
        if v % 50 == 0:
            d.rectangle([X + 2, 2, X + 34, 14], fill=(255, 255, 255, 210)); d.text((X + 3, 2), str(v), fill=(200, 0, 60))
    for v in range(y0 - y0 % grid + grid, y1, grid):
        Y = (v - y0) * zoom
        d.line([(0, Y), (im.width, Y)], fill=(255, 0, 80, 140 if v % 50 == 0 else 35), width=1)
        if v % 50 == 0:
            d.rectangle([2, Y + 2, 34, Y + 14], fill=(255, 255, 255, 210)); d.text((3, Y + 2), str(v), fill=(200, 0, 60))
    for L in lights:
        pts = L.get("pts") or [L["xy"]]
        c = COL.get(L["kind"], (255, 255, 0))
        for (px, py) in pts:
            X, Y = (px - x0) * zoom, (py - y0) * zoom
            if -20 < X < im.width + 20 and -20 < Y < im.height + 20:
                r = max(3, L.get("r", 2) * zoom)
                d.ellipse([X - r, Y - r, X + r, Y + r], outline=c + (230,), width=2)
        if "rect" in L:
            rx, ry, rw, rh = L["rect"]
            d.rectangle([(rx - x0) * zoom, (ry - y0) * zoom, (rx + rw - x0) * zoom, (ry + rh - y0) * zoom], outline=c + (230,), width=2)
        if "poly" in L:
            d.polygon([((px - x0) * zoom, (py - y0) * zoom) for px, py in L["poly"]], outline=c + (230,))
        px, py = pts[0] if pts else L["rect"][:2]
        X, Y = (px - x0) * zoom, (py - y0) * zoom
        if 0 <= X < im.width and 0 <= Y < im.height:
            d.text((X + 6, Y - 12), str(L["id"]), fill=c + (255,))
    p = os.path.join(out, f"c_{x0}_{y0}.png")
    im.save(p)
    print(p)
