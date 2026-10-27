"""Carousel horse sprites: a generated 5 x 4 sheet on flat magenta (rows = horses, columns = views: side, three-quarter
towards, front, three-quarter away, back; all facing right) -> keyed, scaled, packed into rides/carousel/horses.webp
with rides/carousel/horses.json.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/carousel/tools/build_sprites.py [SHEET]

Per frame: rect in the atlas, size in park px at scale 1 (a horse whose side view is SIDE_H park px tall), the pole
point (where the pole passes through the saddle) and the seat (where a rider's feet anchor sits), both in frame px.
Frames are stored at S atlas px per park px.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
S = 4          # atlas px per park px
SIDE_H = 30    # a horse's side view, park px tall
VIEWS = ["side", "q_toward", "front", "q_away", "back"]
NAMES = ["white", "cream", "lavender", "mint"]


def key_magenta(rgb):
    a = rgb.astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 60) / 70, 0, 1)
    # un-mix the magenta from the soft edge: c = alpha * fg + (1 - alpha) * bg
    fg = (a - (1 - alpha[..., None]) * bg) / np.maximum(alpha[..., None], 1e-3)
    # pixels still magenta-leaning at the edge: pull green up
    return np.clip(fg, 0, 255), alpha


def main():
    sheet = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RIDE, "gen/horses_v1_1.png")
    rgb = np.asarray(Image.open(sheet).convert("RGB"))
    H, W = rgb.shape[:2]
    fg, alpha = key_magenta(rgb)
    solid = ndimage.binary_closing(alpha > 0.5, iterations=3)
    lab, n = ndimage.label(solid)
    boxes = {}
    for i, sl in enumerate(ndimage.find_objects(lab)):
        ys, xs = sl
        if (ys.stop - ys.start) * (xs.stop - xs.start) < 2000:
            continue
        cy, cx = (ys.start + ys.stop) / 2, (xs.start + xs.stop) / 2
        k = (min(3, int(cy / (H / 4))), min(4, int(cx / (W / 5))))
        b = boxes.get(k)
        boxes[k] = (ys.start, ys.stop, xs.start, xs.stop) if b is None else (min(b[0], ys.start), max(b[1], ys.stop), min(b[2], xs.start), max(b[3], xs.stop))
    missing = [(r, c) for r in range(4) for c in range(5) if (r, c) not in boxes]
    if missing:
        raise SystemExit(f"missing cells {missing}")
    frames, meta = {}, {}
    for r in range(4):
        y0, y1, _, _ = boxes[(r, 0)]
        s = SIDE_H * S / (y1 - y0)   # the row's scale, from its side view
        for c in range(5):
            y0, y1, x0, x1 = boxes[(r, c)]
            pad = 6
            y0, y1, x0, x1 = max(0, y0 - pad), min(H, y1 + pad), max(0, x0 - pad), min(W, x1 + pad)
            cell = np.dstack([fg[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).astype(np.uint8)
            im = Image.fromarray(cell, "RGBA")
            w, h = round(im.width * s), round(im.height * s)
            # premultiplied resize
            a = np.asarray(im).astype(np.float32) / 255
            pm = a[..., :3] * a[..., 3:]
            chans = [np.asarray(Image.fromarray(pm[..., i]).resize((w, h), Image.LANCZOS)) for i in range(3)]
            al = np.clip(np.asarray(Image.fromarray(a[..., 3]).resize((w, h), Image.LANCZOS)), 0, 1)
            out = np.dstack([np.clip(np.stack(chans, -1) / np.maximum(al[..., None], 1e-4), 0, 1), al])
            m = al > 0.5
            ys, xs = np.where(m)
            bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            cx = (bx0 + bx1) / 2
            view = VIEWS[c]
            if view in ("side", "q_toward", "q_away"):
                # the saddle: the topmost opaque pixel a little behind the middle (the horse faces right); the pole
                # goes through the withers, in front of the rider
                sx = bx0 + (bx1 - bx0) * 0.42
                col = m[:, int(sx)]
                sy = np.argmax(col) if col.any() else by0
                px_ = bx0 + (bx1 - bx0) * 0.58
                pole = [px_, by0 + (by1 - by0) * 0.5]
                seat = [sx, sy + (by1 - by0) * 0.15]
            else:
                pole = [cx, by0 + (by1 - by0) * 0.5]
                seat = [cx, by0 + (by1 - by0) * (0.40 if view == "front" else 0.30)]
            key = f"{NAMES[r]}/{view}"
            frames[key] = out
            meta[key] = {"size": [w / S, h / S], "pole": [round(pole[0] / S, 2), round(pole[1] / S, 2)],
                         "seat": [round(seat[0] / S, 2), round(seat[1] / S, 2)]}
    # pack in rows
    items = sorted(frames.items(), key=lambda kv: -kv[1].shape[0])
    AW, gap = 1024, 4
    x = y = rowh = 0
    place = {}
    for k, a in items:
        h, w = a.shape[:2]
        if x + w + gap > AW:
            x, y, rowh = 0, y + rowh + gap, 0
        place[k] = (x + gap, y + gap)
        x += w + gap
        rowh = max(rowh, h)
    AH = y + rowh + 2 * gap
    atlas = np.zeros((AH, AW, 4), np.float32)
    for k, (px, py) in place.items():
        a = frames[k]
        atlas[py:py + a.shape[0], px:px + a.shape[1]] = a
        meta[k]["rect"] = [px, py, a.shape[1], a.shape[0]]
    Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(RIDE, "horses.webp"), lossless=True)
    json.dump({"scale": S, "size": [AW, AH], "views": VIEWS, "horses": NAMES, "frames": meta, "source": os.path.relpath(sheet, os.path.dirname(os.path.dirname(RIDE)))},
              open(os.path.join(RIDE, "horses.json"), "w"), indent=1)
    print(f"horses.webp {AW} x {AH}, {len(frames)} frames; side view {SIDE_H} park px tall")


if __name__ == "__main__":
    main()
