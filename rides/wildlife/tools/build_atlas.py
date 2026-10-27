"""Build rides/wildlife/atlas.webp + atlas.json from the generated sheets on flat magenta (rides/wildlife/gen/*.png).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/wildlife/tools/build_atlas.py [--raw] [--sheet]

For every sprite named in SPRITES below: key the magenta (alpha from the distance to the border's median colour,
colours un-mixed from it), keep that grid cell's pieces, scale the whole family by one factor (so a gull's poses
stay the same size), give it the painting's finish (see finish()), and pack everything into one atlas at D px per
park px. --raw skips the finish (for before/after shots); --sheet also writes gen/atlas_sheet.png, every sprite on
the painting's sea and sand with its name and anchor, for checking by eye.

Anchors (in each frame's own px): flying birds at the body's middle (the centroid of what survives a deep erosion,
so the wings don't move it), standing birds and floating animals at the feet / waterline, heads and backs that the
sheet cuts off at the water at the middle of that cut, splashes at their base, rings at their centre.
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
ROOT = "rides/wildlife"
D = 3.0  # atlas px per park px (canvases draw at 1.5-2.5 device px per park px, so sprites are always shrunk)

# Families: the sheet, its grid, the reference sprite and the size it must have in park px (one scale per family).
FAMILIES = {
    "gull": dict(sheet="gulls_v1_0", grid=(5, 4), ref="gull/side_glide", ref_w=42),
    "pelican": dict(sheet="pelicans_v1_1", grid=(5, 3), ref="pelican/side_glide", ref_w=62),
    "sea": dict(sheet="sea_v1_0", grid=(5, 4), ref="otter/shell", ref_w=38, gridrows={3: 5}),
    "big": dict(sheet="whales_v1_1", grid=(4, 3), ref="dolphin/swim", ref_w=60, gridrows={2: 4}),
}

# name: (family, row, index in the row from the left, anchor kind, options). Anchor kinds: body, feet, cut (flat waterline cut at the bottom),
# base (bottom middle), centre. keep="main" drops loose droplets (keeps the biggest piece and anything touching it).
SPRITES = {
    # Gulls: three views of a flap cycle (side, three-quarter towards us, three-quarter away), landing, standing.
    "gull/side_up": ("gull", 0, 0, "body", {}),
    "gull/side_glide": ("gull", 0, 1, "body", {}),
    "gull/side_down": ("gull", 0, 2, "body", {}),
    "gull/side_bank": ("gull", 0, 4, "body", {}),
    "gull/front_glide": ("gull", 1, 0, "body", {}),
    "gull/front_up": ("gull", 1, 1, "body", {}),
    "gull/front_mid": ("gull", 1, 2, "body", {}),
    "gull/front_down": ("gull", 1, 3, "body", {}),
    "gull/back_glide": ("gull", 2, 0, "body", {}),
    "gull/back_up": ("gull", 2, 1, "body", {}),
    "gull/back_mid": ("gull", 2, 2, "body", {}),
    "gull/back_down": ("gull", 2, 3, "body", {}),
    "gull/land": ("gull", 3, 0, "feet", {}),
    "gull/stand": ("gull", 3, 1, "feet", {}),
    "gull/call": ("gull", 3, 2, "feet", {}),
    "gull/crouch": ("gull", 3, 3, "feet", {}),
    "gull/takeoff": ("gull", 3, 4, "feet", {}),
    # Pelicans: side flap cycle, the dive, sitting on the water, take-off.
    "pelican/side_up": ("pelican", 0, 0, "body", {}),
    "pelican/side_glide": ("pelican", 0, 1, "body", {}),
    "pelican/side_down": ("pelican", 0, 2, "body", {}),
    "pelican/dive_tip": ("pelican", 1, 0, "body", {}),
    "pelican/dive_plunge": ("pelican", 1, 1, "body", {}),
    "pelican/dive_arrow": ("pelican", 1, 2, "body", {}),
    "pelican/sit": ("pelican", 1, 3, "base", {}),
    "pelican/swallow": ("pelican", 1, 4, "base", {}),
    "pelican/takeoff": ("pelican", 2, 3, "body", {}),
    # The sea otter, seal and sea lion heads, fish, splashes.
    "otter/shell": ("sea", 0, 0, "base", {}),
    "otter/groom": ("sea", 0, 1, "base", {"keep": "main"}),
    "otter/sleep": ("sea", 0, 2, "base", {}),
    "otter/swim": ("sea", 0, 3, "base", {"keep": "main"}),
    "otter/dive": ("sea", 0, 4, "cut", {"keep": "main"}),
    "seal/front": ("sea", 1, 0, "cut", {}),
    "seal/right": ("sea", 1, 1, "cut", {}),
    "seal/up": ("sea", 1, 2, "cut", {}),
    "lion/right": ("sea", 1, 3, "cut", {}),
    "lion/bark": ("sea", 1, 4, "cut", {}),
    "fish/up": ("sea", 2, 0, "body", {"keep": "main"}),
    "fish/level": ("sea", 2, 1, "body", {"keep": "main"}),
    "fish/down": ("sea", 2, 2, "body", {"keep": "main"}),
    "splash/crown": ("sea", 2, 3, "base", {}),
    "splash/column": ("sea", 2, 4, "base", {}),
    "splash/drops": ("sea", 3, 2, "base", {}),
    # Dolphins and the whale.
    "dolphin/rise": ("big", 0, 0, "body", {"keep": "main"}),
    "dolphin/top": ("big", 0, 1, "body", {}),
    "dolphin/dive": ("big", 0, 2, "body", {}),
    "dolphin/swim": ("big", 0, 3, "body", {}),
    "whale/back": ("big", 1, 0, "cut", {}),
    "whale/hump": ("big", 1, 1, "cut", {}),
    "whale/fluke": ("big", 1, 2, "cut", {}),
    "whale/spout": ("big", 1, 3, "base", {}),
    "splash/dolphin": ("big", 2, 0, "base", {}),
    "foam/whale": ("big", 2, 3, "centre", {}),
}


def key(rgb):
    """Alpha from the distance to the border's median colour (the flat background), colours un-mixed from it."""
    a = rgb.astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 40) / (130 - 40), 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((a - bg * (1 - alpha[..., None])) / safe, 0, 255)
    return fg, alpha


def pieces(alpha, rows, gridrows=None):
    """The sheet's sprites, row by row: connected pieces are put in the row that holds their centroid; in each row
    the big pieces, left to right, are the sprites, and every small piece (a droplet, a ring's dash) joins the
    nearest big one."""
    lab, n = ndimage.label(alpha > 0.3)
    idx = np.arange(1, n + 1)
    sizes = ndimage.sum(np.ones_like(alpha), lab, idx)
    cents = ndimage.center_of_mass(np.ones_like(alpha), lab, idx)
    H = alpha.shape[0]
    byrow = {}
    for i, (cy, cx) in enumerate(cents):
        if sizes[i] >= 60:
            byrow.setdefault(int(cy * rows / H), []).append((i + 1, sizes[i], cx, cy))
    cell = {}
    W = alpha.shape[1]
    for r, ps in byrow.items():
        if gridrows and r in gridrows:
            # Sprites made of many loose strokes (rings of foam): split this row on a fixed grid of columns instead.
            n = gridrows[r]
            for p in sorted(ps, key=lambda p: -p[1]):
                cell.setdefault((r, int(p[2] * n / W)), []).append(p[0])
            continue
        top = max(p[1] for p in ps)
        major = sorted([p for p in ps if p[1] >= top * 0.08], key=lambda p: p[2])
        groups = [[p[0]] for p in major]
        for p in ps:
            if p[1] >= top * 0.08:
                continue
            k = min(range(len(major)), key=lambda j: (major[j][2] - p[2]) ** 2 + (major[j][3] - p[3]) ** 2)
            groups[k].append(p[0])
        for k, g in enumerate(groups):
            cell[(r, k)] = g
    return lab, cell


def cell_sprite(fg, alpha, lab, cell, row, col, keep):
    got = cell.get((row, col))
    if not got:
        raise SystemExit(f"empty cell {row},{col}")
    ids = got[:1] if keep == "main" else got
    ys, xs = np.where(np.isin(lab, ids))
    m = 8
    y0, y1 = max(0, ys.min() - m), min(alpha.shape[0], ys.max() + m + 1)
    x0, x1 = max(0, xs.min() - m), min(alpha.shape[1], xs.max() + m + 1)
    mask = ndimage.binary_dilation(np.isin(lab[y0:y1, x0:x1], ids), iterations=3)
    return fg[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * mask


def anchor(alpha, kind):
    h, w = alpha.shape
    solid = alpha > 0.5
    ys, xs = np.where(solid)
    if kind == "body":
        # The body is the thickest part: erode until a small core is left; its centroid is the body's middle.
        core = solid
        for _ in range(200):
            nxt = ndimage.binary_erosion(core, iterations=2)
            if nxt.sum() < solid.sum() * 0.04:
                break
            core = nxt
        cy, cx = ndimage.center_of_mass(core)
        return [float(cx), float(cy)]
    if kind in ("feet", "base", "cut"):
        bottom = ys.max()
        row = np.where(solid[max(0, bottom - 3):bottom + 1].any(0))[0]
        return [float((row.min() + row.max()) / 2), float(bottom)]
    return [float(xs.mean()), float(ys.mean())]


def grain_field(shape, scale):
    """The painting's own paper grain: high-pass luminance of flat sand in the HD painting, resampled to atlas px."""
    hd = Image.open("gen/park/world_v2_hd.png").convert("L")
    # Flat dry sand south of the promenade (park 1400-1700 x 1440-1560), 2.5 HD px per park px.
    patch = np.asarray(hd.crop((3500, 3600, 4250, 3900)), np.float32)
    hp = patch - ndimage.gaussian_filter(patch, 6)
    hp /= hp.std() + 1e-6
    im = Image.fromarray(np.clip(hp * 40 + 128, 0, 255).astype(np.uint8))
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.BICUBIC)
    g = (np.asarray(im, np.float32) - 128) / 40
    reps = (shape[0] // g.shape[0] + 2, shape[1] // g.shape[1] + 2)
    return np.tile(g, reps)


def finish(rgb, alpha, grain, oy, ox):
    """The painting's finish at atlas size (rgb 0..255 float, alpha 0..1).

    The generated sprites are a little cleaner, darker-lined and brighter than the painting: outlines here become
    a darker shade of the fill they surround (a warm brown at most, never near-black), whites take the paper's
    cream, colours lose a little saturation, and the painting's own grain is laid over the fills.
    """
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    solid = alpha > 0.6
    # Ink: the dark line pixels. Their replacement is the local fill (a blur of the non-ink pixels nearby), darkened.
    ink = np.clip((105 - lum) / 45, 0, 1) * solid
    fillw = (alpha * (1 - ink))[..., None]
    k = 3.0
    num = ndimage.gaussian_filter(rgb * fillw, (k, k, 0))
    den = ndimage.gaussian_filter(fillw, (k, k, 0)) + 1e-4
    fill = num / den
    tinted = fill * np.array([0.50, 0.46, 0.44], np.float32) + np.array([18, 10, 6], np.float32)
    out = rgb * (1 - 0.32 * ink[..., None]) + tinted * (0.32 * ink[..., None])
    # Whites take the painting's own white (its foam measures 245, 240, 233; the sheets' whites are yellower),
    # and everything loses a little saturation and brightness.
    w = 0.6 * np.clip((lum - 200) / 45, 0, 1)[..., None]
    paper = np.array([245, 240, 233], np.float32) * (lum / 241)[..., None]
    out = out * (1 - w) + paper * w
    grey = (out @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    out = grey + (out - grey) * 0.86
    out = out * 0.975
    # Grain, as the painting's: about 2.5% of the fill's brightness.
    g = grain[oy:oy + rgb.shape[0], ox:ox + rgb.shape[1]][..., None]
    out = out * (1 + 0.035 * g)
    return np.clip(out, 0, 255)


def main():
    raw = "--raw" in sys.argv
    sheets, scales, frames, images = {}, {}, {}, {}
    cut = {}
    for name, (fam, row, col, kind, opt) in SPRITES.items():
        F = FAMILIES[fam]
        if F["sheet"] not in sheets:
            fg, al = key(np.asarray(Image.open(f"{ROOT}/gen/{F['sheet']}.png").convert("RGB")))
            sheets[F["sheet"]] = (fg, al, *pieces(al, F["grid"][1], F.get("gridrows")))
        fg, al, lab, cell = sheets[F["sheet"]]
        cut[name] = cell_sprite(fg, al, lab, cell, row, col, opt.get("keep"))
    for fam, F in FAMILIES.items():
        rgb, a = cut[F["ref"]]
        xs = np.where((a > 0.5).any(0))[0]
        scales[fam] = F["ref_w"] * D / (xs.max() - xs.min() + 1)
    grain = None if raw else grain_field((4096, 4096), D / 2.5)
    for name, (fam, row, col, kind, opt) in SPRITES.items():
        rgb, a = cut[name]
        s = scales[fam]
        w, h = max(1, round(a.shape[1] * s)), max(1, round(a.shape[0] * s))
        # Shrink premultiplied, so the keyed edge doesn't pick up a dark or magenta fringe.
        pm = np.dstack([rgb * a[..., None], a * 255]).astype(np.float32)
        chans = [np.asarray(Image.fromarray(pm[..., i]).resize((w, h), Image.LANCZOS), np.float32) for i in range(4)]
        A = np.clip(chans[3] / 255, 0, 1)
        RGB = np.dstack(chans[:3]) / np.maximum(A, 1e-3)[..., None]
        RGB = np.clip(RGB, 0, 255)
        if not raw:
            rs = np.random.default_rng(abs(hash(name)) % 2**32)
            RGB = finish(RGB, A, grain, int(rs.integers(0, 1024)), int(rs.integers(0, 1024)))
        A[A < 0.01] = 0
        images[name] = np.dstack([RGB, A * 255]).astype(np.uint8)
        frames[name] = {"anchor": [round(v, 1) for v in anchor(A, kind)], "size": [w, h]}
    # Shelf packing, tallest first, 1 px gutters plus 1 px of transparent margin around each frame.
    order = sorted(images, key=lambda n: -images[n].shape[0])
    AW, x, y, shelf = 768, 1, 1, 0
    for n in order:
        h, w = images[n].shape[:2]
        if x + w + 2 > AW:
            x, y, shelf = 1, y + shelf + 2, 0
        frames[n]["rect"] = [x, y, w, h]
        x += w + 2
        shelf = max(shelf, h)
    AH = y + shelf + 1
    atlas = np.zeros((AH, AW, 4), np.uint8)
    for n, im in images.items():
        fx, fy, w, h = frames[n]["rect"]
        atlas[fy:fy + h, fx:fx + w] = im
    out = f"{ROOT}/atlas{'_raw' if raw else ''}"
    # Lossy colour (q 90: about 3.6 levels mean error on opaque pixels), lossless alpha, so edges stay clean.
    Image.fromarray(atlas).save(out + ".webp", quality=90, alpha_quality=100, method=6)
    meta = {
        "about": "rides/wildlife sprites, built by rides/wildlife/tools/build_atlas.py from rides/wildlife/gen sheets. "
                 "rect = x, y, w, h in atlas px; anchor = x, y in the frame's own px; density = atlas px per park px.",
        "density": D, "size": [AW, AH],
        "frames": {n: {"rect": frames[n]["rect"], "anchor": frames[n]["anchor"]} for n in sorted(frames)},
    }
    json.dump(meta, open(out + ".json", "w"), indent=1)
    print(out + ".webp", AW, "x", AH, "scales", {k: round(v, 4) for k, v in scales.items()})
    for n in sorted(frames):
        print(f"  {n:22s} {frames[n]['size'][0] / D:6.1f} x {frames[n]['size'][1] / D:5.1f} park px  anchor {frames[n]['anchor']}")
    if "--sheet" in sys.argv:
        check_sheet(atlas, meta)


def check_sheet(atlas, meta):
    """Every sprite at 3x its on-screen size over a strip of the painting's sea and sand, its anchor marked."""
    from PIL import ImageDraw
    hd = Image.open("gen/park/world_v2_hd.png").convert("RGB")
    sea = hd.crop((4000, 4900, 4000 + 1000, 4900 + 400))  # open water, 2.5 px per park px
    names = sorted(meta["frames"])
    cols, cw, ch = 8, 240, 200
    rows = (len(names) + cols - 1) // cols
    k = 3 * 2.5 / D  # 3x a 1:1 park view, at the HD painting's density
    sheet = Image.new("RGB", (cols * cw, rows * ch))
    bg = sea.resize((cw, ch))
    d = ImageDraw.Draw(sheet)
    A = Image.fromarray(atlas)
    for i, n in enumerate(names):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        sheet.paste(bg, (cx, cy))
        f = meta["frames"][n]
        x, y, w, h = f["rect"]
        sp = A.crop((x, y, x + w, y + h))
        sp = sp.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        ax, ay = f["anchor"][0] * k, f["anchor"][1] * k
        px, py = round(cx + cw / 2 - ax), round(cy + ch * 0.6 - ay)
        sheet.paste(sp, (px, py), sp)
        d.ellipse([cx + cw / 2 - 2, cy + ch * 0.6 - 2, cx + cw / 2 + 2, cy + ch * 0.6 + 2], outline=(255, 0, 0))
        d.text((cx + 4, cy + 4), n, fill=(255, 255, 255))
    sheet.save(f"{ROOT}/gen/atlas_sheet.png")
    print(f"{ROOT}/gen/atlas_sheet.png")


if __name__ == "__main__":
    main()
