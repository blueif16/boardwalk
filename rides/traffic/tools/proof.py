"""Proof sheet: a car composited on the painting (with the erase patches) at given loop positions, with the front
cut-outs drawn over it exactly as the layer sorts them. For checking spots by eye without running the page.

  uv run -q --no-project --with pillow --with numpy python -I rides/traffic/tools/proof.py OUT.png S [S ...] [--car van]

Each S is a loop index (park px of arc). Tiles are 260 x 150 park px around the car, shown 2x.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
car = sys.argv[sys.argv.index("--car") + 1] if "--car" in sys.argv else "hatchback"
out, ss = args[0], [int(v) for v in args[1:] if v.lstrip("-").isdigit()]
lanes = json.load(open(os.path.join(RIDE, "lanes.json")))
sheet = json.load(open(os.path.join(RIDE, "sprites.json")))
atlas = Image.open(os.path.join(RIDE, "gen/sprites.png")).convert("RGBA")
occ = json.load(open(os.path.join(RIDE, "occ.json")))
oim = Image.open(os.path.join(RIDE, "occ.webp")).convert("RGBA")
park = json.load(open(os.path.join(ROOT, "tests/park-crowd/park.json")))
yaw, pitch = math.radians(park["camera"]["yawDeg"]), math.radians(park["camera"]["pitchDeg"])
ex = (math.cos(yaw), math.sin(pitch) * math.sin(yaw)); ez = (-math.sin(yaw), math.sin(pitch) * math.cos(yaw))
det = ex[0] * ez[1] - ez[0] * ex[1]
S = 2  # output px per park px
base = Image.open(os.path.join(ROOT, "site/park/world_5120.webp")).convert("RGBA")
base = base.resize((3840 * S, 2560 * S), Image.LANCZOS)
for p in json.load(open(os.path.join(RIDE, "patches.json"))):
    x, y, w, h = p["rect"]
    im = Image.open(os.path.join(RIDE, p["file"])).convert("RGBA").resize((round(w * S), round(h * S)), Image.LANCZOS)
    base.alpha_composite(im, (round(x * S), round(y * S)))
loop = lanes["loop"]
tiles = []
for s in ss:
    x, y = loop[s]
    p0, p1 = loop[max(0, s - 4)], loop[min(len(loop) - 1, s + 4)]
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    th = math.atan2((ex[0] * dy - dx * ex[1]) / det, (dx * ez[1] - ez[0] * dy) / det)
    k = round(th / (2 * math.pi) * sheet["headings"]) % sheet["headings"]
    f = sheet["cars"][car][f"h{k}"]
    fx, fy, fw, fh = f["rect"]; ax, ay = f["anchor"]; D = sheet["density"]
    box = (round((x - 130) * S), round((y - 90) * S), round((x + 130) * S), round((y + 60) * S))
    t = base.crop(box)
    spr = atlas.crop((fx, fy, fx + fw, fy + fh)).resize((round(fw / D * S), round(fh / D * S)), Image.LANCZOS)
    t.alpha_composite(spr, (round((x - ax / D) * S) - box[0], round((y - ay / D) * S) - box[1]))
    for pc in occ["pieces"]:
        if pc["sortY"] <= y:
            continue
        px, py, pw, ph = pc["at"]
        if px > x + 130 or px + pw < x - 130 or py > y + 60 or py + ph < y - 90:
            continue
        sx, sy, sw, sh = pc["rect"]
        piece = oim.crop((sx, sy, sx + sw, sy + sh)).resize((max(1, round(pw * S)), max(1, round(ph * S))), Image.LANCZOS)
        layer = Image.new("RGBA", t.size, (0, 0, 0, 0))
        layer.paste(piece, (round(px * S) - box[0], round(py * S) - box[1]))
        t.alpha_composite(layer)
    ImageDraw.Draw(t).text((4, 4), f"s {s} ({x:.0f}, {y:.0f}) h{k}", fill=(200, 0, 60, 255))
    tiles.append(t)
cols = 3
W, H = tiles[0].width, tiles[0].height
sheet_img = Image.new("RGBA", (cols * (W + 6), ((len(tiles) + cols - 1) // cols) * (H + 6)), "white")
for i, t in enumerate(tiles):
    sheet_img.paste(t, ((i % cols) * (W + 6), (i // cols) * (H + 6)))
sheet_img.save(out)
print(out, len(tiles), "tiles")
