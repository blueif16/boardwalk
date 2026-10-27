"""Draw lights.json over the day painting for checking by eye: masks filled by kind, polygons outlined, bulbs as dots,
pools as ground ellipses, ids beside them.

  uv run -q --no-project --with pillow --with numpy python -I tests/night-lights/tools/check.py OUT.png [X0,Y0,X1,Y1] [--zoom 2]
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = "tests/night-lights"
argv = sys.argv[1:]
zoom = float(argv[argv.index("--zoom") + 1]) if "--zoom" in argv else 2
pos = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--zoom")]
out = pos[0]
inv = json.load(open(f"{ROOT}/lights.json"))
x0, y0, x1, y1 = (int(v) for v in pos[1].split(",")) if len(pos) > 1 else inv["slice"]
K = 2.5
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
im = src.crop((round(x0 * K), round(y0 * K), round(x1 * K), round(y1 * K))).resize((round((x1 - x0) * zoom), round((y1 - y0) * zoom)), Image.LANCZOS)
im = Image.blend(im, Image.new("RGB", im.size, (30, 30, 50)), 0.35).convert("RGBA")
atlas = Image.open(f"{ROOT}/masks.png").convert("L")
COL = {"lamp": (255, 60, 60), "window": (0, 170, 255), "stall": (255, 150, 0), "spill": (255, 200, 0), "sign": (0, 220, 120),
       "door": (0, 220, 220), "lantern": (255, 0, 200), "flood": (200, 255, 0), "bulbs": (255, 0, 255)}
P = lambda x, y: ((x - x0) * zoom, (y - y0) * zoom)
yaw, pitch = math.radians(24.1), math.radians(28.7)
ex = (math.cos(yaw), math.sin(pitch) * math.sin(yaw)); ez = (-math.sin(yaw), math.sin(pitch) * math.cos(yaw))
ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
for L in inv["lights"]:
    c = COL.get(L["kind"], (255, 255, 255))
    if "mask" in L:
        ax, ay, aw, ah = L["mask"]["atlas"]
        rx, ry, rw, rh = L["mask"]["rect"]
        m = atlas.crop((ax, ay, ax + aw, ay + ah)).resize((max(1, round(rw * zoom)), max(1, round(rh * zoom))))
        tile = Image.new("RGBA", m.size, c + (0,))
        tile.putalpha(m.point(lambda v: v * 0.75))
        ov.alpha_composite(tile, (round((rx - x0) * zoom), round((ry - y0) * zoom)))
    if "poly" in L:
        d.polygon([P(*p) for p in L["poly"]], outline=c + (255,), fill=c + (70,))
    if "pts" in L:
        for p in L["pts"]:
            X, Y = P(*p); d.ellipse([X - 1.5, Y - 1.5, X + 1.5, Y + 1.5], fill=c + (255,))
    if "pool" in L:
        cx, cy = L["pool"]["c"]; r = L["pool"]["r"]
        pts = [P(cx + r * (math.cos(t) * ex[0] + math.sin(t) * ez[0]), cy + r * (math.cos(t) * ex[1] + math.sin(t) * ez[1])) for t in np.linspace(0, 2 * math.pi, 40)]
        d.line(pts + [pts[0]], fill=c + (200,), width=1)
    if "flood" in L:
        f = L["flood"]; X, Y = P(*f["c"])
        d.ellipse([X - f["rx"] * zoom, Y - f["ry"] * zoom, X + f["rx"] * zoom, Y + f["ry"] * zoom], outline=c + (220,))
    if "halo" in L and "src" in L:
        X, Y = P(*L["src"]); r = L["halo"] * zoom
        d.ellipse([X - r, Y - r, X + r, Y + r], outline=c + (160,))
im.alpha_composite(ov)
d = ImageDraw.Draw(im)
for L in inv["lights"]:
    if L["kind"] in ("window", "bulbs"):
        continue
    p = L.get("src") or L.get("ground") or L["poly"][0]
    X, Y = P(*p)
    d.text((X + 5, Y - 12), L["id"], fill=(255, 255, 255, 255))
im.convert("RGB").save(out)
print(out, im.size)
