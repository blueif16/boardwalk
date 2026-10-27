"""Merge the inventory pieces into the one file rides/lights loads: rides/lights/lights.json + masks.png.

  uv run -q --no-project --with pillow --with numpy python -I tests/night-lights/tools/merge.py

Pieces, in order (the first record of an id wins at a seam): tests/night-lights/lights_centre.json (tools/
build_lights.py), lights_west.json, lights_east.json (tools/build_we.py), and the street lights
(rides/streetlights/lights.json or tests/night-lights/lights_streetlights.json) when they exist. Every mask (mask,
post) is cut from its piece's atlas and repacked into one atlas, rows of 2048 px.
"""
import json, os
import numpy as np
from PIL import Image

R = "tests/night-lights"
PIECES = [f"{R}/lights_centre.json", f"{R}/lights_west.json", f"{R}/lights_east.json",
          "rides/streetlights/lights.json", f"{R}/lights_streetlights.json"]
OUT = "rides/lights"
W = 2048
# Fixes found on the night render: lamp_810's head box reaches up into the yellow sculpture behind it (y < 1197).
FIXES = {"lamp_810": {"clip_y0": 1197}}

lights, seen, cuts, used = [], set(), [], []
for p in PIECES:
    if not os.path.exists(p):
        continue
    inv = json.load(open(p))
    atlas = None
    if inv.get("atlas"):
        atlas = np.asarray(Image.open(os.path.join(os.path.dirname(p), inv["atlas"]["file"])).convert("L"))
    n = 0
    for L in inv["lights"]:
        if L["id"] in seen:
            continue
        seen.add(L["id"])
        L["piece"] = inv.get("piece", os.path.basename(p).split(".")[0])
        fix = FIXES.get(L["id"], {})
        for key in ("mask", "post"):
            if L.get(key) and atlas is not None:
                ax, ay, aw, ah = L[key]["atlas"]
                m = atlas[ay:ay + ah, ax:ax + aw].copy()
                if key == "mask" and "clip_y0" in fix:
                    rx, ry, rw, rh = L[key]["rect"]
                    k = max(0, round((fix["clip_y0"] - ry) * ah / rh))
                    m = m[k:]
                    L[key]["rect"] = [rx, round(ry + k * rh / ah, 2), rw, round(rh - k * rh / ah, 2)]
                cuts.append((L, key, m))
        if "clip_y0" in fix and L.get("globes"):
            L["globes"] = [g for g in L["globes"] if g[1] >= fix["clip_y0"]]
            if L["globes"]:
                w = sum(g[2] ** 2 for g in L["globes"])
                L["src"] = [round(sum(g[0] * g[2] ** 2 for g in L["globes"]) / w, 1), round(sum(g[1] * g[2] ** 2 for g in L["globes"]) / w, 1)]
        lights.append(L); n += 1
    used.append((p, n))

# Pack: tallest first, in rows.
order = sorted(range(len(cuts)), key=lambda i: -cuts[i][2].shape[0])
x = y = rowh = 0
place = {}
for i in order:
    h, w = cuts[i][2].shape
    if x + w + 2 > W:
        x, y, rowh = 0, y + rowh + 2, 0
    place[i] = (x, y); x += w + 2; rowh = max(rowh, h)
H = y + rowh + 2
A = np.zeros((H, W), np.uint8)
for i, (L, key, m) in enumerate(cuts):
    ax, ay = place[i]
    A[ay:ay + m.shape[0], ax:ax + m.shape[1]] = m
    L[key]["atlas"] = [ax, ay, m.shape[1], m.shape[0]]
os.makedirs(OUT, exist_ok=True)
Image.fromarray(A).save(f"{OUT}/masks.png", optimize=True)
counts = {}
for L in lights:
    counts[L["kind"]] = counts.get(L["kind"], 0) + (len(L["pts"]) if "pts" in L else 1)
json.dump({"about": "The park's light inventory, merged by tests/night-lights/tools/merge.py from " + ", ".join(f"{p} ({n})" for p, n in used)
           + ". Park px; mask.rect is where an atlas cut (masks.png, 2.5 px per park px) sits on the park.",
           "slice": [0, 0, 3840, 2560], "piece": "park", "atlas": {"file": "masks.png", "density": 2.5, "size": [W, H]},
           "counts": counts, "lights": lights}, open(f"{OUT}/lights.json", "w"), separators=(",", ":"))
print(used, len(lights), "lights", counts, (W, H))
