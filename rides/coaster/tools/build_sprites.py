"""Train sprites: a 3 x 3 sheet (rows side / back / front; columns front car, middle car, rear car) -> keyed, scaled,
outlined sprites in one atlas.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/coaster/tools/build_sprites.py [SHEET]

Every view is scaled by the same factor, set so that a side-view car is CAR_LEN park px long, and stored at D px per
park px. Anchors: side view, the middle of the wheels' contact line; back and front views, the bottom centre. Writes
rides/coaster/sprites.png + sprites.json ({"density": D, "frames": {"side_0": {"rect", "anchor", "size"}}}).
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
SHEET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RIDE, "gen/train_v2_0.png")
CAR_LEN = 40.0  # park px, side view, body length including the nose (riders about the crowd's head size)
D = 4  # sprite px per park px
INK = np.array([44, 32, 27], np.float32) / 255
VIEWS = ["side", "back", "front"]


def key(rgb):
    a = rgb.astype(int)
    white = (a.min(-1) > 226) & (a.max(-1) - a.min(-1) < 24)
    lab, _ = ndimage.label(white)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return ~np.isin(lab, border[border > 0])


def premul_resize(rgba, size):
    a = rgba.astype(np.float32) / 255
    rgb = a[..., :3] * a[..., 3:]
    ch = [np.asarray(Image.fromarray(rgb[..., i]).resize(size, Image.LANCZOS)) for i in range(3)]
    al = np.clip(np.asarray(Image.fromarray(a[..., 3]).resize(size, Image.LANCZOS)), 0, 1)
    rgb = np.clip(np.stack(ch, -1) / np.maximum(al[..., None], 1e-4), 0, 1)
    return np.dstack([rgb, al])


def outline(arr, width):
    pad = 3
    al = np.pad(arr[..., 3], pad)
    rgb = np.pad(arr[..., :3], ((pad, pad), (pad, pad), (0, 0)))
    dist = ndimage.distance_transform_edt(al < 0.5)
    ring = np.maximum(np.clip(width + 0.5 - dist, 0, 1) * 0.9, al)
    out = rgb * al[..., None] + INK * (ring - al)[..., None]
    return np.dstack([np.clip(out / np.maximum(ring[..., None], 1e-4), 0, 1), ring]), pad


def main():
    rgb = np.asarray(Image.open(SHEET).convert("RGB"))
    H, W = rgb.shape[:2]
    fg = key(rgb)
    cells = {}
    for r in range(3):
        for c in range(3):
            y0, y1, x0, x1 = r * H // 3, (r + 1) * H // 3, c * W // 3, (c + 1) * W // 3
            m = ndimage.binary_opening(fg[y0:y1, x0:x1], iterations=2)
            lab, n = ndimage.label(m)
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 2000])
            ys, xs = np.where(keep)
            box = (y0 + ys.min(), y0 + ys.max() + 1, x0 + xs.min(), x0 + xs.max() + 1)
            cells[(r, c)] = box
    # Scale: the side-view front car's body length (its widest row in the lower half, below the riders).
    by0, by1, bx0, bx1 = cells[(0, 0)]
    body = fg[by0 + (by1 - by0) // 2: by1, bx0:bx1]
    body_len = max(np.ptp(np.where(row)[0]) + 1 for row in body if row.any())
    s = CAR_LEN * D / body_len
    frames, tiles = {}, []
    for (r, c), (y0, y1, x0, x1) in cells.items():
        rgba = np.dstack([rgb[y0:y1, x0:x1], (fg[y0:y1, x0:x1] * 255).astype(np.uint8)])
        size = (max(1, round((x1 - x0) * s)), max(1, round((y1 - y0) * s)))
        arr, pad = outline(premul_resize(rgba, size), 0.55 * D)
        # Anchor: bottom of the opaque area, centred on it (the wheels sit on the track there).
        al = arr[..., 3] > 0.5
        rows = np.where(al.any(1))[0]
        cols = np.where(al.any(0))[0]
        ax = (cols.min() + cols.max() + 1) / 2
        ay = rows.max() + 1 - 0.6 * D  # a little above the very bottom: wheels overlap the rail
        name = f"{VIEWS[r]}_{c}"
        frames[name] = {"anchor": [round(ax, 2), round(ay, 2)], "size": [round(arr.shape[1] / D, 2), round(arr.shape[0] / D, 2)]}
        tiles.append((name, arr))
    # Pack in one row-major strip.
    gap = 4
    width = sum(t.shape[1] + gap for _, t in tiles) + gap
    height = max(t.shape[0] for _, t in tiles) + 2 * gap
    atlas = np.zeros((height, width, 4), np.float32)
    x = gap
    for name, t in tiles:
        h, w = t.shape[:2]
        atlas[gap:gap + h, x:x + w] = t
        frames[name]["rect"] = [x, gap, w, h]
        x += w + gap
    Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(RIDE, "sprites.png"))
    json.dump({"source": os.path.relpath(SHEET, os.path.dirname(os.path.dirname(RIDE))), "density": D, "car_len": CAR_LEN, "frames": frames},
              open(os.path.join(RIDE, "sprites.json"), "w"), indent=1)
    print(f"sprites.png {width} x {height}; side car {frames['side_0']['size']} park px, back {frames['back_0']['size']}")


if __name__ == "__main__":
    main()
