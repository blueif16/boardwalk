"""Front cut-outs from the painting: every painted object a moving thing can pass behind (palms, street trees, shrubs,
lamps, signs, poles, stalls, the deck rail, building fronts), as the painting's own pixels (or just their mask) with a
sort line at the object's ground contact. Shared by every layer that draws things standing on the painting.

Users: rides/traffic/tools/make_occluders.py (the toy cars on Beach Street; its old copy of this file is a shim now)
and tests/park-crowd/tools/make_occluders.py (the animal crowd on the promenade).

Library:
  band = load_band(y0, y1, patches)            # the painting (+ RGBA patches over it), HD and park px
  cls = classify(band.park, y0, yellow=line, hd=band.hd, ground=extra_flat)   # road palette / flat ground / ink
  reach = sweep(paths, band.shape, y0, ...)    # where the moving things' bodies can be
  pieces = find(band.park, cls, reach, y0)     # objects, chunked, each with sortY = its foot
  write(pieces, band, out_prefix)              # OUT.webp (packed) + OUT.json + OUT_check.png
  pal = palette(pixels); in_palette(park, pal) # a ground colour learned from samples (the crowd's deck)
CLI, for any set of paths (park px):
  uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/occluders.py \\
      PATHS.json OUT_PREFIX [--height 50] [--half 44] [--below 22] [--patches PATCHES.json] [--yellow LINES.json]
  PATHS.json: {"paths": [[[x, y], ...], ...]}; PATCHES.json: [{"file", "rect": [x, y, w, h]}] (paths relative to it).

How an object is found and sorted:
  - Candidates: inside the reach (and up to DOWN px below it, so trunks and poles are seen down to their feet), every
    pixel that is not road palette (asphalt grey, white and yellow lane paint, kerb white, cool shadows on the road)
    and not flat ground (pale sidewalk, plus `ground`: e.g. the deck's own palette), and not in `exclude`.
  - Objects: 8-connected components of the candidates after a 1 px closing; specks (< 25 px) and components with no
    ink (fewer than 6 dark outline pixels, e.g. a tinted smudge in the asphalt) are dropped. Of each object, only the
    pixels within INK_NEAR px of its ink or enclosed by it are kept: lane paint, cracks and smudges touching it go.
  - Foot: for each column of an object, the run of object pixels ending at its lowest pixel; columns whose run is at
    least RUN_MIN px long are trunk/pole/wall columns. A chunk's foot is the lowest pixel of its own trunk columns; a
    chunk without one (a crown hanging over the road) takes the foot of the object's nearest trunk column; an object
    with no trunk column at all (a bush, a sign board) uses its lowest pixel. feet="kept" measures them on the kept
    pixels only (a soft shadow joined to an object then can't pull its foot forward).
  - Pieces: the object's pixels inside the reach, cut into CHUNK px wide column chunks (a long kerb hedge, a whole
    ride's edge), each with sortY = its foot. A chunk with (almost) no ink is dropped: it is paint or a smudge on the
    ground joined to an object by a crack, not part of the object. With lines=True a chunk whose trunk feet slope
    (the deck rail, a stall's front edge) also gets "line" [xa, ya, xb, yb], the feet fitted across it. A layer draws
    them in one list with its movers sorted by y (or hides its movers under them): a mover whose feet are above (less
    than) a piece's sortY is behind it.
"""
import argparse, json, os
from dataclasses import dataclass
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
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


def load_band(y0, y1, patches=(), patch_dir="", fit=False):
    """The painting's rows y0..y1 (park px), with RGBA patches laid over it (at F px per park px; fit=True resizes a
    patch to its rect first, for plates stored at another density)."""
    hd = Image.open(HD_PATH).convert("RGBA").crop((0, round(y0 * F), round(W * F), round(y1 * F)))
    for p in patches:
        x, y, w, h = p["rect"]
        im = Image.open(os.path.join(patch_dir, p["file"])).convert("RGBA")
        if fit and (im.width, im.height) != (round(w * F), round(h * F)):
            im = im.resize((round(w * F), round(h * F)), Image.LANCZOS)
        px, py = round(x * F), round((y - y0) * F)
        base = hd.crop((px, py, px + im.width, py + im.height))
        base.alpha_composite(im)
        hd.paste(base, (px, py))
    hd = hd.convert("RGB")
    park = np.asarray(hd.resize((W, y1 - y0), Image.LANCZOS)).astype(np.float32)
    return Band(y0, y1, hd, park)


def palette(pixels, q=8, keep=0.95, grow=0):
    """A ground colour learned from sample pixels (N x 3, e.g. the open deck under the crowd's lanes; filter out what
    can't be ground first): the q-level RGB bins that hold `keep` of the samples, grown by `grow` bins. Returns a
    boolean (256/q)^3 table."""
    n = 256 // q
    idx = (np.asarray(pixels, np.int32) // q).clip(0, n - 1)
    flat = idx[:, 0] * n * n + idx[:, 1] * n + idx[:, 2]
    count = np.bincount(flat, minlength=n ** 3)
    order = np.argsort(-count)
    cum = np.cumsum(count[order]) / max(1, count.sum())
    table = np.zeros(n ** 3, bool)
    table[order[:np.searchsorted(cum, keep) + 1]] = True
    table = table.reshape(n, n, n)
    if grow:
        table = ndimage.binary_dilation(table, iterations=grow)
    return table


def in_palette(park, table):
    """Pixels of park (H x W x 3) whose colour is in a palette() table."""
    n = table.shape[0]
    q = 256 // n
    idx = (park.astype(np.int32) // q).clip(0, n - 1)
    return table[idx[..., 0], idx[..., 1], idx[..., 2]]


def classify(park, y0, yellow=None, hd=None, ground=None, street=True):
    """road: the street's own palette; flat: ground that never stands up (pale sidewalk, plus `ground` if given, e.g.
    in_palette(park, deck)); ink: outline pixels. street=False (off the street: the promenade) drops the street's
    palette and the pale-sidewalk rule, which there would take white rails, stripes and blue lamps for ground: flat is
    `ground` alone.
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
    if not street:
        road = np.zeros_like(road)
        flat = np.zeros_like(flat)
    if ground is not None:
        flat |= ground & ~road
    if hd is not None:
        # Outlines here are warm browns (max channel 110-145 at HD on a trunk), so ink is "much darker than around it",
        # not a fixed level: INK_DROP below the 9 px local mean, or simply very dark.
        v = np.asarray(hd).max(-1).astype(np.float32)
        hdm = (v < ndimage.uniform_filter(v, 9) - INK_DROP) | (v < INK_MAX)
        ink = np.asarray(Image.fromarray((hdm * 255).astype(np.uint8)).resize((park.shape[1], park.shape[0]), Image.BOX)) > 40
    else:
        ink = mx < INK_MAX
    return {"road": road, "flat": flat, "ink": ink}


def sweep(paths, shape, y0, height=50, half=44, below=22, step=4):
    """Where bodies can be: for every `step`-th point of every path, a box from `height` px above it to `below` px
    under it and `half` px either side."""
    H, Wd = shape
    m = Image.new("L", (Wd, H), 0)
    d = ImageDraw.Draw(m)
    for pts in paths:
        pts = np.asarray(pts, float)
        for x, y in pts[::step]:
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


def find(park, cls, reach, y0, extra=(), hidden_foot=None, exclude=None, feet="component", lines=False, down=DOWN):
    """Objects in front of movers: a list of {"mask", "x0", "y0", "sortY", "kind", "hidden"[, "line"]} (mask in park px).
    extra: (mask, sortY or None, kind) objects placed by hand (white flags, a white bowling pin) that the palette
    test can't see; sortY None means the object's own foot (a [xa, ya, xb, yb] list sets a sloped base).
    hidden_foot(x, y_seen) -> foot: called for a trunk whose foot is hidden behind a hand-placed object (its lowest
    pixel sits on one), to say where it really stands (e.g. the next ground line below). Without it the foot is the
    last visible pixel, which puts the object too far back; such pieces are marked "hidden".
    exclude: pixels never taken as objects (things another layer handles, flat platforms). feet: "component" (all
    candidate pixels, as built for the traffic layer) or "kept" (only the ink-kept pixels). lines: fit sloped bases."""
    H, Wd = reach.shape
    blockers = np.zeros((H, Wd), bool)
    for mask, _, _ in extra:
        blockers |= mask
    # Search area: the reach and `down` px below it, column by column.
    cols = np.where(reach.any(0))[0]
    area = reach.copy()
    if len(cols):
        bottom = np.where(reach.any(0), H - 1 - np.argmax(reach[::-1], axis=0), -1)
        rows = np.arange(H)[:, None]
        top = np.where(reach.any(0), np.argmax(reach, axis=0), H)
        area |= (rows >= top[None, :]) & (rows <= bottom[None, :] + down)
    cand = ~cls["road"] & ~cls["flat"] & area
    if exclude is not None:
        cand &= ~exclude
    cand = ndimage.binary_closing(cand, iterations=1) & area
    if exclude is not None:
        cand &= ~exclude
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
        body = sub & zone if feet == "kept" else sub
        _cut(pieces, body, inreach, sl, y0, "auto", ink=cls["ink"][sl], blockers=blockers, hidden_foot=hidden_foot, lines=lines)
    for mask, sortY, kind in extra:
        ys, xs = np.where(mask)
        if not len(ys):
            continue
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        sub = mask[sl]
        inreach = sub & reach[sl]
        if inreach.any():
            if isinstance(sortY, (list, tuple)):
                _cut(pieces, sub, inreach, sl, y0, kind, (sortY[1] + sortY[3]) / 2, fixed_line=sortY)
            else:
                _cut(pieces, sub, inreach, sl, y0, kind, sortY, lines=lines and sortY is None)
    return pieces


def find_layered(cls, reach, y0, exclude=None, extra=(), down=DOWN, gap=6, tol=3, inherit=48, strip=48, holes=30, min_piece=80):
    """Like find(), for a crowd on a deck crowded with things that touch on screen (a lamp before a stall before a
    ride): feet per vertical run, not per component. In every column the kept pixels of each object (candidates with
    ink, near their ink, as in find) are split into vertical runs (gaps up to `gap` px bridged); a run at least RUN_MIN
    long stands on its own lowest pixel, a shorter one (a rail bar between posts, a sign on a pole) takes the foot of
    the standing runs of its object within `inherit` columns that reach down to it (interpolated between the nearest
    on either side). Holes up to `holes` px inside an object (deck-coloured specks, not the gaps of a railing) are filled. Neighbouring pixels in
    the reach whose feet differ by at most `tol` px form one piece, whose base is the line fitted through its feet
    (pieces that don't fit one line within tol are cut into `strip` px strips); pieces under `min_piece` px join the
    neighbour they touch most when its foot is within 10 px. Returns find()'s pieces, each with
    "line" when its base slopes."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    H, Wd = reach.shape
    cols = np.where(reach.any(0))[0]
    area = reach.copy()
    if len(cols):
        bottom = np.where(reach.any(0), H - 1 - np.argmax(reach[::-1], axis=0), -1)
        rows = np.arange(H)[:, None]
        top = np.where(reach.any(0), np.argmax(reach, axis=0), H)
        area |= (rows >= top[None, :]) & (rows <= bottom[None, :] + down)
    cand = ~cls["road"] & ~cls["flat"] & area
    hand = np.zeros((H, Wd), bool)
    for mask, _, _ in extra:
        hand |= mask
    if exclude is not None:
        cand &= ~exclude
    cand = ndimage.binary_closing(cand, iterations=1) & area & ~hand
    if exclude is not None:
        cand &= ~exclude
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    obj = np.zeros((H, Wd), bool)
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None:
            continue
        sub = lab[sl] == i + 1
        if sub.sum() < 25 or (cls["ink"][sl] & sub).sum() < 6:
            continue
        ink = cls["ink"][sl] & sub
        zone = ndimage.binary_fill_holes(ndimage.binary_closing(ink, iterations=2)) | ndimage.binary_dilation(ink, iterations=INK_NEAR)
        kept = sub & zone
        if holes:
            hole = ndimage.binary_fill_holes(kept) & ~kept
            hl, hn = ndimage.label(hole)
            if hn:
                size = ndimage.sum(hole, hl, np.arange(1, hn + 1))
                kept |= np.isin(hl, np.where(size <= holes)[0] + 1)
        obj[sl] |= kept & area[sl] & ~hand[sl] & (~exclude[sl] if exclude is not None else True)
        lab[sl][kept & (lab[sl] == 0)] = i + 1
    lab = np.where(obj, lab, 0)
    # Runs per column (gaps up to `gap` bridged), and each run's foot.
    runs = []  # (x, ya, yb, label)
    for x in np.where(obj.any(0))[0]:
        col = ndimage.binary_closing(obj[:, x], structure=np.ones(gap + 1)) | obj[:, x]
        ys = np.where(col)[0]
        cuts = np.where(np.diff(ys) > 1)[0]
        for a, b in zip(np.r_[0, cuts + 1], np.r_[cuts, len(ys) - 1]):
            ya, yb = ys[a], ys[b]
            ids = lab[ya:yb + 1, x]
            ids = ids[ids > 0]
            runs.append((int(x), int(ya), int(yb), int(np.bincount(ids).argmax()) if len(ids) else 0))
    standing = {}
    for x, ya, yb, l in runs:
        if yb - ya + 1 >= RUN_MIN:
            standing.setdefault(l, []).append((x, ya, yb))
    foot = np.full((H, Wd), np.nan, np.float32)
    for x, ya, yb, l in runs:
        f = yb
        if yb - ya + 1 < RUN_MIN:
            left = right = None
            for sx, sa, sb in standing.get(l, ()):
                if abs(sx - x) > inherit or sb < ya:
                    continue
                if sx <= x and (left is None or sx > left[0]):
                    left = (sx, sb)
                if sx >= x and (right is None or sx < right[0]):
                    right = (sx, sb)
            if left and right and right[0] > left[0]:
                f = max(yb, left[1] + (right[1] - left[1]) * (x - left[0]) / (right[0] - left[0]))
            elif left or right:
                f = max(yb, (left or right)[1])
        foot[ya:yb + 1, x] = f
    P = obj & reach & ~np.isnan(foot)
    for mask, _, _ in extra:
        P &= ~mask
    # Pieces: neighbours (4-connected) in P whose feet agree within tol.
    idx = -np.ones((H, Wd), np.int64)
    idx[P] = np.arange(P.sum())
    a_list, b_list = [], []
    for dy, dx in ((0, 1), (1, 0)):
        A = P[:H - dy, :Wd - dx] & P[dy:, dx:]
        fa, fb = foot[:H - dy, :Wd - dx], foot[dy:, dx:]
        A &= np.abs(fa - fb) <= tol
        a_list.append(idx[:H - dy, :Wd - dx][A]); b_list.append(idx[dy:, dx:][A])
    a_, b_ = np.concatenate(a_list), np.concatenate(b_list)
    N = int(P.sum())
    g = coo_matrix((np.ones(len(a_)), (a_, b_)), shape=(N, N))
    _, comp = connected_components(g, directed=False)
    # Slivers (a column or two where an edge's feet jump) join the neighbour they touch most, if its foot is near.
    na, nb = [], []
    for dy, dx in ((0, 1), (1, 0)):
        A = P[:H - dy, :Wd - dx] & P[dy:, dx:]
        A &= np.abs(foot[:H - dy, :Wd - dx] - foot[dy:, dx:]) <= 10
        na.append(idx[:H - dy, :Wd - dx][A]); nb.append(idx[dy:, dx:][A])
    na, nb = np.concatenate(na), np.concatenate(nb)
    for _ in range(3):
        size = np.bincount(comp)
        ca, cb = comp[na], comp[nb]
        small = size < min_piece
        pick = (ca != cb) & (small[ca] != small[cb])
        src = np.where(small[ca[pick]], ca[pick], cb[pick])
        dst = np.where(small[ca[pick]], cb[pick], ca[pick])
        if not len(src):
            break
        key = src.astype(np.int64) * (comp.max() + 1) + dst
        uk, cnt = np.unique(key, return_counts=True)
        best = {}
        for k, c in zip(uk, cnt):
            s_, d_ = divmod(int(k), int(comp.max() + 1))
            if c > best.get(s_, (0, -1))[0]:
                best[s_] = (c, d_)
        remap = np.arange(comp.max() + 1)
        for s_, (_, d_) in best.items():
            remap[s_] = d_
        comp = remap[comp]
    py, px = np.where(P)
    fv = foot[P]
    pieces = []

    def emit(sel):
        ys, xs, fs = py[sel], px[sel], fv[sel]
        if len(ys) < 6:
            return
        m = np.zeros((ys.max() - ys.min() + 1, xs.max() - xs.min() + 1), bool)
        m[ys - ys.min(), xs - xs.min()] = True
        ux = np.unique(xs)
        fx = np.array([fs[xs == u].max() for u in ux])
        piece = {"mask": m, "x0": int(xs.min()), "y0": int(ys.min() + y0), "sortY": float(fx.max() + y0), "kind": "auto", "hidden": False}
        if len(ux) >= 2 and ux.max() - ux.min() >= 8 and fx.max() - fx.min() > 1:
            k, c = np.polyfit(ux, fx, 1)
            xa, xb = ux.min(), ux.max()
            piece["line"] = [float(xa), float(k * xa + c + y0), float(xb), float(k * xb + c + y0)]
            piece["sortY"] = float((piece["line"][1] + piece["line"][3]) / 2)
        pieces.append(piece)

    order = np.argsort(comp, kind="stable")
    bounds = np.r_[0, np.where(np.diff(comp[order]))[0] + 1, len(order)]
    for s0, s1 in zip(bounds[:-1], bounds[1:]):
        sel = order[s0:s1]
        xs, fs = px[sel], fv[sel]
        ux = np.unique(xs)
        fx = np.array([fs[xs == u].max() for u in ux])
        ok = True
        if len(ux) >= 2 and ux.max() - ux.min() >= 8:
            k, c = np.polyfit(ux, fx, 1)
            ok = np.abs(fx - (k * ux + c)).max() <= tol + 3
        if ok:
            emit(sel)
            continue
        for x0 in range(int(xs.min()), int(xs.max()) + 1, strip):
            emit(sel[(xs >= x0) & (xs < x0 + strip)])
    for mask, sortY, kind in extra:
        ys, xs = np.where(mask & reach)
        if not len(ys):
            continue
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        piece = {"mask": (mask & reach)[sl], "x0": int(xs.min()), "y0": int(ys.min() + y0), "kind": kind, "hidden": False}
        if isinstance(sortY, (list, tuple)):
            piece["sortY"], piece["line"] = float((sortY[1] + sortY[3]) / 2), list(sortY)
        else:
            piece["sortY"] = float(sortY)
        pieces.append(piece)
    return pieces


def _fit(xs, ys):
    """A robust line through feet (x, y): least squares, then again without points more than 3 px off."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    if len(xs) < 2 or xs.max() - xs.min() < 12:
        return None
    a, b = np.polyfit(xs, ys, 1)
    ok = np.abs(ys - (a * xs + b)) <= 3
    if ok.sum() >= 2 and xs[ok].max() - xs[ok].min() >= 12:
        a, b = np.polyfit(xs[ok], ys[ok], 1)
    return a, b


def _cut(pieces, sub, inreach, sl, y0, kind, fixed=None, ink=None, blockers=None, hidden_foot=None, lines=False, fixed_line=None):
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
        line = None
        if fixed is not None:
            foot = fixed
            line = fixed_line
        else:
            own = trunk[(trunk >= c0) & (trunk < c0 + CHUNK)]
            if len(own):
                foot = low[own].max()
                if lines:
                    fit = _fit(own, low[own])
                    if fit is not None:
                        a, b = fit
                        xa, xb = px.min(), px.max()
                        # The fitted feet, never above what the chunk's own lowest pixels allow by more than 3 px.
                        line = [float(ox + xa), float(oy + a * xa + b + y0), float(ox + xb), float(oy + a * xb + b + y0)]
            elif len(trunk):
                mid = (px.min() + px.max()) / 2
                foot = low[trunk[np.argmin(np.abs(trunk - mid))]]
            else:
                foot = low.max()
            foot = float(oy + foot + y0)
        piece = {"mask": part[py.min():py.max() + 1, px.min():px.max() + 1], "x0": int(ox + px.min()),
                 "y0": int(oy + py.min() + y0), "sortY": float(foot), "kind": kind, "hidden": bool(hidden)}
        if line is not None:
            piece["line"] = [round(v, 1) for v in line]
        pieces.append(piece)


def write(pieces, band, out_prefix, density=2, mask_only=False, check=True):
    """Packs the pieces (the painting's HD pixels at `density` px per park px; with mask_only, white with the mask as
    alpha) into OUT.webp + OUT.json: {"density", "pieces": [{"rect": atlas px, "at": [x, y, w, h] park px, "sortY",
    "kind"[, "line"]}]}, and OUT_check.png."""
    items = []
    for p in pieces:
        m = p["mask"]
        h, w = m.shape
        box = (round(p["x0"] * F), round((p["y0"] - band.y0) * F), round((p["x0"] + w) * F), round((p["y0"] - band.y0 + h) * F))
        if mask_only:
            rgb = np.full((h * density, w * density, 3), 255, np.uint8)
        else:
            rgb = np.asarray(band.hd.crop(box).resize((w * density, h * density), Image.LANCZOS))
        a = Image.fromarray((m * 255).astype(np.uint8)).resize((w * density, h * density), Image.BILINEAR)
        a = np.clip(np.asarray(a).astype(np.float32) / 255 * 1.15, 0, 1)
        items.append((p, np.dstack([rgb, (a * 255).astype(np.uint8)])))
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
                     "sortY": round(p["sortY"], 1), "kind": p["kind"], **({"line": p["line"]} if p.get("line") else {}),
                     **({"hiddenFoot": True} if p.get("hidden") else {})})
    Image.fromarray(atlas, "RGBA").save(out_prefix + ".webp", lossless=True, quality=100)
    json.dump({"density": density, "pieces": meta}, open(out_prefix + ".json", "w"))
    if check:
        # Check: each piece tinted by its sortY (blue = far, red = near), its foot marked as a white line.
        chk = band.park.copy() * 0.5
        lo, hi = band.y0, band.y1
        for p in pieces:
            m = p["mask"]
            h, w = m.shape
            sl = chk[p["y0"] - band.y0:p["y0"] - band.y0 + h, p["x0"]:p["x0"] + w]
            t = np.clip((p["sortY"] - lo) / max(1, hi - lo), 0, 1)
            sl[m] = sl[m] * 0.3 + np.array([255 * t, 80, 255 * (1 - t)]) * 0.7
            if p.get("line"):
                xa, ya, xb, yb = p["line"]
                for xx in range(int(xa), int(xb) + 1):
                    fy = int(round(ya + (yb - ya) * (xx - xa) / max(1e-6, xb - xa))) - band.y0
                    if 0 <= fy < chk.shape[0] and 0 <= xx < chk.shape[1]:
                        chk[fy, xx] = (255, 255, 255)
                continue
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
