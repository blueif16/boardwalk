"""The whole-park world: paste the sharp master back over an extension, cut the world into pieces for 4K redraws, and
stitch the redrawn pieces into one large painting.

  P="uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/park_world.py"
  $P paste EXT MASTER OUT [--top 620 --height 1320 --feather 48]
  $P cut WORLD DIR [--tile 1536x1024 --step 1152x768 --prompt prompts/park_tile_v1.txt]
  $P stitch WORLD DIR OUT [--scale 2.5 --feather 24]

paste: an extension edit repaints the whole canvas from a reduced copy of its input, so the park in the middle comes
back soft. This puts the master (resized to the band, as it was placed in the extension's input) back over the band,
shifted to wherever the extension moved it (phase correlation), with a feathered edge.

cut: writes DIR/in_r<r>c<c>.png, one crop per grid cell, and DIR/jobs.jsonl for `tools/shyfai_image.py --batch`
(each job redraws its crop at the tool's default 3840 x 2560).

stitch: places every redraw DIR/r<r>c<c>_0.png at its cell x scale, corrected by its measured shift; takes its low
frequencies (colour and light) from WORLD so neighbours agree; then joins each row along a least-difference seam in
the overlap, and the rows the same way, feathered across the seam. Writes OUT (PNG) and prints the shifts.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32)


def save(a, p):
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).save(p)


def resize(a, w, h):
    return np.asarray(Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32)


def gray(a):
    return a @ np.array([0.299, 0.587, 0.114], np.float32)


def shift_of(ref, img):
    """(dy, dx) such that img moved by (dy, dx) lands on ref: phase correlation of local-contrast maps, whole pixels."""
    def prep(a):
        g = gray(a)
        g = g - ndimage.uniform_filter(g, 15)
        wy = np.hanning(g.shape[0])[:, None]
        wx = np.hanning(g.shape[1])[None, :]
        return g * wy * wx
    A, B = np.fft.rfft2(prep(ref)), np.fft.rfft2(prep(img))
    R = A * np.conj(B)
    r = np.fft.irfft2(R / (np.abs(R) + 1e-6), s=ref.shape[:2])
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    if dy > ref.shape[0] // 2: dy -= ref.shape[0]
    if dx > ref.shape[1] // 2: dx -= ref.shape[1]
    return int(dy), int(dx)


def paste(a):
    ext, master = load(a.ext), load(a.master)
    W = ext.shape[1]
    band = resize(master, W, a.height)
    dy, dx = shift_of(ext[a.top:a.top + a.height], band)
    print(f"extension moved the park by dy={dy} dx={dx} px")
    out = ext.copy()
    alpha = np.ones((a.height, W), np.float32)
    ramp = np.linspace(0, 1, a.feather, dtype=np.float32)
    alpha[:a.feather] *= ramp[:, None]
    alpha[-a.feather:] *= ramp[::-1, None]
    # Place the band where the extension drew the park; columns it no longer covers keep the extension.
    y0, x0 = a.top + dy, dx
    ys, xs = slice(max(0, y0), min(ext.shape[0], y0 + a.height)), slice(max(0, x0), min(W, x0 + W))
    by, bx = slice(ys.start - y0, ys.stop - y0), slice(xs.start - x0, xs.stop - x0)
    al = alpha[by, bx][..., None]
    out[ys, xs] = out[ys, xs] * (1 - al) + band[by, bx] * al
    diff = np.abs(ext[ys, xs] - band[by, bx]).mean()
    print(f"mean colour difference in the band before pasting: {diff:.1f} levels")
    save(out, a.out)


def grid(world_shape, tile, step):
    H, W = world_shape
    xs = list(range(0, W - tile[0] + 1, step[0]))
    ys = list(range(0, H - tile[1] + 1, step[1]))
    if xs[-1] + tile[0] < W: xs.append(W - tile[0])
    if ys[-1] + tile[1] < H: ys.append(H - tile[1])
    return ys, xs


def cut(a):
    world = load(a.world)
    tile, step = [int(v) for v in a.tile.split("x")], [int(v) for v in a.step.split("x")]
    ys, xs = grid(world.shape[:2], tile, step)
    os.makedirs(a.dir, exist_ok=True)
    jobs = []
    for r, y in enumerate(ys):
        for c, x in enumerate(xs):
            p = os.path.join(a.dir, f"in_r{r}c{c}.png")
            save(world[y:y + tile[1], x:x + tile[0]], p)
            jobs.append({"out": os.path.join(a.dir, f"r{r}c{c}"), "prompt_file": a.prompt, "ref": [p]})
    with open(os.path.join(a.dir, "jobs.jsonl"), "w") as f:
        f.write("".join(json.dumps(j) + "\n" for j in jobs))
    json.dump({"world": a.world, "tile": tile, "step": step, "ys": ys, "xs": xs}, open(os.path.join(a.dir, "grid.json"), "w"))
    print(f"{len(jobs)} pieces: rows at {ys}, columns at {xs}")


def seam(cost, center_weight=0.15):
    """Least-cost top-to-bottom path through cost (rows x cols): one column index per row."""
    h, w = cost.shape
    cost = cost + center_weight * cost.mean() * np.abs(np.linspace(-1, 1, w))[None, :] * 4
    acc = cost.copy()
    back = np.zeros((h, w), np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        stack = np.stack([left, prev, right])
        k = stack.argmin(0)
        acc[y] += stack[k, np.arange(w)]
        back[y] = k - 1
    path = np.zeros(h, np.int64)
    path[-1] = int(acc[-1].argmin())
    for y in range(h - 2, -1, -1):
        path[y] = np.clip(path[y + 1] + back[y + 1, path[y + 1]], 0, w - 1)
    return path


def join(A, B, axis, overlap, feather, q=4, busy=0.6):
    """Join A then B along axis (1 = side by side, 0 = stacked); the last `overlap` px of A cover the first of B.
    The seam follows where the two agree and avoids busy detail (stairs, rails, rides) in either of them, so it
    crosses structures where they are plain. Returns the joined image and the seam (offset into the overlap)."""
    if axis == 0:
        out, path = join(A.transpose(1, 0, 2), B.transpose(1, 0, 2), 1, overlap, feather, q, busy)
        return out.transpose(1, 0, 2), path
    h = A.shape[0]
    oa, ob = A[:, -overlap:], B[:, :overlap]
    ga, gb = gray(oa[::q, ::q]), gray(ob[::q, ::q])
    edges = lambda g: np.hypot(ndimage.sobel(g, 0), ndimage.sobel(g, 1)) / 4
    cost = ndimage.uniform_filter(np.abs(ga - gb) + busy * (edges(ga) + edges(gb)), 5)
    path = seam(cost) * q + q // 2
    path = np.interp(np.arange(h), np.arange(0, h, q)[: len(path)], path)
    xs = np.arange(overlap)[None, :]
    m = np.clip((xs - path[:, None]) / feather + 0.5, 0, 1).astype(np.float32)[..., None]  # 0 = A, 1 = B
    mid = oa * (1 - m) + ob * m
    return np.concatenate([A[:, :-overlap], mid, B[:, overlap:]], axis=1), path


def stitch(a):
    world = load(a.world)
    g = json.load(open(os.path.join(a.dir, "grid.json")))
    tw, th = g["tile"]
    s = a.scale
    TW, TH = round(tw * s), round(th * s)
    rows, seams = [], []
    shifts = {}
    for r, y in enumerate(g["ys"]):
        pieces = []
        for c, x in enumerate(g["xs"]):
            t = load(os.path.join(a.dir, f"r{r}c{c}_0.png"))
            if t.shape[:2] != (TH, TW):
                t = resize(t, TW, TH)
            ref = resize(world[y:y + th, x:x + tw], TW, TH)
            # Shift measured at quarter size, then low frequencies (colour, light) taken from the world.
            dy, dx = shift_of(ref[::4, ::4], t[::4, ::4])
            dy, dx = dy * 4, dx * 4
            if max(abs(dy), abs(dx)) > a.max_shift:  # featureless pieces (open sea) give a meaningless peak
                print(f"r{r}c{c}: ignoring implausible shift ({dy}, {dx})")
                dy = dx = 0
            t = ndimage.shift(t, (dy, dx, 0), order=0, mode="nearest")
            shifts[f"r{r}c{c}"] = [dy, dx]
            f = 8
            lo_t = resize(t, TW // f, TH // f)
            lo_r = resize(ref, TW // f, TH // f)
            d = ndimage.gaussian_filter(lo_r - lo_t, (6, 6, 0))
            t = t + resize(d + 128, TW, TH) - 128
            pieces.append(t)
        strip = pieces[0]
        for c in range(1, len(pieces)):
            ov = round((g["xs"][c - 1] + tw - g["xs"][c]) * s)
            strip, path = join(strip, pieces[c], 1, ov, a.feather)
            x0 = round(g["xs"][c] * s)
            seams.append(np.c_[x0 + path, round(y * s) + np.arange(len(path))])
        rows.append(strip)
        print(f"row {r} joined")
    out = rows[0]
    for r in range(1, len(rows)):
        ov = round((g["ys"][r - 1] + th - g["ys"][r]) * s)
        out, path = join(out, rows[r], 0, ov, a.feather)
        y0 = round(g["ys"][r] * s)
        seams.append(np.c_[np.arange(len(path)), y0 + path])
    print("shifts (dy, dx) in redraw px:", json.dumps(shifts))
    save(out, a.out)
    print(f"wrote {a.out}: {out.shape[1]} x {out.shape[0]}")
    # Where the seams run, drawn over a quarter-size copy, for checking them by eye.
    prev = resize(out, out.shape[1] // 4, out.shape[0] // 4)
    for line in seams:
        p = (line[::2] / 4).astype(int)
        p = p[(p[:, 0] >= 0) & (p[:, 0] < prev.shape[1]) & (p[:, 1] >= 0) & (p[:, 1] < prev.shape[0])]
        prev[p[:, 1], p[:, 0]] = (230, 30, 30)
    save(prev, os.path.join(a.dir, "seams.png"))
    json.dump([l[::8].round().astype(int).tolist() for l in seams], open(os.path.join(a.dir, "seams.json"), "w"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("paste"); p.add_argument("ext"); p.add_argument("master"); p.add_argument("out")
    p.add_argument("--top", type=int, default=620); p.add_argument("--height", type=int, default=1320); p.add_argument("--feather", type=int, default=48)
    p = sub.add_parser("cut"); p.add_argument("world"); p.add_argument("dir")
    p.add_argument("--tile", default="1536x1024"); p.add_argument("--step", default="1152x768"); p.add_argument("--prompt", default="prompts/park_tile_v1.txt")
    p = sub.add_parser("stitch"); p.add_argument("world"); p.add_argument("dir"); p.add_argument("out")
    p.add_argument("--scale", type=float, default=2.5); p.add_argument("--feather", type=int, default=24)
    p.add_argument("--max-shift", type=int, default=32, help="larger measured shifts are ignored (redraw px)")
    a = ap.parse_args()
    {"paste": paste, "cut": cut, "stitch": stitch}[a.cmd](a)


if __name__ == "__main__":
    main()
