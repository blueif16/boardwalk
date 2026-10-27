"""Placeholders of the painting for a fast first paint: a tiny blurred copy small enough to inline in index.html as a
data URI, and a small preview webp that is sharp enough to read the park while the full painting loads.

  uv run --no-project --with pillow python -I tests/perf/tools/load_placeholder.py site/park/world_1920.webp \
      --lqip 40 --preview 960 --out <dir>

Writes <dir>/world_lqip.webp (+ .txt with the data URI) and <dir>/world_<preview>.webp, and prints their sizes.
"""
import argparse, base64, io, os
from PIL import Image, ImageFilter

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--lqip", type=int, default=40, help="width of the inlined placeholder (px)")
ap.add_argument("--lqip-q", type=int, default=40)
ap.add_argument("--preview", type=int, default=960, help="width of the preview image (px); 0 for none")
ap.add_argument("--preview-q", type=int, default=55)
ap.add_argument("--out", required=True)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
im = Image.open(a.src).convert("RGB")
w, h = im.size

lw = a.lqip
lq = im.resize((lw, round(lw * h / w)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
buf = io.BytesIO()
lq.save(buf, "WEBP", quality=a.lqip_q, method=6)
data = buf.getvalue()
open(os.path.join(a.out, "world_lqip.webp"), "wb").write(data)
uri = "data:image/webp;base64," + base64.b64encode(data).decode()
open(os.path.join(a.out, "world_lqip.txt"), "w").write(uri)
print(f"lqip {lq.size[0]}x{lq.size[1]}: {len(data)} bytes, data URI {len(uri)} chars")

if a.preview:
    pw = a.preview
    pv = im.resize((pw, round(pw * h / w)), Image.LANCZOS)
    path = os.path.join(a.out, f"world_{pw}.webp")
    pv.save(path, "WEBP", quality=a.preview_q, method=6)
    print(f"preview {pv.size[0]}x{pv.size[1]}: {os.path.getsize(path)} bytes -> {path}")
