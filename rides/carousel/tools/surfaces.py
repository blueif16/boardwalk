"""Turn a carousel's own painted surfaces: unwrap them from the painting, tile them around the full circle, and write
the textures the layer rewraps with a rotation.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/carousel/tools/surfaces.py [--debug DIR]

For each carousel in rides/carousel/geom.json and each surface:
  roof  a cone:  P(phi, v) = apex + v * (rim(phi) - apex)          v 0 at the apex, 1 at the rim
  val   a band:  P(phi, v) = rim(phi) * (1 - v) + val(phi) * v     the valance, rim to the bottom of its panels
  band  a band:  P(phi, v) = top(phi) * (1 - v) + bot(phi) * v     the platform's side
with ellipse(phi) = c + R(rot) (a cos phi, b sin phi): phi = 90 degrees is the front (lowest on screen).

1. Unwrap: sample the painting (gen/park/world_v2_hd.png) at P(phi, v) over the front half.
2. Shading: the strip's luminance smoothed along phi over two periods, a 1-D curve kept static at runtime, divided out
   of the strip so only the pattern turns.
3. Period: autocorrelation of the strip near the front.
4. Tile: a window of k whole periods centred on the front, stretched to 360/m degrees (m whole tiles round the circle,
   k and m chosen for the least stretch), with its end cross-faded into its start so the loop is seamless.
Writes rides/carousel/surfaces.webp (all tiles stacked, RGBA) and rides/carousel/surfaces.json (per tile: rect, m,
k, stretch, shading curve sampled over phi 0-180 degrees).
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
F = 2.5
TILE_PX_PER_RAD = 220  # tile width in px per radian of the circle (about 2.5 HD px per park px at r = 88)
NPHI = 1440            # unwrap samples over 180 degrees


def ell(e, phi):
    cx, cy, a, b = e["c"][0], e["c"][1], e["a"], e["b"]
    r = math.radians(e.get("rot", 0))
    u, v = a * np.cos(phi), b * np.sin(phi)
    return cx + u * math.cos(r) - v * math.sin(r), cy + u * math.sin(r) + v * math.cos(r)


def surface_xy(g, kind, phi, v):
    if kind == "roof":
        rx, ry = ell(g["rim"], phi)
        ax, ay = g["apex"]
        return ax + v * (rx - ax), ay + v * (ry - ay)
    e0, e1 = (g["rim"], g["val"]) if kind == "val" else (g["top"], g["bot"])
    x0, y0 = ell(e0, phi)
    x1, y1 = ell(e1, phi)
    return x0 * (1 - v) + x1 * v, y0 * (1 - v) + y1 * v


def rows_for(g, kind):
    # one row per HD px of the surface's height at the front
    x0, y0 = surface_xy(g, kind, np.array([math.pi / 2]), np.array([0.0]))
    x1, y1 = surface_xy(g, kind, np.array([math.pi / 2]), np.array([1.0]))
    return max(24, int(round(math.hypot(x1[0] - x0[0], y1[0] - y0[0]) * F * 1.3)))


def unwrap(hd, g, kind):
    nv = rows_for(g, kind)
    phi = np.linspace(0, math.pi, NPHI)
    v = (np.arange(nv) + 0.5) / nv
    P, V = np.meshgrid(phi, v)
    x, y = surface_xy(g, kind, P, V)
    coords = [y * F - 0.5, x * F - 0.5]
    strip = np.dstack([ndimage.map_coordinates(hd[..., c], coords, order=1, mode="nearest") for c in range(3)])
    return strip, phi, v


def period(strip, phi, lo, hi):
    # autocorrelation of the luminance (rows averaged after removing each row's mean) near the front
    sel = (phi >= lo) & (phi <= hi)
    lum = strip[:, sel].mean(2)
    lum = lum - lum.mean(1, keepdims=True)
    sig = lum.mean(0) if np.abs(lum.mean(0)).sum() > 1 else lum[lum.shape[0] // 2]
    n = len(sig)
    ac = np.correlate(sig, sig, "full")[n - 1:]
    ac /= ac[0]
    dphi = phi[1] - phi[0]
    # first strong peak after the first dip
    start = np.argmax(ac < 0.2) if (ac < 0.2).any() else 5
    k = start + int(np.argmax(ac[start:n // 2]))
    # parabolic refinement
    if 0 < k < len(ac) - 1:
        a0, a1, a2 = ac[k - 1], ac[k], ac[k + 1]
        k = k + 0.5 * (a0 - a2) / (a0 - 2 * a1 + a2)
    return k * dphi, ac


def tile(strip, phi, p, max_window=math.radians(110), fade=0.12, fixed_m=None):
    best = None
    if fixed_m:  # irregular patterns: a fixed window of 360 / m degrees, no period
        best = (0, 0, fixed_m, 1.0, 2 * math.pi / fixed_m)
    for k in range(1, 40 if not fixed_m else 1):
        w = k * p
        if w > max_window:
            break
        m = max(2, round(2 * math.pi / w))
        stretch = (2 * math.pi / m) / w
        score = abs(stretch - 1) + (0.02 if w < math.radians(40) else 0)  # prefer wider windows a little
        if best is None or score < best[0]:
            best = (score, k, m, stretch, w)
    _, k, m, stretch, w = best
    wpx = int(round(TILE_PX_PER_RAD * 2 * math.pi / m))
    a = math.pi / 2 - w / 2
    fw = fade * w
    # sample [a, a + w + fw]; the extra fw cross-fades into the start
    src = np.linspace(a, a + w + fw, int(round(wpx * (1 + fade))), endpoint=False)
    idx = np.interp(src, phi, np.arange(len(phi)))
    cols = np.stack([np.stack([np.interp(idx, np.arange(len(phi)), strip[r, :, c]) for c in range(3)], -1) for r in range(strip.shape[0])])
    body, extra = cols[:, :wpx], cols[:, wpx:]
    nf = extra.shape[1]
    t = np.linspace(0, 1, nf)[None, :, None]
    body[:, :nf] = extra * (1 - t) + body[:, :nf] * t
    return body, k, m, stretch, w, a


def main():
    debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    geom = json.load(open(os.path.join(RIDE, "geom.json")))
    hd = np.asarray(Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGB")).astype(np.float32)
    tiles, meta = [], {}
    for name, g in geom.items():
        meta[name] = {}
        for kind in ("roof", "val", "band"):
            strip, phi, v = unwrap(hd, g, kind)
            lum = strip.mean(2).mean(0)
            p, ac = period(strip, phi, math.radians(45), math.radians(135))
            fixed = g.get("fixed_m", {}).get(kind)
            if fixed:
                p = 2 * math.pi / fixed
            sig = max(3, int(round(2 * p / (phi[1] - phi[0]))))
            shade = ndimage.uniform_filter1d(lum, sig, mode="nearest")
            shade = shade / shade[(phi > math.radians(60)) & (phi < math.radians(120))].mean()
            albedo = strip / shade[None, :, None]
            body, k, m, stretch, w, a0 = tile(albedo, phi, p, fixed_m=fixed)
            tiles.append((name, kind, body))
            meta[name][kind] = {"k": k, "m": m, "a0": round(a0, 5), "stretch": round(stretch, 4), "period_deg": round(math.degrees(p), 3),
                                "window_deg": round(math.degrees(w), 2), "rows": strip.shape[0],
                                "shade": [round(float(s), 4) for s in np.interp(np.linspace(0, math.pi, 91), phi, shade)]}
            print(f"{name} {kind}: period {math.degrees(p):.2f} deg, window {k} periods = {math.degrees(w):.1f} deg -> {m} tiles, stretch {stretch:.3f}")
            if debug:
                os.makedirs(debug, exist_ok=True)
                Image.fromarray(np.clip(strip, 0, 255).astype(np.uint8)).save(os.path.join(debug, f"{name}_{kind}_strip.png"))
                Image.fromarray(np.clip(np.concatenate([body, body], 1), 0, 255).astype(np.uint8)).save(os.path.join(debug, f"{name}_{kind}_tile2.png"))
    # stack tiles vertically into one atlas; each tile is padded by PAD wrapped columns on both sides and PAD repeated
    # edge rows above and below, so bilinear and mipmapped sampling never reads a neighbour
    PAD = 8
    W = max(t[2].shape[1] for t in tiles) + 2 * PAD
    H = sum(t[2].shape[0] + 2 * PAD for t in tiles)
    atlas = np.zeros((H, W, 4), np.uint8)
    y = 0
    for name, kind, body in tiles:
        h, w = body.shape[:2]
        wrapped = np.concatenate([body[:, -PAD:], body, body[:, :PAD]], 1)
        padded = np.concatenate([np.repeat(wrapped[:1], PAD, 0), wrapped, np.repeat(wrapped[-1:], PAD, 0)], 0)
        atlas[y:y + h + 2 * PAD, :w + 2 * PAD, :3] = np.clip(padded, 0, 255)
        atlas[y:y + h + 2 * PAD, :w + 2 * PAD, 3] = 255
        meta[name][kind]["rect"] = [PAD, y + PAD, w, h]
        y += h + 2 * PAD
    Image.fromarray(atlas, "RGBA").save(os.path.join(RIDE, "surfaces.webp"), lossless=True)
    json.dump({"size": [W, H], "carousels": meta}, open(os.path.join(RIDE, "surfaces.json"), "w"))
    print(f"surfaces.webp {W} x {H}")


if __name__ == "__main__":
    main()
