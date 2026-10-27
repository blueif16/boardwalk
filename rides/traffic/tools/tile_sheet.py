"""Tiles rides/traffic/gen/probe/*.png (index.json) into labelled sheets, 18 tiles each, shown 2x:
rides/traffic/gen/probe/sheet_<k>.png. Each label: tile number, loop index, piece kind, and FRONT (the piece should
cover the car: its sortY is below the car's feet) or BEHIND.

  uv run -q --no-project --with pillow python -I rides/traffic/tools/tile_sheet.py
"""
import json, os
from PIL import Image, ImageDraw

RIDE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
idx = json.load(open(os.path.join(RIDE, "gen/probe/index.json")))
per, cols, S = 18, 3, 2
for k in range(0, len(idx), per):
    part = idx[k:k + per]
    tw, th = 260 * S, 150 * S + 22
    sheet = Image.new("RGB", (cols * (tw + 8), ((len(part) + cols - 1) // cols) * (th + 8)), "white")
    for j, t in enumerate(part):
        im = Image.open(t["file"]).convert("RGB").resize((260 * S, 150 * S), Image.LANCZOS)
        tile = Image.new("RGB", (tw, th), "white")
        tile.paste(im, (0, 22))
        rel = "FRONT" if t["sortY"] > t["at"][1] else "BEHIND"
        ImageDraw.Draw(tile).text((4, 4), f"#{k + j} s{t['s']} {t['kind']} piece {rel} (foot {t['sortY']} vs car {t['at'][1]})", fill=(200, 0, 60))
        sheet.paste(tile, ((j % cols) * (tw + 8), (j // cols) * (th + 8)))
    out = os.path.join(RIDE, f"gen/probe/sheet_{k // per}.png")
    sheet.save(out)
    print(out)
