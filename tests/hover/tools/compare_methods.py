"""Score the mask methods against the shipped masks and draw their outlines side by side.

  uv run --no-project --with numpy --with pillow --with scipy --with opencv-python-headless \
      python tests/hover/tools/compare_methods.py            # from the repo root

A key colour  shyfai painted the item flat magenta on a copy of the stage (gen/key_*.png)
B grabcut     OpenCV GrabCut on the stage, initialised with the item's box, 5 iterations
C polygon     the hand-traced polygon alone (stalls and benches)
D diff        stage vs clean plate, thresholded and hole-filled inside the box, no polygon
E shipped     D snapped to the hand polygon for stalls and benches, D inside a rough region for the rest
"""
import json, os
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
import build_masks as b

TEST = b.TEST
KEYS = {k: np.asarray(Image.open(os.path.join(TEST, f"gen/key_{k}_0.png")).convert("RGB")).astype(int) for k in ("stalls", "lamps", "palms", "benchflags")}
KEY_OF = {"stall": "stalls", "lamp": "lamps", "palm": "palms", "bench": "benchflags", "flag": "benchflags"}
data = {d["id"]: d for d in json.load(open(os.path.join(TEST, "data.json")))["items"]}


def shipped(i):
    d = data[i]
    m = np.zeros((b.H, b.W), bool)
    x, y, w, h = d["bbox"]
    m[y:y + h, x:x + w] = np.asarray(Image.open(os.path.join(TEST, f"masks/{i}.png"))) > 0
    return m


def box_of(i, pad):
    x, y, w, h = data[i]["bbox"]
    r = np.zeros((b.H, b.W), bool)
    r[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad] = True
    return r


def key_mask(it):
    k = KEYS[KEY_OF[it["kind"]]]
    mag = (k[..., 0] > 170) & (k[..., 2] > 170) & (k[..., 1] < 120)
    return b.clean(mag & box_of(it["id"], 6))


def grabcut(it):
    x, y, w, h = data[it["id"]]["bbox"]
    m = np.zeros((b.H, b.W), np.uint8)
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(b.S.astype(np.uint8)[..., ::-1].copy(), m, (x - 4, y - 4, w + 8, h + 8), bg, fg, 5, cv2.GC_INIT_WITH_RECT)
    return (m == 1) | (m == 3)


def diff_only(it):
    plate = b.plates[it.get("plate", "all" if it["kind"] == "stall" else "thin")]
    return b.clean((b.diff(b.S, plate) > b.TAU) & box_of(it["id"], 6))


def score(m, ref):
    inter, union = (m & ref).sum(), (m | ref).sum()
    edge = m & ~ndi.binary_erosion(m)
    dist = ndi.distance_transform_edt(~(ref & ~ndi.binary_erosion(ref)))
    return round(inter / max(1, union), 3), round(float(dist[edge].mean()) if edge.any() else 99, 2)


rows, sheets = [], []
COL = {"A": (255, 0, 255), "B": (0, 170, 255), "D": (255, 140, 0), "E": (0, 200, 90)}
for it in b.cfg["items"]:
    i = it["id"]
    ref = shipped(i)
    ms = {"A": key_mask(it), "B": grabcut(it), "D": diff_only(it)}
    if it.get("method") == "snap":
        ms["C"] = b.region(it)
    row = {"id": i, "kind": it["kind"]}
    for k, m in ms.items():
        row[k] = score(m, ref)
    rows.append(row)
    if i in ("s5", "s1", "l1", "p4", "f1", "b1"):
        x, y, w, h = data[i]["bbox"]
        x0, y0, x1, y1 = max(0, x - 8), max(0, y - 8), min(b.W, x + w + 8), min(b.H, y + h + 8)
        k = 3
        tiles = []
        for name in ("A", "B", "D", "E"):
            m = ref if name == "E" else ms[name]
            big = np.asarray(Image.fromarray(b.S[y0:y1, x0:x1].astype(np.uint8)).resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST)).copy()
            mb = np.kron(m[y0:y1, x0:x1], np.ones((k, k), bool))
            big[ndi.binary_dilation(mb, iterations=2) & ~mb] = COL[name]
            im = Image.fromarray(big)
            ImageDraw.Draw(im).text((4, 4), f"{i} {name}", fill=COL[name])
            tiles.append(im)
        row_im = Image.new("RGB", (sum(t.width + 4 for t in tiles), tiles[0].height), "white")
        xx = 0
        for t in tiles:
            row_im.paste(t, (xx, 0))
            xx += t.width + 4
        sheets.append(row_im)

print(f"{'id':4} {'kind':6} " + " ".join(f"{k:>14}" for k in "ABCD"))
for r in rows:
    print(f"{r['id']:4} {r['kind']:6} " + " ".join(f"{str(r.get(k, '-')):>14}" for k in "ABCD"))
for k in "ABCD":
    v = [r[k] for r in rows if k in r]
    print(k, "mean IoU", round(float(np.mean([a for a, _ in v])), 3), "mean boundary px", round(float(np.mean([e for _, e in v])), 2), "n", len(v))
Wd = max(s.width for s in sheets)
out = Image.new("RGB", (Wd, sum(s.height + 4 for s in sheets)), "white")
yy = 0
for s in sheets:
    out.paste(s, (0, yy))
    yy += s.height + 4
out.thumbnail((2400, 4000))
out.save(os.path.join(TEST, "shots/methods.png"))
