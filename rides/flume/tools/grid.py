"""Gridded HD crops of the painting for tracing (park px): a line every 10 px, labelled every 50.

  uv run -q --no-project --with pillow python -I rides/flume/tools/grid.py OUT X0,Y0,X1,Y1 [ZOOM]
"""
import sys
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
out, box = sys.argv[1], [int(v) for v in sys.argv[2].split(",")]
z = float(sys.argv[3]) if len(sys.argv) > 3 else 4
x0, y0, x1, y1 = box
with Image.open("gen/park/world_v2_hd.png") as im:
    c = im.convert("RGB").crop((int(x0 * 2.5), int(y0 * 2.5), int(x1 * 2.5), int(y1 * 2.5))).resize((int((x1 - x0) * z), int((y1 - y0) * z)), Image.LANCZOS)
d = ImageDraw.Draw(c, "RGBA")
for v in range(x0 - x0 % 10 + 10, x1, 10):
    X = (v - x0) * z
    d.line([(X, 0), (X, c.height)], fill=(255, 0, 80, 140 if v % 50 == 0 else 40))
    if v % 50 == 0:
        d.rectangle([X + 1, 1, X + 30, 13], fill=(255, 255, 255, 210)); d.text((X + 3, 2), str(v), fill=(200, 0, 60))
for v in range(y0 - y0 % 10 + 10, y1, 10):
    Y = (v - y0) * z
    d.line([(0, Y), (c.width, Y)], fill=(255, 0, 80, 140 if v % 50 == 0 else 40))
    if v % 50 == 0:
        d.rectangle([1, Y + 1, 30, Y + 13], fill=(255, 255, 255, 210)); d.text((3, Y + 2), str(v), fill=(200, 0, 60))
c.save(out)
