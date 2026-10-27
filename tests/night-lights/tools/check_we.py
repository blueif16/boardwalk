"""Draw lights_<piece>.json over the day painting (tools/check.py's look): masks filled by kind, polygons, pools as ground
ellipses, labels. args: PIECE OUT.png X0,Y0,X1,Y1 ZOOM [--tile W] [--winlabels]"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
ROOT = "tests/night-lights"
piece, out = sys.argv[1], sys.argv[2]
X0, Y0, X1, Y1 = map(int, sys.argv[3].split(",")); zoom = float(sys.argv[4])
tile = int(sys.argv[sys.argv.index("--tile") + 1]) if "--tile" in sys.argv else X1 - X0
winlab = "--winlabels" in sys.argv
inv = json.load(open(f"{ROOT}/lights_{piece}.json"))
K = 2.5
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
atlas = Image.open(f"{ROOT}/{inv['atlas']['file']}").convert("L")
COL = {"lamp": (255, 60, 60), "window": (0, 170, 255), "stall": (255, 150, 0), "spill": (255, 200, 0), "sign": (0, 220, 120),
       "door": (0, 220, 220), "lantern": (255, 0, 200), "flood": (200, 255, 0), "bulbs": (255, 0, 255)}
yaw, pitch = math.radians(24.1), math.radians(28.7)
ex = (math.cos(yaw), math.sin(pitch) * math.sin(yaw)); ez = (-math.sin(yaw), math.sin(pitch) * math.cos(yaw))
outs = []
for tx in range(X0, X1, tile):
    x0, y0, x1, y1 = tx, Y0, min(X1, tx + tile), Y1
    P = lambda x, y: ((x - x0) * zoom, (y - y0) * zoom)
    im = src.crop((round(x0 * K), round(y0 * K), round(x1 * K), round(y1 * K))).resize((round((x1 - x0) * zoom), round((y1 - y0) * zoom)), Image.LANCZOS)
    im = Image.blend(im, Image.new("RGB", im.size, (30, 30, 50)), 0.35).convert("RGBA")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for L in inv["lights"]:
        c = COL.get(L["kind"], (255, 255, 255))
        for key in ("mask", "post"):
            if L.get(key):
                ax, ay, aw, ah = L[key]["atlas"]; rx, ry, rw, rh = L[key]["rect"]
                m = atlas.crop((ax, ay, ax + aw, ay + ah)).resize((max(1, round(rw * zoom)), max(1, round(rh * zoom))))
                cc = c if key == "mask" else (90, 140, 255)
                t = Image.new("RGBA", m.size, cc + (0,)); t.putalpha(m.point(lambda v: v * 0.8))
                ov.alpha_composite(t, (round((rx - x0) * zoom), round((ry - y0) * zoom)))
        if "poly" in L:
            d.polygon([P(*p) for p in L["poly"]], outline=c + (255,), fill=c + (80,))
        if "pool" in L:
            cx, cy = L["pool"]["c"]; r = L["pool"]["r"]
            pts = [P(cx + r * (math.cos(t) * ex[0] + math.sin(t) * ez[0]), cy + r * (math.cos(t) * ex[1] + math.sin(t) * ez[1])) for t in np.linspace(0, 2 * math.pi, 40)]
            d.line(pts + [pts[0]], fill=c + (200,), width=1)
        if L["kind"] == "lamp":
            for gx, gy, gr in L["globes"]:
                X, Y = P(gx, gy); d.ellipse([X - gr * zoom, Y - gr * zoom, X + gr * zoom, Y + gr * zoom], outline=(255, 255, 255, 230))
    im.alpha_composite(ov); d = ImageDraw.Draw(im)
    for i, L in enumerate(inv["lights"]):
        if L["kind"] == "window" and not winlab:
            continue
        p = L.get("src") or L.get("ground") or L["poly"][0]
        X, Y = P(*p)
        if 0 <= X < im.width and 0 <= Y < im.height:
            lab = str(i) if L["kind"] == "window" else L["id"]
            d.text((X + 4, Y - 11), lab, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for v in range(x0 - x0 % 100 + 100, x1, 100):
        d.text(((v - x0) * zoom + 2, 2), str(v), fill=(255, 255, 0, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for v in range(y0 - y0 % 100 + 100, y1, 100):
        d.text((2, (v - y0) * zoom + 2), str(v), fill=(255, 255, 0, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    outs.append(im.convert("RGB"))
if len(outs) == 1:
    outs[0].save(out); print(out, outs[0].size)
else:
    for k, o in enumerate(outs):
        p = out.replace(".png", f"_{k}.png"); o.save(p); print(p, o.size)
