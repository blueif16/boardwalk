"""Regenerates every candidate encoding of the site's images from the best source there is, into the scratch folder
(nothing in the repo is replaced).

  PY=/tmp/claude-1000/boardwalk-assets/py     # uv run --no-project --with pillow,numpy,scipy,ssimulacra2,... python -I
  NODE_PATH=/tmp/claude-1000/boardwalk-assets/node/node_modules  # sharp 0.34 (npm i sharp)
  $PY tests/perf/tools/recompress.py painting [--widths 1920,2560,3024,3456,3840,5120] [--set ladder|final]
  $PY tests/perf/tools/recompress.py assets [--only rides/wheel/*] [--set ladder|final]
  $PY tests/perf/tools/recompress.py preview
  $PY tests/perf/tools/recompress.py masks

Writes $PERF_SCRATCH/cand/<asset id>/<variant>.<ext> and appends one line per file to $PERF_SCRATCH/cand/index.jsonl
({asset, variant, density, fmt, bytes, path}). Sources: the painting from gen/park/world_v2_hd.png (Lanczos to each
width); traffic sprites from rides/traffic/gen/sprites.png (lossless); everything else from the shipped file, which
is lossless except where assets.py says lossy. Resizing to a lower density is premultiplied Lanczos (metrics.resize).

Encoders: WebP through sharp (libwebp 1.6: smartSubsample = cwebp -sharp_yuv, alphaQuality, exact, effort 6 = -m 6),
AVIF through Pillow (libavif 1.4.2 + libaom 3.14, which tunes stills for SSIMULACRA2-like quality; sharp's libheif
path is older and loses ~15% here), palette PNG through sharp's libimagequant (= pngquant), lossless PNG through
oxipng.
"""
import fnmatch, glob, json, os, subprocess, sys, tempfile, time
from multiprocessing import Pool

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import A, ROOT, SCRATCH  # noqa: E402
import metrics as M  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
CAND = os.path.join(SCRATCH, "cand")
SRC = os.path.join(SCRATCH, "src")
NODE_PATH = os.environ.get("NODE_PATH", os.path.join(SCRATCH, "node/node_modules"))
ENCODE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "encode.mjs")
BEST_SOURCE = {"rides/traffic/sprites.webp": "rides/traffic/gen/sprites.png"}

# Encoding ladders. Each entry: (variant name, fmt, options). "{q}" variants are expanded over the quality list.
RGBA_LADDER = [
    ("webp_ll", "webp", {"lossless": True, "effort": 6}),
    *[(f"webp_q{q}", "webp", {"quality": q, "alphaQuality": 100, "smartSubsample": True, "effort": 6}) for q in (75, 80, 85, 90, 95)],
    ("webp_q90_a80", "webp", {"quality": 90, "alphaQuality": 80, "smartSubsample": True, "effort": 6}),
    *[(f"avif_q{q}", "avif", {"quality": q, "subsampling": "4:4:4"}) for q in (70, 75, 80, 85, 90)],
    ("png_pal", "png", {"palette": True, "quality": 100, "colours": 256, "dither": 1.0, "effort": 10}),
]
RGB_LADDER = [
    *[(f"webp_q{q}", "webp", {"quality": q, "smartSubsample": True, "effort": 6}) for q in (80, 85, 88, 90, 92)],
    *[(f"avif_q{q}", "avif", {"quality": q, "subsampling": "4:4:4"}) for q in (65, 70, 75, 80, 85)],
]
PAINTING_LADDER = [
    *[(f"webp_q{q}_sy", "webp", {"quality": q, "smartSubsample": True, "effort": 6}) for q in (86, 88, 90)],
    *[(f"avif_q{q}_444", "avif", {"quality": q, "subsampling": "4:4:4"}) for q in (68, 70, 72, 75)],
    ("avif_q80_420", "avif", {"quality": 80, "subsampling": "4:2:0"}),
]
DENSITIES = {"img": (2.0, 1.5, 1.25, 1.0), "cap2": (2.0, 1.5, 1.25, 1.0), "cap1.25": (1.0,), "max1.5": (2.0, 1.5),
             "fixed1.5": (1.5,), "nearest": ()}


def asset_id(path):
    return path.replace("/", "__").rsplit(".", 1)[0]


def record(rows):
    os.makedirs(CAND, exist_ok=True)
    with open(os.path.join(CAND, "index.jsonl"), "a") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def source_png(path, density_now, density):
    """The lossless source at the given density, as a PNG in SRC (cached)."""
    os.makedirs(SRC, exist_ok=True)
    out = os.path.join(SRC, f"{asset_id(path)}@{density if density is None else format(density, 'g')}.png")
    if os.path.exists(out):
        return out
    src = os.path.join(ROOT, BEST_SOURCE.get(path, path))
    im = Image.open(src)
    im.load()
    if density is None or density_now is None or abs(density - density_now) < 1e-6:
        im.convert("RGBA" if "A" in im.mode else "RGB").save(out, compress_level=1)
        return out
    a = M.load(src)
    f = density / density_now
    w, h = max(1, round(a.shape[1] * f)), max(1, round(a.shape[0] * f))
    r = M.resize(a, w, h)
    Image.fromarray(np.clip(r + 0.5, 0, 255).astype(np.uint8), "RGBA" if r.shape[2] == 4 else "RGB").save(out, compress_level=1)
    return out


def run_sharp(jobs):
    if not jobs:
        return []
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(jobs, f)
    env = dict(os.environ, NODE_PATH=NODE_PATH, JOBS=os.environ.get("JOBS", "6"))
    out = subprocess.run(["node", ENCODE, f.name], capture_output=True, text=True, env=env, check=True).stdout
    os.unlink(f.name)
    return json.loads(out)


def avif_one(job):
    t = time.time()
    im = Image.open(job["src"])
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    im.save(job["out"], "AVIF", quality=job["opts"]["quality"], subsampling=job["opts"].get("subsampling", "4:4:4"),
            speed=job["opts"].get("speed", 4), max_threads=2)
    return {"out": job["out"], "bytes": os.path.getsize(job["out"]), "ms": round((time.time() - t) * 1000)}


def encode_all(jobs):
    """jobs: dicts with src, out, fmt, opts, plus asset/variant/density metadata. Returns index rows."""
    sharp_jobs = [j for j in jobs if j["fmt"] in ("webp", "png")]
    avif_jobs = [j for j in jobs if j["fmt"] == "avif"]
    res = {r["out"]: r for r in run_sharp([{k: j[k] for k in ("src", "out", "fmt", "opts")} for j in sharp_jobs])}
    with Pool(int(os.environ.get("JOBS", "6"))) as p:
        for r in p.map(avif_one, avif_jobs):
            res[r["out"]] = r
    rows = []
    for j in jobs:
        r = res.get(j["out"], {})
        if "bytes" not in r:
            print("failed", j["out"], r.get("error"), file=sys.stderr)
            continue
        rows.append({k: j[k] for k in ("asset", "variant", "density", "fmt")} | {"bytes": r["bytes"], "ms": r["ms"], "path": j["out"]})
    record(rows)
    return rows


def painting(widths, ladder):
    master = None
    jobs = []
    for w in widths:
        src = os.path.join(SRC, f"world_{w}.png")
        if not os.path.exists(src):
            if master is None:
                master = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGB")
            h = round(6400 * w / 9600)
            cur = os.path.join(ROOT, f"site/park/world_{w}.webp")
            if os.path.exists(cur):
                h = Image.open(cur).size[1]
            os.makedirs(SRC, exist_ok=True)
            master.resize((w, h), Image.LANCZOS).save(src, compress_level=1)
        for name, fmt, opts in ladder:
            jobs.append({"asset": f"site/park/world_{w}", "variant": name, "density": w / 3840, "fmt": fmt, "opts": opts,
                         "src": src, "out": os.path.join(CAND, "painting", str(w), f"{name}.{fmt}")})
    for r in encode_all(jobs):
        print(f"{r['bytes']:>9} {r['ms']:>7} ms  {r['asset']} {r['variant']}")


def preview():
    """Tiny placeholders for a first paint: the whole painting at a few small widths, encoded small; the page
    would show them blurred (CSS filter) and cover-fit until the real width decodes."""
    master = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGB")
    jobs = []
    for w in (48, 96, 160, 320, 480, 640):
        src = os.path.join(SRC, f"preview_{w}.png")
        if not os.path.exists(src):
            master.resize((w, round(w * 2 / 3)), Image.LANCZOS).save(src)
        for name, fmt, opts in [("webp_q50", "webp", {"quality": 50, "effort": 6}), ("webp_q70", "webp", {"quality": 70, "effort": 6, "smartSubsample": True}),
                                ("avif_q50", "avif", {"quality": 50, "subsampling": "4:2:0"}), ("avif_q65", "avif", {"quality": 65, "subsampling": "4:4:4"})]:
            jobs.append({"asset": f"preview_{w}", "variant": name, "density": w / 3840, "fmt": fmt, "opts": opts, "src": src,
                         "out": os.path.join(CAND, "preview", f"{w}_{name}.{fmt}")})
    for r in encode_all(jobs):
        print(f"{r['bytes']:>9}  {r['asset']} {r['variant']}")


def assets(only, final=None):
    jobs = []
    for path, (kind, density, rule, _src, _note) in A.items():
        if "*" in path or not fnmatch.fnmatch(path, only) or not os.path.exists(os.path.join(ROOT, path)):
            continue
        if kind in ("mask", "ids"):
            continue
        im = Image.open(os.path.join(ROOT, path))
        has_alpha = "A" in im.mode
        ladder = RGBA_LADDER if has_alpha else RGB_LADDER
        dens = [density] + [d for d in DENSITIES[rule] if density and d < density - 1e-6]
        for d in dens:
            src = source_png(path, density, d)
            for name, fmt, opts in ladder:
                if final and name not in final:
                    continue
                if not has_alpha and fmt == "png":
                    continue
                jobs.append({"asset": path, "variant": name, "density": d, "fmt": fmt, "opts": opts, "src": src,
                             "out": os.path.join(CAND, asset_id(path), f"{'native' if d is None else format(d, 'g')}_{name}.{fmt}")})
    rows = encode_all(jobs)
    print(f"{len(rows)} files")


def masks():
    """Lossless data images: channel-dropped, oxipng-optimised PNG and exact lossless WebP. Never lossy, never resized
    (except hole.png at half size, which is a soft-edged coverage mask: see ASSETS.md)."""
    import oxipng
    out = os.path.join(CAND, "masks")
    os.makedirs(out, exist_ok=True)
    rows = []
    jobs = []
    specs = {
        "rides/sea/masks.png": ("RGB", "the alpha channel is always 255 and unused"),
        "rides/sea/hole.png": ("L", ""),
        "rides/sea/strokes.png": ("RGB", "ids: R + 256 G; B always 0"),
    }
    for path, (mode, _note) in specs.items():
        im = Image.open(os.path.join(ROOT, path)).convert(mode)
        base = os.path.join(out, asset_id(path))
        p = base + f"_{mode}.png"
        im.save(p, optimize=True)
        for level, zop in ((4, False), (6, True)):
            o = base + f"_{mode}_oxipng{level}{'z' if zop else ''}.png"
            data = oxipng.optimize_from_memory(open(p, "rb").read(), level=level, strip=oxipng.StripChunks.all(),
                                               deflate=oxipng.Deflaters.zopfli(15) if zop else oxipng.Deflaters.libdeflater(12))
            open(o, "wb").write(data)
            rows.append({"asset": path, "variant": f"png_{mode}_oxipng{level}{'z' if zop else ''}", "density": None, "fmt": "png", "bytes": len(data), "ms": 0, "path": o})
        src = base + "_src.png"
        im.convert("RGB" if mode == "L" else mode).save(src)
        jobs.append({"asset": path, "variant": "webp_ll_exact", "density": None, "fmt": "webp", "opts": {"lossless": True, "effort": 6, "exact": True},
                     "src": src, "out": base + "_ll_exact.webp"})
    record(rows)
    rows += encode_all(jobs)
    for r in rows:
        print(f"{r['bytes']:>9}  {r['asset']} {r['variant']}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    arg = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d  # noqa: E731
    final = arg("--variants")
    final = final.split(",") if final else None
    if cmd == "painting":
        widths = [int(w) for w in arg("--widths", "1920,2560,3024,3456,3840,5120").split(",")]
        ladder = [x for x in PAINTING_LADDER if not final or x[0] in final]
        painting(widths, ladder)
    elif cmd == "preview":
        preview()
    elif cmd == "assets":
        assets(arg("--only", "*"), final)
    elif cmd == "masks":
        masks()
