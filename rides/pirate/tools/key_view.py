"""Key a sprite drawn on flat magenta and write a gridded view of it, for measuring by eye.

  uv run -q --no-project --with pillow --with numpy --with scipy python -I rides/pirate/tools/key_view.py IN.png OUT_PREFIX [--step 50]

Writes OUT_PREFIX_keyed.png (RGBA, cropped to the subject with a 20 px margin; its offset in IN is printed) and
OUT_PREFIX_grid.png (the keyed sprite over grey, a line every --step px of the keyed image, labelled every 5th).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def key(rgb):
    """Alpha from the distance to the border's median colour (the flat background), colours un-mixed from it."""
    a = rgb.astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 40) / (130 - 40), 0, 1)
    # Keep the subject's connected body only (drops specks of noise in the background).
    lab, n = ndimage.label(alpha > 0.5)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(alpha), lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.where(sizes > sizes.max() * 0.002)[0])
        alpha = alpha * ndimage.binary_dilation(keep, iterations=3)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((a - bg * (1 - alpha[..., None])) / safe, 0, 255)
    return np.dstack([fg, alpha * 255]).astype(np.uint8), bg


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    step = int(sys.argv[sys.argv.index("--step") + 1]) if "--step" in sys.argv else 50
    rgba, bg = key(np.asarray(Image.open(args[0]).convert("RGB")))
    ys, xs = np.where(rgba[..., 3] > 8)
    x0, y0 = max(0, xs.min() - 20), max(0, ys.min() - 20)
    x1, y1 = min(rgba.shape[1], xs.max() + 21), min(rgba.shape[0], ys.max() + 21)
    out = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")
    out.save(args[1] + "_keyed.png")
    print(f"background {np.round(bg).astype(int).tolist()}, subject box {x0},{y0} - {x1},{y1} in the input ({x1 - x0} x {y1 - y0})")
    view = Image.new("RGBA", out.size, (150, 150, 150, 255))
    view.alpha_composite(out)
    d = ImageDraw.Draw(view)
    for v in range(0, out.width, step):
        d.line([(v, 0), (v, out.height)], fill=(255, 255, 255, 255) if v % (step * 5) == 0 else (220, 220, 220, 255))
        if v % (step * 5) == 0: d.text((v + 3, 3), str(v), fill=(0, 0, 0))
    for v in range(0, out.height, step):
        d.line([(0, v), (out.width, v)], fill=(255, 255, 255, 255) if v % (step * 5) == 0 else (220, 220, 220, 255))
        if v % (step * 5) == 0: d.text((3, v + 3), str(v), fill=(0, 0, 0))
    view.convert("RGB").save(args[1] + "_grid.png")
