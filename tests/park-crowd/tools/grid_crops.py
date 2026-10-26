"""Gridded crops of the park painting for tracing by eye, in park px (the 3840 x 2560 frame).

  uv run -q --no-project --with pillow python -I tests/park-crowd/tools/grid_crops.py OUT_DIR X0,Y0,X1,Y1 [...] [--zoom 1.5]

Each crop gets a light line every 20 px and a labelled line every 100 px.
"""
import os, sys
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
args = [a for a in sys.argv[1:] if not a.startswith("--")]
zoom = float(sys.argv[sys.argv.index("--zoom") + 1]) if "--zoom" in sys.argv else 1.5
out, boxes = args[0], [tuple(int(v) for v in b.split(",")) for b in args[1:] if "," in b]
src = Image.open("site/park/world_3840.webp").convert("RGB")
os.makedirs(out, exist_ok=True)
for x0, y0, x1, y1 in boxes:
    im = src.crop((x0, y0, x1, y1)).resize((round((x1 - x0) * zoom), round((y1 - y0) * zoom)), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    for v in range(x0 - x0 % 20 + 20, x1, 20):
        X = (v - x0) * zoom
        d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 150 if v % 100 == 0 else 45), width=1)
        if v % 100 == 0:
            d.rectangle([X + 2, 2, X + 40, 16], fill=(255, 255, 255, 200)); d.text((X + 4, 3), str(v), fill=(200, 0, 60))
    for v in range(y0 - y0 % 20 + 20, y1, 20):
        Y = (v - y0) * zoom
        d.line([(0, Y), (im.width, Y)], fill=(255, 0, 80, 150 if v % 100 == 0 else 45), width=1)
        if v % 100 == 0:
            d.rectangle([2, Y + 2, 40, Y + 16], fill=(255, 255, 255, 200)); d.text((4, Y + 3), str(v), fill=(200, 0, 60))
    im.save(os.path.join(out, f"g_{x0}_{y0}.png"))
    print(os.path.join(out, f"g_{x0}_{y0}.png"))
