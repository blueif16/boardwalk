"""Front cut-outs for the flume's logs, from the painting's own pixels (the shared tools/park_patch.py cut, unchanged).
Adapted from rides/coaster/tools/make_occluders.py: same cut, but the class masks keep "not water" instead of "lattice
members", and the crossing cut-out follows the S tube's own band.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/flume/tools/make_occluders.py

- s_tube: the S tube's band where the lift chute passes behind it (track.json mode 1); drawn between the back canvas
  (logs on that stretch of the lift) and the front canvas.
- disc: the round blue disc the S tube passes behind, east of the S.
- porch: the mill house's porch roof and front pillar, limited to the wood (not the water around the pillar); the log
  slips behind them into the mill house.
- box: the wooden housing at the lift's foot, wood only, so the log is seen through its blue panels as it comes out.
Writes rides/flume/occ_<name>.webp + .json and gen/occ_check.png (all four over the painting, tinted).
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
GEN = os.path.join(RIDE, "gen")
F = 2.5
TUBE_HALF = 10.5  # px: the S tube's half-width including its outline


def run_cut(poly, name, extra=()):
    path = os.path.join(GEN, f"occ_{name}_poly.json")
    json.dump(poly, open(path, "w"))
    cmd = [sys.executable, "-I", os.path.join(ROOT, "tools/park_patch.py"), "cut", path, os.path.join(RIDE, f"occ_{name}"), *extra]
    subprocess.run(cmd, check=True, cwd=ROOT)


def hd(region):
    x0, y0, x1, y1 = region
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        return np.asarray(im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F)))).astype(np.float32)


def not_water(poly, name):
    """A class mask over the polygon's box: 1 where the painting is not water (wood, outlines, plants)."""
    xs = [x for p in poly for x, _ in p]
    ys = [y for p in poly for _, y in p]
    region = [min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2]
    a = hd(region)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    water = (b > r + 40) & (g > r + 15) & (b > 115)
    water = ndimage.binary_opening(water, iterations=1)
    keep = ndimage.gaussian_filter((~water).astype(np.float32), 0.6)
    path = os.path.join(GEN, f"occ_{name}_class.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(path)
    return ["--classmask", path, "--region", ",".join(str(v) for v in region)]


def ellipse(c, rx, ry, n=48):
    return [[round(c[0] + rx * np.cos(t), 1), round(c[1] + ry * np.sin(t), 1)] for t in np.linspace(0, 2 * np.pi, n, endpoint=False)]


def main():
    track = json.load(open(os.path.join(RIDE, "track.json")))
    P = np.array(track["points"])
    mode, kind = np.array(track["mode"]), np.array(track["kind"])

    # The S tube's band over the crossing: S-tube points (flume) between y 985 and 1066, west of x 3480.
    sel = np.where((kind == 2) & (P[:, 1] > 985) & (P[:, 1] < 1066) & (P[:, 0] < 3470) & (P[:, 0] > 3420))[0]
    pts = P[sel]
    t = np.gradient(P, axis=0)[sel]
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.c_[-t[:, 1], t[:, 0]]
    band = np.r_[pts + n * TUBE_HALF, (pts - n * TUBE_HALF)[::-1]]
    run_cut([band.round(1).tolist()], "s_tube", ["--feather", "0.8"])

    run_cut([ellipse((3610, 1050), 27.5, 21.5)], "disc", ["--feather", "1"])

    # The roof, the front pillar, and the dark doorway right of the pillar (wood and shadow only: the water in front of
    # the doorway stays open), so the log's nose disappears into the dark as it goes in.
    porch = [[3046, 1244], [3122, 1244], [3122, 1296], [3085, 1296], [3085, 1339], [3068, 1339], [3068, 1269], [3046, 1269]]
    run_cut([porch], "porch", ["--feather", "0.6", *not_water([porch], "porch")])

    box = [[3282, 1192], [3282, 1160], [3299, 1143], [3318, 1134], [3336, 1146], [3352, 1172], [3346, 1193]]
    run_cut([box], "box", ["--feather", "0.6", *not_water([box], "box")])

    # Check: every cut-out tinted magenta over the painting.
    region = (3020, 960, 3660, 1350)
    a = hd(region)
    for name in ("s_tube", "disc", "porch", "box"):
        meta = json.load(open(os.path.join(RIDE, f"occ_{name}.json")))
        im = np.asarray(Image.open(os.path.join(RIDE, f"occ_{name}.webp")).convert("RGBA")).astype(np.float32) / 255
        x, y = round((meta["rect"][0] - region[0]) * F), round((meta["rect"][1] - region[1]) * F)
        h, w = im.shape[:2]
        sl = a[y:y + h, x:x + w]
        al = im[: sl.shape[0], : sl.shape[1], 3:] * 0.55
        sl[:] = sl * (1 - al) + np.array([230, 0, 160]) * al
    Image.fromarray(a.astype(np.uint8)).resize((int(a.shape[1] / 1.25), int(a.shape[0] / 1.25)), Image.LANCZOS).save(os.path.join(GEN, "occ_check.png"))
    print("cut-outs written; check gen/occ_check.png")


if __name__ == "__main__":
    main()
