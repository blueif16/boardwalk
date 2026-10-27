"""Logger's Revenge's water circuit on the painting: waypoints traced by eye on gridded HD crops (tools/grid.py), a
centripetal Catmull-Rom spline through them, snapped onto the centre of the painted water band where a run asks for
it, smoothed, and resampled every 1 park px. Measures how far the final path sits from the painted band's centre.

Copied from rides/coaster/tools/make_track.py. What changed: a water mask (teal tubes and light-blue chutes) instead of
the red-track mask; a snap reach per run (narrow tubes, the wide drop chute; the pool and the U-turn are not snapped);
a "tilt" per run (how much a side-view log turns with the path: less in the flat pool); a "kind" per point for the
motion and the water effects (pool, lift, flume, drop).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/flume/tools/make_track.py

Writes rides/flume/track.json:
  points  [[x, y], ...] park px, one per 1 px of arc length, a closed loop in travel order
  mode    per point: 0 front, 1 behind (drawn under the S tube's cut-out, where the lift passes behind it), 2 hidden
  kind    per point: 0 pool, 1 lift, 2 flume, 3 drop
  tilt    per point, 0..1: how much a side-view log turns with the path
  alpha   per point, 0..1: fades into the mill house and back out of the box at the lift's foot
  keys    arc-length positions: station, lift_start, lift_end, drop_start, splash, length
and rides/flume/gen/track_check.png: the path over the painting, coloured by kind, dashed where hidden or behind.
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
BOX = (3010, 890, 3740, 1400)  # park px window that holds the whole flume

FRONT, BEHIND, HIDDEN = 0, 1, 2
POOL, LIFT, FLUME, DROP = 0, 1, 2, 3
# Travel order. Each run: (mode, kind, snap reach in px or 0, tilt, waypoints). The circuit closes from the last
# point back to the first.
RUNS = [
    # The station in the U-turn in front of the mill house, then round the U and up its left arm under the porch.
    (FRONT, POOL, 0, 0.45, [(3112, 1356), (3090, 1360), (3068, 1359), (3050, 1350), (3041, 1334), (3044, 1316),
                            (3054, 1302), (3068, 1291)]),
    # Through the mill house and behind the drop chute to the box at the lift's foot: out of sight.
    (HIDDEN, LIFT, 0, 1, [(3088, 1274), (3130, 1246), (3180, 1218), (3232, 1194), (3276, 1176)]),
    # The lift: the straight diagonal chute, up to where it passes behind the S tube.
    # (Its first stretch, inside the wooden housing, isn't snapped: the housing's blue panels would pull it sideways.)
    (FRONT, LIFT, 0, 1, [(3302, 1160), (3331, 1131)]),
    (FRONT, LIFT, 18, 1, [(3363, 1100), (3397, 1072), (3420, 1052)]),
    (BEHIND, LIFT, 0, 1, [(3440, 1035), (3456, 1021), (3470, 1009)]),
    # The rest of the lift and the top run: the crest.
    (FRONT, LIFT, 15, 1, [(3485, 996), (3500, 983), (3518, 968), (3540, 956), (3562, 950)]),
    (FRONT, FLUME, 19, 1, [(3585, 954), (3608, 966), (3632, 968), (3660, 962), (3688, 968), (3706, 984),
                           # Down the right side to the loop's foot.
                           (3711, 1007), (3703, 1032), (3687, 1075), (3670, 1118), (3657, 1158), (3644, 1198),
                           (3636, 1232),
                           # Round the big loop and back up its left side.
                           (3626, 1262), (3600, 1277), (3567, 1278), (3540, 1266), (3526, 1242), (3532, 1214),
                           (3556, 1187), (3583, 1160), (3610, 1133), (3632, 1110), (3641, 1090), (3633, 1073),
                           # West under the round disc, to the S tube's bend.
                           (3613, 1062), (3590, 1052), (3567, 1043), (3543, 1041), (3521, 1048), (3500, 1058),
                           (3478, 1072), (3455, 1080), (3436, 1074),
                           # Up the S (in front of the lift chute), over its top and west along the arch.
                           (3433, 1052), (3442, 1027), (3453, 1000), (3459, 972), (3456, 947), (3443, 928),
                           (3425, 917), (3405, 915), (3385, 918), (3362, 929), (3339, 944), (3318, 962), (3299, 981)]),
    # The drop: down the tall tube, then the wide chute into the pool.
    (FRONT, DROP, 20, 1, [(3285, 997), (3281, 1023), (3277, 1057), (3272, 1090), (3267, 1123), (3263, 1157)]),
    (FRONT, DROP, 30, 1, [(3256, 1182), (3245, 1203), (3220, 1250), (3193, 1290), (3166, 1327)]),
    # The splash, and the glide back into the station.
    (FRONT, POOL, 0, 0.45, [(3146, 1346), (3128, 1353)]),
]
STATION_XY = (3088, 1360)    # where the log stops to load
LIFT_START_XY = (3302, 1160)
LIFT_END_XY = (3562, 950)    # the crest
DROP_START_XY = (3285, 997)  # the top of the tall tube
SPLASH_XY = (3150, 1344)     # where the drop meets the pool
FADE_OUT, FADE_IN = 30.0, 34.0  # px of arc: into the porch, out of the box


def water_mask():
    x0, y0, x1, y1 = BOX
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        a = np.asarray(im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F)))).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    water = (b > r + 45) & (g > r + 20) & (b > 120)
    water = ndimage.binary_closing(water, iterations=3).astype(np.float32)
    small = Image.fromarray(water).resize((x1 - x0, y1 - y0), Image.BOX)
    return np.asarray(small)


def catmull_rom(pts, closed=True, per=24):
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
    """Points every `step` px of arc length, and for each the index of the input point it came from (by arc length,
    not by nearest position: the circuit passes close to itself, e.g. the hidden run beside the drop chute)."""
    Q = np.vstack([P, P[:1]]) if closed else P
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    s = np.arange(0, d[-1] - (step * 0.5 if closed else 0), step)
    src = np.clip(np.searchsorted(d, s, side="right") - 1, 0, len(P) - 1)
    return np.c_[np.interp(s, d, Q[:, 0]), np.interp(s, d, Q[:, 1])], src, d[-1]


def band_centre(mask, p, n, reach):
    """Offset along the normal n to the centre of the water band nearest p, or None."""
    offs = np.arange(-reach, reach + 0.01, 0.5)
    xs, ys = p[0] + offs * n[0] - BOX[0], p[1] + offs * n[1] - BOX[1]
    v = ndimage.map_coordinates(mask, [ys, xs], order=1, mode="constant")
    on = v > 0.5
    if on.sum() < 4:
        return None
    lab, k = ndimage.label(on)
    best, bd = None, 1e9
    for j in range(1, k + 1):
        idx = lab == j
        if idx.sum() * 0.5 < 3:
            continue
        # A band cut by the reach's end isn't measured: its centre would be biased.
        if idx[0] or idx[-1]:
            continue
        c = float((offs[idx] * v[idx]).sum() / v[idx].sum())
        if abs(c) < bd:
            bd, best = abs(c), c
    return best


def normals(P):
    t = np.gradient(P, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    return np.c_[-t[:, 1], t[:, 0]]


def main():
    water = water_mask()
    wps, attrs = [], []
    for mode, kind, reach, tilt, pts in RUNS:
        for p in pts:
            wps.append(p)
            attrs.append((mode, kind, reach, tilt))
    attrs = np.array(attrs, float)
    dense, seg = catmull_rom(wps)
    P, src, L = resample(dense, 1.0)
    A = attrs[seg[src]]
    mode, reach = A[:, 0].astype(int), A[:, 2]
    N = normals(P)
    raw = np.full(len(P), np.nan)
    for i in range(len(P)):
        if reach[i] > 0:
            c = band_centre(water, P[i], N[i], reach[i])
            if c is not None:
                raw[i] = c
    idx = np.arange(len(P))
    snap = reach > 0
    ok = ~np.isnan(raw)
    off = np.interp(idx, idx[ok], raw[ok], period=len(P))
    off[~snap] = 0
    off = ndimage.gaussian_filter1d(off, 7, mode="wrap")
    snapped = P + off[:, None] * N
    snapped = np.c_[ndimage.gaussian_filter1d(snapped[:, 0], 2.5, mode="wrap"), ndimage.gaussian_filter1d(snapped[:, 1], 2.5, mode="wrap")]
    Q, src2, _ = resample(snapped, 1.0)
    A2 = A[src2]
    mode2, kind2, reach2 = A2[:, 0].astype(int), A2[:, 1].astype(int), A2[:, 2]
    tilt2 = ndimage.gaussian_filter1d(A2[:, 3], 10, mode="wrap")

    # How far the final path is from the painted band's centre, on the snapped front runs where the band is found.
    N2 = normals(Q)
    dev, tried = [], 0
    for i in range(len(Q)):
        if mode2[i] == FRONT and reach2[i] > 0:
            tried += 1
            c = band_centre(water, Q[i], N2[i], reach2[i])
            if c is not None:
                dev.append(abs(c))
    dev = np.array(dev)

    alpha = np.ones(len(Q))
    hid = np.where(mode2 == HIDDEN)[0]
    h0, h1 = hid.min(), hid.max()
    for i in range(len(Q)):
        if mode2[i] == HIDDEN:
            alpha[i] = 0
            continue
        before, after = (h0 - i) % len(Q), (i - h1) % len(Q)
        a = 1.0
        if before < FADE_OUT:
            a = min(a, before / FADE_OUT)
        if after < FADE_IN:
            a = min(a, after / FADE_IN)
        alpha[i] = a

    def s_at(xy):
        return float(np.argmin(((Q - np.array(xy)) ** 2).sum(1)))
    keys = {"station": s_at(STATION_XY), "lift_start": s_at(LIFT_START_XY), "lift_end": s_at(LIFT_END_XY),
            "drop_start": s_at(DROP_START_XY), "splash": s_at(SPLASH_XY), "length": len(Q)}
    out = {
        "about": "Logger's Revenge circuit in park px (rides/flume/tools/make_track.py): one point per px of arc length, a closed loop in travel order. mode 0 front, 1 behind (under the S tube's cut-out), 2 hidden; kind 0 pool, 1 lift, 2 flume, 3 drop; tilt: how much a side-view log turns with the path; alpha fades into the mill house and out of the box at the lift's foot.",
        "points": np.round(Q, 2).tolist(),
        "mode": mode2.tolist(),
        "kind": kind2.tolist(),
        "tilt": np.round(tilt2, 3).tolist(),
        "alpha": np.round(alpha, 3).tolist(),
        "keys": keys,
        "offset_px": {"median": round(float(np.median(dev)), 2), "p95": round(float(np.percentile(dev, 95)), 2),
                      "max": round(float(dev.max()), 2), "band_found": round(len(dev) / max(1, tried), 3)},
    }
    json.dump(out, open(os.path.join(RIDE, "track.json"), "w"), separators=(",", ":"))

    x0, y0, x1, y1 = BOX
    z = 2
    with Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")) as im:
        bg = im.convert("RGB").crop((int(x0 * F), int(y0 * F), int(x1 * F), int(y1 * F))).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
    d = ImageDraw.Draw(bg)
    col = {POOL: (255, 220, 0), LIFT: (255, 60, 160), FLUME: (0, 220, 120), DROP: (255, 90, 0)}
    for i in range(len(Q) - 1):
        if mode2[i] != FRONT and (i // 6) % 2:
            continue
        a, b = Q[i], Q[i + 1]
        d.line([((a[0] - x0) * z, (a[1] - y0) * z), ((b[0] - x0) * z, (b[1] - y0) * z)], fill=col[int(kind2[i])], width=2)
    for k, c in (("station", (0, 0, 255)), ("lift_end", (200, 0, 200)), ("drop_start", (255, 0, 0)), ("splash", (0, 200, 255))):
        p = Q[int(keys[k])]
        d.ellipse([(p[0] - x0) * z - 7, (p[1] - y0) * z - 7, (p[0] - x0) * z + 7, (p[1] - y0) * z + 7], outline=c, width=3)
    os.makedirs(os.path.join(RIDE, "gen"), exist_ok=True)
    bg.save(os.path.join(RIDE, "gen/track_check.png"))
    print(f"track: {len(Q)} px; front {int((mode2 == FRONT).sum())}, behind {int((mode2 == BEHIND).sum())}, hidden {int((mode2 == HIDDEN).sum())}")
    print("kinds:", {n: int((kind2 == k).sum()) for n, k in (("pool", POOL), ("lift", LIFT), ("flume", FLUME), ("drop", DROP))})
    print(f"keys {keys}")
    print(f"distance from the painted band's centre (snapped front runs): {out['offset_px']}")


if __name__ == "__main__":
    main()
