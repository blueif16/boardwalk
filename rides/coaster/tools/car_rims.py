"""The rim of each car sprite: the row (sprite px from the frame's top) where the blue car body starts, so riders from
the crowd can sit inside an empty car (rides/RIDERS.md). Writes rides/coaster/rims.json and shots/rims_check.png.

  uv run -q --no-project --with pillow --with numpy python -I rides/coaster/tools/car_rims.py   (from the repo root)

A row belongs to the body when at least 45% of the frame's width is blue paint (b > r + 25 and b > g). The rim is the
first such row from the top, raised through the cream lip on top of the body, less 2 px for its outline.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
meta = json.load(open(os.path.join(HERE, "sprites.json")))
img = Image.open(os.path.join(HERE, "sprites.png")).convert("RGBA")
a = np.asarray(img).astype(int)
rims, check = {}, img.copy()
d = ImageDraw.Draw(check)
for name, f in meta["frames"].items():
    x, y, w, h = f["rect"]
    c = a[y:y + h, x:x + w]
    blue = (c[..., 2] > c[..., 0] + 25) & (c[..., 2] > c[..., 1]) & (c[..., 3] > 128)
    rows = np.where(blue.sum(1) >= 0.45 * w)[0]
    rim = int(rows[0]) if len(rows) else h // 2
    # Up through the cream lip that tops the body (a row mostly cream or blue), then 2 px for its outline.
    cream = (c[..., 0] > 205) & (c[..., 1] > 195) & (c[..., 2] > 170) & (c[..., 3] > 128)
    while rim > 0 and (cream[rim - 1] | blue[rim - 1]).sum() >= 0.5 * w:
        rim -= 1
    rim = max(0, rim - 2)
    rims[name] = rim
    d.line([(x, y + rim), (x + w, y + rim)], fill=(255, 0, 60, 255), width=1)
json.dump({"density": meta["density"], "rim": rims}, open(os.path.join(HERE, "rims.json"), "w"))
os.makedirs(os.path.join(HERE, "shots"), exist_ok=True)
check.resize((check.width * 2, check.height * 2), Image.NEAREST).save(os.path.join(HERE, "shots", "rims_check.png"))
print(rims)
