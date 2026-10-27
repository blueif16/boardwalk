"""The plate's allowed area for each carousel, from geom.json: everything under the roof, between the valance's bottom
edge (front arc, raised by --up park px so it tucks under the valance overlay) and the platform's front rim (lowered
by --down so it tucks under the band overlay), closed at the sides by short straight edges.

  uv run -q --no-project python -I rides/carousel/tools/plate_poly.py [--up 6] [--down 3] [--side 4]

Writes rides/carousel/gen/plate_<name>_poly.json (park px), the --poly input of tools/park_patch.py paste.
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
args = sys.argv[1:]
opt = lambda n, d: float(args[args.index(n) + 1]) if n in args else d
up, down, side = opt("--up", 6), opt("--down", 3), opt("--side", 4)


def ell(e, phi, grow=0):
    cx, cy, a, b = e["c"][0], e["c"][1], e["a"] + grow, e["b"] + grow * e["b"] / e["a"]
    r = math.radians(e.get("rot", 0))
    u, v = a * math.cos(phi), b * math.sin(phi)
    return cx + u * math.cos(r) - v * math.sin(r), cy + u * math.sin(r) + v * math.cos(r)


for name, g in json.load(open(os.path.join(RIDE, "geom.json"))).items():
    top = [(x, y - up) for x, y in (ell(g["val"], math.radians(k), side) for k in range(-12, 193, 3))]
    bottom = [(x, y + down) for x, y in (ell(g["top"], math.radians(k), side) for k in range(192, -13, -3))]
    poly = [[round(x, 1), round(y, 1)] for x, y in top + bottom]
    out = os.path.join(RIDE, "gen", f"plate_{name}_poly.json")
    json.dump([poly], open(out, "w"))
    print(out, len(poly), "points")
