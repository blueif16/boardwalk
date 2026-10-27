"""A gridded close-up (park px grid, labels every 5) of a 4K take of geom.json's region.

  uv run -q --no-project --with pillow python -I rides/swings/tools/zoom_grid.py TAKE.png X0 Y0 X1 Y1 OUT.png [ZOOM]
"""
import sys
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from geom import G  # noqa: E402
RX0, RY0, RX1, _ = G["region"]
take, out = sys.argv[1], sys.argv[6]
x0, y0, x1, y1 = (float(v) for v in sys.argv[2:6])
z = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
im = Image.open(take).convert("RGB")
S = im.width / (RX1 - RX0)
c = im.crop((round((x0 - RX0) * S), round((y0 - RY0) * S), round((x1 - RX0) * S), round((y1 - RY0) * S)))
c = c.resize((round(c.width * z), round(c.height * z)), Image.LANCZOS)
d = ImageDraw.Draw(c)
s = S * z
for v in range(int(x0), int(x1) + 1):
    X = (v - x0) * s
    d.line([(X, 0), (X, c.height)], fill=(255, 0, 80) if v % 5 == 0 else (255, 170, 200), width=1)
    if v % 5 == 0:
        d.text((X + 2, 2), str(v), fill=(200, 0, 60))
for v in range(int(y0), int(y1) + 1):
    Y = (v - y0) * s
    d.line([(0, Y), (c.width, Y)], fill=(255, 0, 80) if v % 5 == 0 else (255, 170, 200), width=1)
    if v % 5 == 0:
        d.text((2, Y + 2), str(v), fill=(200, 0, 60))
c.save(out)
print(out, c.size)
