"""The hidden corgi's art: its 12 frames from the crowd's corgi sheet, and the bowling pin it hides behind.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/corgi/tools/build.py   (from the repo root)

- Frames: tests/characters/gen/sheet_pet_corgi_0.png (the 4 x 3 sheet the crowd's lead dogs come from), keyed, cut
  and outlined with the crowd's own functions (tests/characters/tools/build_atlas.py), but at D = 4 px per park px
  for a corgi H = 20 park px tall (a little bigger than the crowd's pets, so it can be found and clicked), instead of
  the crowd atlas's 2 px per stage px. Written as one strip, rides/corgi/corgi.webp + corgi.json
  (frames: rect, anchor = the feet point, in strip px).
- pin.webp: the painting's giant bowling pin on the Boardwalk Bowl roof, cut out (its white body, red band and ink
  outline) from gen/park/world_v2_hd.png, so the layer can draw it again over the corgi when it hides behind it.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "tests", "characters", "tools"))
import build_atlas as ba  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
OUT = os.path.join(ROOT, "rides", "corgi")
D = 4          # strip px per park px
H = 20         # park px, the standing corgi's height
VIEWS, POSES = ["front", "side", "back"], ["stand", "walk0", "walk1", "act"]
PIN = (236, 652, 62, 118)  # park px: x, y, w, h round the bowling pin
MASTER = 2.5               # master px per park px


def frames():
    rgb, fg, boxes = ba.load_sheet("pet_corgi")
    rgba = np.dstack([rgb, (fg * 255).astype(np.uint8)])
    crops = {k: Image.fromarray(rgba[y0:y1, x0:x1]) for k, (y0, y1, x0, x1) in boxes.items()}
    s = H * D / crops[(0, 0)].size[1]
    ref = ba.head_sig(crops[(1, 0)])
    out = {}
    for (r, c), im in sorted(crops.items()):
        if r == 1 and c in (1, 2) and np.abs(ba.head_sig(im, True) - ref).mean() < 0.85 * np.abs(ba.head_sig(im) - ref).mean():
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        w, h = im.size
        arr = ba.sharpen(ba.premul_resize(im, (max(1, round(w * s)), max(1, round(h * s)))))
        arr, pad = ba.outline(arr, 0.8 * D)
        a = np.asarray(im)[..., 3] > 127
        rows, cols = np.where(a.any(1))[0], np.where(a[: max(1, h // 2)].any(0))[0]
        if r == 1:  # side views: the feet sit under the body's middle, not under the head
            cols = np.where(a.any(0))[0]
        out[f"{VIEWS[r]}_{POSES[c]}"] = (arr, (cols.min() + cols.max() + 1) / 2 * s + pad, (rows.max() + 1) * s + pad)
    return out


def strip(fr, gap=2):
    w = sum(a.shape[1] + gap for a, _, _ in fr.values()) + gap
    h = max(a.shape[0] for a, _, _ in fr.values()) + 2 * gap
    img, meta, x = np.zeros((h, w, 4), np.float32), {}, gap
    for name, (a, ax, ay) in fr.items():
        img[gap:gap + a.shape[0], x:x + a.shape[1]] = a
        meta[name] = {"rect": [x, gap, a.shape[1], a.shape[0]], "anchor": [round(ax, 2), round(ay, 2)]}
        x += a.shape[1] + gap
    return img, meta


def pin():
    x, y, w, h = PIN
    src = Image.open(os.path.join(ROOT, "gen", "park", "world_v2_hd.png")).convert("RGB")
    crop = src.crop(tuple(round(v * MASTER) for v in (x, y, x + w, y + h)))
    a = np.asarray(crop).astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1)
    light = (mx > 0.72) & (mx - mn < 0.16)                       # the pin's white body and head
    lab, _ = ndimage.label(light)
    seeds = [(round((cy - y) * MASTER), round((cx - x) * MASTER)) for cx, cy in ((264, 690), (262, 735))]
    body = np.isin(lab, [lab[s] for s in seeds if lab[s] > 0])
    # Fill each row between the body's outermost pixels; rows across the red band at the neck (no white) take their
    # span from the nearest rows above and below.
    rows = np.where(body.any(1))[0]
    spans = {r: (np.where(body[r])[0].min(), np.where(body[r])[0].max()) for r in rows}
    for r in range(rows.min(), rows.max() + 1):
        if r not in spans:
            a, b = rows[rows < r].max(), rows[rows > r].min()
            k = (r - a) / (b - a)
            spans[r] = tuple(round(spans[a][i] + (spans[b][i] - spans[a][i]) * k) for i in (0, 1))
        body[r, spans[r][0]:spans[r][1] + 1] = True
    body = ndimage.binary_dilation(body, iterations=5)            # the ink outline round it
    alpha = ndimage.gaussian_filter(body.astype(np.float32), 0.8)
    img = np.dstack([np.asarray(crop), (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(img, "RGBA").resize((w * D, h * D), Image.LANCZOS).save(os.path.join(OUT, "pin.webp"), lossless=True)
    return {"rect": [x, y, w, h]}


def main():
    img, meta = strip(frames())
    out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, "corgi.webp"), lossless=True)
    json.dump({"density": D, "frames": meta, "pin": pin()}, open(os.path.join(OUT, "corgi.json"), "w"), indent=1)
    print(f"corgi.webp {out.shape[1]}x{out.shape[0]}, {len(meta)} frames; pin.webp")


if __name__ == "__main__":
    main()
