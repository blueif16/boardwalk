"""Scores ride and crowd image candidates as the page shows them.

  $PY tests/perf/tools/score.py [--only 'rides/wheel/*'] [--variants a,b] [--screens all] > $PERF_SCRATCH/scores.jsonl

For every candidate in $PERF_SCRATCH/cand/index.jsonl: decode it, push it through the page's own pipeline for a
screen density d and compare with the best source pushed through the same pipeline:
  img (plates, patches)    asset -> d (zoomed: Chrome re-rasters at 2d)
  canvas rules (assets.py) asset -> canvas density c = drawn(rule, d) -> d (zoomed: the canvas, magnified to 2d)
then composite over what is behind it: the painting at the asset's own park rect when it has one (plates,
occluders: the painting is exactly what an error would show against), else a light and a dark flat ground (worst
of the two). SSIMULACRA2 on the whole composite when it is at most 1.5 MP (small ones repeated to 512 px so all six
scales count), else on the 8 most detailed 512 px tiles that are at least 30% covered; the score is the second
lowest tile (or the whole image), so a mostly transparent sheet can't hide its errors in empty space.

Screens: d = 0.5 (1920x1080 @1), 0.667 (2560x1440 @1), 0.7875 (MacBook 1512x982 @2), 1.0 (4K @1.5 or @2); zoomed =
the same at 2x. Default (ladders): display at 0.7875 and 1.0, zoomed at 1.0 (= 2.0), the binding cases; --screens all
scores every screen both ways.

Verdict: indistinguishable   display >= 88 and zoomed >= 85
         visible only zoomed display >= 88, zoomed < 85
         visible             display < 88
(The shipped painting itself scores 82-83 against its own master at 1:1, so 88 is well inside what is shipped.)
"""
import fnmatch, json, os, sys
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import ROOT, SCRATCH, drawn, lookup  # noqa: E402
import metrics as M  # noqa: E402
from recompress import BEST_SOURCE  # noqa: E402

LIGHT, DARK = (236, 226, 206), (58, 56, 66)
TILE, NTILES, WHOLE_MAX = 512, int(os.environ.get('NTILES', 5)), 1.5e6


def rect_of(path):
    """The asset's park rect [x, y, w, h], if it has one."""
    base = os.path.join(ROOT, path.rsplit(".", 1)[0] + ".json")
    d = os.path.dirname(os.path.join(ROOT, path))
    name = os.path.basename(path).rsplit(".", 1)[0]
    try:
        if os.path.exists(base):
            j = json.load(open(base))
            if "rect" in j and len(j["rect"]) == 4:
                return j["rect"]
        for fn, key in (("plates.json", None), ("occluders.json", None), ("patches.json", None), ("cutouts.json", None), ("wheel.json", "legs"), ("corgi.json", "pin")):
            p = os.path.join(d, fn)
            if not os.path.exists(p):
                continue
            j = json.load(open(p))
            if key:
                if name == key and key in j:
                    return j[key]["rect"]
                continue
            items = j if isinstance(j, list) else list(j.values())
            for it in items:
                if isinstance(it, dict) and it.get("file") == os.path.basename(path):
                    return it["rect"]
                if isinstance(it, dict) and it.get("column", {}).get("file") == os.path.basename(path):
                    return it["column"]["rect"]
            if isinstance(j, dict) and name.replace("occ_", "") in j and "rect" in j[name.replace("occ_", "")]:
                return j[name.replace("occ_", "")]["rect"]
    except Exception:
        pass
    return None


def render(a, extent, rule, d, z, region):
    """The pixels the screen shows (density d, zoom z) for park region (x, y, w, h) of an asset stretched over the
    park extent (W, H), as the page stretches every image over its rect."""
    W, H = extent
    dx, dy = a.shape[1] / W, a.shape[0] / H
    x, y, w, h = region
    k = d * z
    fw, fh = max(8, round(w * k)), max(8, round(h * k))
    if rule == "img":
        return M.resize(a, fw, fh, box=(x * dx, y * dy, (x + w) * dx, (y + h) * dy))
    c = drawn(rule, d)
    m = 8.0  # park px of margin for the resampling kernels
    X0, Y0, X1, Y1 = max(0.0, x - m), max(0.0, y - m), min(W, x + w + m), min(H, y + h + m)
    cw, ch = max(1, round((X1 - X0) * c)), max(1, round((Y1 - Y0) * c))
    canvas = M.resize(a, cw, ch, box=(X0 * dx, Y0 * dy, X1 * dx, Y1 * dy))
    cx, cy = cw / (X1 - X0), ch / (Y1 - Y0)
    return M.resize(canvas, fw, fh, box=((x - X0) * cx, (y - Y0) * cy, (x + w - X0) * cx, (y + h - Y0) * cy))


def background(path, region, dims, colour=None):
    if colour is not None:
        return np.broadcast_to(np.array(colour, np.float32), (dims[1], dims[0], 3))
    rx, ry, _, _ = RECT[path]
    x, y, w, h = region
    x0, y0 = int(rx + x), int(ry + y)
    crop = PAINT[y0:y0 + int(np.ceil(h)) + 1, x0:x0 + int(np.ceil(w)) + 1]
    return M.resize(crop, *dims)


def ss2_fit(r, c):
    ry, rx = -(-512 // r.shape[0]), -(-512 // r.shape[1])
    if ry > 1 or rx > 1:
        return M.ss2(np.tile(r, (ry, rx, 1)), np.tile(c, (ry, rx, 1)))
    return M.ss2(r, c)


def plan(path, src, density, rule, evals):
    """Per eval: the regions to score and the reference composites (cached per worker)."""
    H, W = src.shape[0] / density, src.shape[1] / density
    alpha = src.shape[2] == 4
    # detail map at 1 park px: luminance std and coverage per candidate tile
    low = M.resize(src, max(1, round(W)), max(1, round(H)))
    out = {}
    for d, z in evals:
        k = d * z
        if W * H * k * k <= WHOLE_MAX:
            regions = [(0.0, 0.0, W, H)]
        else:
            t = TILE / k
            cands = []
            for y in np.arange(0, max(1.0, H - t * 0.5), t):
                for x in np.arange(0, max(1.0, W - t * 0.5), t):
                    blk = low[int(y):int(y + t), int(x):int(x + t)]
                    cov = (blk[..., 3] > 8).mean() if alpha else 1.0
                    if cov < 0.3:
                        continue
                    lum = blk[..., :3].mean(axis=2)
                    cands.append((float(lum.std() * cov), (float(x), float(y), float(min(t, W - x)), float(min(t, H - y)))))
            cands.sort(reverse=True)
            regions = [r for _, r in cands[:NTILES]] or [(0.0, 0.0, min(W, t), min(H, t))]
        items = []
        for reg in regions:
            ref = render(src, (W, H), rule, d, z, reg)
            dims = (ref.shape[1], ref.shape[0])
            bgs = [background(path, reg, dims)] if RECT.get(path) else [background(path, reg, dims, LIGHT), background(path, reg, dims, DARK)]
            items.append((reg, ref, [M.over(ref, bg) for bg in bgs], bgs))
        out[(d, z)] = items
    return out


def init():
    global PAINT, RECT, CACHE, EXTENT
    PAINT = M.load(os.path.join(SCRATCH, "src/world_3840.png"))
    RECT, CACHE, EXTENT = {}, {}, {}


def score(job):
    path, rows, evals = job
    kind, density, rule, _s, _n = lookup(path)
    if path not in CACHE:
        src = M.load(os.path.join(ROOT, BEST_SOURCE.get(path, path)))
        RECT[path] = rect_of(path) if density else None
        CACHE.clear()
        EXTENT[path] = (src.shape[1] / (density or 1.0), src.shape[0] / (density or 1.0))
        CACHE[path] = (src, plan(path, src, density or 1.0, rule if density else "img", evals if density else [(1.0, 1)]))
    src, P = CACHE[path]
    out = []
    for r in rows:
        cand = M.load(r["path"])
        if cand.shape[2] != src.shape[2]:
            cand = M.rgba(cand) if src.shape[2] == 4 else cand[..., :3]
        per = {}
        for (d, z), items in P.items():
            vals = []
            for reg, ref, refc, bgs in items:
                c = render(cand, EXTENT[path], rule, d, z, reg) if density else cand
                if c.shape[:2] != ref.shape[:2]:
                    c = M.resize(c, ref.shape[1], ref.shape[0])
                vals.append(min(ss2_fit(rc, M.over(c, bg)) for rc, bg in zip(refc, bgs)))
            vals.sort()
            per[f"{d:g}x{z}"] = round(vals[1] if len(vals) > 2 else vals[0], 2)
        if not density:
            per = {"native": per["1x1"]}
        disp = min(v for k, v in per.items() if not k.endswith("x2"))
        zoom = min([v for k, v in per.items() if k.endswith("x2")] or [disp])
        verdict = "indistinguishable" if disp >= 88 and zoom >= 85 else "visible only zoomed" if disp >= 88 else "visible"
        out.append(r | {"display": disp, "zoomed": zoom, "verdict": verdict, "per": per})
    return out


if __name__ == "__main__":
    arg = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d  # noqa: E731
    only = arg("--only", "*")
    if arg("--screens", "dense") == "all":
        evals = [(d, 1) for d in (0.5, 0.6667, 0.7875, 1.0)] + [(d, 2) for d in (0.5, 0.6667, 0.7875, 1.0)]
    else:
        evals = [(0.7875, 1), (1.0, 1), (1.0, 2)]
    variants = arg("--variants")
    skip = set()
    if arg("--skip-done"):
        skip = {json.loads(l)["path"] for l in open(arg("--skip-done"))}
    rows = [json.loads(l) for l in open(arg("--index", os.path.join(SCRATCH, "cand/index.jsonl")))]
    by = {}
    for r in rows:
        if r["asset"].startswith(("site/", "preview")) or lookup(r["asset"]) is None or not fnmatch.fnmatch(r["asset"], only):
            continue
        if variants and r["variant"] not in variants.split(",") or r["path"] in skip:
            continue
        by.setdefault(r["asset"], {})[r["path"]] = r
    jobs = []
    for path, rs in sorted(by.items(), key=lambda kv: -os.path.getsize(os.path.join(ROOT, kv[0]))):
        rs = list(rs.values())
        n = max(4, len(rs) // 4)
        for i in range(0, len(rs), n):
            jobs.append((path, rs[i:i + n], evals))
    with Pool(int(os.environ.get("JOBS", 12)), initializer=init, maxtasksperchild=1) as p:
        for res in p.imap_unordered(score, jobs):
            for r in res:
                print(json.dumps(r), flush=True)
