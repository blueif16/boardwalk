"""Build relight fields in park coordinates and grade crops of the day painting with them.

  P="uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/build.py"
  $P fit DAY PLATE RECT OUT [--r 4 --eps 0.01 --robust 1 --res 4]
      DAY and PLATE cover park rect RECT (x,y,w,h in park px) at any equal size; the fit runs at their size with a
      window of --r park px. Writes OUT_A.png, OUT_B.png (the CSS field, 1 px per --res park px) and OUT.json.
  $P grade DAY_CROP CROP_RECT FIELD OUT        # grade a crop of the day painting (any scale) with a field
  $P merge OUT FIELD... [--base FIELD --day DAY --day-rect 0,0,3840,2560 --lowpass 64 --feather 48]
      Lay fields over each other (later ones on top, feathered 48 park px at their edges) into one field covering
      the first one's rect. --base takes the low frequencies (blur of --lowpass park px) from that field, so pieces
      relit one by one share one colour of light (as tools/park_world.py stitch does with the world).

  $P flat FIELD DAY OUT [--day-rect 0,0,3840,2560 --sigma 16 --lo 0.015 --hi 0.05]   # smooth where the day is flat

A field is A, B with graded = day * A + B (sRGB), shown on the page as mix-blend-mode multiply with A / (1 - B), then
screen with B. Identity (midday) is A = 1, B = 0.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from field import fit_diag, load, save, box  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


def rect(s):
    return [float(v) for v in s.split(",")]


def resize(a, w, h, resample=Image.BILINEAR):
    return np.asarray(Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).resize((w, h), resample)).astype(np.float32) / 255


def resize_f(a, w, h):
    """Bilinear resize of a float field (keeps precision)."""
    out = np.empty((h, w, a.shape[2]), np.float32)
    for k in range(a.shape[2]):
        out[..., k] = np.asarray(Image.fromarray(a[..., k].astype(np.float32), mode="F").resize((w, h), Image.BILINEAR))
    return out


def cmd_fit(a):
    day, plate = load(a.day), load(a.plate)
    if day.shape != plate.shape:
        plate = resize(plate, day.shape[1], day.shape[0], Image.LANCZOS)
    x, y, w, h = rect(a.rect)
    s = day.shape[1] / w  # image px per park px
    r = max(1, round(a.r * s))
    A, B = fit_diag(day, plate, r, a.eps, css=True, robust=a.robust)
    fw, fh = round(w / a.res), round(h / a.res)
    # Area-average down to the field's grid (box of one field cell), as the page shows it.
    As, Bs = resize_f(box(A, max(1, round(a.res * s / 2))), fw, fh), resize_f(box(B, max(1, round(a.res * s / 2))), fw, fh)
    Bs = np.clip(Bs, 0, 0.98)
    As = np.clip(As, 0, 1 - Bs)
    save(As, a.out + "_A.png")
    save(Bs, a.out + "_B.png")
    info = {"rect": [x, y, w, h], "res": a.res, "size": [fw, fh], "r_park_px": a.r, "eps": a.eps, "robust": a.robust,
            "fit_scale": s, "day": a.day, "plate": a.plate}
    json.dump(info, open(a.out + ".json", "w"), indent=1)
    print(json.dumps(info))


def read_field(prefix):
    info = json.load(open(prefix + ".json"))
    A = np.asarray(Image.open(prefix + "_A.png").convert("RGB")).astype(np.float32) / 255
    B = np.asarray(Image.open(prefix + "_B.png").convert("RGB")).astype(np.float32) / 255
    return info, A, B


def sample(info, F, crop_rect, W, H):
    """The field F resampled onto a W x H image covering park rect crop_rect (bilinear, like the compositor)."""
    fx, fy, fw, fh = info["rect"]
    res = info["res"]
    cx, cy, cw, ch = crop_rect
    # pixel centres of the output in field-grid coordinates
    xs = (cx + (np.arange(W) + 0.5) * cw / W - fx) / res - 0.5
    ys = (cy + (np.arange(H) + 0.5) * ch / H - fy) / res - 0.5
    gy, gx = np.meshgrid(ys, xs, indexing="ij")
    out = np.stack([ndimage.map_coordinates(F[..., k], [gy, gx], order=1, mode="nearest") for k in range(3)], -1)
    return out


def cmd_grade(a):
    day = load(a.day)
    H, W = day.shape[:2]
    info, A, B = read_field(a.field)
    cr = rect(a.crop)
    As, Bs = sample(info, A, cr, W, H), sample(info, B, cr, W, H)
    save(np.clip(day * As + Bs, 0, 1), a.out)
    print(f"wrote {a.out}")


def cmd_merge(a):
    infos = [read_field(p) for p in a.fields]
    info0 = infos[0][0]
    fx, fy, fw, fh = info0["rect"]
    res = info0["res"]
    gw, gh = round(fw / res), round(fh / res)
    accA = np.zeros((gh, gw, 3), np.float32); accB = np.zeros_like(accA); accW = np.zeros((gh, gw, 1), np.float32)
    for info, A, B in infos:
        x, y, w, h = info["rect"]
        As, Bs = sample(info, A, [fx, fy, fw, fh], gw, gh), sample(info, B, [fx, fy, fw, fh], gw, gh)
        px = fx + (np.arange(gw) + 0.5) * res
        py = fy + (np.arange(gh) + 0.5) * res
        # Feather only the edges that lie inside the canvas (where an earlier field is underneath); the first field
        # and edges on the canvas border keep full weight.
        feather = a.feather
        far = 1e9
        l = px - x if x > fx + 0.5 else np.where(px >= x, far, -1.0)
        r_ = x + w - px if x + w < fx + fw - 0.5 else np.where(px <= x + w, far, -1.0)
        t = py - y if y > fy + 0.5 else np.where(py >= y, far, -1.0)
        b_ = y + h - py if y + h < fy + fh - 0.5 else np.where(py <= y + h, far, -1.0)
        wx = np.clip(np.minimum(l, r_) / feather, 0, 1)
        wy = np.clip(np.minimum(t, b_) / feather, 0, 1)
        wgt = (wy[:, None] * wx[None, :])[..., None]
        wgt = wgt * wgt * (3 - 2 * wgt)
        accA = accA * (1 - wgt) + As * wgt
        accB = accB * (1 - wgt) + Bs * wgt
        accW = np.maximum(accW, wgt)
    if a.base:
        # Low frequencies from the base: on the day painting at field resolution, scale the graded result so its
        # blur (--lowpass park px) equals the base's graded blur. A gain field, smooth, so local detail stays.
        binfo, bA, bB = read_field(a.base)
        bAs, bBs = sample(binfo, bA, [fx, fy, fw, fh], gw, gh), sample(binfo, bB, [fx, fy, fw, fh], gw, gh)
        day = load(a.day)
        drect = rect(a.day_rect)
        dsm = sample({"rect": drect, "res": drect[2] / day.shape[1]}, day, [fx, fy, fw, fh], gw, gh)
        sig = a.lowpass / res
        lp = lambda X: ndimage.gaussian_filter(X, (sig, sig, 0))
        k = (lp(dsm * bAs + bBs) + 1e-3) / (lp(dsm * accA + accB) + 1e-3)
        accA, accB = accA * k, np.clip(accB * k, 0, 0.98)
        accA = np.clip(accA, 0, 1 - accB)
    save(accA, a.out + "_A.png")
    save(accB, a.out + "_B.png")
    json.dump({**info0, "merged": a.fields, "base": a.base}, open(a.out + ".json", "w"), indent=1)
    print(f"wrote {a.out}")


def cmd_flat(a):
    """Smooth a field where the day painting is flat (street, sand, sea, walls): the plate's own mottling there lines
    up with nothing in the day painting. A blur among flat pixels only (normalised by their weights), so the field of
    a structure doesn't bleed into the flat ground beside it."""
    info, A, B = read_field(a.field)
    fx, fy, fw, fh = info["rect"]
    res = info["res"]
    gh, gw = A.shape[:2]
    day = load(a.day)
    drect = rect(a.day_rect)
    s = day.shape[1] / drect[2]
    g = day @ np.array([0.299, 0.587, 0.114], np.float32)
    r = max(1, round(a.r * s))
    m = box(g, r); sd = np.sqrt(np.maximum(box(g * g, r) - m * m, 0))
    # flatness at field resolution, over the field's rect
    sd_f = sample({"rect": drect, "res": 1 / s}, sd[..., None].repeat(3, -1), [fx, fy, fw, fh], gw, gh)[..., 0]
    w = 1 - np.clip((sd_f - a.lo) / (a.hi - a.lo), 0, 1)
    w = w * w * (3 - 2 * w)
    sig = a.sigma / res
    G = lambda X: ndimage.gaussian_filter(X, (sig, sig, 0) if X.ndim == 3 else (sig, sig))
    den = G(w)[..., None] + 1e-4
    As, Bs = G(A * w[..., None]) / den, G(B * w[..., None]) / den
    A2, B2 = A * (1 - w[..., None]) + As * w[..., None], B * (1 - w[..., None]) + Bs * w[..., None]
    B2 = np.clip(B2, 0, 0.98); A2 = np.clip(A2, 0, 1 - B2)
    save(A2, a.out + "_A.png"); save(B2, a.out + "_B.png")
    save(np.stack([w] * 3, -1), a.out + "_flat.png")
    json.dump({**info, "flat": {"sigma": a.sigma, "lo": a.lo, "hi": a.hi, "r": a.r}}, open(a.out + ".json", "w"), indent=1)
    print(f"wrote {a.out}: flat share {float((w > 0.5).mean()):.2f}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit")
    f.add_argument("day"); f.add_argument("plate"); f.add_argument("rect"); f.add_argument("out")
    f.add_argument("--r", type=float, default=4); f.add_argument("--eps", type=float, default=0.01)
    f.add_argument("--robust", type=int, default=1); f.add_argument("--res", type=float, default=4)
    g = sub.add_parser("grade")
    g.add_argument("day"); g.add_argument("crop"); g.add_argument("field"); g.add_argument("out")
    m = sub.add_parser("merge")
    m.add_argument("out"); m.add_argument("fields", nargs="+")
    m.add_argument("--base"); m.add_argument("--lowpass", type=float, default=64); m.add_argument("--feather", type=float, default=48)
    m.add_argument("--day", help="the day painting (any scale) for --base"); m.add_argument("--day-rect", default="0,0,3840,2560")
    fl = sub.add_parser("flat")
    fl.add_argument("field"); fl.add_argument("day"); fl.add_argument("out")
    fl.add_argument("--day-rect", default="0,0,3840,2560"); fl.add_argument("--sigma", type=float, default=16)
    fl.add_argument("--lo", type=float, default=0.015); fl.add_argument("--hi", type=float, default=0.05)
    fl.add_argument("--r", type=float, default=4)
    a = ap.parse_args()
    {"fit": cmd_fit, "grade": cmd_grade, "merge": cmd_merge, "flat": cmd_flat}[a.cmd](a)


if __name__ == "__main__":
    main()
