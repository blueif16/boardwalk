"""Swing-chair sheet (rides/swings/gen/chairs_v1_1.png: 5 views x 6 chairs on flat magenta) -> keyed, scaled,
anchored atlas for the layer.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/swings/tools/build_chairs.py [--debug OUT.png]

- Key: alpha from the colour distance to the sheet's magenta (measured on its border), colours un-mixed from it.
- Cells: rows and columns found as runs between empty bands (a fixed grid cuts the doubles' chain rings, which reach
  up into the row above); in each, the chair's bounding box. The sheet's fourth column faces left and away, the
  mirror of what was asked, so it is flipped.
- Scale: per row, so the front view is FRONT_W park px wide (single 14, double 21); every view of a row shares it.
- Anchors (park px from the frame's top-left): rings, the chain rings at the top of the side frames (one or two
  blobs in the top 16% of the frame); hang, their midpoint; seat, where a rider sits (the seat's top surface,
  measured per view as a share of the frame height on gridded zooms); cut, the row that splits the chair into the
  part drawn behind a rider (the backrest, above) and in front (seat front, safety bar, footrest, below).
Writes rides/swings/chairs.webp (4 px per park px, lossy RGBA) and rides/swings/chairs.json.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
SRC = os.path.join(RIDE, "gen/chairs_v1_1.png")
OUT_D = 4.0
VIEWS = ["side", "q_toward", "front", "q_away", "back"]
ROWS = [("yellow", 1), ("green", 1), ("red", 1), ("blue", 1), ("orange", 2), ("pink", 2)]
FRONT_W = {1: 14.0, 2: 21.0}   # the sheet drew doubles 1.25x as wide as singles; 21 keeps them 1.16x as tall
FLIP = {"q_away"}
# seat surface and cut line, as shares of the frame's height from its top (gridded zooms of row 1 and row 5)
SEAT = {"side": 0.66, "q_toward": 0.58, "front": 0.60, "q_away": 0.62, "back": 0.66}
# rings per view, and their shares of the frame where the finder can't separate a ring from the backrest (the
# three-quarter view towards: the left ring's pole runs into the backrest's top; measured on a gridded zoom)
EXPECT = {"side": 1, "q_toward": 2, "front": 2, "q_away": 2, "back": 2}
RING_SHARE = {"q_toward": [[0.202, 0.110], [0.618, 0.071]]}
CUT = {"side": 0.58, "q_toward": 0.52, "front": 0.55, "q_away": 0.0, "back": 0.0}


def key(im):
    a = im.astype(np.float32)
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    bg = np.median(border, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 40) / 90, 0, 1)
    alpha = ndimage.binary_opening(alpha > 0.02, iterations=1) * alpha
    # Decontaminate: un-mixing leaves magenta in the soft edge (a purple fringe at screen size), so every pixel that
    # isn't solid takes the colour of the nearest solid one, and the edge is pulled in by 2 sheet px (about 0.1 park
    # px); the chairs' own dark outline is several px wide, so it stays the edge.
    solid = ndimage.binary_erosion(alpha > 0.97, iterations=2)
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    col = a[iy, ix]
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    alpha = ndimage.gaussian_filter(alpha, 0.7)
    return np.clip(col, 0, 255), alpha, bg


def bands(prof, minlen):
    """Runs of occupied rows (or columns) separated by empty ones: the sheet's rows and cells."""
    out, start = [], None
    for i, v in enumerate(prof):
        if v >= 3 and start is None:
            start = i
        if v < 3 and start is not None:
            if i - start >= minlen:
                out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(prof)))
    return out


def main():
    debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    im = np.asarray(Image.open(SRC).convert("RGB"))
    rgb, alpha, bg = key(im)
    occ = alpha > 0.3
    rbands = bands(occ.sum(1), 20)
    assert len(rbands) == 6, rbands
    frames, sprites = {}, []
    for ri, (colour, seats) in enumerate(ROWS):
        cells = []
        y0, y1 = rbands[ri][0] - 4, rbands[ri][1] + 4
        cbands = bands(occ[y0:y1].sum(0), 20)
        assert len(cbands) == 5, cbands
        for ci, view in enumerate(VIEWS):
            x0, x1 = cbands[ci][0] - 4, cbands[ci][1] + 4
            al = alpha[y0:y1, x0:x1]
            lab, n = ndimage.label(al > 0.5)
            sizes = ndimage.sum(al > 0.5, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 0.002 * sizes.max() or s > 150])
            keep = ndimage.binary_dilation(keep, iterations=3)
            ys, xs = np.where(keep & (al > 0.02))
            by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            c_rgb = rgb[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1]
            c_al = (al * keep)[by0:by1, bx0:bx1]
            if view in FLIP:
                c_rgb, c_al = c_rgb[:, ::-1], c_al[:, ::-1]
            cells.append((view, c_rgb, c_al))
        front = next(c for c in cells if c[0] == "front")
        s = FRONT_W[seats] / front[2].shape[1]   # park px per sheet px
        for view, c_rgb, c_al in cells:
            h, w = c_al.shape
            # chain rings: blobs in the top 16% of the frame
            top = c_al[: max(4, int(h * 0.16))] > 0.5
            lab, n = ndimage.label(top)
            rings = []
            for i in range(1, n + 1):
                yy, xx = np.where(lab == i)
                # a ring (with the top of its pole) is narrow and starts near the frame's top; the backrest's top,
                # which reaches into the top band in side views, is wide
                if len(xx) > 30 and yy.min() <= 0.12 * h and xx.max() - xx.min() <= 0.18 * w:
                    rings.append((float(xx.mean()), float(yy.mean())))
            rings.sort()
            if len(rings) > 2:
                rings = [rings[0], rings[-1]]
            if not rings:
                rings = [(w / 2, 4.0)]
            hang = (sum(r[0] for r in rings) / len(rings), sum(r[1] for r in rings) / len(rings))
            pw, ph = max(1, round(w * s * OUT_D)), max(1, round(h * s * OUT_D))
            rgba = np.dstack([c_rgb * c_al[..., None], c_al * 255]).astype(np.float32)  # premultiplied for resizing
            img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").resize((pw, ph), Image.LANCZOS)
            arr = np.asarray(img).astype(np.float32)
            a_ = arr[..., 3:] / 255
            arr[..., :3] = np.where(a_ > 0, arr[..., :3] / np.maximum(a_, 1e-3), 0)
            name = f"{colour}/{view}"
            sprites.append((name, Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")))
            frames[name] = {
                "size": [round(w * s, 3), round(h * s, 3)],
                "rings": [[round(x * s, 3), round(y * s, 3)] for x, y in rings],
                "hang": [round(hang[0] * s, 3), round(hang[1] * s, 3)],
                "seat": [round(w * s / 2, 3), round(h * s * SEAT[view], 3)],
                "cut": round(h * s * CUT[view], 3),
                "seats": seats,
            }
    # rings and hang point per view: the median share over the rows (every row is drawn alike; a ring the finder
    # misses in one frame doesn't move that frame's chains)
    for view in VIEWS:
        names = [f"{c}/{view}" for c, _ in ROWS]
        nring = int(np.median([len(frames[n]["rings"]) for n in names]))
        shares = [[[x / frames[n]["size"][0], y / frames[n]["size"][1]] for x, y in frames[n]["rings"]] for n in names if len(frames[n]["rings"]) == nring]
        med = np.median(np.array(shares), 0)
        if nring < EXPECT[view]:
            med = np.array(RING_SHARE[view])
        for n in names:
            w, h = frames[n]["size"]
            frames[n]["rings"] = [[round(float(x * w), 3), round(float(y * h), 3)] for x, y in med]
            frames[n]["hang"] = [round(float(med[:, 0].mean() * w), 3), round(float(med[:, 1].mean() * h), 3)]
    # pack in rows
    AW, pad = 512, 2
    x = y = rowh = 0
    for name, img in sprites:
        if x + img.width + pad > AW:
            x, y, rowh = 0, y + rowh + pad, 0
        frames[name]["rect"] = [x, y, img.width, img.height]
        x += img.width + pad
        rowh = max(rowh, img.height)
    AH = y + rowh
    atlas = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
    for name, img in sprites:
        r = frames[name]["rect"]
        atlas.paste(img, (r[0], r[1]))
    atlas.save(os.path.join(RIDE, "chairs.webp"), quality=90, alpha_quality=100, method=6)
    json.dump({"density": OUT_D, "size": [AW, AH], "views": VIEWS, "chairs": [c for c, _ in ROWS], "frames": frames},
              open(os.path.join(RIDE, "chairs.json"), "w"), indent=1)
    print(f"chairs.webp {AW} x {AH}, {os.path.getsize(os.path.join(RIDE, 'chairs.webp')) // 1024} KB; key colour {np.round(bg).tolist()}")
    if debug:
        Z = 4
        sheet = Image.new("RGB", (AW * Z, AH * Z), (60, 70, 80))
        big = atlas.resize((AW * Z, AH * Z), Image.NEAREST)
        sheet.paste(big, (0, 0), big)
        d = ImageDraw.Draw(sheet)
        for name, f in frames.items():
            rx, ry = f["rect"][0], f["rect"][1]
            k = OUT_D * Z
            for rx_, ry_ in f["rings"]:
                d.ellipse([(rx + rx_ * OUT_D) * Z - 4, (ry + ry_ * OUT_D) * Z - 4, (rx + rx_ * OUT_D) * Z + 4, (ry + ry_ * OUT_D) * Z + 4], outline=(0, 255, 255), width=2)
            sx, sy = f["seat"]
            d.ellipse([rx * Z + sx * k - 5, ry * Z + sy * k - 5, rx * Z + sx * k + 5, ry * Z + sy * k + 5], fill=(255, 40, 40))
            if f["cut"]:
                d.line([(rx * Z, ry * Z + f["cut"] * k), (rx * Z + f["rect"][2] * Z, ry * Z + f["cut"] * k)], fill=(255, 255, 0), width=2)
        sheet.save(debug)
        print(debug, sheet.size)


if __name__ == "__main__":
    main()
