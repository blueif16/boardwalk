"""The beach layer's atlas: beach pose sheets, the residents' own crowd frames, props and small things, one texture.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/beach/tools/build.py [--debug]

Inputs (all generated at 3840 x 2560, see rides/beach/RESULTS.md):
  rides/beach/gen/beach_<species>_0.png   4 x 3 beach pose sheets on white (prompts/beach_sheet.txt)
  tests/characters/gen/sheet_<species>_0.png   the cast's own sheets (stand, walk, act), cut exactly as the crowd's
                                          build cuts them (tests/characters/tools/build_atlas.py, imported)
  rides/beach/gen/props_v1_1.png          5 x 4 props on magenta (umbrellas, tower, chairs, castles, boards, rings)
  rides/beach/gen/smalls_v1_0.png         4 x 4 on magenta (towels seen from above, gulls, kite, crab, basket, hat)
Writes rides/beach/atlas.webp (lossy, alpha) and atlas.json: frames with rect and anchor in atlas px and their own
scale (atlas px per unit). Characters are in the crowd's stage units (drawn at the crowd's K, as crowd.js draws
them); everything else is in park px. --debug writes gen/atlas_check.png (every frame over sand, labelled).

Characters are cut and outlined exactly as the crowd's atlas so residents and the crowd look alike. Props get the
finishing pass the painting asks for: a warm paper tint, a little less saturation, the painting's own paper grain
(a high-pass of its flat sand), and whites no brighter than the painting's.
"""
import importlib.util, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
BEACH = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(BEACH))
GEN = os.path.join(BEACH, "gen")
spec = importlib.util.spec_from_file_location("crowd_atlas", os.path.join(ROOT, "tests/characters/tools/build_atlas.py"))
CA = importlib.util.module_from_spec(spec)
spec.loader.exec_module(CA)
CA.SCALE = 2          # the park crowd's density: 2 atlas px per stage px
PX = 2                # props: atlas px per park px (the canvas shows 1.5)

# Species with a beach sheet (and their own crowd frames); species that only need their crowd frames.
BEACH_SPECIES = ["bear", "bunny", "panda", "fox", "pig", "crocodile", "penguin", "otter", "koala", "duck", "bunny_kid", "fox_kid"]
EXTRA_SPECIES = ["seal", "frog", "hippo", "sheep", "cat_orange", "tiger", "deer", "pet_corgi"]
ACTS = {"tiger": ("back_act",), "pet_corgi": ("side_act",)}  # kite string held up; the dog's sniff
BEACH_POSES = [["lie_back", "lie_read", "lie_nap", "sit_lean"], ["run", "spike", "pass", "kneel"], ["stand2", "wave", "cheer", "sunscreen"]]
# Props: name, target size in park px ("h" height or "w" width), anchor ("base": bottom centre; "mid": centre).
PROPS = [
    [("umbrella_red", "h", 66, "pole"), ("umbrella_blue", "h", 66, "pole"), ("umbrella_mint", "h", 66, "pole"), ("umbrella_pink", "h", 66, "pole"), ("tower", "h", 100, "base")],
    [("chair_blue", "h", 30, "base"), ("chair_red", "h", 30, "base"), ("cooler", "w", 24, "base"), ("bucket", "h", 13, "base"), ("bag", "h", 19, "base")],
    [("castle_small", "h", 24, "base"), ("castle_big", "h", 30, "base"), ("surf_red", "h", 46, "base"), ("surf_mint", "h", 46, "base"), ("bodyboard", "w", 30, "mid")],
    [("ring_pink", "w", 30, "mid"), ("ring_duck", "w", 34, "mid"), ("beachball", "w", 10, "mid"), ("volleyball", "w", 8, "mid"), ("flipflops", "w", 13, "base")],
]
SMALLS = [
    [("towel_red", "w", 64, "mid"), ("towel_teal", "w", 64, "mid"), ("towel_sun", "w", 64, "mid"), ("towel_dots", "w", 64, "mid")],
    [("towel_mint", "w", 64, "mid"), ("towel_wave", "w", 64, "mid"), ("towel_peach", "w", 64, "mid"), ("towel_rainbow", "w", 64, "mid")],
    [("gull_stand", "h", 13, "base"), ("gull_walk", "h", 13, "base"), ("gull_up", "w", 19, "mid"), ("gull_down", "w", 17, "mid")],
    [("kite", "h", 30, "kite"), ("crab", "w", 9, "base"), ("basket", "h", 15, "base"), ("hat", "w", 14, "base")],
]
# Cut but not shipped: the gulls (rides/wildlife owns the birds), the crab and the pink ring (not placed yet).
UNUSED = {"gull_stand", "gull_walk", "gull_up", "gull_down", "crab", "ring_pink"}
# Towels are drawn as ground-plane quads, so they keep their full texture (at 2 px per park px of their length).


def key_magenta(rgb):
    """Alpha from the distance to the flat background colour, colour un-mixed from it (rides/pirate/tools/key_view.py)."""
    a = rgb.astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 40) / (130 - 40), 0, 1)
    # Background seen through gaps (between a railing's bars) comes out as strong magenta-purple: drop it too.
    mag = np.minimum(a[..., 0], a[..., 2]) - a[..., 1]
    alpha = alpha * np.clip((115 - mag) / 45, 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((a - bg * (1 - alpha[..., None])) / safe, 0, 255)
    return fg, alpha


def despill(rgb, alpha, reach=5):
    """Take the magenta background's tint out of the edges (within `reach` px of transparency): where red and blue
    both stand above green, pull them down towards it. The interior keeps its own pinks."""
    edge = ndimage.distance_transform_edt(alpha > 0.5) <= reach
    c = rgb.astype(np.float32)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    m = np.minimum(r, b)
    spill = np.clip(m - g - 4, 0, None) * edge * (np.abs(r - b) < 70)
    c[..., 0] -= spill * 0.85
    c[..., 2] -= spill * 0.85
    return np.clip(c, 0, 255)


def grid_parts(alpha, rows, cols, keep=0.05):
    """Per grid cell: the mask of its object (components centred in the cell, at least `keep` of the largest)."""
    H, W = alpha.shape
    solid = ndimage.binary_closing(alpha > 0.5, iterations=2)
    lab, n = ndimage.label(solid)
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    cents = ndimage.center_of_mass(solid, lab, range(1, n + 1))
    cells = {}
    for i in range(n):
        if sizes[i] < 200:
            continue
        cy, cx = cents[i]
        k = (min(rows - 1, int(cy / (H / rows))), min(cols - 1, int(cx / (W / cols))))
        cells.setdefault(k, []).append((sizes[i], i + 1))
    out = {}
    for k, comps in cells.items():
        big = max(s for s, _ in comps)
        labels = [l for s, l in comps if s >= keep * big]
        m = np.isin(lab, labels)
        m = ndimage.binary_dilation(m, iterations=3)
        ys, xs = np.where(m)
        out[k] = (m, ys.min(), ys.max() + 1, xs.min(), xs.max() + 1)
    return out


def paper_grain():
    """The painting's paper grain: a high-pass of its flat sand, relative to the local mean, at PX px per park px."""
    hd = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png"))
    crop = hd.crop((int(2920 * 2.5), int(1770 * 2.5), int(3320 * 2.5), int(1930 * 2.5))).convert("L")
    crop = crop.resize((round(crop.width * PX / 2.5), round(crop.height * PX / 2.5)), Image.LANCZOS)
    a = np.asarray(crop).astype(np.float32)
    g = a / ndimage.gaussian_filter(a, 6) - 1
    g = np.clip(g, -0.06, 0.06)
    return g


GRAIN = None


def finish(rgb, alpha, strength=1.0):
    """The finishing pass: warm paper tint, a little less saturation, whites like the painting's, paper grain."""
    global GRAIN
    if GRAIN is None:
        GRAIN = paper_grain()
    c = rgb.astype(np.float32) / 255
    lum = (c * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
    c = lum + (c - lum) * (1 - 0.1 * strength)
    c = c * (1 - (1 - np.array([1.0, 0.975, 0.925])) * strength)
    c = np.minimum(c, np.array([0.985, 0.955, 0.9]))
    h, w = alpha.shape
    gy, gx = GRAIN.shape
    g = np.tile(GRAIN, (h // gy + 1, w // gx + 1))[:h, :w]
    c = c * (1 + 1.4 * strength * g[..., None])
    return np.dstack([np.clip(c, 0, 1), alpha])


def soft_outline(arr, width=1.1, alpha=0.55):
    """A thin outer ring in a darkened copy of the nearest colour (the painting's tinted outlines), under the art."""
    al = arr[..., 3]
    pad = 3
    al_p = np.pad(al, pad)
    rgb_p = np.pad(arr[..., :3], ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    dist, (iy, ix) = ndimage.distance_transform_edt(al_p < 0.5, return_indices=True)
    near = rgb_p[iy, ix]
    ink = near * 0.42 + np.array([44, 32, 27]) / 255 * 0.3
    ring = np.clip(width + 0.5 - dist, 0, 1) * alpha
    a_out = al_p + ring * (1 - al_p)
    rgb = (rgb_p * al_p[..., None] + ink * (ring * (1 - al_p))[..., None]) / np.maximum(a_out[..., None], 1e-4)
    return np.dstack([np.clip(rgb, 0, 1), np.clip(a_out, 0, 1)]), pad


def cut_props(path, table, finish_strength=1.0, outline=True):
    rgb, alpha = key_magenta(np.asarray(Image.open(path).convert("RGB")))
    rgb = despill(rgb, alpha)
    rows, cols = len(table), len(table[0])
    parts = grid_parts(alpha, rows, cols)
    frames = {}
    for r, row in enumerate(table):
        for c, (name, dim, size, anchor) in enumerate(row):
            if name in UNUSED:
                continue
            if (r, c) not in parts:
                print(f"{os.path.basename(path)}: no object in cell {r},{c} ({name})", file=sys.stderr)
                continue
            m, y0, y1, x0, x1 = parts[(r, c)]
            a = (alpha * m)[y0:y1, x0:x1]
            col = rgb[y0:y1, x0:x1]
            s = size * PX / ((y1 - y0) if dim == "h" else (x1 - x0))
            im = Image.fromarray(np.dstack([col, a * 255]).astype(np.uint8), "RGBA")
            w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
            arr = CA.premul_resize(im, (w, h))
            arr = CA.sharpen(arr)
            arr = finish((arr[..., :3] * 255), arr[..., 3], finish_strength)
            pad = 0
            if outline:
                arr, pad = soft_outline(arr)
            if anchor == "mid":
                ax, ay = w / 2, h / 2
            elif anchor == "pole":  # the pole's foot: the lowest opaque column near the middle
                aa = arr[..., 3] > 0.5
                ys, xs = np.where(aa)
                bottom = ys.max()
                xs_b = xs[ys >= bottom - 2]
                ax, ay = float(xs_b.mean()) - pad + 0.5, bottom - pad - 0.12 * h
            elif anchor == "kite":
                ax, ay = w * 0.62, h * 0.95  # the tail's end, where the string is tied is near the kite's lower corner
            else:
                ax, ay = w / 2, h - 0.06 * h
            frames[name] = (arr, ax + pad, ay + pad, PX)
    return frames


def char_frames(name, height, beach):
    """The crowd's own 12 frames of a species and, with a beach sheet, its 12 beach poses (in stage units)."""
    out = {}
    for k, (arr, ax, ay) in CA.sheet_frames(name, height).items():
        pose = k.split("/")[1]
        if pose in ("side_act", "back_act") and pose not in ACTS.get(name, ()):
            continue  # the ice cream and the photo: only where the beach uses them
        out[k] = (arr, ax, ay, CA.SCALE)
    if not beach:
        return out
    path = os.path.join(GEN, f"beach_{name}_0.png")
    if not os.path.exists(path):
        print(f"{name}: no beach sheet", file=sys.stderr)
        return out
    rgb = np.asarray(Image.open(path).convert("RGB"))
    fg = CA.key_background(rgb)
    parts = grid_parts(fg.astype(np.float32), 3, 4, keep=0.22)
    missing = [(r, c) for r in range(3) for c in range(4) if (r, c) not in parts]
    if missing:
        print(f"{name}: beach sheet missing cells {missing}", file=sys.stderr)
    if (2, 0) not in parts:
        return out
    _, y0, y1, _, _ = parts[(2, 0)]
    # The standing reference (row 3, column 1) is scaled exactly as the crowd scales its standing frames.
    s = height * CA.SCALE / (y1 - y0 - 6)
    for (r, c), (m, y0, y1, x0, x1) in parts.items():
        pose = BEACH_POSES[r][c]
        if pose == "stand2":
            continue  # only the scale reference
        a = (fg & m)[y0:y1, x0:x1]
        im = Image.fromarray(np.dstack([rgb[y0:y1, x0:x1], a * 255]).astype(np.uint8), "RGBA")
        w, h = im.size
        arr = CA.premul_resize(im, (max(1, round(w * s)), max(1, round(h * s))))
        arr = CA.sharpen(arr)
        arr, pad = CA.outline(arr, 0.8 * CA.SCALE)
        aa = a > 0
        rows_ = np.where(aa.any(1))[0]
        if r == 0 and c < 3:  # lying: the body's middle, on the ground under it
            cols_ = np.where(aa.any(0))[0]
        else:  # standing, kneeling, sitting: under the head and body, as the crowd's frames
            cols_ = np.where(aa[: max(1, int(h * 0.5))].any(0))[0]
        ax = (cols_.min() + cols_.max() + 1) / 2 * s + pad
        ay = (rows_.max() + 1) * s + pad
        if r == 0 and c < 3:
            ay -= 0.12 * h * s  # lying bodies are drawn a little from above: their contact is above the lowest pixel
        view = "side" if r == 1 else "front"
        out[f"{name}/{pose}"] = (arr, ax, ay, CA.SCALE)
    return out


def procedural():
    out = {}
    # Soft contact shadow, park px 32 x 12 at PX: a violet-brown multiply-like tone, as the painting's shadows.
    w, h = 32 * PX, 12 * PX
    y, x = np.mgrid[0:h, 0:w]
    d = np.sqrt(((x - w / 2 + 0.5) / (w / 2)) ** 2 + ((y - h / 2 + 0.5) / (h / 2)) ** 2)
    al = np.clip(1 - d, 0, 1) ** 1.2 * 0.42
    out["shadow"] = (np.dstack([np.broadcast_to(np.array([150, 112, 98]) / 255, (h, w, 3)), al]), w / 2, h / 2, PX)
    # Ripple ring round a swimmer: a broken white ellipse, 30 x 10 park px.
    w, h = 34 * PX, 12 * PX
    y, x = np.mgrid[0:h, 0:w]
    ex, ey = (x - w / 2 + 0.5) / (w / 2 - 2), (y - h / 2 + 0.5) / (h / 2 - 2)
    r = np.sqrt(ex ** 2 + ey ** 2)
    ang = np.arctan2(ey, ex)
    ring = np.clip(1.25 - np.abs(r - 0.8) / 0.16, 0, 1) * (0.6 + 0.4 * np.cos(ang * 3 + 0.7) ** 2)
    ring *= np.where(ey < 0, 0.55, 1.0)
    out["ripple"] = (np.dstack([np.broadcast_to(np.array([250, 252, 250]) / 255, (h, w, 3)), np.clip(ring, 0, 1)]), w / 2, h / 2, PX)
    # A splash: white specks in a fan, 14 x 9 park px, anchored at its foot.
    rng = np.random.default_rng(3)
    w, h = 16 * PX, 10 * PX
    im = Image.new("L", (w * 4, h * 4), 0)
    dr = ImageDraw.Draw(im)
    for _ in range(26):
        a = rng.uniform(-2.6, -0.5); rr = rng.uniform(0.2, 1)
        cx = w * 2 + np.cos(a) * rr * w * 1.8; cy = h * 4 - 4 + np.sin(a) * rr * h * 3.6
        s = rng.uniform(2, 5)
        dr.ellipse([cx - s, cy - s, cx + s, cy + s], fill=255)
    a = np.asarray(im.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
    out["splash"] = (np.dstack([np.broadcast_to(np.array([252, 253, 250]) / 255, (h, w, 3)), a * 0.95]), w / 2, h - 1, PX)
    # Solid texels for lines (kite string, net posts, court ropes): white, tinted per use by vertex colour.
    out["white"] = (np.dstack([np.ones((6, 6, 3)), np.ones((6, 6))]), 3, 3, PX)
    # The volleyball net's mesh, mapped onto its ground-perpendicular quad: a cream tape on top, a soft mesh below.
    w, h = 240, 48
    im = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    mesh = (64, 56, 60, 165)
    for i in range(0, w * 2, 9):
        dr.line([(i, 14), (i, h * 2 - 6)], fill=mesh, width=2)
    for j in range(14, h * 2 - 4, 9):
        dr.line([(0, j), (w * 2, j)], fill=mesh, width=2)
    dr.rectangle([0, 0, w * 2, 18], fill=(250, 244, 230, 255))
    dr.rectangle([0, 0, w * 2, 18], outline=(110, 92, 80, 255), width=3)
    dr.rectangle([0, h * 2 - 8, w * 2, h * 2 - 1], fill=(96, 140, 200, 235))
    arr = np.asarray(im.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
    out["net"] = (arr, 0, 0, w / 100)  # drawn as a quad by its corners; the scale is unused
    return out


def main():
    frames = {}
    for n in BEACH_SPECIES:
        frames.update(char_frames(n, CA.SHEETS[n], True))
    for n in EXTRA_SPECIES:
        frames.update(char_frames(n, CA.SHEETS[n], False))
    frames.update(cut_props(os.path.join(GEN, "props_v1_1.png"), PROPS))
    frames.update(cut_props(os.path.join(GEN, "smalls_v1_0.png"), SMALLS))
    frames.update(procedural())
    packed = {k: (v[0], v[1], v[2]) for k, v in frames.items()}
    atlas, placed = CA.pack(packed, width=2048, gap=4)
    out = (np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    img.save(os.path.join(BEACH, "atlas.webp"), quality=78, alpha_quality=100, method=6)
    meta = {"about": "rides/beach/tools/build.py: rect, anchor in atlas px; scale = atlas px per unit (characters: crowd stage units, drawn at the crowd's K; everything else: park px)", "size": [out.shape[1], out.shape[0]], "frames": {}}
    for name, (x, y, w, h, ax, ay) in sorted(placed.items()):
        meta["frames"][name] = {"rect": [x, y, w, h], "anchor": [round(ax, 2), round(ay, 2)], "scale": frames[name][3]}
    json.dump(meta, open(os.path.join(BEACH, "atlas.json"), "w"), separators=(",", ":"))
    print(f"atlas {out.shape[1]}x{out.shape[0]}, {len(placed)} frames, {os.path.getsize(os.path.join(BEACH, 'atlas.webp')) // 1024} KB")
    if "--debug" in sys.argv:
        check(img, meta)


def check(img, meta):
    """Every frame at 4x its drawn size over painted-sand colour, with its anchor marked, for review."""
    items = sorted(meta["frames"].items())
    cw, ch = 150, 150
    cols = 14
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), (253, 222, 172))
    dr = ImageDraw.Draw(sheet)
    for i, (name, f) in enumerate(items):
        x, y, w, h = f["rect"]
        k = (2.5 if f["scale"] == CA.SCALE and "/" in name else 2) / f["scale"] * (1.246 if "/" in name else 1)
        fr = img.crop((x, y, x + w, y + h))
        fr = fr.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        if fr.width > cw - 6 or fr.height > ch - 20:
            q = min((cw - 6) / fr.width, (ch - 20) / fr.height)
            fr = fr.resize((max(1, round(fr.width * q)), max(1, round(fr.height * q))), Image.LANCZOS)
        ox, oy = (i % cols) * cw + (cw - fr.width) // 2, (i // cols) * ch + 4
        sheet.paste(fr, (ox, oy), fr)
        dr.text(((i % cols) * cw + 3, (i // cols) * ch + ch - 14), name[:24], fill=(80, 40, 40))
    sheet.save(os.path.join(GEN, "atlas_check.png"))


if __name__ == "__main__":
    main()
