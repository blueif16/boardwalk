"""Find the painted globe lamps (yellow globe clusters on a blue post) on the HD painting.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I tests/night-lights/tools/detect_lamps.py \
      OUT.json [X0,Y0,X1,Y1] [--sheet SHEET.png]

Box in park px (default: the whole park). For each lamp: the head (centre of its globes), every globe (centre and
radius), the post's foot on the ground (where the pool of light lands), the post's length and a score. With --sheet,
a contact sheet with one thumbnail per detection, for checking by eye.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
K = 2.5  # HD px per park px
argv = sys.argv[1:]
sheet = argv[argv.index("--sheet") + 1] if "--sheet" in argv else None
pos = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--sheet")]
out = pos[0]
box = tuple(int(v) for v in pos[1].split(",")) if len(pos) > 1 else (0, 0, 3840, 2560)
src = Image.open("gen/park/world_v2_hd.png").convert("RGB")


def hsv(a):
    a = a.astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = (mx - mn) / np.maximum(mx, 1e-6)
    return h, s, mx


lamps = []
BAND = 400  # park px per band, with 150 px of overlap below for the posts
x0, y0, x1, y1 = box
for by in range(y0, y1, BAND):
    ty0, ty1 = by, min(y1, by + BAND)
    crop = np.asarray(src.crop((round(x0 * K), round(ty0 * K), round(x1 * K), round(min(2560, ty1 + 150) * K))))
    h, s, v = hsv(crop)
    yel = (h > 38) & (h < 62) & (s > 0.42) & (v > 0.85)
    blue = (h > 185) & (h < 218) & (s > 0.35) & (v > 0.45) & (v < 0.93)
    yel = ndi.binary_opening(yel, np.ones((2, 2)))
    lab, n = ndi.label(yel, np.ones((3, 3)))
    if n == 0:
        continue
    idx = np.arange(1, n + 1)
    area = ndi.sum(np.ones_like(lab), lab, idx)
    com = np.array(ndi.center_of_mass(np.ones_like(lab), lab, idx))
    objs = ndi.find_objects(lab)
    keep = [(i, area[i], com[i], objs[i]) for i in range(n) if 12 <= area[i] <= 2500]
    # Globes of one lamp: yellow blobs within 22 park px of each other (single linkage).
    pts = np.array([c for _, _, c, _ in keep]) if keep else np.zeros((0, 2))
    parent = list(range(len(keep)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for i in range(len(keep)):
        for j in range(i + 1, len(keep)):
            if np.hypot(*(pts[i] - pts[j])) < 22 * K:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(len(keep)):
        groups.setdefault(find(i), []).append(keep[i])
    for g in groups.values():
        tot = sum(a for _, a, _, _ in g)
        if tot < 80:
            continue
        cy = sum(c[0] * a for _, a, c, _ in g) / tot
        cx = sum(c[1] * a for _, a, c, _ in g) / tot
        ys0 = min(o[0].start for *_, o in g); ys1 = max(o[0].stop for *_, o in g)
        xs0 = min(o[1].start for *_, o in g); xs1 = max(o[1].stop for *_, o in g)
        if ty0 + cy / K >= ty1:  # belongs to the next band
            continue
        # The post: a run of blue rows under the head's centre.
        c0, c1 = int(cx - 7 * K), int(cx + 7 * K)
        r0 = int(cy)
        rows = blue[r0: min(blue.shape[0], ys1 + int(110 * K)), max(0, c0): c1]
        frac = rows.sum(1)
        run, best, last, gap = 0, 0, None, 0
        for k, f in enumerate(frac):
            if 2 <= f <= 16 * K * 2:
                run += 1; gap = 0; last = k
                best = max(best, run)
            else:
                gap += 1
                if gap > 6 and run > 0 and last is not None and k - last > 6:
                    if best >= 20 * K:
                        break
                    run = 0
        if best < 20 * K or last is None:
            continue
        # The foot: the lowest blue row of the run (the base), the base's centre column.
        foot_r = r0 + last
        brow = blue[max(0, foot_r - int(6 * K)): foot_r + 1, max(0, c0 - int(6 * K)): c1 + int(6 * K)]
        cols = np.nonzero(brow.any(0))[0]
        fx = (max(0, c0 - int(6 * K)) + (cols.mean() if len(cols) else (c1 - c0) / 2)) if len(cols) else cx
        globes = [[round(x0 + c[1] / K, 1), round(ty0 + c[0] / K, 1), round(float(np.sqrt(a / np.pi) / K), 1)] for _, a, c, _ in g]
        lamps.append({
            "head": [round(x0 + cx / K, 1), round(ty0 + cy / K, 1)],
            "bbox": [round(x0 + xs0 / K), round(ty0 + ys0 / K), round((xs1 - xs0) / K), round((ys1 - ys0) / K)],
            "globes": sorted(globes, key=lambda q: q[1]),
            "foot": [round(x0 + fx / K, 1), round(ty0 + foot_r / K, 1)],
            "post": round(best / K, 1),
            "yellow": int(tot),
        })

# The same lamp seen from two bands: keep one.
lamps.sort(key=lambda L: (L["head"][0], L["head"][1]))
uniq = []
for L in lamps:
    if any(abs(L["head"][0] - u["head"][0]) < 10 and abs(L["head"][1] - u["head"][1]) < 10 for u in uniq):
        continue
    uniq.append(L)
for i, L in enumerate(uniq):
    L["id"] = f"lamp{i}"
json.dump({"about": "Painted globe lamps found by tools/detect_lamps.py, park px", "box": box, "lamps": uniq}, open(out, "w"), indent=1)
print(len(uniq), "lamps")

if sheet:
    T = 120
    cols = 10
    rows = (len(uniq) + cols - 1) // cols
    S = Image.new("RGB", (cols * T, rows * (T + 14)), "white")
    d = ImageDraw.Draw(S)
    for i, L in enumerate(uniq):
        hx, hy = L["head"]; fx, fy = L["foot"]
        cx, cy = (hx + fx) / 2, (hy + fy) / 2
        half = max(40, (fy - hy) / 2 + 20)
        im = src.crop((round((cx - half) * K), round((cy - half) * K), round((cx + half) * K), round((cy + half) * K))).resize((T, T))
        dd = ImageDraw.Draw(im)
        sc = T / (2 * half)
        for gx, gy, gr in L["globes"]:
            X, Y = (gx - cx + half) * sc, (gy - cy + half) * sc
            dd.ellipse([X - gr * sc, Y - gr * sc, X + gr * sc, Y + gr * sc], outline=(255, 0, 0))
        X, Y = (fx - cx + half) * sc, (fy - cy + half) * sc
        dd.line([X - 6, Y, X + 6, Y], fill=(255, 0, 255), width=2)
        S.paste(im, ((i % cols) * T, (i // cols) * (T + 14)))
        d.text(((i % cols) * T + 2, (i // cols) * (T + 14) + T), f"{i} {round(hx)},{round(hy)}", fill=(0, 0, 0))
    S.save(sheet)
