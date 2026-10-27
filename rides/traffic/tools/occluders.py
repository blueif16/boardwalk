"""Front cut-outs from the painting: every painted object a moving thing can pass behind (palms, street trees, shrubs,
lamps, signs, poles, building fronts, rides), as the painting's own pixels with a sort line at the object's ground
contact. Reusable for any layer that draws things standing on the painting (cars, the crowd, ride riders).

Library (rides/traffic/tools/make_occluders.py is the traffic layer's use of it):
  band = load_band(y0, y1, patches)            # the painting (+ RGBA patches over it), HD and park px
  cls = classify(band.park, y0, yellow=line)   # road palette / flat ground / ink
  reach = sweep(paths, band.shape, y0, ...)    # where the moving things' bodies can be
  pieces = find(band.park, cls, reach, y0)     # objects, chunked, each with sortY = its foot
  write(pieces, band, out_prefix)              # OUT.webp (packed) + OUT.json + OUT_check.png
CLI, for any set of paths (park px):
  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/occluders.py \
      PATHS.json OUT_PREFIX [--height 50] [--half 44] [--below 22] [--patches PATCHES.json] [--yellow LINES.json]
  PATHS.json: {"paths": [[[x, y], ...], ...]}; PATCHES.json: [{"file", "rect": [x, y, w, h]}] (paths relative to it).

How an object is found and sorted:
  - Candidates: inside the reach (and up to DOWN px below it, so trunks and poles are seen down to their feet), every
    pixel that is not road palette (asphalt grey, white and yellow lane paint, kerb white, cool shadows on the road)
    and not flat ground (pale sidewalk).
  - Objects: 8-connected components of the candidates after a 1 px closing; specks (< 25 px) and components with no
    ink (fewer than 6 dark outline pixels, e.g. a tinted smudge in the asphalt) are dropped. Of each object, only the
    pixels within INK_NEAR px of its ink or enclosed by it are kept: lane paint, cracks and smudges touching it go.
  - Foot: for each column of an object, the run of object pixels ending at its lowest pixel; columns whose run is at
    least RUN_MIN px long are trunk/pole/wall columns. A chunk's foot is the lowest pixel of its own trunk columns; a
    chunk without one (a crown hanging over the road) takes the foot of the object's nearest trunk column; an object
    with no trunk column at all (a bush, a sign board) uses its lowest pixel.
  - Pieces: the object's pixels inside the reach, cut into CHUNK px wide column chunks (a long kerb hedge, a whole
    ride's edge), each with sortY = its foot. A chunk with (almost) no ink is dropped: it is paint or a smudge on the
    ground joined to an object by a crack, not part of the object. A layer draws them in one list with its movers sorted by y: a mover
    whose feet are above (less than) a piece's sortY is behind it, so the piece is drawn over it.
"""
import argparse, json, os
from dataclasses import dataclass
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
HD_PATH = os.path.join(ROOT, "gen/park/world_v2_hd.png")
F = 2.5          # HD px per park px
W = 3840
RUN_MIN = 12     # px: a vertical run this long is a trunk, pole or wall
DOWN = 200       # px below the reach searched for feet
CHUNK = 160      # px: pieces wider than this are cut into column chunks
INK_MAX = 95     # a pixel this dark (max channel) is outline ink
INK_DROP = 32    # or this much darker (max channel) than the 9 px around it, at HD
INK_NEAR = 6     # px: object pixels further than this from its ink, and not enclosed by it, are dropped


@dataclass
class Band:
    y0: int
    y1: int
    hd: Image.Image      # RGB, HD px
    park: np.ndarray     # float32 RGB, park px


def load_band(y0, y1, patches=(), patch_dir=""):
    """The painting's rows y0..y1 (park px), with RGBA patches laid over it."""
    hd = Image.open(HD_PATH).convert("RGBA").crop((0, round(y0 * F), round(W * F), round(y1 * F)))
    for p in patches:
        x, y, w, h = p["rect"]
        im = Image.open(os.path.join(patch_dir, p["file"])).convert("RGBA")
        px, py = round(x * F), round((y - y0) * F)
        base = hd.crop((px, py, px + im.width, py + im.height))
        base.alpha_composite(im)
        hd.paste(base, (px, py))
    hd = hd.convert("RGB")
    park = np.asarray(hd.resize((W, y1 - y0), Image.LANCZOS)).astype(np.float32)
    return Band(y0, y1, hd, park)


def classify(park, y0, yellow=None, hd=None):
    """road: the street's own palette; flat: ground that never stands up (pale sidewalk); ink: outline pixels.
    Pass the band's HD image as hd: at park px the outlines are only 1-2 px and come out light (max channel 130-170)
    after downsampling, so ink is found at HD and carried down (any HD ink in a park pixel's footprint)."""
    r, g, b = park[..., 0], park[..., 1], park[..., 2]
    mx, mn = park.max(-1), park.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    asphalt = (sat < 0.16) & (mx > 110) & (mx < 236)
    white = (mx > 222) & (sat < 0.16)
    yel = (r > 170) & (g > 140) & (b < 125) & (r - b > 80)
    if yellow is not None:  # yellow is lane paint only along the traced centre line; elsewhere it is a ride
        yy = np.arange(y0, y0 + park.shape[0])[:, None]
        yel &= np.abs(yy - np.interp(np.arange(park.shape[1]), *zip(*yellow))[None, :]) < 18
    shadow = (b >= r - 4) & (sat < 0.28) & (mx > 85) & (mx < 205)
    road = asphalt | white | yel | shadow
    flat = (mx > 205) & (sat < 0.33) & (r >= b - 5) & ~road
    if hd is not None:
        # Outlines here are warm browns (max channel 110-145 at HD on a trunk), so ink is "much darker than around it",
        # not a fixed level: INK_DROP below the 9 px local mean, or simply very dark.
        v = np.asarray(hd).max(-1).astype(np.float32)
        hdm = (v < ndimage.uniform_filter(v, 9) - INK_DROP) | (v < INK_MAX)
        ink = np.asarray(Image.fromarray((hdm * 255).astype(np.uint8)).resize((park.shape[1], park.shape[0]), Image.BOX)) > 40
    else:
        ink = mx < INK_MAX
    return {"road": road, "flat": flat, "ink": ink}


def sweep(paths, shape, y0, height=50, half=44, below=22):
    """Where bodies can be: for every 4th point of every path, a box from `height` px above it to `below` px under it
    and `half` px either side."""
    H, Wd = shape
    m = Image.new("L", (Wd, H), 0)
    d = ImageDraw.Draw(m)
    for pts in paths:
        pts = np.asarray(pts, float)
        for x, y in pts[::4]:
            d.rectangle([x - half, y - y0 - height, x + half, y - y0 + below], fill=255)
    return np.asarray(m) > 0


def _feet(sub):
    """Per column of a component's bbox mask: lowest pixel (row, or -1) and the length of the run ending there."""
    h = sub.shape[0]
    any_ = sub.any(0)
    low = np.where(any_, h - 1 - np.argmax(sub[::-1], axis=0), -1)
    run = np.zeros(sub.shape[1], int)
    for c in np.where(any_)[0]:
        col = sub[:low[c] + 1, c][::-1]
        run[c] = np.argmin(col) if not col.all() else len(col)
    return low, run


def find(park, cls, reach, y0, extra=(), hidden_foot=None):
    """Objects in front of movers: a list of {"mask", "x0", "y0", "sortY", "kind", "hidden"} (mask in park px).
    extra: (mask, sortY or None, kind) objects placed by hand (white flags, a white bowling pin) that the palette
    test can't see; sortY None means the object's own foot.
    hidden_foot(x, y_seen) -> foot: called for a trunk whose foot is hidden behind a hand-placed object (its lowest
    pixel sits on one), to say where it really stands (e.g. the next ground line below). Without it the foot is the
    last visible pixel, which puts the object too far back; such pieces are marked "hidden"."""
    H, Wd = reach.shape
    blockers = np.zeros((H, Wd), bool)
    for mask, _, _ in extra:
        blockers |= mask
    # Search area: the reach and DOWN px below it, column by column.
    cols = np.where(reach.any(0))[0]
    area = reach.copy()
    if len(cols):
        bottom = np.where(reach.any(0), H - 1 - np.argmax(reach[::-1], axis=0), -1)
        rows = np.arange(H)[:, None]
        top = np.where(reach.any(0), np.argmax(reach, axis=0), H)
        area |= (rows >= top[None, :]) & (rows <= bottom[None, :] + DOWN)
    cand = ~cls["road"] & ~cls["flat"] & area
    cand = ndimage.binary_closing(cand, iterations=1) & area
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    pieces = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None:
            continue
        sub = lab[sl] == i + 1
        if sub.sum() < 25 or (cls["ink"][sl] & sub).sum() < 6:
            continue
        # Painted objects are outlined in ink: keep the pixels near the object's ink or enclosed by it. Lane paint,
        # cracks and smudges joined to the object (no ink of their own) drop out; they would streak over a car.
        ink = cls["ink"][sl] & sub
        zone = ndimage.binary_fill_holes(ndimage.binary_closing(ink, iterations=2)) | ndimage.binary_dilation(ink, iterations=INK_NEAR)
        inreach = sub & zone & reach[sl]
        if not inreach.any():
            continue
        _cut(pieces, sub, inreach, sl, y0, "auto", ink=cls["ink"][sl], blockers=blockers, hidden_foot=hidden_foot)
    for mask, sortY, kind in extra:
        ys, xs = np.where(mask)
        if not len(ys):
            continue
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        sub = mask[sl]
        inreach = sub & reach[sl]
        if inreach.any():
            _cut(pieces, sub, inreach, sl, y0, kind, sortY)
    return pieces


def _cut(pieces, sub, inreach, sl, y0, kind, fixed=None, ink=None, blockers=None, hidden_foot=None):
    low, run = _feet(sub)
    trunk = np.where(run >= RUN_MIN)[0]
    oy, ox = sl[0].start, sl[1].start
    # A trunk whose lowest pixel sits on a hand-placed object stands behind it: its real foot is further down.
    hidden = set()
    if blockers is not None and len(trunk):
        H = blockers.shape[0]
        for c in trunk:
            y, x = oy + low[c], ox + c
            if y + 3 < H and blockers[y + 1:y + 4, x].any():
                hidden.add(int(c))
                if hidden_foot is not None:
                    low[c] = max(low[c], hidden_foot(x, y + y0) - y0 - oy)
    xs_in = np.where(inreach.any(0))[0]
    for c0 in range(xs_in.min(), xs_in.max() + 1, CHUNK):
        part = inreach.copy()
        part[:, :c0] = False
        part[:, c0 + CHUNK:] = False
        py, px = np.where(part)
        if len(py) < 6:
            continue
        # A painted object is outlined in ink; a chunk with no ink of its own and no trunk is paint or a smudge on the
        # ground joined to an object by a crack (a faded lane stroke inheriting a kerb palm's foot): left out.
        if ink is not None and ((ink & part).sum() < max(4, 0.01 * len(py))):
            continue
        if fixed is not None:
            foot = fixed
        else:
            own = trunk[(trunk >= c0) & (trunk < c0 + CHUNK)]
            if len(own):
                foot = low[own].max()
            elif len(trunk):
                mid = (px.min() + px.max()) / 2
                foot = low[trunk[np.argmin(np.abs(trunk - mid))]]
            else:
                foot = low.max()
            foot = float(oy + foot + y0)
        pieces.append({"mask": part[py.min():py.max() + 1, px.min():px.max() + 1], "x0": int(ox + px.min()),
                       "y0": int(oy + py.min() + y0), "sortY": float(foot), "kind": kind, "hidden": bool(hidden)})


def write(pieces, band, out_prefix, density=2):
    """Packs the pieces (the painting's HD pixels at `density` px per park px) into OUT.webp + OUT.json:
    {"density", "pieces": [{"rect": atlas px, "at": [x, y, w, h] park px, "sortY", "kind"}]}, and OUT_check.png."""
    items = []
    for p in pieces:
        m = p["mask"]
        h, w = m.shape
        box = (round(p["x0"] * F), round((p["y0"] - band.y0) * F), round((p["x0"] + w) * F), round((p["y0"] - band.y0 + h) * F))
        rgb = band.hd.crop(box).resize((w * density, h * density), Image.LANCZOS)
        a = Image.fromarray((m * 255).astype(np.uint8)).resize((w * density, h * density), Image.BILINEAR)
        a = np.clip(np.asarray(a).astype(np.float32) / 255 * 1.15, 0, 1)
        items.append((p, np.dstack([np.asarray(rgb), (a * 255).astype(np.uint8)])))
    items.sort(key=lambda it: -it[1].shape[0])
    AW, gap = 2048, 2
    x = y = row = 0
    placed = []
    for p, img in items:
        h, w = img.shape[:2]
        if x + w + gap > AW:
            x, y, row = 0, y + row + gap, 0
        placed.append((p, img, x, y))
        x += w + gap
        row = max(row, h)
    atlas = np.zeros((y + row + gap, AW, 4), np.uint8)
    meta = []
    for p, img, ax, ay in placed:
        h, w = img.shape[:2]
        atlas[ay:ay + h, ax:ax + w] = img
        meta.append({"rect": [ax, ay, w, h], "at": [p["x0"], p["y0"], w / density, h / density],
                     "sortY": round(p["sortY"], 1), "kind": p["kind"], **({"hiddenFoot": True} if p.get("hidden") else {})})
    Image.fromarray(atlas, "RGBA").save(out_prefix + ".webp", lossless=True, quality=100)
    json.dump({"density": density, "pieces": meta}, open(out_prefix + ".json", "w"))
    # Check: each piece tinted by its sortY (blue = far, red = near), its foot marked as a white line.
    chk = band.park.copy() * 0.5
    lo, hi = band.y0, band.y1
    for p in pieces:
        m = p["mask"]
        h, w = m.shape
        sl = chk[p["y0"] - band.y0:p["y0"] - band.y0 + h, p["x0"]:p["x0"] + w]
        t = np.clip((p["sortY"] - lo) / max(1, hi - lo), 0, 1)
        sl[m] = sl[m] * 0.3 + np.array([255 * t, 80, 255 * (1 - t)]) * 0.7
        fy = int(min(p["sortY"], hi - 1) - band.y0)
        if 0 <= fy < chk.shape[0]:
            chk[fy, p["x0"]:p["x0"] + w] = (255, 255, 255)
    Image.fromarray(np.clip(chk, 0, 255).astype(np.uint8)).save(out_prefix + "_check.png")
    return meta, atlas.shape


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths"); ap.add_argument("out")
    ap.add_argument("--height", type=float, default=50); ap.add_argument("--half", type=float, default=44)
    ap.add_argument("--below", type=float, default=22); ap.add_argument("--patches"); ap.add_argument("--yellow")
    a = ap.parse_args()
    paths = json.load(open(a.paths))["paths"]
    ys = [y for p in paths for _, y in p]
    y0, y1 = max(0, int(min(ys) - a.height - 10)), min(2560, int(max(ys) + a.below + DOWN + 10))
    patches = json.load(open(a.patches)) if a.patches else []
    band = load_band(y0, y1, patches, os.path.dirname(os.path.abspath(a.patches)) if a.patches else "")
    yellow = json.load(open(a.yellow))["lines"]["yellow"] if a.yellow else None
    cls = classify(band.park, y0, yellow, band.hd)
    reach = sweep(paths, band.park.shape[:2], y0, a.height, a.half, a.below)
    pieces = find(band.park, cls, reach, y0)
    meta, shape = write(pieces, band, a.out)
    print(f"{len(meta)} pieces, atlas {shape[1]} x {shape[0]}")


if __name__ == "__main__":
    main()
