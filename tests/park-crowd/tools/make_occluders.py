"""The crowd's painted cut-outs: tests/park-crowd/occ.webp + occ.json (+ shots/occ_check.webp), the things on the
promenade that animals pass behind (lamps, stalls, kiosks, benches, bushes, signs, the deck rail, the kiddie rides),
as masks with their base lines, for tests/park-crowd/crowd.js (DEPTH.md).

  node scripts/drive.mjs "http://localhost:15178/?t=0&occ=0" --actions tests/park-crowd/tools/dump_reach.json \\
      | python3 tests/park-crowd/tools/save_reach.py            # the reach, when the network or a ride's queue moves
  uv run -q --no-project --with pillow --with numpy --with scipy python -I tests/park-crowd/tools/make_occluders.py [--preview OUT.png]

Uses tools/occluders.py over everywhere an animal can stand on the deck (occ_reach.json: the walking network with the
rides' queues, gates and exits), on the painting with the reviewed rides' plates laid over it, with:
  - the deck's own palette (learned under the lanes) as flat ground, so only things standing on it are objects; the
    stairs, the beach wall under the rail and the benches (walked or sat on) are left out;
  - feet measured on the ink-kept pixels and sloped bases fitted per 160 px chunk (the rail, a stall's front edge);
  - every live ride's area excluded: those layers return their own occluders (rides/RIDERS.md "Depth"), and the
    carousel, Sea Swings and beach areas belong to their own layers;
  - by hand (HAND): the thrill layer's flower bush, whose cut-out polygon carries deck, keyed to its own pixels and
    sorted on the middle of its mound, not its lowest pixel.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CROWD = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(CROWD))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import occluders as oc  # noqa: E402

HEIGHT, HALF, BELOW = 48, 14, 3   # px an animal reaches above its feet, either side of them, below them
DOWN = 40                         # px below the reach searched for feet
LAMP_INSET = 3                    # px from a round foot's lowest pixel to its middle
MIN_PX = 12                       # px: smaller pieces (stray specks) are dropped
WALL_TOP = 15                     # px under the rail's top line where the beach wall starts (the posts' feet)
# Plates of the reviewed rides, laid over the painting so their erased live parts don't read as objects.
PLATES = ["rides/pirate/plate.json", "rides/wheel/plate.json", "rides/teacups/plate.json",
          "rides/thrill/plate_typhoon.json", "rides/flume/plate_pool.json"]
PLATE_FILES = {"rides/pirate/plate.json": "plate.webp", "rides/wheel/plate.json": "plate.webp",
               "rides/teacups/plate.json": "plate.webp", "rides/thrill/plate_typhoon.json": "plate_typhoon.webp",
               "rides/flume/plate_pool.json": "plate_pool.webp"}
# Areas left to the layers that draw there (park px polygons): their structures come with their own occluders.
EXCLUDE = {
    "pirate A-frame and platform": [(836, 1070), (1030, 1070), (1030, 1300), (836, 1300)],
    "thrill towers": [(1012, 860), (1200, 860), (1200, 1216), (1100, 1216), (1100, 1236), (1012, 1236)],
    # Faded paving east of the Typhoon (its queue stands on it), up to the yellow stall's roof.
    "paving by the Typhoon": [(1205, 1090), (1400, 1090), (1400, 1178), (1300, 1185), (1300, 1205), (1205, 1210)],
    "west carousel": [(1570, 1170), (1770, 1170), (1770, 1300), (1570, 1300)],
    "coaster": [(1990, 900), (3240, 900), (3240, 1250), (1990, 1250)],
    "wheel A-frame": [(2495, 1290), (2680, 1290), (2680, 1495), (2495, 1495)],
    "sea swings": [(2700, 1350), (2870, 1350), (2870, 1550), (2700, 1550)],
    "teacups": [(3100, 1490), (3320, 1490), (3320, 1640), (3100, 1640)],
    "flume": [(3010, 890), (3740, 890), (3740, 1400), (3010, 1400)],
    # The east rail runs steeply into the picture; the exit lane beside it passes outside it, in front.
    "east rail": [(3535, 1725), (3595, 1725), (3775, 1405), (3715, 1405)],
}
# Hand-placed: (name, cut-out RGBA file, its rect in park px, base y or [xa, ya, xb, yb]).
HAND = [("thrill bush", "rides/thrill/occ_bush.webp", [1001, 1115, 88, 118], 1218)]


def main():
    preview = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else None
    reach_meta = json.load(open(os.path.join(CROWD, "occ_reach.json")))
    walk = json.load(open(os.path.join(CROWD, "walk.json")))
    ys = [p[1] for p in reach_meta["points"]] + [q[1] for l in reach_meta["lines"] for q in l[:2]]
    y0 = int(min(ys) - HEIGHT - 10)
    y1 = int(max(ys) + BELOW + DOWN + 10)
    patches = []
    for pj in PLATES:
        meta = json.load(open(os.path.join(ROOT, pj)))
        patches.append({"file": os.path.join(ROOT, os.path.dirname(pj), PLATE_FILES[pj]), "rect": meta["rect"]})
    band = oc.load_band(y0, y1, patches, "", fit=True)
    H, Wd = band.park.shape[:2]

    # The deck's palette: the painting just above every lane point (open deck by construction).
    lanes = [n["px"] for n in walk["nodes"] if n["kind"] == "lane" and n["h"] == 0]
    samples = np.concatenate([band.park[int(y) - y0 - 9:int(y) - y0 - 1, int(x) - 7:int(x) + 7].reshape(-1, 3) for x, y in lanes])
    # Only warm tans can be deck (the samples also catch the rail, lamp feet and stall fronts by the lanes).
    r, g, b = samples[:, 0], samples[:, 1], samples[:, 2]
    mx, mn = samples.max(1), samples.min(1)
    sat = (mx - mn) / np.maximum(mx, 1)
    tan = (r >= g) & (g >= b - 4) & (r - b > 35) & (sat > 0.12) & (sat < 0.56) & (mx > 150)
    deck = oc.palette(samples[tan], q=8, keep=0.95)
    ground = oc.in_palette(band.park, deck)
    cls = oc.classify(band.park, y0, hd=band.hd, ground=ground, street=False)

    paths = [[l[0], l[1]] for l in reach_meta["lines"]]
    # Densify the lines (sweep boxes every step-th point) and add every point.
    dense = []
    for a, b in paths:
        n = max(2, int(np.hypot(b[0] - a[0], b[1] - a[1]) / 2))
        dense.append([[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] for t in np.linspace(0, 1, n)])
    dense += [[[p[0], p[1]]] for p in reach_meta["points"]]
    reach = oc.sweep(dense, (H, Wd), y0, HEIGHT, HALF, BELOW, step=1)

    def poly(points):
        m = Image.new("L", (Wd, H), 0)
        ImageDraw.Draw(m).polygon([(x, y - y0) for x, y in points], fill=255)
        return np.asarray(m) > 0
    exclude = np.zeros((H, Wd), bool)
    for pts in EXCLUDE.values():
        exclude |= poly(pts)
    # The stairs (animals walk on them) and the beach wall under the rail (the stairs stand in front of it): ground,
    # not things to pass behind. The rail keeps its bar and posts down to WALL_TOP px under its top line.
    nodes = {n["id"]: n for n in walk["nodes"]}
    for k in range(64):
        top, bot = nodes.get(f"st{k}"), nodes.get(f"sb{k}")
        if not top:
            break
        (tx, ty), (bx, by) = top["px"], bot["px"]
        exclude |= poly([(tx - 26, ty - 2), (tx + 26, ty - 2), (bx + 30, by + 12), (bx - 30, by + 12)])
    # Benches: animals sit on them.
    for x0b, x1b, front, kind in walk["objects"]:
        if kind == "bench":
            exclude |= poly([(x0b - 6, front - 45), (x1b + 6, front - 45), (x1b + 6, front + 4), (x0b - 6, front + 4)])
    rail, foot = np.array(walk["rail"], float), np.array(walk["wallFoot"], float)
    xs = np.arange(Wd)
    wall_top = np.interp(xs, rail[:, 0], rail[:, 1]) + WALL_TOP
    wall_bot = np.interp(xs, foot[:, 0], foot[:, 1]) + 10
    rows = np.arange(H)[:, None] + y0
    under = (rows > wall_top[None, :]) & (rows < wall_bot[None, :]) & (xs[None, :] >= rail[0, 0] - 20) & (xs[None, :] <= rail[-1, 0])
    exclude |= under

    extra = []
    for name, f, (x, y, w, h), base in HAND:
        im = Image.open(os.path.join(ROOT, f)).convert("RGBA").resize((round(w), round(h)), Image.BILINEAR)
        a = np.zeros((H, Wd), bool)
        sub = np.asarray(im)[..., 3] > 128
        a[round(y) - y0:round(y) - y0 + sub.shape[0], round(x):round(x) + sub.shape[1]] = sub
        # Keyed to the thing's own pixels: not deck, not flat; small holes closed.
        a &= ~cls["flat"] & ~cls["road"]
        a = ndimage.binary_opening(ndimage.binary_closing(a, iterations=1), iterations=1)
        extra.append((a, base, name))
        exclude |= a

    if preview:
        chk = band.park.copy() * 0.55
        chk[reach] = chk[reach] * 0.6 + np.array([60, 160, 255]) * 0.4
        cand = ~cls["road"] & ~cls["flat"] & reach & ~exclude
        chk[cand] = chk[cand] * 0.3 + np.array([255, 60, 60]) * 0.7
        chk[exclude] = chk[exclude] * 0.5 + np.array([0, 0, 0]) * 0.5
        Image.fromarray(np.clip(chk, 0, 255).astype(np.uint8)).save(preview)
        print("preview", y0, y1)
        return

    pieces = oc.find_layered(cls, reach, y0, exclude=exclude, extra=extra, down=DOWN)
    # Round feet (lamps, posts): sort on the middle of the foot, a few px above its lowest pixel.
    for p in pieces:
        if p["kind"] == "auto" and p["mask"].shape[1] <= 30:
            p["sortY"] -= LAMP_INSET
            if p.get("line"):
                p["line"] = [p["line"][0], p["line"][1] - LAMP_INSET, p["line"][2], p["line"][3] - LAMP_INSET]
    pieces = [p for p in pieces if p["mask"].sum() >= MIN_PX]
    out = os.path.join(CROWD, "occ")
    meta, shape = oc.write(pieces, band, out, density=2, mask_only=True)
    os.makedirs(os.path.join(CROWD, "shots"), exist_ok=True)
    Image.open(out + "_check.png").save(os.path.join(CROWD, "shots", "occ_check.webp"), quality=82)
    os.remove(out + "_check.png")
    kinds = {}
    for m in meta:
        kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
    print(f"{len(meta)} pieces {kinds}, sheet {shape[1]} x {shape[0]}, {os.path.getsize(out + '.webp') // 1024} KB")


if __name__ == "__main__":
    main()
