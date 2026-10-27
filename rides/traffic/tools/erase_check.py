"""Before/after tiles of every erase box, for checking the car-erase patches.

  uv run -q --no-project --with pillow python -I rides/traffic/tools/erase_check.py   -> rides/traffic/gen/erase/boxes_check.png
"""
import json, os
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
F = 2.5
hd = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGBA")
after = hd.copy()
for k in ("R1", "R2", "R3"):
    r = json.load(open(os.path.join(RIDE, f"patch_{k}.json")))["rect"]
    p = Image.open(os.path.join(RIDE, f"patch_{k}.webp")).convert("RGBA")
    x, y = round(r[0] * F), round(r[1] * F)
    base = after.crop((x, y, x + p.width, y + p.height)); base.alpha_composite(p); after.paste(base, (x, y))
tiles = []
for k in ("R1", "R2", "R3"):
    for b in json.load(open(os.path.join(RIDE, f"gen/erase/{k}.json")))["boxes"]:
        m = 22
        box = tuple(round(v * F) for v in (b[0] - m, b[1] - m, b[2] + m, b[3] + m))
        a, c = hd.crop(box), after.crop(box)
        t = Image.new("RGBA", (a.width * 2 + 6, a.height + 18), "white")
        t.paste(a, (0, 18)); t.paste(c, (a.width + 6, 18))
        ImageDraw.Draw(t).text((3, 3), f"{k} {b}", fill=(200, 0, 60, 255))
        tiles.append(t)
W = 1800
rows, row, x, h = [], [], 0, 0
for t in tiles:
    if x + t.width > W and row:
        rows.append((row, h)); row, x, h = [], 0, 0
    row.append(t); x += t.width + 8; h = max(h, t.height)
rows.append((row, h))
out = Image.new("RGBA", (W, sum(h + 8 for _, h in rows)), "white")
y = 0
for row, h in rows:
    x = 0
    for t in row:
        out.paste(t, (x, y)); x += t.width + 8
    y += h + 8
out.save(os.path.join(RIDE, "gen/erase/boxes_check.png"))
print(len(tiles), "boxes", out.size)
