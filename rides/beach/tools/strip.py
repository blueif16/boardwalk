"""Frames of the beach layer at a row of clock times, tiled into one sheet, for checking motion.

  uv run -q --no-project --with pillow python -I rides/beach/tools/strip.py OUT.png X Y W H T0 DT N [--scale 2] [--cols 6] [--layers sea,beach] [--extra "&crowd=0"] [--anim OUT.webp]

Loads the page frozen at T0 in a 3840 x 2560 window (1 CSS px per park px), then for each time calls the layer's
draw(t) (and the sea's) and screenshots the park rect X Y W H. Needs the dev server on :15178.
"""
import json, os, subprocess, sys, tempfile
args = sys.argv[1:]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
scale, cols, layers, extra = float(opt("--scale", 2)), int(opt("--cols", 6)), opt("--layers", "sea,beach"), opt("--extra", "")
anim = opt("--anim", None)  # also write the frames as an animated WebP, played at real speed
out, x, y, w, h, t0, dt, n = args[0], *map(float, args[1:7]), int(args[7])
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
tmp = tempfile.mkdtemp()
acts = [["until", "document.documentElement.dataset.ready && window.__beach", 30000], ["wait", 800]]
shots = []
for i in range(n):
    t = t0 + i * dt
    acts.append(["eval", f"(window.__sea && __sea.draw({t}), __beach.draw({t}), 1)"])
    p = os.path.join(tmp, f"f{i:03d}.png"); shots.append((p, t))
    acts.append(["shot", p, "body", scale, [x, y, w, h]])
af = os.path.join(tmp, "acts.json"); json.dump(acts, open(af, "w"))
url = f"http://localhost:15178/?layers={layers}&t={t0}{extra}"
subprocess.run(["node", os.path.join(ROOT, "scripts/drive.mjs"), url, "--actions", af, "--width", "3840", "--height", "2560", "--scale", "1"], check=True, stdout=subprocess.DEVNULL)
from PIL import Image, ImageDraw
ims = [Image.open(p).convert("RGB") for p, _ in shots]
W, H = ims[0].size
rows = (n + cols - 1) // cols
sheet = Image.new("RGB", (cols * W + (cols - 1) * 4, rows * H + (rows - 1) * 4), "white")
d = ImageDraw.Draw(sheet)
for i, (im, (_, t)) in enumerate(zip(ims, shots)):
    X, Y = (i % cols) * (W + 4), (i // cols) * (H + 4)
    sheet.paste(im, (X, Y)); d.rectangle([X, Y, X + 46, Y + 14], fill="white"); d.text((X + 3, Y + 2), f"t={t:.1f}", fill="black")
sheet.save(out); print(out, sheet.size)
if anim:
    ims[0].save(anim, save_all=True, append_images=ims[1:], duration=round(dt * 1000), loop=0, quality=70, method=6)
    print(anim, os.path.getsize(anim) // 1024, "KB")
