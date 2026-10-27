"""Cut the generated pattern sheet (gen/textures_v1_0.png: seven bands separated by white gaps) into one texture
atlas for the 3D cups and teapot: textures.webp (1024 x 2048, eight 1024 x 256 slots, band k in slot k) + textures.json.

  uv run -q --no-project --with pillow --with numpy python -I rides/teacups/tools/build_textures.py [--repeat 0.45]

Each slot holds the band's first `repeat` of its width, so a cup's circumference shows about five repeats of the
pattern instead of eleven: bigger, bolder shapes at the size the ride is seen. The wrap's seam is placed under the
cup's handle, so the band need not tile.
"""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
repeat = float(sys.argv[sys.argv.index("--repeat") + 1]) if "--repeat" in sys.argv else 0.45
im = Image.open(os.path.join(RIDE, "gen/textures_v1_0.png")).convert("RGB")
a = np.asarray(im).astype(float)
W, H = im.size
# A row belongs to a gap when nearly all of it is near-white.
white = ((a.min(-1) > 236) & (a.max(-1) - a.min(-1) < 14)).mean(1) > 0.97
bands, y = [], 0
while y < H:
    if white[y]:
        y += 1; continue
    y0 = y
    while y < H and not white[y]: y += 1
    if y - y0 > H * 0.06: bands.append((y0, y))
print("bands (rows):", bands)
assert len(bands) == 7, f"expected 7 bands, found {len(bands)}"
SW, SH = 1024, 256
atlas = Image.new("RGB", (SW, SH * 8), (250, 244, 232))
names = ["pink_dots", "yellow_daisies", "blue_stars", "mint_stripes", "lavender_hearts", "peach_scallops", "cream_flowers"]
meta = {"size": [SW, SH * 8], "slots": {}}
for k, (y0, y1) in enumerate(bands):
    band = im.crop((0, y0 + 2, round(W * repeat), y1 - 2)).resize((SW, SH), Image.LANCZOS)
    atlas.paste(band, (0, k * SH))
    meta["slots"][names[k]] = {"v0": k * SH / (SH * 8), "v1": (k + 1) * SH / (SH * 8)}
atlas.save(os.path.join(RIDE, "textures.webp"), quality=92)
json.dump(meta, open(os.path.join(RIDE, "textures.json"), "w"), indent=1)
print("textures.webp", atlas.size, os.path.getsize(os.path.join(RIDE, "textures.webp")) // 1024, "KB")
