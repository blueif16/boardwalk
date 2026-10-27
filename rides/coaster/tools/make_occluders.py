"""Front cut-outs for the coaster train, from the painting's own pixels (tools/park_patch.py cut):

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/coaster/tools/make_occluders.py

- fireball: the Fireball's hub ball; the train comes out from behind it (the hidden run ends inside it).
- station: the station shed's roof board and wall; the train waits behind them, riders' heads above the roof.
- lattice: along the run behind the structure (track.json mode 1), the painted lattice members in front of the train
  (near-white timber and the dark outline along it). The gaps between members stay open, so the train is seen
  through them; the layer also draws this cut-out at OCC_LATTICE_ALPHA so the train reads as behind, not gone.
Writes rides/coaster/occ_<name>.webp + .json and gen/occ_lattice_check.png (the class mask over the painting).
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
UP, DOWN = 38.0, 8.0  # how far the train reaches above and below its track, park px


def run_cut(poly, name, extra=()):
    cmd = [sys.executable, "-I", os.path.join(ROOT, "tools/park_patch.py"), "cut", poly, os.path.join(RIDE, f"occ_{name}"), *extra]
    subprocess.run(cmd, check=True, cwd=ROOT)


def main():
    track = json.load(open(os.path.join(RIDE, "track.json")))
    P = np.array(track["points"])
    mode = np.array(track["mode"])

    # The Fireball's hub ball.
    c, r = (2150.0, 1216.0), 26.0
    ball = [[[round(c[0] + r * np.cos(a), 1), round(c[1] + r * np.sin(a), 1)] for a in np.linspace(0, 2 * np.pi, 40, endpoint=False)]]
    json.dump(ball, open(os.path.join(GEN, "occ_fireball_poly.json"), "w"))
    run_cut(os.path.join(GEN, "occ_fireball_poly.json"), "fireball", ["--feather", "1.2"])

    # The station shed: its sloped roof board and the wall and door below it; the track runs behind them.
    shed = [[[2286, 1245], [2286, 1207], [2290, 1194], [2352, 1166], [2357, 1170], [2348, 1180], [2348, 1245]]]
    json.dump(shed, open(os.path.join(GEN, "occ_station_poly.json"), "w"))
    run_cut(os.path.join(GEN, "occ_station_poly.json"), "station", ["--feather", "0.8"])

    # The lattice along the run behind the structure.
    g = np.where(mode == 1)[0]
    pts = P[g]
    t = np.gradient(P, axis=0)[g]
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.c_[-t[:, 1], t[:, 0]]
    n[n[:, 1] > 0] *= -1  # the normal pointing up the screen
    lo = np.minimum(pts + n * UP, pts - n * DOWN).min(0) - 4
    hi = np.maximum(pts + n * UP, pts - n * DOWN).max(0) + 4
    region = [float(np.floor(lo[0])), float(np.floor(lo[1])), float(np.ceil(hi[0])), float(np.ceil(hi[1]))]
    x0, y0, x1, y1 = region
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        a = np.asarray(im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F)))).astype(np.float32)
    h, w = a.shape[:2]
    corridor = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(corridor)
    for p, nn in zip(pts, n):
        A = ((p + nn * UP) - [x0, y0]) * F
        B = ((p - nn * DOWN) - [x0, y0]) * F
        d.line([tuple(A), tuple(B)], fill=255, width=6)
    corridor = np.asarray(corridor) > 127

    r_, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r_ + 0.587 * g_ + 0.114 * b_
    sat = a.max(-1) - a.min(-1)
    # The lattice members: near-white timber, plus the dark outline right along each member. Red is left out: in this
    # corridor it is the painted return run itself, which the train covers. Everything else stays a gap.
    white = (lum > 200) & (sat < 45)
    white = ndimage.binary_opening(white, iterations=1)
    dark = (lum < 120) & ndimage.binary_dilation(white, iterations=3)
    front = white | dark
    mask = ndimage.gaussian_filter((front & corridor).astype(np.float32), 0.7)
    Image.fromarray((mask * 255).astype(np.uint8)).save(os.path.join(GEN, "occ_lattice_class.png"))
    rect = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]
    json.dump(rect, open(os.path.join(GEN, "occ_lattice_poly.json"), "w"))
    run_cut(os.path.join(GEN, "occ_lattice_poly.json"), "lattice",
            ["--feather", "0", "--classmask", os.path.join(GEN, "occ_lattice_class.png"), "--region", ",".join(str(v) for v in region)])

    # Check: the kept pixels tinted magenta, the open gaps left as they are, inside the corridor.
    chk = a.copy()
    chk[corridor] = chk[corridor] * (1 - mask[corridor, None] * 0.6) + np.array([230, 0, 160]) * mask[corridor, None] * 0.6
    Image.fromarray(chk.astype(np.uint8)).save(os.path.join(GEN, "occ_lattice_check.png"))
    print(f"lattice region {region}; corridor {corridor.mean():.2f} of it, kept {mask[corridor].mean():.2f} of the corridor")


if __name__ == "__main__":
    main()
