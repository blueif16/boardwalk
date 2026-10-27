"""Gridded crop of the base (painting + traffic patches): park-px grid lines every STEP with labels.
  py gridcrop.py X0 Y0 X1 Y1 OUT.png [SCALE park->out px, default 1] [STEP 50]"""
import sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__file__))
from base import base_crop

x0, y0, x1, y1 = [float(v) for v in sys.argv[1:5]]
out = sys.argv[5]
s = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
step = int(sys.argv[7]) if len(sys.argv) > 7 else 50
im = Image.fromarray(base_crop([x0, y0, x1, y1]))
im = im.resize((round((x1 - x0) * s), round((y1 - y0) * s)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
for gx in range(int(np.ceil(x0 / step) * step), int(x1), step):
    X = (gx - x0) * s
    major = gx % (step * 2) == 0
    d.line([(X, 0), (X, im.height)], fill=(255, 0, 80, 110 if major else 50), width=1)
    if major:
        d.text((X + 2, 2), str(gx), fill=(255, 0, 80, 255))
for gy in range(int(np.ceil(y0 / step) * step), int(y1), step):
    Y = (gy - y0) * s
    major = gy % (step * 2) == 0
    d.line([(0, Y), (im.width, Y)], fill=(0, 60, 255, 110 if major else 50), width=1)
    if major:
        d.text((2, Y + 2), str(gy), fill=(0, 60, 255, 255))
im.save(out)
print(out, im.size)
