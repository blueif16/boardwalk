"""Side-by-side crops for looking with one's own eyes: rows are places, columns are variants, each crop enlarged
with nearest-neighbour so single pixels stay visible.

  $PY tests/perf/tools/crops.py out.png --zoom 2 --box fx,fy,fw,fh [--box ...] --bg painting|grey|check
        label=path [label=path ...]

Boxes are fractions of the image (so one box works for every width of the painting). RGBA is shown over a grey
and white checkerboard unless --bg grey. The first variant is the reference; a last column shows |ref - first
candidate| x 8 when --diff is given.
"""
import os, sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import metrics as M  # noqa: E402


def main():
    a = sys.argv[1:]
    out = a.pop(0)
    zoom, boxes, bg, diff, variants, size = 2, [], "check", False, [], None
    while a:
        x = a.pop(0)
        if x == "--zoom": zoom = float(a.pop(0))
        elif x == "--box": boxes.append([float(v) for v in a.pop(0).split(",")])
        elif x == "--bg": bg = a.pop(0)
        elif x == "--diff": diff = True
        elif x == "--size": size = [int(v) for v in a.pop(0).split("x")]
        else:
            label, path = x.split("=", 1)
            variants.append((label, path))
    ims = []
    for label, path in variants:
        arr = M.load(path)
        if size and (arr.shape[1], arr.shape[0]) != tuple(size):
            arr = M.resize(M.rgba(arr), size[0], size[1])
        ims.append((label, arr))
    H, W = ims[0][1].shape[:2]
    cells = []
    for fx, fy, fw, fh in boxes:
        x0, y0, x1, y1 = int(fx * W), int(fy * H), int((fx + fw) * W), int((fy + fh) * H)
        row = []
        for label, arr in ims:
            c = arr[y0:y1, x0:x1]
            if c.shape[2] == 4:
                yy, xx = np.mgrid[0:c.shape[0], 0:c.shape[1]]
                board = np.where(((yy // 8 + xx // 8) % 2)[..., None] == 0, 200, 255).astype(np.float32) if bg == "check" else np.full(c.shape[:2] + (1,), 128, np.float32)
                c = M.over(c, np.broadcast_to(board, c.shape[:2] + (3,)))
            row.append((label, c))
        if diff and len(ims) > 1:
            d = np.clip(np.abs(row[0][1] - row[1][1]) * 8, 0, 255)
            row.append(("|diff| x8", d))
        cells.append(row)
    cw = max(int(r[1].shape[1] * zoom) for row in cells for r in row)
    ch = [max(int(r[1].shape[0] * zoom) for r in row) for row in cells]
    ncol = max(len(row) for row in cells)
    canvas = Image.new("RGB", (ncol * (cw + 6) + 6, sum(h + 24 for h in ch) + 6), (40, 40, 40))
    dr = ImageDraw.Draw(canvas)
    y = 6
    for row, h in zip(cells, ch):
        for i, (label, c) in enumerate(row):
            im = Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8)).resize((int(c.shape[1] * zoom), int(c.shape[0] * zoom)), Image.NEAREST)
            x = 6 + i * (cw + 6)
            canvas.paste(im, (x, y + 18))
            dr.text((x, y + 3), label, fill=(240, 240, 240))
        y += h + 24
    canvas.save(out, optimize=True)
    print(out, canvas.size)


if __name__ == "__main__":
    main()
