"""Image comparison helpers: SSIMULACRA2 (the pip `ssimulacra2` port of libjxl's tool), SSIM, premultiplied resizing
and compositing. Arrays are float32 0..255, HxWx3 or HxWx4.

SSIMULACRA2 reading (libjxl's guide): 90+ visually lossless at 1:1 even side by side, 80-90 artifacts not visible at
normal distance, 70 high quality, 50 medium. Computed here on the image as it is shown (resized to the screen's
density), so an 80 there is seen at 1:1 on that screen.
"""
import io

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
import ssimulacra2.ssimulacra2 as S

Image.MAX_IMAGE_PIXELS = None


def load(path_or_bytes):
    im = Image.open(io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, (bytes, bytearray)) else path_or_bytes)
    im.load()
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if ("A" in im.mode or "transparency" in im.info) else "RGB")
    return np.asarray(im, dtype=np.float32)


def rgba(a):
    if a.shape[2] == 4:
        return a
    return np.concatenate([a, np.full(a.shape[:2] + (1,), 255, np.float32)], axis=2)


def resize(a, w, h, filt=Image.LANCZOS, box=None):
    """Resize with premultiplied alpha (what browsers and sharp do), Lanczos by default. box: the source region
    (x0, y0, x1, y1) in source px, fractional allowed, mapped onto the whole w x h output."""
    if a.shape[1] == w and a.shape[0] == h and box is None:
        return a
    def one(ch):
        return np.asarray(Image.fromarray(np.ascontiguousarray(ch), "F").resize((w, h), filt, box=box), dtype=np.float32)
    if a.shape[2] == 3:
        return np.clip(np.stack([one(a[..., c]) for c in range(3)], axis=2), 0, 255)
    al = a[..., 3] / 255.0
    pre = [one(a[..., c] * al) for c in range(3)]
    A = np.clip(one(a[..., 3]), 0, 255)
    an = A / 255.0
    out = np.stack([np.where(an > 1e-4, p / np.maximum(an, 1e-4), 0) for p in pre] + [A], axis=2)
    return np.clip(out, 0, 255)


def over(fg, bg):
    """fg (RGBA) over bg (RGB, same size)."""
    if fg.shape[2] == 3:
        return fg
    a = fg[..., 3:4] / 255.0
    return fg[..., :3] * a + bg[..., :3] * (1 - a)


def ss2(ref, dist):
    """SSIMULACRA2 of dist against ref (RGB float 0..255)."""
    o = S.make_positive_xyb(S.linear_rgb_to_xyb(S.srgb_to_linear(ref[..., :3].astype(np.float64))))
    d = S.make_positive_xyb(S.linear_rgb_to_xyb(S.srgb_to_linear(dist[..., :3].astype(np.float64))))
    ol, dl = S.srgb_to_linear(ref[..., :3].astype(np.float64)), S.srgb_to_linear(dist[..., :3].astype(np.float64))
    m = S.Msssim()
    for scale in range(S.kNumScales):
        if o.shape[0] < 8 or o.shape[1] < 8:
            break
        s1, s2, s12 = S.blur_image(o * o), S.blur_image(d * d), S.blur_image(o * d)
        mu1, mu2 = S.blur_image(o), S.blur_image(d)
        sd = S.MsssimScale()
        sd.avg_ssim = S.ssim_map(mu1, mu2, s1, s2, s12)
        sd.avg_edgediff = S.edge_diff_map(o, mu1, d, mu2)
        m.scales.append(sd)
        if scale < S.kNumScales - 1:
            ol, dl = S.downsample(ol, 2, 2), S.downsample(dl, 2, 2)
            o, d = S.make_positive_xyb(S.linear_rgb_to_xyb(ol)), S.make_positive_xyb(S.linear_rgb_to_xyb(dl))
    return float(m.score())


def ssim(ref, dist):
    return float(structural_similarity(ref[..., :3], dist[..., :3], channel_axis=2, data_range=255))


def tiles(ref, dist, size=512, keep=None):
    """SSIMULACRA2 per tile: (min, 10th percentile) over tiles; keep(ref_tile) -> bool filters which tiles count."""
    out = []
    H, W = ref.shape[:2]
    for y in range(0, max(1, H - size // 2), size):
        for x in range(0, max(1, W - size // 2), size):
            r, d = ref[y:y + size, x:x + size], dist[y:y + size, x:x + size]
            if keep and not keep(r):
                continue
            out.append((ss2(r, d), x, y))
    if not out:
        return None
    s = sorted(v for v, _, _ in out)
    return {"min": s[0], "p10": s[max(0, len(s) // 10)], "worst": min(out)[1:], "n": len(s)}


def max_abs(ref, dist):
    return float(np.abs(ref[..., :3] - dist[..., :3]).max())


def psnr(ref, dist):
    mse = float(np.mean((ref[..., :3] - dist[..., :3]) ** 2))
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
