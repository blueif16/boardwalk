"""Tiles of the HD painting with detector windows outlined and numbered. args: WIN.json OUTPREFIX TILE_W ZOOM [X0,Y0,X1,Y1]"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS = None
K = 2.5
wj, pre, tw, zoom = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
d = json.load(open(wj)); bx0, by0, bx1, by1 = d["box"]
if len(sys.argv) > 5: bx0, by0, bx1, by1 = map(int, sys.argv[5].split(","))
ids = np.load(wj.replace(".json", "_mask_ids.npy"))
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")
ox, oy = d["box"][:2]
for tx in range(bx0, bx1, tw):
    x0, x1 = tx, min(bx1, tx + tw)
    im = src.crop((round(x0*K), round(by0*K), round(x1*K), round(by1*K)))
    sub = ids[round((by0-oy)*K):round((by1-oy)*K), round((x0-ox)*K):round((x1-ox)*K)]
    a = np.asarray(im).copy()
    e = (sub > 0) & ~ndi.binary_erosion(sub > 0, iterations=2)
    a[e[:a.shape[0], :a.shape[1]]] = [255, 0, 255]
    im = Image.fromarray(a).resize((round((x1-x0)*zoom), round((by1-by0)*zoom)), Image.LANCZOS)
    dd = ImageDraw.Draw(im)
    for w in d["windows"]:
        cx, cy = w["c"]
        if x0 <= cx < x1 and by0 <= cy < by1:
            X, Y = (cx-x0)*zoom, (cy-by0)*zoom
            dd.text((X+4, Y-12), w["id"][1:], fill=(255, 255, 255), stroke_width=2, stroke_fill=(200, 0, 120))
    for v in range(x0 - x0 % 50 + 50, x1, 50):
        dd.text(((v-x0)*zoom+2, 2), str(v), fill=(0, 0, 0), stroke_width=2, stroke_fill=(255, 255, 255))
    for v in range(by0 - by0 % 50 + 50, by1, 50):
        dd.text((2, (v-by0)*zoom+2), str(v), fill=(0, 0, 0), stroke_width=2, stroke_fill=(255, 255, 255))
    p = f"{pre}_{x0}.png"; im.save(p); print(p, im.size)
