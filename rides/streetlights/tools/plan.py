"""Plan board: the street (painting + traffic patches) with the traffic lanes, stalls, crosswalks and front cut-outs
drawn over it, plus the chosen pole positions (positions.json). py plan.py OUT_PREFIX"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from base import base_crop, ROOT

lanes = json.load(open(os.path.join(ROOT, "rides/traffic/lanes.json")))
occ = json.load(open(os.path.join(ROOT, "rides/traffic/occ.json")))
posf = os.path.join(ROOT, "rides/streetlights/positions.json")
poles = json.load(open(posf))["poles"] if os.path.exists(posf) else []
S = 0.75
for name, (x0, x1) in {"west": (0, 1300), "mid": (1200, 2500), "east": (2400, 3500)}.items():
    y0, y1 = 500, 1080
    im = Image.fromarray(base_crop([x0, y0, x1, y1])).resize((round((x1 - x0) * S), round((y1 - y0) * S)), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    P = lambda x, y: ((x - x0) * S, (y - y0) * S)
    for gx in range(x0 - x0 % 100 + 100, x1, 100):
        d.line([P(gx, y0), P(gx, y1)], fill=(255, 0, 80, 60)); d.text(P(gx + 2, y0 + 2), str(gx), fill=(255, 0, 80, 255))
    for gy in range(600, y1, 100):
        d.line([P(x0, gy), P(x1, gy)], fill=(0, 60, 255, 60)); d.text(P(x0 + 2, gy + 2), str(gy), fill=(0, 60, 255, 255))
    loop = lanes["loop"]
    d.line([P(*p) for p in loop[::4]], fill=(255, 140, 0, 200), width=2)
    for k, c in {"north": (0, 200, 255), "median": (0, 255, 0), "kerb": (255, 0, 255)}.items():
        d.line([P(*p) for p in lanes["lines"][k]], fill=c + (200,), width=1)
    for st in lanes["stalls"]:
        d.line([P(*p) for p in st["path"][::3]], fill=(255, 255, 0, 220), width=3)
    for cw in lanes["crosswalks"]:
        d.line([P(*cw["walk"][0]), P(*cw["walk"][1])], fill=(255, 0, 0, 220), width=4)
    for pc in occ["pieces"]:
        x, y, w, h = pc["at"]
        d.rectangle([P(x, y), P(x + w, y + h)], outline=(120, 0, 200, 120))
        d.line([P(x, pc["sortY"]), P(x + w, pc["sortY"])], fill=(120, 0, 200, 200), width=1)
    for p in poles:
        fx, fy = p["foot"]; hx, hy = p["head"]
        col = (255, 0, 0, 255) if p["side"] == "south" else (0, 0, 255, 255)
        d.line([P(fx, fy), P(fx, hy - 4)], fill=col, width=2)
        d.line([P(fx, hy - 4), P(hx, hy)], fill=col, width=2)
        d.ellipse([P(fx - 3, fy - 2), P(fx + 3, fy + 2)], outline=col)
        d.text(P(fx + 4, fy - 14), p["id"].split("_")[-1], fill=col)
    im.save(f"{sys.argv[1]}_{name}.png")
    print(f"{sys.argv[1]}_{name}.png", im.size)
