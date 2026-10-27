"""Car sprites: the 3D renders (render_cars.mjs) -> colour-matched to the painted turnaround, ink-outlined, downscaled,
packed into one atlas.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/build_sprites.py NAME [NAME ...]

For each car NAME: rides/traffic/gen/render_NAME.png/.json (32 headings at D_IN px per park px) and the sheet
rides/traffic/gen/car_NAME_0.png (its side view sets the colours). Writes rides/traffic/sprites.webp + .json (and
the lossless gen/sprites.png):
{"density": D_OUT, "headings": 32, "cars": {NAME: {"h0": {"rect", "anchor"}, ...}}}. Anchors are the car's ground
centre. The outline is a warm ink ring OUTLINE park px wide around the solid body (the soft contact shadow is left
without one).
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
GEN = os.path.join(RIDE, "gen")
D_OUT = 2.0
OUTLINE = 0.8  # park px
INK = np.array([58, 40, 32], np.float32) / 255
INK_ALPHA = 0.9


def clusters(rgb, solid, k=4):
    """The k most common flat colours among solid pixels: (mean colours, shares)."""
    px = rgb[solid]
    q = np.round(px * 8).astype(int)
    keys, inv, counts = np.unique(q[:, 0] * 81 + q[:, 1] * 9 + q[:, 2], return_inverse=True, return_counts=True)
    order = np.argsort(-counts)[:k]
    return np.array([px[inv.ravel() == o].mean(0) for o in order]), counts[order] / counts[order].sum()


def body_mean(rgb, solid):
    return clusters(rgb, solid, 1)[0][0]


def sheet_side(name):
    im = np.asarray(Image.open(os.path.join(GEN, f"car_{name}_0.png")).convert("RGB")).astype(np.float32) / 255
    h, w = im.shape[:2]
    side = im[: h // 2, w // 2:]
    solid = ~((side.min(-1) > 0.91) & (side.max(-1) - side.min(-1) < 0.08))
    solid = ndimage.binary_erosion(solid, iterations=3)
    return side, solid


def outline(rgba, width):
    al = rgba[..., 3]
    solid = al > 0.6
    pad = int(np.ceil(width)) + 2
    solid_p = np.pad(solid, pad)
    rgba_p = np.pad(rgba, ((pad, pad), (pad, pad), (0, 0)))
    dist = ndimage.distance_transform_edt(~solid_p)
    ring = np.clip(width + 0.5 - dist, 0, 1) * (~solid_p) * INK_ALPHA
    a = rgba_p[..., 3]
    out_a = np.maximum(a, ring)
    rgb = rgba_p[..., :3] * a[..., None] * (1 - ring[..., None]) + INK * ring[..., None]
    rgb = rgb / np.maximum(out_a[..., None], 1e-4)
    return np.dstack([np.clip(rgb, 0, 1), out_a]), pad


def premul_resize(rgba, size):
    rgb = rgba[..., :3] * rgba[..., 3:]
    ch = [np.asarray(Image.fromarray(rgb[..., i].astype(np.float32)).resize(size, Image.LANCZOS)) for i in range(3)]
    al = np.clip(np.asarray(Image.fromarray(rgba[..., 3].astype(np.float32)).resize(size, Image.LANCZOS)), 0, 1)
    rgb = np.clip(np.stack(ch, -1) / np.maximum(al[..., None], 1e-4), 0, 1)
    return np.dstack([rgb, al])


def build(name):
    meta = json.load(open(os.path.join(GEN, f"render_{name}.json")))
    sheet = np.asarray(Image.open(os.path.join(GEN, f"render_{name}.png")).convert("RGBA")).astype(np.float32) / 255
    d_in = meta["density"]
    side, sside = sheet_side(name)
    target = body_mean(side, sside)
    # The render's side view: heading 0 (driving east) is a near profile.
    f0 = meta["frames"]["h0"]
    x, y, w, h = f0["rect"]
    c0 = sheet[y:y + h, x:x + w]
    got = body_mean(c0[..., :3], c0[..., 3] > 0.97)
    # The render comes back darker and more saturated than the painted sheet. Fit one desaturation factor and one gamma
    # on the paint colour and apply them to every solid pixel: hues and the relations between colours stay as
    # painted, so cream stays cream.
    def look(rgb, sat, gam):
        lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        out = lum[..., None] + (rgb - lum[..., None]) * sat
        return np.clip(out, 0, 1) ** gam
    # Fit on the sheet's four main colours, each against its nearest render colour after the change.
    sc, sw = clusters(side, sside)
    rc, _ = clusters(c0[..., :3], c0[..., 3] > 0.97)
    def err(p):
        lr = look(rc, *p)
        return sum(w * np.abs(lr - c).sum(1).min() for c, w in zip(sc, sw))
    best = min(((sa, ga) for sa in np.linspace(0.6, 1.3, 29) for ga in np.linspace(0.55, 1.2, 27)), key=err)
    remap = lambda rgb: look(rgb, *best)
    after = remap(got)
    print(f"{name}: paint sheet {np.round(target * 255)} render {np.round(got * 255)} -> {np.round(after * 255)} (sat {best[0]:.2f}, gamma {best[1]:.2f})")
    frames = {}
    k = D_OUT / d_in
    for key, f in meta["frames"].items():
        x, y, w, h = f["rect"]
        cell = sheet[y:y + h, x:x + w].copy()
        solid = cell[..., 3] > 0.97
        # The baked texture is mottled up close: a small median filter calms it before the colour fit.
        calm = np.stack([ndimage.median_filter(cell[..., i], size=3) for i in range(3)], -1)
        cell[..., :3] = np.where(solid[..., None], remap(calm), cell[..., :3])
        cell, pad = outline(cell, OUTLINE * d_in)
        ys, xs = np.where(cell[..., 3] > 0.01)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = cell[y0:y1, x0:x1]
        size = (max(1, round(crop.shape[1] * k)), max(1, round(crop.shape[0] * k)))
        small = premul_resize(crop, size)
        ax = (f["anchor"][0] + pad - x0) * k
        ay = (f["anchor"][1] + pad - y0) * k
        frames[key] = (small, ax, ay, f["theta"])
    return frames


def pack(all_frames, width=2048, gap=2):
    items = sorted(((n, k, v) for n, fr in all_frames.items() for k, v in fr.items()), key=lambda t: -t[2][0].shape[0])
    x = y = row = 0
    placed = []
    for n, k, (img, ax, ay, th) in items:
        h, w = img.shape[:2]
        if x + w + gap > width:
            x, y, row = 0, y + row + gap, 0
        placed.append((n, k, x + gap, y + gap, img, ax, ay, th))
        x += w + gap
        row = max(row, h)
    H = int(2 ** np.ceil(np.log2(y + row + 2 * gap)))
    atlas = np.zeros((H, width, 4), np.float32)
    meta = {}
    for n, k, px, py, img, ax, ay, th in placed:
        h, w = img.shape[:2]
        atlas[py:py + h, px:px + w] = img
        meta.setdefault(n, {})[k] = {"rect": [px, py, w, h], "anchor": [round(ax, 2), round(ay, 2)], "theta": th}
    return atlas, meta


names = sys.argv[1:]
frames = {n: build(n) for n in names}
atlas, meta = pack(frames)
rgba = np.dstack([atlas[..., :3] * 255, atlas[..., 3:] * 255]).round().astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(os.path.join(GEN, "sprites.png"), optimize=True)  # lossless master
Image.fromarray(rgba, "RGBA").save(os.path.join(RIDE, "sprites.webp"), quality=92, alpha_quality=100, method=6)  # shipped
json.dump({"density": D_OUT, "headings": 32, "cars": meta}, open(os.path.join(RIDE, "sprites.json"), "w"), separators=(",", ":"))
print("atlas", atlas.shape[1], "x", atlas.shape[0], sum(len(v) for v in meta.values()), "frames")
