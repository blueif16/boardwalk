"""The Sea Swings' turning surfaces: unwrapped from the painted ride (the look-matched takes), their light divided out,
tiled by their measured period, for the layer to rewrap at the turn angle (the carousel's method,
rides/carousel/tools/surfaces.py).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/swings/tools/surfaces.py [--debug DIR]

Surfaces (geom.json "painted", park px, the canopy at full lift as rides/swings/gen/ride_v1_0.png draws it; the
column as gen/ride_v1_1.png draws it), with ellipse(e, phi) = c + (a cos phi, b sin phi), phi = 90 degrees the front:
  top     the canopy's cone: lerp(band_top(phi), collar(phi), v), v 0 at the rim, 1 at the collar
  band    the crown band:    lerp(band_top(phi), band_bot(phi), v); alpha cut under the scallops' outline
  cupola  the striped dome:  the collar ring (collar_h tall), then a dome of radius a, height h, up to its tip
  column  the column:        the column's ellipse, from its top (under the canopy) down len px
Each strip is sampled over the front half (0-180 degrees). The light (the strip's luminance smoothed along phi over two
periods) is a 1-D curve kept fixed at runtime; the pattern is a window of whole periods centred on the front,
stretched to 360/m degrees, its end cross-faded into its start.
Writes rides/swings/surfaces.webp (tiles stacked, RGBA, padded) and rides/swings/surfaces.json.
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, RIDE  # noqa: E402

F = 2.5                 # the matched takes are at the master's density
X0, Y0 = G["region"][0], G["region"][1]
TILE_PX_PER_RAD = 150   # tile width per radian (2.7 px per park px at the rim, r = 55)
NPHI = 1440
PAD = 8
PT = G["painted"]


def ell(e, phi):
    return e["c"][0] + e["a"] * np.cos(phi), e["c"][1] + e["b"] * np.sin(phi)


def surface_xy(kind, phi, v):
    if kind in ("top", "band"):
        e1 = PT["band_top"]
        e2 = PT["collar"] if kind == "top" else PT["band_bot"]
        x0, y0 = ell(e1, phi)
        x1, y1 = ell(e2, phi)
        return x0 * (1 - v) + x1 * v, y0 * (1 - v) + y1 * v
    if kind == "cupola":
        c = PT["cupola"]
        k = c["b"] / c["a"]
        vc = c["collar_v"]
        # collar ring, then the dome
        r = np.where(v < vc, PT["collar"]["a"], c["a"] * np.cos((v - vc) / (1 - vc) * math.pi / 2))
        h = np.where(v < vc, c["collar_h"] * v / vc, c["collar_h"] + c["h"] * np.sin((v - vc) / (1 - vc) * math.pi / 2))
        cx, cy = PT["collar"]["c"]
        return cx + r * np.cos(phi), cy + k * r * np.sin(phi) - h
    if kind == "column":
        c = PT["column"]
        return c["c"][0] + c["r"] * np.cos(phi), c["c"][1] + c["b"] * np.sin(phi) + v * c["len"]
    raise ValueError(kind)


def rows_for(kind):
    if kind == "cupola":
        c = PT["cupola"]
        return max(24, int(round((c["collar_h"] + c["h"] * 1.3) * F * 1.4)))
    x0, y0 = surface_xy(kind, np.array([math.pi / 2]), np.array([0.0]))
    x1, y1 = surface_xy(kind, np.array([math.pi / 2]), np.array([1.0]))
    return max(24, int(round(math.hypot(x1[0] - x0[0], y1[0] - y0[0]) * F * 1.4)))


def unwrap(img, kind):
    nv = rows_for(kind)
    phi = np.linspace(0, math.pi, NPHI)
    v = (np.arange(nv) + 0.5) / nv
    P, V = np.meshgrid(phi, v)
    x, y = surface_xy(kind, P, V)
    coords = [(y - Y0) * F - 0.5, (x - X0) * F - 0.5]
    strip = np.dstack([ndimage.map_coordinates(img[..., c], coords, order=1, mode="nearest") for c in range(3)])
    return strip, phi, v


def period(strip, phi, lo, hi, pmin=0.0, pmax=math.pi):
    sel = (phi >= lo) & (phi <= hi)
    lum = strip[:, sel].mean(2)
    lum = lum - lum.mean(1, keepdims=True)
    sig = lum.mean(0)
    n = len(sig)
    ac = np.correlate(sig, sig, "full")[n - 1:]
    ac /= ac[0]
    dphi = phi[1] - phi[0]
    start = np.argmax(ac < 0.2) if (ac < 0.2).any() else 5
    start = max(start, int(pmin / dphi))
    stop = min(n - 1, int(pmax / dphi)) if pmax < math.pi else n // 2
    k = start + int(np.argmax(ac[start:stop]))
    if 0 < k < len(ac) - 1:
        a0, a1, a2 = ac[k - 1], ac[k], ac[k + 1]
        k = k + 0.5 * (a0 - a2) / (a0 - 2 * a1 + a2)
    return k * dphi


def tile(strip, phi, p, max_window=math.radians(110), fade=0.12):
    best = None
    for k in range(1, 40):
        w = k * p
        if w > max_window:
            break
        m = max(2, round(2 * math.pi / w))
        stretch = (2 * math.pi / m) / w
        score = abs(stretch - 1) + (0.02 if w < math.radians(40) else 0)
        if best is None or score < best[0]:
            best = (score, k, m, stretch, w)
    _, k, m, stretch, w = best
    wpx = int(round(TILE_PX_PER_RAD * 2 * math.pi / m))
    a = math.pi / 2 - w / 2
    fw = fade * w
    src = np.linspace(a, a + w + fw, int(round(wpx * (1 + fade))), endpoint=False)
    idx = np.interp(src, phi, np.arange(len(phi)))
    nc = strip.shape[2]
    cols = np.stack([np.stack([np.interp(idx, np.arange(len(phi)), strip[r, :, c]) for c in range(nc)], -1) for r in range(strip.shape[0])])
    body, extra = cols[:, :wpx], cols[:, wpx:]
    nf = extra.shape[1]
    t = np.linspace(0, 1, nf)[None, :, None]
    body[:, :nf] = extra * (1 - t) + body[:, :nf] * t
    return body, k, m, stretch, w, a


def scallop_alpha(strip):
    """Alpha for the crown band: opaque down to the lowest outline pixel of each column (the scallops' ink edge),
    transparent below, searched in the bottom 45% of the rows."""
    lum = strip.mean(2)
    nv = strip.shape[0]
    start = int(nv * 0.55)
    ink = lum[start:] < 95
    alpha = np.ones(lum.shape, np.float32)
    for j in range(lum.shape[1]):
        ys = np.where(ink[:, j])[0]
        cut = start + (ys.max() + 1 if len(ys) else ink.shape[0])
        alpha[cut:, j] = 0
    # smooth the edge along phi a little (scallops are round), and a one-row soft edge
    alpha = ndimage.uniform_filter(alpha, (2, 3))
    return alpha


SOURCES = {"top": "ride_v1_0", "band": "ride_v1_0", "cupola": "ride_v1_0", "column": "ride_v1_1"}
# period search per surface, degrees: the cone's scrollwork beats its gores (a gold and a blue gore, about 45 degrees);
# the column's panels (about 60 degrees) are wider than the search window, so it takes 6 panels round.
SEARCH = {"top": (30, 60, 20, 160), "band": (12, 50, 40, 140), "cupola": (20, 40, 40, 140), "column": None}
FIXED_M = {"column": 6}


def main():
    debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    imgs = {}
    tiles, meta = [], {}
    for kind, src in SOURCES.items():
        if src not in imgs:
            imgs[src] = np.asarray(Image.open(os.path.join(RIDE, "gen", src + "_matched.png")).convert("RGB")).astype(np.float32)
        strip, phi, v = unwrap(imgs[src], kind)
        lum = strip.mean(2).mean(0)
        if kind in FIXED_M:
            p = 2 * math.pi / FIXED_M[kind]
        else:
            pmin, pmax, lo, hi = (math.radians(x) for x in SEARCH[kind])
            p = period(strip, phi, lo, hi, pmin, pmax)
        sig = max(3, int(round(2 * p / (phi[1] - phi[0]))))
        shade = ndimage.uniform_filter1d(lum, sig, mode="nearest")
        shade = shade / shade[(phi > math.radians(60)) & (phi < math.radians(120))].mean()
        albedo = strip / shade[None, :, None]
        if kind == "band":
            albedo = np.dstack([albedo, scallop_alpha(strip) * 255])
        else:
            albedo = np.dstack([albedo, np.full(albedo.shape[:2], 255, np.float32)])
        body, k, m, stretch, w, a0 = tile(albedo, phi, p)
        tiles.append((kind, body))
        meta[kind] = {"k": k, "m": m, "a0": round(a0, 5), "stretch": round(stretch, 4), "period_deg": round(math.degrees(p), 3),
                      "window_deg": round(math.degrees(w), 2), "rows": strip.shape[0], "source": f"gen/{src}.png",
                      "shade": [round(float(s), 4) for s in np.interp(np.linspace(0, math.pi, 91), phi, shade)]}
        print(f"{kind}: period {math.degrees(p):.2f} deg, window {k} periods = {math.degrees(w):.1f} deg -> {m} tiles, stretch {stretch:.3f}, {strip.shape[0]} rows")
        if debug:
            os.makedirs(debug, exist_ok=True)
            Image.fromarray(np.clip(strip, 0, 255).astype(np.uint8)).save(os.path.join(debug, f"{kind}_strip.png"))
            two = np.concatenate([body, body], 1)
            Image.fromarray(np.clip(two, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(debug, f"{kind}_tile2.png"))
    Wd = max(t[1].shape[1] for t in tiles) + 2 * PAD
    Hd = sum(t[1].shape[0] + 2 * PAD for t in tiles)
    atlas = np.zeros((Hd, Wd, 4), np.uint8)
    y = 0
    for kind, body in tiles:
        h, w = body.shape[:2]
        wrapped = np.concatenate([body[:, -PAD:], body, body[:, :PAD]], 1)
        padded = np.concatenate([np.repeat(wrapped[:1], PAD, 0), wrapped, np.repeat(wrapped[-1:], PAD, 0)], 0)
        atlas[y:y + h + 2 * PAD, :w + 2 * PAD] = np.clip(padded, 0, 255)
        meta[kind]["rect"] = [PAD, y + PAD, w, h]
        y += h + 2 * PAD
    Image.fromarray(atlas, "RGBA").save(os.path.join(RIDE, "surfaces.webp"), quality=92, alpha_quality=100, method=6)
    json.dump({"size": [Wd, Hd], "surfaces": meta}, open(os.path.join(RIDE, "surfaces.json"), "w"))
    print(f"surfaces.webp {Wd} x {Hd}, {os.path.getsize(os.path.join(RIDE, 'surfaces.webp')) // 1024} KB")


if __name__ == "__main__":
    main()
