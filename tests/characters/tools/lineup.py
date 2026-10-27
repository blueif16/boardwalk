"""Lineup of every look in an atlas: one row per look, eight frames each, labelled.

  uv run -q --no-project --with pillow python -I tests/characters/tools/lineup.py [ATLAS_DIR] [OUT.png] [--only a,b] [--cols 2]
Defaults: tests/park-crowd -> tests/characters/shots/lineup_park.png. --cols splits the rows into side-by-side columns.
"""
import json, os, sys
from PIL import Image, ImageDraw

args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0] if args else "tests/park-crowd"
out = args[1] if len(args) > 1 else "tests/characters/shots/lineup_park.png"
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
ncol = int(sys.argv[sys.argv.index("--cols") + 1]) if "--cols" in sys.argv else 1
m = json.load(open(os.path.join(src, "atlas.json")))
at = Image.open(os.path.join(src, "atlas.png")).convert("RGBA")
looks = sorted({k.split("/")[0] for k in m["frames"] if k.endswith("/front_stand")})
if only:
    looks = [l for l in looks if l.split("~")[0] in only]
poses = ["front_stand", "front_walk0", "side_stand", "side_walk0", "back_stand", "front_act", "side_act", "back_act"]
sc = m["scale"]
cw, ch, lw = 32 * sc, 40 * sc, 120
per = -(-len(looks) // ncol)
W = (lw + cw * len(poses) + 20) * ncol
img = Image.new("RGBA", (W, ch * per), (246, 241, 234, 255))
d = ImageDraw.Draw(img)
for i, l in enumerate(looks):
    col, row = divmod(i, per)
    ox, oy = col * (lw + cw * len(poses) + 20), row * ch
    d.text((ox + 4, oy + ch // 2 - 6), l, fill=(60, 40, 40, 255))
    for c, p in enumerate(poses):
        f = m["frames"].get(f"{l}/{p}")
        if not f:
            continue
        x, y, w, h = f["rect"]
        img.alpha_composite(at.crop((x, y, x + w, y + h)), (ox + lw + c * cw + (cw - w) // 2, oy + ch - h - 2))
img.save(out)
print(f"{out}: {len(looks)} looks")
