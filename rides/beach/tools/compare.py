"""Painting | live comparison crops, stacked, for review (from full-window captures).

  uv run -q --no-project --with pillow python -I rides/beach/tools/compare.py PAINT.png LIVE.png OUT.png X0 Y0 X1 Y1 [--k 2] [--window 2560x1440]

X0..Y1 are park px. --window: the captures' window size (park px -> CSS px by the page's cover fit); --k enlarges.
"""
import sys
from PIL import Image, ImageDraw
args = sys.argv[1:]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
k, win = float(opt("--k", 2)), opt("--window", "3840x2560")
vw, vh = map(int, win.split("x"))
s = max(vw / 3840, vh / 2560); ox, oy = (vw - 3840 * s) / 2, (vh - 2560 * s) / 2
a, b, out = args[:3]; x0, y0, x1, y1 = map(float, args[3:7])
box = (round(x0 * s + ox), round(y0 * s + oy), round(x1 * s + ox), round(y1 * s + oy))
ims = [Image.open(p).convert("RGB").crop(box) for p in (a, b)]
ims = [im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) for im in ims]
W, H = ims[0].size
sheet = Image.new("RGB", (W, H * 2 + 6), "white")
for i, im in enumerate(ims):
    sheet.paste(im, (0, i * (H + 6)))
d = ImageDraw.Draw(sheet)
for i, label in enumerate(["painting", "live"]):
    d.rectangle([4, i * (H + 6) + 4, 70, i * (H + 6) + 20], fill="white"); d.text((8, i * (H + 6) + 6), label, fill="black")
sheet.save(out); print(out, sheet.size)
