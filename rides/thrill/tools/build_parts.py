"""Thrill-ride sprites from the generated part sheets (gen/parts_v1_*.png, flat magenta background).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/thrill/tools/build_parts.py

Keys the magenta out (alpha from the distance to the border's median colour, colours un-mixed from it), splits each
sheet into its objects, and writes, in rides/thrill/:
  ring_back.webp, ring_front.webp  the drop tower's seat ring, split along the hole's top arc so the tower can be drawn
                                   between them (inside the hole's span the back is what lies above the arc)
  arm.webp, car.webp               the Typhoon's beam and one car
  parts.json                       sizes (sprite px) and anchors: ring hole centre and width, arm hub and end caps,
                                   car pivot; plus gen/parts_*_keyed.png for checking by eye
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
GEN = os.path.join(RIDE, "gen")


def key(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, 0)
    d = np.sqrt(((rgb - bg) ** 2).sum(-1))
    a = np.clip((d - 40) / (150 - 40), 0, 1)
    # Un-mix: c = a * fg + (1 - a) * bg
    fg = (rgb - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-3)
    fg = np.clip(fg, 0, 255)
    return np.dstack([fg, a * 255]).astype(np.float32)


def objects(rgba, min_area=4000):
    m = rgba[..., 3] > 128
    lab, n = ndimage.label(ndimage.binary_closing(m, iterations=6))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        area = int((lab[sl] == i + 1).sum())
        if area < min_area:
            continue
        ys, xs = sl
        out.append({"y0": ys.start, "y1": ys.stop, "x0": xs.start, "x1": xs.stop, "area": area, "label": i + 1})
    return lab, sorted(out, key=lambda o: (round(o["y0"] / 200), o["x0"]))


def crop(rgba, lab, o, pad=4):
    y0, y1, x0, x1 = max(0, o["y0"] - pad), o["y1"] + pad, max(0, o["x0"] - pad), o["x1"] + pad
    c = rgba[y0:y1, x0:x1].copy()
    own = ndimage.binary_dilation(lab[y0:y1, x0:x1] == o["label"], iterations=3)
    c[..., 3] *= own
    return c


# Shipped density: the layer draws each sprite at park px = sprite px * k (ring 0.118, arm 0.1286, car 0.0776); the files
# are resampled to 2.5 px per park px (the canvas never exceeds 2 device px per park px). parts.json keeps sprite px.
OUT = {"ring_back.webp": 0.118 * 2.5, "ring_front.webp": 0.118 * 2.5, "arm.webp": 0.1286 * 2.5, "car.webp": 0.0776 * 2.5}


def save(arr, name):
    a = np.clip(arr, 0, 255).astype(np.float32)
    f = OUT.get(name, 1)
    h, w = a.shape[:2]
    size = (max(1, round(w * f)), max(1, round(h * f)))
    # Premultiplied resize, so the keyed edges don't pick up a dark fringe.
    al = a[..., 3:] / 255
    rgb = [np.asarray(Image.fromarray(a[..., i] * al[..., 0]).resize(size, Image.LANCZOS)) for i in range(3)]
    al2 = np.clip(np.asarray(Image.fromarray(al[..., 0]).resize(size, Image.LANCZOS)), 0, 1)
    rgb = np.stack(rgb, -1) / np.maximum(al2[..., None], 1e-4)
    out = np.dstack([np.clip(rgb, 0, 255), al2 * 255])
    Image.fromarray((out + 0.5).astype(np.uint8), "RGBA").save(os.path.join(RIDE, name), lossless=True, quality=100)


def main():
    meta = {}
    s0, s1 = key(os.path.join(GEN, "parts_v1_0.png")), key(os.path.join(GEN, "parts_v1_1.png"))
    for i, s in enumerate((s0, s1)):
        Image.fromarray(np.clip(s, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(GEN, f"parts_{i}_keyed.png"))
    lab0, o0 = objects(s0)
    lab1, o1 = objects(s1)
    print("sheet 0:", [(o["x0"], o["y0"], o["x1"] - o["x0"], o["y1"] - o["y0"]) for o in o0])
    print("sheet 1:", [(o["x0"], o["y0"], o["x1"] - o["x0"], o["y1"] - o["y0"]) for o in o1])

    # The ring: the top object of sheet 0.
    ring = crop(s0, lab0, min(o0, key=lambda o: o["y0"]))
    # The hole: the inner edge of the back band, measured per column (the band's red rows: lowest y 359 at the
    # centre, 372-397 at +-150 px, 403-430 at +-300 px) and fitted with a half-ellipse, b/a = 0.45 (the camera's
    # 0.48). Front seat backs rise into the hole, so the arc can't be found from the hole's own pixels.
    H, W = ring.shape[:2]
    cx, ha, hb, hcy = 800.0, 375.0, 170.0, 529.0
    xs_all = np.arange(W)
    inside = np.abs(xs_all - cx) < ha
    # 14 px lower, so the band's own inner outline stays with the back half (it must not cross the column).
    split = np.where(inside, hcy - hb * np.sqrt(np.clip(1 - ((xs_all - cx) / ha) ** 2, 0, 1)), hcy)[None, :] + 14
    yy = np.arange(H)[:, None]
    front = yy > split
    hc, hw, hh = [float(cx), float(hcy)], float(2 * ha), float(2 * hb)
    back_img, front_img = ring.copy(), ring.copy()
    back_img[..., 3] *= ~front
    front_img[..., 3] *= front
    save(back_img, "ring_back.webp")
    save(front_img, "ring_front.webp")
    meta["ring"] = {"size": [ring.shape[1], ring.shape[0]], "hole_centre": hc, "hole_size": [hw, hh]}

    # The arm: the middle object of sheet 1; hub at its centre, caps at the ends.
    arm_o = sorted(o1, key=lambda o: o["y0"])[1]
    arm = crop(s1, lab1, arm_o)
    a = arm[..., 3] > 128
    ys, xs = np.where(a)
    cy = float(ys.mean())
    h_end = float(ys[xs < xs.min() + 20].max() - ys[xs < xs.min() + 20].min() + 1)
    meta["arm"] = {"size": [arm.shape[1], arm.shape[0]], "hub": [float((xs.min() + xs.max()) / 2), cy],
                   "ends": [[float(xs.min() + h_end / 2), cy], [float(xs.max() - h_end / 2), cy]]}
    save(arm, "arm.webp")

    # The car: the left bottom object of sheet 0.
    cars = sorted(o0, key=lambda o: o["y0"])[2:]
    car_o = min(cars, key=lambda o: o["x0"])
    car = crop(s0, lab0, car_o)
    a = car[..., 3] > 128
    ys, xs = np.where(a)
    meta["car"] = {"size": [car.shape[1], car.shape[0]], "pivot": [float((xs.min() + xs.max()) / 2), float((ys.min() + ys.max()) / 2)]}
    save(car, "car.webp")
    json.dump(meta, open(os.path.join(RIDE, "parts.json"), "w"), indent=1)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
