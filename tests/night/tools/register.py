"""Registration check of a relit plate against the day stage.

  uv run --no-project --with pillow --with numpy python -I tools/register.py DAY PLATE OUT_PREFIX [--warp OUT.png]

Writes OUT_PREFIX_diff.png (|day - plate| x3, as gen/stage/diff_*.png), OUT_PREFIX_struct.png (difference of the
local-contrast structure, which ignores the relighting), OUT_PREFIX_edges.png (day edges red, plate edges cyan: white
where they agree) and OUT_PREFIX_shift.png (tile shift vectors x10), and prints the tile shift statistics. --warp
writes the plate resampled onto the day stage along the smoothed shift field.
"""
import json, sys
import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32) / 255


def lum(a):
    return a @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def box(a, r):
    k = 2 * r + 1
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def structure(a, r=6):
    l = lum(a)
    m = box(l, r)
    s = np.sqrt(np.maximum(box(l * l, r) - m * m, 1e-5))
    return (l - m) / (s + 0.02)


def edges(a):
    l = lum(a)
    gx = np.zeros_like(l); gy = np.zeros_like(l)
    gx[:, 1:-1] = l[:, 2:] - l[:, :-2]
    gy[1:-1] = l[2:] - l[:-2]
    g = np.hypot(gx, gy)
    return g / (np.percentile(g, 99) + 1e-6)


def phase_shift(a, b):
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    A = np.fft.fft2((a - a.mean()) * win)
    B = np.fft.fft2((b - b.mean()) * win)
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-9
    c = np.real(np.fft.ifft2(R))
    iy, ix = np.unravel_index(np.argmax(c), c.shape)
    peak = c[iy, ix]
    def sub(cm, c0, cp):
        d = cm - 2 * c0 + cp
        return 0.0 if d == 0 else 0.5 * (cm - cp) / d
    dy = iy + sub(c[(iy - 1) % h, ix], peak, c[(iy + 1) % h, ix])
    dx = ix + sub(c[iy, (ix - 1) % w], peak, c[iy, (ix + 1) % w])
    if dy > h / 2: dy -= h
    if dx > w / 2: dx -= w
    return dx, dy, peak


def tile_shifts(sa, sb, size=128, step=64):
    H, W = sa.shape
    out = []
    for y in range(0, H - size + 1, step):
        for x in range(0, W - size + 1, step):
            ta, tb = sa[y:y + size, x:x + size], sb[y:y + size, x:x + size]
            if ta.std() < 0.15: continue
            dx, dy, peak = phase_shift(ta, tb)
            out.append((x + size / 2, y + size / 2, dx, dy, peak))
    return np.array(out, np.float32)


def field(t, H, W, minpeak=0.08, sigma=96.0):
    """Smooth displacement field (plate px = day px + d) from tile shifts: Gaussian-weighted average of good tiles."""
    good = t[(t[:, 4] > minpeak) & (np.hypot(t[:, 2], t[:, 3]) < 12)]
    gy, gx = np.mgrid[0:H:16, 0:W:16].astype(np.float32)
    num_x = np.zeros_like(gx); num_y = np.zeros_like(gx); den = np.full_like(gx, 1e-6)
    for cx, cy, dx, dy, pk in good:
        wgt = pk * np.exp(-((gx - cx) ** 2 + (gy - cy) ** 2) / (2 * sigma ** 2))
        num_x += wgt * dx; num_y += wgt * dy; den += wgt
    fx, fy = num_x / den, num_y / den
    up = lambda f: np.asarray(Image.fromarray(f).resize((W, H), Image.BILINEAR))
    return up(fx), up(fy), good


def warp(img, fx, fy):
    H, W = fx.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sx = np.clip(xx - fx, 0, W - 1.001); sy = np.clip(yy - fy, 0, H - 1.001)
    x0 = np.floor(sx).astype(int); y0 = np.floor(sy).astype(int)
    ax = (sx - x0)[..., None]; ay = (sy - y0)[..., None]
    p = lambda yy_, xx_: img[yy_, xx_]
    return (p(y0, x0) * (1 - ax) * (1 - ay) + p(y0, x0 + 1) * ax * (1 - ay) + p(y0 + 1, x0) * (1 - ax) * ay
            + p(y0 + 1, x0 + 1) * ax * ay)


def save(a, p):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(p, optimize=True)


def stats(t):
    m = np.hypot(t[:, 2], t[:, 3])
    good = t[:, 4] > 0.08
    mg = m[good] if good.any() else m
    return {"tiles": int(len(t)), "confident": int(good.sum()), "median_px": round(float(np.median(mg)), 2),
            "p90_px": round(float(np.percentile(mg, 90)), 2), "max_px": round(float(mg.max()), 2),
            "mean_dx": round(float(t[good, 2].mean()), 2), "mean_dy": round(float(t[good, 3].mean()), 2)}


def main():
    day_p, plate_p, out = sys.argv[1:4]
    warp_out = sys.argv[sys.argv.index("--warp") + 1] if "--warp" in sys.argv else None
    day, plate = load(day_p), load(plate_p)
    H, W = day.shape[:2]
    sa, sb = structure(day), structure(plate)
    t = tile_shifts(sa, sb)
    st = stats(t)
    save(np.abs(day - plate) * 3, out + "_diff.png")
    d = np.clip(np.abs(sa - sb) / 4, 0, 1)
    save(np.stack([d, d, d], -1), out + "_struct.png")
    ea, eb = np.clip(edges(day) * 1.5, 0, 1), np.clip(edges(plate) * 1.5, 0, 1)
    save(np.stack([ea, eb, eb], -1), out + "_edges.png")
    vis = np.asarray(Image.fromarray((lum(plate) * 120).astype(np.uint8)).convert("RGB")).copy()
    from PIL import ImageDraw
    im = Image.fromarray(vis); dr = ImageDraw.Draw(im)
    for cx, cy, dx, dy, pk in t:
        col = (255, 220, 0) if pk > 0.08 else (120, 120, 120)
        dr.line([(cx, cy), (cx + dx * 10, cy + dy * 10)], fill=col, width=2)
        dr.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=col)
    im.save(out + "_shift.png")
    if warp_out:
        fx, fy, good = field(t, H, W)
        w = warp(plate, fx, fy)
        save(w, warp_out)
        t2 = tile_shifts(sa, structure(w))
        st["after_warp"] = stats(t2)
        st["field_max_px"] = round(float(np.hypot(fx, fy).max()), 2)
    print(json.dumps(st))
    json.dump(st, open(out + "_stats.json", "w"), indent=1)


main()
