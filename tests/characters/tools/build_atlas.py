"""Character atlas: shyfai sheets (4 x 3 grid) -> keyed, scaled, outlined frames -> one atlas.png + atlas.json.

  uv run --with pillow --with numpy --with scipy --with imagequant python -I tests/characters/tools/build_atlas.py [--park] [--lossless]   (from the repo root)

--park: only the animal sheets (no 3D test sets, no Dipper-stage cut-outs), written to tests/park-crowd/ for the
whole-park crowd, at 2 atlas px per stage px (still twice what a screen shows at size 38), plus outfit variants:
each adult's clothing colour (sampled on the front view's torso) is recoloured into --variants N palette colours
(default 1), keeping its shading; species whose clothing hue also shows in the head (fur, beak, hat) get none.
Variant looks are named <species>~<colour>. Sheets that have not been generated are skipped.

Frames are drawn at 4 atlas px per stage px (SCALE), sharp up to 47 px characters on the 2.5x stage. Each frame's anchor is the feet point. Rows of a sheet are
front / side (facing right) / back; columns stand / walk0 / walk1 / act (sit, eat, photo; the pet: sit, sniff, sit).
Extra frame sets (rendered 3D sprites) are merged from gen/sprites_*.json + .png when present.
"""
import json, os, sys, zlib
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.dirname(HERE)
GEN = os.path.join(TEST, "gen")
SCALE = 4
INK = (44, 32, 27)
SHEETS = {
    "bear": 30, "bunny": 31, "cat_orange": 29, "dog_shiba": 30, "cat_grey": 29,
    "bear_cub": 22, "bunny_brown": 30, "dog_cream": 29, "pet": 13,
    "panda": 30, "fox": 30, "pig": 29, "raccoon": 29, "koala": 29, "frog": 27, "penguin": 28, "tiger": 30,
    "sheep": 29, "duck": 27, "elephant": 31, "hamster": 27,
    "lion": 31, "giraffe": 33, "deer": 31, "otter": 29, "owl": 28, "hedgehog": 27, "squirrel": 29, "mouse": 28,
    "monkey": 29, "zebra": 31, "hippo": 30, "seal": 28, "alpaca": 32, "crocodile": 30, "flamingo": 31, "red_panda": 29,
    "bunny_kid": 23, "panda_kid": 22, "fox_kid": 22, "piglet": 21, "kitten": 21, "lion_cub": 22,
    "pet_corgi": 13, "pet_poodle": 14, "pet_cat": 12,
}
# The characters test (on the Dipper stage) keeps its original cast; --park takes every sheet.
ORIGINAL = {"bear", "bunny", "cat_orange", "dog_shiba", "cat_grey", "bear_cub", "bunny_brown", "dog_cream", "pet"}
KIDS = {"bear_cub", "bunny_kid", "panda_kid", "fox_kid", "piglet", "kitten", "lion_cub"}
PALETTE = {
    "salmon": (236, 129, 103), "butter": (242, 178, 117), "cornflower": (133, 173, 205), "mint": (140, 200, 165),
    "lavender": (178, 158, 212), "peach": (247, 186, 150), "red": (214, 86, 74), "teal": (88, 168, 170),
}
VIEWS = ["front", "side", "back"]
POSES = ["stand", "walk0", "walk1", "act"]


def key_background(rgb):
    a = rgb.astype(int)
    white = (a.min(-1) > 228) & (a.max(-1) - a.min(-1) < 22)
    lab, n = ndimage.label(white)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, border[border > 0])
    return ~bg


def cells(fg, H, W):
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    objs = ndimage.find_objects(lab)
    out = {}
    for i, sl in enumerate(objs):
        ys, xs = sl
        area = (ys.stop - ys.start) * (xs.stop - xs.start)
        if area < 300:
            continue
        cy, cx = (ys.start + ys.stop) / 2, (xs.start + xs.stop) / 2
        key = (min(2, int(cy / (H / 3))), min(3, int(cx / (W / 4))))
        box = out.get(key)
        out[key] = (ys.start, ys.stop, xs.start, xs.stop) if box is None else (
            min(box[0], ys.start), max(box[1], ys.stop), min(box[2], xs.start), max(box[3], xs.stop))
    return out


def head_sig(rgba, flip=False):
    im = rgba.transpose(Image.FLIP_LEFT_RIGHT) if flip else rgba
    w, h = im.size
    head = im.crop((0, 0, w, int(h * 0.55))).resize((24, 16), Image.BOX)
    a = np.asarray(head).astype(float)
    return a[..., :3] * (a[..., 3:] / 255.0)


def premul_resize(im, size):
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb = a[..., :3] * a[..., 3:4]
    chans = [Image.fromarray(rgb[..., i]).resize(size, Image.LANCZOS) for i in range(3)]
    al = np.clip(np.asarray(Image.fromarray(a[..., 3]).resize(size, Image.LANCZOS)), 0, 1)
    rgb = np.stack([np.asarray(c) for c in chans], -1)
    rgb = np.clip(rgb / np.maximum(al[..., None], 1e-4), 0, 1)
    return np.dstack([rgb, al])


def outline(arr, width=1.6):
    al = arr[..., 3]
    pad = 4
    al_p = np.pad(al, pad)
    rgb_p = np.pad(arr[..., :3], ((pad, pad), (pad, pad), (0, 0)))
    dist = ndimage.distance_transform_edt(al_p < 0.5)
    ring = np.clip(width + 0.5 - dist, 0, 1)
    ring = np.maximum(ring, al_p)
    ink = np.array(INK, np.float32) / 255.0
    a_out = ring
    rgb = rgb_p * al_p[..., None] + ink * (a_out - al_p)[..., None] * 0.92
    a_out = al_p + (a_out - al_p) * 0.92
    rgb = rgb / np.maximum(a_out[..., None], 1e-4)
    return np.dstack([np.clip(rgb, 0, 1), np.clip(a_out, 0, 1)]), pad


def sharpen(arr):
    rgb = Image.fromarray((arr[..., :3] * 255).astype(np.uint8))
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=1))
    return np.dstack([np.asarray(rgb).astype(np.float32) / 255.0, arr[..., 3]])


def rgb_to_hsv(a):
    a = a.astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = d > 1e-6
    rm, gm = m & (mx == r), m & (mx == g) & (mx != r)
    bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    return np.dstack([h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx])


def hsv_to_rgb(hsv):
    h, s, v = hsv[..., 0] / 60 % 6, hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    out = np.choose(i[..., None] * np.ones(3, int), [np.dstack(c) for c in [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]])
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def hue_gap(a, b):
    d = np.abs(np.asarray(a) - b) % 360
    return np.minimum(d, 360 - d)


def clothing_variants(name, rgb, fg, boxes, n):
    """Recolourers for the clothing: [(colour name, fn(rgb) -> rgb)], or [] when the clothing can't be told apart."""
    if n <= 0 or (0, 0) not in boxes:
        return []
    hsv = rgb_to_hsv(rgb)
    y0, y1, x0, x1 = boxes[(0, 0)]
    h, w = y1 - y0, x1 - x0
    ty0, ty1, tx0, tx1 = y0 + int(h * 0.58), y0 + int(h * 0.72), x0 + int(w * 0.40), x0 + int(w * 0.60)
    t = hsv[ty0:ty1, tx0:tx1][fg[ty0:ty1, tx0:tx1]]
    t = t[(t[:, 1] > 0.18) & (t[:, 2] > 0.35)]
    if len(t) < 30:
        return []
    h0 = float(np.angle(np.exp(1j * np.radians(t[:, 0])).mean(), deg=True) % 360)
    s0, v0 = float(np.median(t[:, 1])), float(np.median(t[:, 2]))
    if s0 < 0.12:
        return []
    mask = fg & (hue_gap(hsv[..., 0], h0) < 16) & (hsv[..., 1] > 0.5 * s0) & (hsv[..., 2] > 0.25)
    # Keep the clothing's big connected areas only: drops rosy cheeks, inner ears and specks of the same hue.
    lab, n_lab = ndimage.label(mask)
    if n_lab:
        cell_area = np.median([(a1 - a0) * (b1 - b0) for a0, a1, b0, b1 in boxes.values()])
        sizes = ndimage.sum(mask, lab, range(1, n_lab + 1))
        mask = np.isin(lab, 1 + np.where(sizes > 0.012 * cell_area)[0])
    head = np.zeros_like(mask)
    furs = []
    for (r, c), (a0, a1, b0, b1) in boxes.items():
        head[a0:a0 + int((a1 - a0) * 0.42), b0:b1] = True
        hp = hsv[a0:a0 + int((a1 - a0) * 0.42), b0:b1][fg[a0:a0 + int((a1 - a0) * 0.42), b0:b1]]
        furs.append(hp[hp[:, 1] > 0.25, 0])
    if mask.sum() == 0 or (mask & head).sum() / mask.sum() > 0.08:
        return []
    # Never recolour the head (the top 38% of a cell on these chunky bodies): noses and markings share hues.
    for a0, a1, b0, b1 in boxes.values():
        mask[a0:a0 + int((a1 - a0) * 0.38), b0:b1] = False
    fur = np.concatenate(furs)
    fur_h = float(np.median(fur)) if len(fur) > 200 else None
    names = sorted(PALETTE, key=lambda k: zlib.crc32((name + k).encode()))
    picks = []
    for k in names:
        th, ts, tv = rgb_to_hsv(np.array([[PALETTE[k]]], np.uint8))[0, 0]
        if hue_gap(th, h0) < 50 or (fur_h is not None and hue_gap(th, fur_h) < 30):
            continue
        picks.append((k, th, ts, tv))
        if len(picks) == n:
            break

    def make(th, ts, tv):
        def fn(img):
            hv = rgb_to_hsv(img)
            hv[..., 0] = np.where(mask, th, hv[..., 0])
            hv[..., 1] = np.where(mask, np.clip(ts * hv[..., 1] / s0, 0, 1), hv[..., 1])
            hv[..., 2] = np.where(mask, np.clip(tv * hv[..., 2] / v0, 0, 1), hv[..., 2])
            out = img.copy()
            out[mask] = hsv_to_rgb(hv)[mask]
            return out
        return fn
    return [(k, make(th, ts, tv)) for k, th, ts, tv in picks]


def load_sheet(name):
    rgb = np.asarray(Image.open(os.path.join(GEN, f"sheet_{name}_0.png")).convert("RGB"))
    fg = key_background(rgb)
    return rgb, fg, cells(fg, *rgb.shape[:2])


def sheet_frames(name, height, sheet=None, look=None):
    rgb, fg, boxes = sheet or load_sheet(name)
    look = look or name
    missing = [(r, c) for r in range(3) for c in range(4) if (r, c) not in boxes]
    if missing and look == name:
        print(f"{name}: missing cells {missing}", file=sys.stderr)
    rgba = np.dstack([rgb, (fg * 255).astype(np.uint8)])
    crops = {}
    for (r, c), (y0, y1, x0, x1) in boxes.items():
        crops[(r, c)] = Image.fromarray(rgba[y0:y1, x0:x1])
    stand_h = np.median([crops[(r, 0)].size[1] for r in range(3) if (r, 0) in crops])
    if name.startswith("pet"):
        stand_h = crops[(0, 0)].size[1]
    s = height * SCALE / stand_h
    ref = head_sig(crops[(1, 0)])
    frames, flips = {}, []
    for (r, c), im in crops.items():
        if r == 1 and c in (1, 2):
            d0 = np.abs(head_sig(im) - ref).mean()
            d1 = np.abs(head_sig(im, True) - ref).mean()
            if d1 < d0 * 0.85:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
                flips.append(c)
        w, h = im.size
        size = (max(1, round(w * s)), max(1, round(h * s)))
        arr = premul_resize(im, size)
        arr = sharpen(arr)
        arr, pad = outline(arr, 0.8 * SCALE)
        a = np.asarray(im)[..., 3] > 127
        rows = np.where(a.any(1))[0]
        top = a[: max(1, int(h * 0.5))]
        cols = np.where(top.any(0))[0]
        ax = (cols.min() + cols.max() + 1) / 2 * s + pad
        ay = (rows.max() + 1) * s + pad
        frames[f"{look}/{VIEWS[r]}_{POSES[c]}"] = (arr, ax, ay)
    if flips and look == name:
        print(f"{name}: mirrored side cells {flips}")
    return frames


def shadow():
    w, h = 18 * SCALE, 7 * SCALE
    y, x = np.mgrid[0:h, 0:w]
    d = np.sqrt(((x - w / 2 + 0.5) / (w / 2)) ** 2 + ((y - h / 2 + 0.5) / (h / 2)) ** 2)
    al = np.clip(1 - d, 0, 1) ** 0.8 * 0.55
    ink = np.array(INK, np.float32) / 255.0
    arr = np.dstack([np.broadcast_to(ink, (h, w, 3)), al])
    return {"shadow": (arr, w / 2, h / 2)}


def solid():
    arr = np.dstack([np.broadcast_to(np.array(INK, np.float32) / 255.0, (6, 6, 3)), np.ones((6, 6))])
    return {"ink": (arr, 3, 3)}


def pack(frames, width=2048, gap=4):
    items = sorted(frames.items(), key=lambda kv: -kv[1][0].shape[0])
    x = y = row_h = 0
    placed = {}
    for name, (arr, ax, ay) in items:
        h, w = arr.shape[:2]
        if x + w + gap > width:
            x, y, row_h = 0, y + row_h + gap, 0
        placed[name] = (x + gap, y + gap, w, h, ax, ay)
        x += w + gap
        row_h = max(row_h, h)
    height = 1 << int(np.ceil(np.log2(y + row_h + 2 * gap)))
    atlas = np.zeros((height, width, 4), np.float32)
    for name, (px, py, w, h, ax, ay) in placed.items():
        atlas[py:py + h, px:px + w] = frames[name][0]
    return atlas, placed


def extra_sets():
    out = {}
    for f in sorted(os.listdir(GEN)):
        if not (f.startswith("sprites_") and f.endswith(".json")):
            continue
        meta = json.load(open(os.path.join(GEN, f)))
        img = Image.open(os.path.join(GEN, meta["image"])).convert("RGBA")
        cut = {}
        for name, fr in meta["frames"].items():
            x, y, w, h = fr["rect"]
            cell = img.crop((x, y, x + w, y + h))
            bb = cell.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            if bb:
                cut[name] = (cell.crop(bb), fr["anchor"][0] - bb[0], fr["anchor"][1] - bb[1])
        ref = cut.get("h0_stand") or next(iter(cut.values()))
        s = meta.get("targetPx", 30) * SCALE / ref[0].size[1]
        for name, (im, ax, ay) in cut.items():
            w, h = im.size
            arr = sharpen(premul_resize(im, (max(1, round(w * s)), max(1, round(h * s)))))
            arr, pad = outline(arr, 0.8 * SCALE) if meta.get("outline", True) else (arr, 0)
            out[f"{meta['look']}/{name}"] = (arr, ax * s + pad, ay * s + pad)
    return out


def main():
    global SCALE
    park = "--park" in sys.argv
    n_var = int(sys.argv[sys.argv.index("--variants") + 1]) if "--variants" in sys.argv else 1
    if park:
        SCALE = 2
    out_dir = os.path.join(TEST, "..", "park-crowd") if park else TEST
    frames = {}
    for name, h in SHEETS.items():
        if not os.path.exists(os.path.join(GEN, f"sheet_{name}_0.png")) or (not park and name not in ORIGINAL):
            continue
        sheet = load_sheet(name)
        frames.update(sheet_frames(name, h, sheet))
        if park and name not in KIDS and not name.startswith("pet"):
            rgb, fg, boxes = sheet
            variants = clothing_variants(name, rgb, fg, boxes, n_var)
            for colour, fn in variants:
                frames.update(sheet_frames(name, h, (fn(rgb), fg, boxes), f"{name}~{colour}"))
            print(f"{name}: variants {[v[0] for v in variants] or 'none'}")
    frames.update(shadow())
    frames.update(solid())
    if not park:
        frames.update(extra_sets())
    occ_path = os.path.join(GEN, "occluders.npz")
    occ_meta = {}
    if os.path.exists(occ_path) and not park:
        occ_meta = json.load(open(os.path.join(GEN, "occluders.json")))
        z = np.load(occ_path)
        for name, m in occ_meta.items():
            frames[f"occ/{name}"] = (z[name], m["anchor"][0], m["anchor"][1])
    atlas, placed = pack(frames)
    out = (np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    if park and "--lossless" not in sys.argv:
        # The park atlas ships as a 256-colour palette PNG (libimagequant, the pngquant library, dither 1.0): about a
        # quarter of the lossless size and indistinguishable on screen (tests/perf/ASSETS.md). --lossless skips it.
        try:
            import imagequant
            img = imagequant.quantize_pil_image(img, dithering_level=1.0, max_colors=256)
        except ImportError:
            print("imagequant is missing (uv run --with imagequant): atlas.png written lossless")
    img.save(os.path.join(out_dir, "atlas.png"), optimize=True)
    meta = {"scale": SCALE, "size": [out.shape[1], out.shape[0]], "frames": {}}
    for name, (x, y, w, h, ax, ay) in sorted(placed.items()):
        fr = {"rect": [x, y, w, h], "anchor": [round(ax, 2), round(ay, 2)]}
        if name.startswith("occ/"):
            m = occ_meta[name[4:]]
            fr.update({"scale": m.get("scale", 1), "at": m["at"], "sortY": m["sortY"]})
        meta["frames"][name] = fr
    json.dump(meta, open(os.path.join(out_dir, "atlas.json"), "w"), separators=(",", ":"))
    print(f"atlas {out.shape[1]}x{out.shape[0]}, {len(placed)} frames")


if __name__ == "__main__":
    main()
