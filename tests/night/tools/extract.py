"""Split a registered night plate into an unlit night base and an emissive light layer, plus per-light metadata.

  uv run --no-project --with pillow --with numpy --with scipy python -I tools/extract.py DAY NIGHT OUT_DIR
      [--off NIGHT_OFF] [NAME=PATH ...]

A, the night without its lights: with --off, a registered lights-off edit of the lit night plate; without it
(method A, "night minus darkened day"), day x G, where G is a smooth per-channel gain field from a low percentile of
night/day in 48 px tiles. A light both filters and adds: night = A x M + E in linear light, with E = max(0, night - dilate(A))
under a soft noise floor (the dilation absorbs the last fraction of a pixel of misregistration) and M = (night - E) / A,
at most 1, kept to the lit area. E splits into sources (bulbs, globes, windows: bright cores and their tight halo,
for the lights slot) and spill (pools on the planks, uplit lattice: drawn into the plate, under the characters).

Writes night.webp (A), warm.webp (M, linear), spill.webp (sRGB-encoded linear light), sources.webp (the sRGB
difference the sources add over the rest of the night, for an additive canvas), lights_meta.png (R wave delay 0..1, G twinkle phase,
B twinkle amount), each NAME=PATH as NAME.webp, and check images: lights_full.png (E), wave.png (delay map).
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32) / 255


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).astype(np.float32)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055).astype(np.float32)


def lum(a):
    return a @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def save(a, p, **kw):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(p, **kw)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gain_field(day, night, tile=48, q=20):
    H, W = day.shape[:2]
    ny, nx = H // tile, W // tile
    g = np.zeros((ny, nx, 3), np.float32)
    ok = lum(day) > 0.18
    for j in range(ny):
        for i in range(nx):
            sl = (slice(j * tile, (j + 1) * tile), slice(i * tile, (i + 1) * tile))
            m = ok[sl]
            if m.sum() < tile * tile * 0.1:
                g[j, i] = np.nan
                continue
            r = (night[sl][m] + 0.02) / (day[sl][m] + 0.02)
            g[j, i] = np.percentile(r, q, axis=0)
    for c in range(3):
        ch = g[..., c]
        bad = np.isnan(ch)
        if bad.any():
            idx = ndi.distance_transform_edt(bad, return_distances=False, return_indices=True)
            ch[:] = ch[tuple(idx)]
        g[..., c] = ndi.median_filter(ch, 3)
    up = np.stack([np.asarray(Image.fromarray(g[..., c]).resize((W, H), Image.BICUBIC)) for c in range(3)], -1)
    return ndi.gaussian_filter(up, (tile / 2, tile / 2, 0))


def main():
    import os
    day_p, night_p, out = sys.argv[1:4]
    opt = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
    plates = [a.split("=", 1) for a in sys.argv[4:] if "=" in a]
    day, night = load(day_p), load(night_p)
    H, W = day.shape[:2]
    if opt("--off"):
        amb = load(opt("--off"))
        amb_d = ndi.maximum_filter(amb, (3, 3, 1))
        lo, hi = 0.02, 0.07
    else:
        amb = np.clip(day * gain_field(day, night), 0, 1)
        amb_d = ndi.maximum_filter(amb, (5, 5, 1))
        lo, hi = 0.035, 0.11
    sel = np.maximum(0, night - amb_d)
    soft = smoothstep(lo, hi, lum(sel))[..., None]
    N, A, Ad = lin(night), lin(amb), lin(amb_d)
    E_lin = np.maximum(0, N - Ad) * soft
    E = srgb(E_lin)
    le = lum(sel * soft)
    lit = ndi.gaussian_filter(ndi.maximum_filter((le > 0.015).astype(np.float32), 5), 2)
    M = np.minimum(1, (N - E_lin) / np.maximum(A, 0.0005))
    M = 1 + (M - 1) * np.clip(lit, 0, 1)[..., None]

    core = ndi.binary_opening(le > 0.22, np.ones((2, 2))) | (le > 0.4)
    lab, n = ndi.label(core, np.ones((3, 3)))
    near = ndi.gaussian_filter(ndi.binary_dilation(core, iterations=3).astype(np.float32), 1.5)
    S_lin = E_lin * np.clip(near, 0, 1)[..., None]
    spill_lin = E_lin - S_lin
    S = np.clip(night - srgb(np.maximum(0, N - S_lin)), 0, 1)
    _, (iy, ix) = ndi.distance_transform_edt(lab == 0, return_indices=True)
    owner = lab[iy, ix]

    rng = np.random.default_rng(7)
    sweep = lambda x, y: (x + 0.215 * y) / (W + 0.215 * H)
    idx = np.arange(1, n + 1)
    ones = np.ones_like(le)
    area = ndi.sum(ones, lab, idx)
    cy, cx = np.array(ndi.center_of_mass(ones, lab, idx)).T
    jitter = rng.uniform(-0.05, 0.05, n + 1).astype(np.float32)
    phase = rng.uniform(0, 1, n + 1).astype(np.float32)
    amount = np.zeros(n + 1, np.float32)
    amount[1:] = np.where(area < 40, 1.0, np.where(area < 200, 0.35, 0.0))
    s_c = np.zeros(n + 1, np.float32)
    s_c[1:] = sweep(cx, cy)
    delay = np.clip(0.05 + 0.9 * (s_c + jitter)[owner], 0, 1)
    meta = np.stack([delay, phase[owner], amount[owner]], -1)

    os.makedirs(out, exist_ok=True)
    save(amb, f"{out}/night.webp", quality=90, method=6)
    save(M, f"{out}/warm.webp", quality=92, method=6)
    save(srgb(spill_lin), f"{out}/spill.webp", quality=92, method=6)
    save(S, f"{out}/sources.webp", quality=92, method=6)
    save(meta, f"{out}/lights_meta.png", optimize=True)
    for name, path in plates:
        save(load(path), f"{out}/{name}.webp", quality=90, method=6)
    save(E, f"{out}/lights_full.png", optimize=True)
    hue = np.stack([delay, 1 - np.abs(delay - 0.5) * 2, 1 - delay], -1)
    save(np.where(core[..., None], hue, amb * 0.5), f"{out}/wave.png", optimize=True)
    recon = np.abs(np.clip(srgb(A * M + spill_lin) + S, 0, 1) - night)
    info = {"sources": int(n), "bulbs": int((area < 40).sum()), "lit_px_share": round(float((le > 0.02).mean()), 4),
            "recon_mean_err": round(float(recon.mean()), 4), "recon_p99_err": round(float(np.percentile(recon, 99)), 4)}
    print(json.dumps(info))
    json.dump(info, open(f"{out}/extract.json", "w"), indent=1)


main()
