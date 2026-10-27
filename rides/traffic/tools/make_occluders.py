"""The traffic layer's front cut-outs: rides/traffic/occ.webp + occ.json (and gen/occ_check.png).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/traffic/tools/make_occluders.py

Uses the reusable builder in occluders.py over every car path (the loop and the stalls) on the painting with the
car-erase patches. Everything is automatic except three objects the palette test can't see, placed by hand (park px):
  - the two flags on the coaster's crest: white stripes on thin poles;
  - the Boardwalk Bowl's roof and its white pin, which the painting draws over the eastbound lane;
  - the railway bridge's truss by the turn, where the asphalt is tinted green.
All three stand south of every lane, so they are drawn in front of every car.
"""
import json, os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I leaves the script's folder off the path
import occluders as oc  # noqa: E402
RIDE = os.path.dirname(HERE)
Y0, Y1 = 430, 1250
CAR_H, CAR_HALF, CAR_BELOW = 50, 44, 22  # px a car reaches above its wheel line, along the path, below it

lanes = json.load(open(os.path.join(RIDE, "lanes.json")))
patches = json.load(open(os.path.join(RIDE, "patches.json")))
band = oc.load_band(Y0, Y1, patches, RIDE)
cls = oc.classify(band.park, Y0, lanes["lines"]["yellow"], band.hd)
paths = [lanes["loop"]] + [st["path"] for st in lanes["stalls"]]
reach = oc.sweep(paths, band.park.shape[:2], Y0, CAR_H, CAR_HALF, CAR_BELOW)

H, W = reach.shape


def poly_mask(poly):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(x, y - Y0) for x, y in poly], fill=255)
    return np.asarray(m) > 0


p = band.park
r, g, b = p[..., 0], p[..., 1], p[..., 2]
mx, mn = p.max(-1), p.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
FLAGS = [[(2633, 866), (2728, 870), (2728, 940), (2652, 946), (2652, 1010), (2633, 1010)],
         [(2722, 880), (2802, 884), (2804, 955), (2745, 958), (2745, 1010), (2722, 1010)]]
BOWL = [(258, 660), (268, 660), (279, 690), (281, 724), (300, 724), (355, 728), (375, 760), (378, 822), (160, 822),
        (165, 765), (195, 735), (225, 722), (246, 722), (247, 690)]
BRIDGE = [(3440, 690), (3840, 590), (3840, 1000), (3470, 1000), (3440, 860)]
asphalt = (sat < 0.16) & (mx > 110) & (mx < 236)
truss = ((r > g) & (g > b - 8) & (mx < 175) & (sat > 0.22)) | (mx < 80)
extra = [(poly_mask(f) & ~asphalt, 99999, "flag") for f in FLAGS]
extra.append((poly_mask(BOWL), 99999, "bowl"))
extra.append((poly_mask(BRIDGE) & truss, 99999, "bridge"))
# The automatic pass must not also find the hand-placed objects (double edges), nor the tinted asphalt by the turn.
hand = np.zeros_like(reach)
for m, _, _ in extra:
    hand |= m
cls["road"] |= hand | (poly_mask(BRIDGE) & ~truss)

# A trunk hidden behind the flags stands on the next ground line below what shows: the median, else the south kerb.
LINES = [lanes["lines"]["median"], lanes["lines"]["kerb"]]
def hidden_foot(x, y_seen):
    for line in LINES:
        y = float(np.interp(x, *zip(*line)))
        if y > y_seen:
            return y
    return y_seen

pieces = oc.find(band.park, cls, reach, Y0, extra, hidden_foot)
for p_ in pieces:
    if p_.get("hidden"):
        print(f"hidden foot: piece at x {p_['x0']}..{p_['x0'] + p_['mask'].shape[1]}, foot -> {p_['sortY']:.0f}")
meta, shape = oc.write(pieces, band, os.path.join(RIDE, "occ"))
shutil.move(os.path.join(RIDE, "occ_check.png"), os.path.join(RIDE, "gen/occ_check.png"))
kinds = {}
for m in meta:
    kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
print(f"{len(meta)} pieces {kinds}, atlas {shape[1]} x {shape[0]}")
