"""Scores painting candidates: SSIMULACRA2 against the master resized to the same width (Lanczos from
gen/park/world_v2_hd.png), against the shipped file, and the 10th-percentile 512 px tile (the worst places: paper grain,
line art, sea). Shown 1:1 on the screen that loads that width, so this is the on-screen comparison; for the MacBook
(3456 drawn at 3024) pass --display 3024.

  $PY tests/perf/tools/score_painting.py <width> [--display W] [--only glob] > scores.json
"""
import glob, json, os, sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import ROOT, SCRATCH  # noqa: E402
import metrics as M  # noqa: E402

W = int(sys.argv[1])
DISPLAY = int(sys.argv[sys.argv.index("--display") + 1]) if "--display" in sys.argv else W
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else "*"


def at_display(a):
    if DISPLAY == W:
        return a
    return M.resize(a, DISPLAY, round(a.shape[0] * DISPLAY / W))


def setup():
    global REF, CUR
    REF = at_display(M.load(f"{SCRATCH}/src/world_{W}.png"))
    cur = os.path.join(ROOT, f"site/park/world_{W}.webp")
    CUR = at_display(M.load(cur)) if os.path.exists(cur) else None


def score(path):
    d = at_display(M.load(path)[..., :3])
    out = {"file": path, "bytes": os.path.getsize(path), "vs_master": round(M.ss2(REF, d), 2),
           "ssim": round(M.ssim(REF, d), 4)}
    t = M.tiles(REF, d, 256)
    out["tile_p10"] = round(t["p10"], 2)
    out["tile_min"] = round(t["min"], 2)
    if CUR is not None:
        out["vs_current"] = round(M.ss2(CUR, d), 2)
    return out


if __name__ == "__main__":
    files = sorted(glob.glob(f"{SCRATCH}/cand/painting/{W}/{ONLY}"))
    cur = os.path.join(ROOT, f"site/park/world_{W}.webp")
    if os.path.exists(cur):
        files = [cur] + files
    with Pool(int(os.environ.get("JOBS", 8)), initializer=setup) as p:
        rows = p.map(score, files)
    print(json.dumps(rows, indent=1))
