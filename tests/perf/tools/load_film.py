"""A filmstrip of load_measure.mjs --film frames: the frame on screen at each given time, side by side, labelled.

  uv run --no-project --with pillow python -I tests/perf/tools/load_film.py <frames dir> out.jpg \
      --times 0.5,1,2,3,5,8,12 [--label "index.html today"] [--width 220]

Frames are named fNNN_<ms>.jpg (ms from navigation start); the frame shown at time t is the last one at or before t.
Several rows: pass "dir1=label1" "dir2=label2" as the first arguments instead of one dir.
"""
import argparse, os, re
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("inputs", nargs="+", help="frames dir[=label] ... out.jpg")
ap.add_argument("--times", default="0.5,1,2,3,5,8,12")
ap.add_argument("--width", type=int, default=220)
a = ap.parse_args()
*rows, out = a.inputs
times = [float(t) for t in a.times.split(",")]
font = ImageFont.load_default()

def frames(d):
    fs = []
    for f in os.listdir(d):
        m = re.match(r"f\d+_(-?\d+)\.jpg$", f)
        if m: fs.append((int(m.group(1)), os.path.join(d, f)))
    return sorted(fs)

strips = []
for spec in rows:
    d, _, label = spec.partition("=")
    fs = frames(d)
    cells = []
    for t in times:
        before = [p for (ms, p) in fs if ms <= t * 1000]
        im = Image.open(before[-1]).convert("RGB") if before else Image.new("RGB", (640, 420), (246, 241, 234))
        h = round(im.height * a.width / im.width)
        cells.append(im.resize((a.width, h), Image.LANCZOS))
    h = max(c.height for c in cells)
    strip = Image.new("RGB", (a.width * len(cells) + 140, h + 18), (255, 253, 249))
    dr = ImageDraw.Draw(strip)
    dr.text((6, h // 2), label or os.path.basename(d), fill=(54, 34, 35), font=font)
    for i, (t, c) in enumerate(zip(times, cells)):
        strip.paste(c, (140 + i * a.width, 0))
        dr.text((140 + i * a.width + 4, h + 3), f"{t:g} s", fill=(93, 74, 71), font=font)
    strips.append(strip)
sheet = Image.new("RGB", (max(s.width for s in strips), sum(s.height for s in strips)), (255, 253, 249))
y = 0
for s in strips:
    sheet.paste(s, (0, y)); y += s.height
sheet.save(out, quality=78)
print(out, sheet.size, os.path.getsize(out), "bytes")
