"""Relight fields: fit a painted relit plate as a smooth per-pixel colour transform of the day painting.

  P="uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/field.py"
  $P fit DAY PLATE OUT_PREFIX [--r 12 --eps 0.002 --down 4 --mode diag|color --space srgb|linear --css]
  $P apply DAY OUT_PREFIX OUT.png          # reconstruct the plate from the day painting and the field
  $P sweep DAY PLATE                       # reconstruction error over radii, modes and spaces

The model is a local affine map (a guided filter with the day painting as the guide):
  diag:  plate_k = A_k(x) * day_k + B_k(x)            per channel k: 6 numbers per pixel, CSS multiply + add
  color: plate_k = sum_j M_kj(x) * day_j + B_k(x)      a 3 x 3 colour matrix: 12 numbers per pixel, WebGL only
A and B vary slowly (box windows of radius r park px, then averaged), so the result keeps the day painting's lines and
texture and takes only the plate's light. Where a window is flat (open sand, sea) the slope is pulled toward the local
gain mean(plate)/mean(day) (weight eps), so texture is scaled rather than flattened.
--css constrains the field so it can be shown as two overlays over everything the page draws, in sRGB:
mix-blend-mode multiply with m = A / (1 - B), then screen with s = B (c * m * (1 - s) + s = c * A + B), so B in [0, 1)
and A + B <= 1 (white never goes above white). --robust N reweights pixels the edit redrew, N extra passes.
OUT_PREFIX_A.png / _B.png hold the diag field at 1/down resolution (A and B in [0, 1] as 8-bit). OUT_PREFIX.json has
the stats.
"""
import argparse, json
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None


def load(p, size=None):
    im = Image.open(p).convert("RGB")
    if size and im.size != tuple(size):
        im = im.resize(tuple(size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255


def save(a, p):
    Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).save(p)


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def box(a, r):
    return ndimage.uniform_filter(a, size=(2 * r + 1, 2 * r + 1) + (1,) * (a.ndim - 2), mode="reflect")


def wbox(a, w, r):
    """Weighted box mean of a (h, w[, c]) with weights w (h, w)."""
    ww = w if a.ndim == 2 else w[..., None]
    return box(a * ww, r) / np.maximum(box(ww, r), 1e-6)


def fit_diag(I, p, r, eps, css=False, robust=0, tau=0.05):
    """Per-channel local affine fit. robust > 0 reweights pixels the plate redrew (objects the edit added or moved)
    by their residual, so they don't stain the field. css: the field must be shown as multiply then screen, which is
    c * m * (1 - s) + s = c * A + B with m = A / (1 - B), s = B: so B in [0, 1) and A in [0, 1 - B]."""
    w = np.ones(I.shape[:2], np.float32)
    for it in range(robust + 1):
        mI, mp = wbox(I, w, r), wbox(p, w, r)
        var = wbox(I * I, w, r) - mI * mI
        cov = wbox(I * p, w, r) - mI * mp
        gain = mp / np.maximum(mI, 0.02)
        a = (cov + eps * gain) / (np.maximum(var, 0) + eps)
        a = np.clip(a, 0, 4)
        b = mp - a * mI
        A, B = box(a, r), box(b, r)
        if css:
            B = np.clip(B, 0, 0.98)
            A = np.clip(A, 0, 1 - B)
            B = np.clip(wbox(mp - A * mI, w, r), 0, 0.98)
            A = np.minimum(A, 1 - B)
        if it < robust:
            e = ndimage.gaussian_filter(np.abs(A * I + B - p).sum(-1), 1.5)
            w = 1 / (1 + (e / tau) ** 2)
    return A, B


def fit_color(I, p, r, eps):
    """He et al.'s colour guided filter, one output channel at a time; returns M (h, w, 3, 3) and B (h, w, 3)."""
    h, w, _ = I.shape
    mI = box(I, r)
    cov = np.empty((h, w, 3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            cov[..., i, j] = cov[..., j, i] = box(I[..., i] * I[..., j], r) - mI[..., i] * mI[..., j]
    reg = cov + eps * np.eye(3, dtype=np.float32)
    inv = np.linalg.inv(reg)
    M = np.empty((h, w, 3, 3), np.float32)
    B = np.empty((h, w, 3), np.float32)
    for k in range(3):
        mp = box(p[..., k], r)
        cIp = np.stack([box(I[..., j] * p[..., k], r) - mI[..., j] * mp for j in range(3)], -1)
        gain = mp / np.maximum(mI[..., k], 0.02)
        prior = np.zeros((h, w, 3), np.float32)
        prior[..., k] = eps * gain
        a = np.einsum("hwij,hwj->hwi", inv, cIp + prior)
        b = mp - (a * mI).sum(-1)
        M[..., k, :] = box(a, r)
        B[..., k] = box(b, r)
    return M, B


def down_up(F, down):
    """Store a field at 1/down resolution and read it back with bilinear filtering, as the page does."""
    if down <= 1:
        return F
    h, w = F.shape[:2]
    small = ndimage.zoom(box(F, max(1, down // 2)), (1 / down, 1 / down) + (1,) * (F.ndim - 2), order=1)
    return ndimage.zoom(small, (h / small.shape[0], w / small.shape[1]) + (1,) * (F.ndim - 2), order=1)


def lab(c):
    """sRGB [0,1] -> CIE Lab (D65)."""
    l = to_lin(c)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = l @ m.T / np.array([0.9505, 1.0, 1.089], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def errors(rec, plate, blur=2.0):
    """Delta E (CIE76) between reconstruction and plate: per pixel, and after a small blur (colour of the light,
    ignoring the fine detail the edit redrew)."""
    d = np.linalg.norm(lab(rec) - lab(plate), axis=-1)
    g = lambda a: ndimage.gaussian_filter(a, (blur, blur, 0))
    dl = np.linalg.norm(lab(g(rec)) - lab(g(plate)), axis=-1)
    return {"dE_mean": float(d.mean()), "dE_p95": float(np.percentile(d, 95)),
            "dE_blur_mean": float(dl.mean()), "dE_blur_p95": float(np.percentile(dl, 95))}


def run(day, plate, r, eps, down, mode, space, css, robust=0):
    I, p = (to_lin(day), to_lin(plate)) if space == "linear" else (day, plate)
    if mode == "diag":
        A, B = fit_diag(I, p, r, eps, css, robust)
        A, B = down_up(A, down), down_up(B, down)
        rec = A * I + B
        F = (A, B)
    else:
        M, B = fit_color(I, p, r, eps)
        M, B = down_up(M, down), down_up(B, down)
        rec = np.einsum("hwkj,hwj->hwk", M, I) + B
        F = (M, B)
    rec = to_srgb(rec) if space == "linear" else np.clip(rec, 0, 1)
    return rec, F


def cmd_fit(a):
    plate = load(a.plate)
    day = load(a.day, plate.shape[1::-1])
    rec, F = run(day, plate, a.r, a.eps, 1, a.mode, a.space, a.css, a.robust)
    st = errors(rec, plate)
    st.update(r=a.r, eps=a.eps, down=a.down, mode=a.mode, space=a.space, css=a.css, robust=a.robust)
    if a.mode == "diag":
        A, B = F
        h, w = A.shape[:2]
        sm = lambda X: np.asarray(Image.fromarray(np.clip(X * 255 + 0.5, 0, 255).astype(np.uint8)).resize(
            (round(w / a.down), round(h / a.down)), Image.BOX)).astype(np.float32) / 255
        save(sm(np.clip(A, 0, 1)), a.out + "_A.png")
        save(sm(np.clip(B, 0, 1)), a.out + "_B.png")
    save(rec, a.out + "_rec.png")
    json.dump(st, open(a.out + ".json", "w"), indent=1)
    print(json.dumps(st))


def cmd_apply(a):
    day = load(a.day)
    h, w = day.shape[:2]
    A = load(a.prefix + "_A.png", (w, h))
    B = load(a.prefix + "_B.png", (w, h))
    save(np.clip(day * A + B, 0, 1), a.out)  # = multiply by A / (1 - B), then screen with B


def cmd_sweep(a):
    plate = load(a.plate)
    day = load(a.day, plate.shape[1::-1])
    print("baseline |day - plate|:", json.dumps(errors(day, plate)))
    rows = []
    for mode, space, css in [("diag", "srgb", True), ("diag", "srgb", False), ("diag", "linear", False), ("color", "srgb", False)]:
        for r in a.radii:
            for down in a.downs:
                rec, _ = run(day, plate, r, a.eps, down, mode, space, css)
                st = errors(rec, plate)
                st.update(mode=mode, space=space, css=css, r=r, down=down)
                rows.append(st)
                print(json.dumps(st))
    if a.json:
        json.dump(rows, open(a.json, "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit")
    f.add_argument("day"); f.add_argument("plate"); f.add_argument("out")
    f.add_argument("--r", type=int, default=12); f.add_argument("--eps", type=float, default=0.002)
    f.add_argument("--down", type=int, default=4); f.add_argument("--mode", default="diag")
    f.add_argument("--space", default="srgb"); f.add_argument("--css", action="store_true")
    f.add_argument("--robust", type=int, default=0)
    p = sub.add_parser("apply")
    p.add_argument("day"); p.add_argument("prefix"); p.add_argument("out")
    s = sub.add_parser("sweep")
    s.add_argument("day"); s.add_argument("plate")
    s.add_argument("--radii", type=int, nargs="+", default=[4, 8, 16, 32])
    s.add_argument("--downs", type=int, nargs="+", default=[1, 4])
    s.add_argument("--eps", type=float, default=0.002)
    s.add_argument("--json")
    a = ap.parse_args()
    {"fit": cmd_fit, "apply": cmd_apply, "sweep": cmd_sweep}[a.cmd](a)


if __name__ == "__main__":
    main()
