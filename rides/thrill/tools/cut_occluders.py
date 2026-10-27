"""Front cut-outs for the thrill rides: the painting's own pixels (with this ride's plate laid over it first), inside
hand-measured polygons, drawn over the moving parts where a painted thing stands in front of them.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/thrill/tools/cut_occluders.py

Like `tools/park_patch.py cut`, except that it composites the plate (plate_typhoon.webp) over the painting before
cutting: the Typhoon's new tower exists only in the plate. Writes occ_<name>.webp (RGBA at HD density, 2.5 px per park
px) and occluders.json ({name: {"rect": [x, y, w, h] in park px}}).
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
F = 2.5

# Park px. The drop tower's column and crown (the seat ring's back half passes behind it); the Typhoon's tower and base
# (nearer than the drop tower, so it covers the ring's right tip); the flower bush in front of the drop tower's base.
POLYS = {
    "dropcolumn": [[1030, 866], [1072, 866], [1082, 885], [1082, 912], [1071, 928], [1069, 945], [1072, 960],
                   [1078, 990], [1082, 1005], [1086, 1030], [1087, 1050], [1091, 1075], [1096, 1100], [1018, 1100],
                   [1020, 1050], [1022, 1000], [1023, 960], [1023, 930], [1018, 912], [1019, 885]],
    "typhoontower": [[1139, 886], [1169, 886], [1175, 935], [1172, 1000], [1176, 1138], [1197, 1160], [1197, 1201],
                     [1150, 1211], [1103, 1201], [1103, 1160], [1133, 1138], [1136, 1000], [1133, 935]],
    "bush": [[1003, 1182], [1018, 1150], [1028, 1121], [1050, 1117], [1063, 1140], [1081, 1168], [1087, 1200],
             [1077, 1227], [1030, 1231], [1005, 1219]],
}
FEATHER = 0.8  # park px


def main():
    hd = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGBA")
    plate = json.load(open(os.path.join(RIDE, "plate_typhoon.json")))
    pimg = Image.open(os.path.join(RIDE, "plate_typhoon.webp")).convert("RGBA")
    meta = {}
    for name, poly in POLYS.items():
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        r = [min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2]
        box = tuple(round(v * F) for v in r)
        im = hd.crop(box)
        px, py = round(plate["rect"][0] * F) - box[0], round(plate["rect"][1] * F) - box[1]
        im.alpha_composite(pimg, (max(0, px), max(0, py)), (max(0, -px), max(0, -py)))
        m = Image.new("L", im.size, 0)
        ImageDraw.Draw(m).polygon([((x - r[0]) * F, (y - r[1]) * F) for x, y in poly], fill=255)
        m = np.asarray(m) > 127
        sd = ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)
        alpha = np.clip(0.5 + sd / (FEATHER * F), 0, 1)
        rgba = np.asarray(im).astype(np.float32)
        rgba[..., 3] = alpha * 255
        Image.fromarray(rgba.astype(np.uint8), "RGBA").save(os.path.join(RIDE, f"occ_{name}.webp"), lossless=True, quality=100)
        meta[name] = {"rect": [r[0], r[1], r[2] - r[0], r[3] - r[1]]}
        print(name, meta[name]["rect"])
    json.dump(meta, open(os.path.join(RIDE, "occluders.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
