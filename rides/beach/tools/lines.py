"""The beach's measured lines in park px, shared by the beach tools.

wall_foot and dry_edge are tests/park-crowd/tools/make_walk.mjs's wallFoot and waterline (the dry sand's edge);
sea(x) is the painted shoreline (the foam's sea-side edge, s = 0 in rides/sea/masks.png), and the first crossing
going down (the lagoon at x 2200-2550). path(x) is the crowd's walk along the wall foot.
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WALL = [[213, 1160], [293, 1183], [400, 1225], [493, 1257], [627, 1283], [800, 1303], [870, 1340], [913, 1363], [1067, 1373],
        [1133, 1347], [1300, 1323], [1367, 1307], [1527, 1343], [1600, 1367], [1767, 1393], [1947, 1433], [2033, 1455],
        [2200, 1493], [2400, 1530], [2600, 1567], [2800, 1607], [2880, 1633], [3100, 1670], [3347, 1743], [3537, 1803]]
DRY = [[0, 1330], [500, 1470], [1000, 1570], [1500, 1640], [1875, 1712], [2250, 1812], [2625, 1880], [3000, 1980], [3500, 2150], [3840, 2250]]


def along(line, x):
    xs, ys = zip(*line)
    return float(np.interp(x, xs, ys))


wall_foot = lambda x: along(WALL, x)
dry_edge = lambda x: along(DRY, x)

_m = np.asarray(Image.open(os.path.join(ROOT, "rides/sea/masks.png")))
SDF = _m[..., 0].astype(np.float32) - 128  # park px, + on the sand; 0.5 px per park px from y 1187
NORM = _m[..., 2].astype(np.float32) / 255 * 2 * np.pi - np.pi
Y0, K = 1187, 0.5


def sdf(x, y):
    i, j = int(round((y - Y0) * K)), int(round(x * K))
    if i < 0:
        return 99.0
    i = min(i, SDF.shape[0] - 1); j = min(max(j, 0), SDF.shape[1] - 1)
    return float(SDF[i, j])


def normal(x, y):
    i, j = int(round((y - Y0) * K)), int(round(x * K))
    i = min(max(i, 0), SDF.shape[0] - 1); j = min(max(j, 0), SDF.shape[1] - 1)
    a = float(NORM[i, j])
    return np.cos(a), np.sin(a)


def sea(x, first=False):
    """The y where the sand ends going down at x: the main sea (default) or the first water (the lagoon)."""
    col = SDF[:, min(int(x * K), SDF.shape[1] - 1)]
    cr = [Y0 + i / K for i in range(1, len(col)) if col[i - 1] > 0 and col[i] <= 0]
    if not cr:
        return None
    return cr[0] if first else cr[-1]


if __name__ == "__main__" and "--write" not in __import__("sys").argv:
    for x in range(100, 3840, 100):
        print(x, round(wall_foot(x)), round(wall_foot(x) + 26), round(dry_edge(x)), sea(x, True), sea(x))


def write():
    """rides/beach/lines.json for the layer: the main sea's shoreline, the dry sand's edge and the wall's foot, every 20 px."""
    import json
    xs = list(range(0, 3841, 20))
    out = {
        "about": "rides/beach/tools/lines.py --write: park px, y at each x. sea: the painted shoreline of the open sea (s = 0 in rides/sea/masks.png); dry: the dry sand's edge; wall: the promenade wall's foot.",
        "x0": 0, "dx": 20,
        "sea": [round(sea(x) or 0, 1) for x in xs],
        "dry": [round(dry_edge(x), 1) for x in xs],
        "wall": [round(wall_foot(x), 1) for x in xs],
    }
    json.dump(out, open(os.path.join(ROOT, "rides/beach/lines.json"), "w"), separators=(",", ":"))
    print("rides/beach/lines.json", len(xs))


if __name__ == "__main__" and "--write" in __import__("sys").argv:
    write()
