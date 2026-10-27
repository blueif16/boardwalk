"""The Giant Dipper's circuit on the painting: waypoints traced by eye on red-mask crops of gen/park/world_v2_hd.png,
a centripetal Catmull-Rom spline through them, snapped onto the centre of the painted red band where the band is
there, smoothed, and resampled every 1 park px. Also measures how far the final path sits from the painted band.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/coaster/tools/make_track.py

Writes rides/coaster/track.json:
  points  [[x, y], ...] park px, one per 1 px of arc length, a closed loop (the last point joins the first)
  mode    per point: 0 front (drawn), 1 gaps (drawn under the lattice cut-out: seen through the gaps), 2 hidden
  alpha   per point, 0..1: fades into hidden and back out
  keys    arc-length positions: station (the front car's stop), lift_start, lift_end (the crest), brake (brakes on)
and rides/coaster/gen/track_check.png: the path over the painting, coloured by mode.
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
BOX = (1990, 900, 3240, 1260)  # park px window that holds the whole coaster

# Travel order. Each run: (mode, waypoints). The circuit closes from the last point back to the first.
FRONT, GAPS, HIDDEN = 0, 1, 2
RUNS = [
    # Out from behind the Fireball's hub, up the west loop's left side, over its top, down to its low point.
    (FRONT, [(2150, 1222), (2125, 1221), (2110, 1215), (2098, 1209), (2087, 1203), (2077, 1195), (2067, 1184), (2059, 1171),
             (2051, 1158), (2044, 1146), (2039, 1132), (2035, 1116), (2032, 1100), (2037, 1083), (2050, 1070), (2067, 1061), (2088, 1057), (2110, 1058), (2132, 1064),
             (2152, 1074), (2172, 1088), (2192, 1104), (2212, 1122), (2232, 1142), (2252, 1161), (2268, 1178), (2282, 1195),
             (2298, 1206),
             # The station at the lift's foot, the chain lift, the crest.
             (2320, 1199), (2350, 1189), (2384, 1170), (2418, 1145), (2453, 1119), (2488, 1095), (2522, 1072), (2556, 1050),
             (2591, 1028), (2617, 1013), (2643, 1002), (2661, 995), (2680, 991), (2700, 988),
             # The first drop, the upper branch, the valley.
             (2722, 993), (2742, 1003), (2760, 1018), (2776, 1033), (2797, 1047), (2830, 1065), (2856, 1080), (2883, 1095),
             (2908, 1110), (2930, 1118), (2952, 1116), (2970, 1103), (2985, 1083), (2997, 1065), (3008, 1046), (3020, 1024),
             # Up and over the east crest, and the turn at its east end.
             (3031, 1004), (3045, 983), (3062, 966), (3080, 953), (3100, 945), (3122, 941), (3145, 942), (3164, 948),
             (3176, 960), (3180, 975), (3172, 990), (3150, 1009), (3134, 1028)]),
    # Down the descent behind the lattice, through the lower dip, west along the return run seen through the gaps.
    (GAPS, [(3119, 1046), (3103, 1062), (3087, 1077), (3071, 1090), (3056, 1103), (3044, 1119), (3034, 1134), (3019, 1152),
            (3002, 1166), (2982, 1178), (2960, 1186), (2935, 1189), (2910, 1187), (2888, 1181), (2868, 1170), (2845, 1160),
            (2815, 1152), (2780, 1147), (2740, 1144), (2700, 1143), (2650, 1142), (2600, 1142), (2560, 1143)]),
    # Out of sight: under the lift and the stalls, back to the Fireball's hub.
    (HIDDEN, [(2520, 1146), (2470, 1152), (2410, 1170), (2350, 1196), (2290, 1216), (2230, 1225), (2180, 1224)]),
]
SNAP = {FRONT: True, GAPS: True, HIDDEN: False}
STATION_XY = (2336, 1194)      # where the front car stops: in the station shed, its nose just out
LIFT_END_XY = (2700, 988)      # the crest: the chain lets go
FADE_OUT, FADE_IN = 46.0, 30.0  # px of arc: gaps -> hidden, hidden -> front (under the Fireball's hub)


def red_mask():
    x0, y0, x1, y1 = BOX
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        a = np.asarray(im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F)))).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = ((r > 150) & (r - g > 60) & (r - b > 55) & (g < 150)).astype(np.float32)
    # Down to park px: the fraction of red in each 2.5 x 2.5 cell.
    small = Image.fromarray(red).resize((x1 - x0, y1 - y0), Image.BOX)
    return np.asarray(small)


def catmull_rom(pts, closed=True, per=24):
    """Centripetal Catmull-Rom through pts; returns dense points and, per point, the index of the segment it's on."""
    P = np.array(pts, float)
    n = len(P)
    out, seg = [], []
    for i in range(n if closed else n - 1):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        for t in np.linspace(t1, t2, per, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
            seg.append(i)
    return np.array(out), np.array(seg)


def resample(P, step=1.0, closed=True):
    Q = np.vstack([P, P[:1]]) if closed else P
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    s = np.arange(0, d[-1] - (step * 0.5 if closed else 0), step)
    return np.c_[np.interp(s, d, Q[:, 0]), np.interp(s, d, Q[:, 1])], s, d[-1]


def band_centre(red, p, n, reach=7.0):
    """Offset along the normal n to the centre of the red band nearest p, or None."""
    offs = np.arange(-reach, reach + 0.01, 0.5)
    xs, ys = p[0] + offs * n[0] - BOX[0], p[1] + offs * n[1] - BOX[1]
    v = ndimage.map_coordinates(red, [ys, xs], order=1, mode="constant")
    on = v > 0.3
    if on.sum() < 3:
        return None
    lab, k = ndimage.label(on)
    best, bd = None, 1e9
    for j in range(1, k + 1):
        idx = lab == j
        c = float((offs[idx] * v[idx]).sum() / v[idx].sum())
        width = idx.sum() * 0.5
        if width < 1.5:
            continue
        if abs(c) < bd:
            bd, best = abs(c), c
    return best


def normals(P):
    t = np.gradient(P, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    return np.c_[-t[:, 1], t[:, 0]]


def main():
    red = red_mask()
    wps, modes = [], []
    for mode, pts in RUNS:
        for p in pts:
            wps.append(p)
            modes.append(mode)
    dense, seg = catmull_rom(wps)
    dmode = np.array(modes)[seg]
    P, s, L = resample(dense, 1.0)
    # Mode of each resampled point: from the nearest dense point.
    near = np.argmin(((dense[None, :, :] - P[:, None, :]) ** 2).sum(-1), axis=1) if len(P) * len(dense) < 6e7 else None
    mode = dmode[near]
    N = normals(P)
    raw = np.full(len(P), np.nan)
    for i in range(len(P)):
        if SNAP[int(mode[i])]:
            c = band_centre(red, P[i], N[i])
            if c is not None:
                raw[i] = c
    # Fill the gaps in the offsets, smooth along the path (closed), apply.
    idx = np.arange(len(P))
    ok = ~np.isnan(raw)
    off = np.interp(idx, idx[ok], raw[ok], period=len(P))
    off[mode == HIDDEN] = 0
    off = ndimage.gaussian_filter1d(off, 7, mode="wrap")
    off[mode == HIDDEN] *= 0
    snapped = P + off[:, None] * N
    snapped = np.c_[ndimage.gaussian_filter1d(snapped[:, 0], 2.5, mode="wrap"), ndimage.gaussian_filter1d(snapped[:, 1], 2.5, mode="wrap")]
    Q, s2, L2 = resample(snapped, 1.0)
    near2 = np.argmin(((snapped[None, ::4, :] - Q[:, None, :]) ** 2).sum(-1), axis=1) * 4
    mode2 = mode[np.minimum(near2, len(mode) - 1)]

    # How far the final path is from the painted band's centre, where the band is found (front and gaps runs).
    N2 = normals(Q)
    dev = []
    for i in range(0, len(Q)):
        if mode2[i] == FRONT:
            c = band_centre(red, Q[i], N2[i], reach=5.0)
            if c is not None:
                dev.append(abs(c))
    dev = np.array(dev)
    found = len(dev) / max(1, int((mode2 == FRONT).sum()))

    # Fades.
    alpha = np.ones(len(Q))
    for i in range(len(Q)):
        if mode2[i] == HIDDEN:
            alpha[i] = 0
    # distance (along the loop) to the hidden run, before and after it
    hid = np.where(mode2 == HIDDEN)[0]
    h0, h1 = hid.min(), hid.max()
    for i in range(len(Q)):
        if mode2[i] == HIDDEN:
            continue
        before = (h0 - i) % len(Q)   # px until the hidden run starts
        after = (i - h1) % len(Q)    # px since it ended
        a = 1.0
        if before < FADE_OUT:
            a = min(a, before / FADE_OUT)
        if after < FADE_IN:
            a = min(a, after / FADE_IN)
        alpha[i] = a

    def s_at(xy):
        return float(np.argmin(((Q - np.array(xy)) ** 2).sum(1)))
    station, crest = s_at(STATION_XY), s_at(LIFT_END_XY)
    keys = {"station": station, "lift_start": station + 2, "lift_end": crest, "brake": (station - 150) % len(Q), "length": len(Q)}
    out = {
        "about": "Giant Dipper circuit in park px (rides/coaster/tools/make_track.py): one point per px of arc length, a closed loop in travel order. mode 0 front, 1 gaps (under the lattice cut-out), 2 hidden; alpha fades into and out of the hidden run.",
        "points": np.round(Q, 2).tolist(),
        "mode": mode2.astype(int).tolist(),
        "alpha": np.round(alpha, 3).tolist(),
        "keys": keys,
        "offset_px": {"median": round(float(np.median(dev)), 2), "p95": round(float(np.percentile(dev, 95)), 2),
                      "max": round(float(dev.max()), 2), "band_found": round(found, 3)},
    }
    json.dump(out, open(os.path.join(RIDE, "track.json"), "w"), separators=(",", ":"))

    # Check picture: the path over the painting, 2x, coloured by mode, with the station and crest marked.
    x0, y0, x1, y1 = BOX
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        bg = im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F))).resize(((x1 - x0) * 2, (y1 - y0) * 2), Image.LANCZOS)
    d = ImageDraw.Draw(bg)
    col = {FRONT: (0, 170, 255), GAPS: (255, 170, 0), HIDDEN: (150, 150, 150)}
    for i in range(len(Q) - 1):
        a, b = Q[i], Q[i + 1]
        d.line([((a[0] - x0) * 2, (a[1] - y0) * 2), ((b[0] - x0) * 2, (b[1] - y0) * 2)], fill=col[int(mode2[i])], width=2)
    for xy, c in ((STATION_XY, (0, 200, 0)), (LIFT_END_XY, (200, 0, 200))):
        d.ellipse([(xy[0] - x0) * 2 - 6, (xy[1] - y0) * 2 - 6, (xy[0] - x0) * 2 + 6, (xy[1] - y0) * 2 + 6], outline=c, width=3)
    os.makedirs(os.path.join(RIDE, "gen"), exist_ok=True)
    bg.save(os.path.join(RIDE, "gen/track_check.png"))
    print(f"track: {len(Q)} px of arc; front {int((mode2 == FRONT).sum())}, gaps {int((mode2 == GAPS).sum())}, hidden {int((mode2 == HIDDEN).sum())}")
    print(f"keys {keys}")
    print(f"distance from the painted band's centre (front runs): {out['offset_px']}")


if __name__ == "__main__":
    main()
