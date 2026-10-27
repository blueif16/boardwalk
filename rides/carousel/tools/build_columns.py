"""Each carousel's centre column, cut from its plate (the erased carousel) so back horses can pass behind it.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/carousel/tools/build_columns.py

The outlines (park px) are measured on gridded zooms of the plates (tools/grid_view.py --patch). Writes
rides/carousel/column_<name>.webp (RGBA at the plate's HD density, 2.5 px per park px) and adds "column": {rect} to
rides/carousel/plates.json.
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
F = 2.5
COLUMNS = {
    "west": [(1661, 1206), (1685, 1206), (1684, 1216), (1680.5, 1218), (1680.5, 1243), (1684.5, 1246), (1685, 1253),
             (1678, 1256.5), (1666, 1256.5), (1660, 1253), (1660.5, 1246), (1665, 1243), (1665, 1218), (1661.5, 1216)],
}
plates = json.load(open(os.path.join(RIDE, "plates.json")))
for name, poly in COLUMNS.items():
    p = plates[name]
    rx, ry = p["rect"][0], p["rect"][1]
    im = Image.open(os.path.join(RIDE, p["file"])).convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).polygon([((x - rx) * F, (y - ry) * F) for x, y in poly], fill=255)
    m = np.asarray(mask).astype(np.float32) / 255
    m = ndimage.gaussian_filter(m, 0.6)
    a = np.asarray(im).astype(np.float32)
    a[..., 3] = a[..., 3] * m
    ys, xs = np.where(m > 0.01)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = Image.fromarray(a[y0:y1, x0:x1].astype(np.uint8), "RGBA")
    fn = f"column_{name}.webp"
    out.save(os.path.join(RIDE, fn), lossless=True)
    p["column"] = {"file": fn, "rect": [round(rx + x0 / F, 2), round(ry + y0 / F, 2), round((x1 - x0) / F, 2), round((y1 - y0) / F, 2)]}
    print(name, p["column"])
json.dump(plates, open(os.path.join(RIDE, "plates.json"), "w"), indent=1)
