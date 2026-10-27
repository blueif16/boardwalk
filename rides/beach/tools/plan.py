"""Draw rides/beach/scene.json's points over the painting, for placing things by eye.

  uv run -q --no-project --with pillow --with numpy python -I rides/beach/tools/plan.py X0 Y0 X1 Y1 OUT.png [--zoom 1]
"""
import json, os, sys
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
args = sys.argv[1:]
zoom = float(args[args.index("--zoom") + 1]) if "--zoom" in args else 1.0
x0, y0, x1, y1 = (int(v) for v in args[:4]); out = args[4]
sc = json.load(open(os.path.join(ROOT, "rides/beach/scene.json")))
im = Image.open(os.path.join(ROOT, "site/park/world_3840.webp")).convert("RGB").crop((x0, y0, x1, y1))
im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
P = lambda x, y: ((x - x0) * zoom, (y - y0) * zoom)
def dot(x, y, label, col=(220, 0, 80)):
    X, Y = P(x, y); d.ellipse([X - 3, Y - 3, X + 3, Y + 3], fill=col); d.text((X + 4, Y - 6), label, fill=col)
for c in sc["camps"]:
    dot(*c["umbrella"][1:3], c["id"] + " " + c["umbrella"][0], (200, 0, 0))
    for t in c.get("towels", []): dot(t[1], t[2], t[0], (0, 120, 200))
    for t in c.get("chairs", []): dot(t[1], t[2], t[0], (0, 120, 0))
    for t in c.get("things", []): dot(t[1], t[2], t[0], (120, 60, 0))
v = sc["volleyball"]; dot(*v["center"], "volleyball")
dot(*sc["tower"]["at"], "tower"); dot(*sc["castle"]["at"], "castle")
for s in sc["swimmers"]: dot(*s["at"], "swim " + s["look"], (0, 0, 160))
dot(*sc["boarder"]["from"], "board from", (0, 0, 160)); dot(*sc["boarder"]["to"], "board to", (0, 0, 160))
for w in sc["waders"]: dot(*w["at"], "wade " + w["look"], (0, 0, 160))
dot(*sc["dog"]["at"], "dog"); dot(*sc["dog"]["to"], "dog to")
dot(*sc["kite"]["at"], "kite flyer"); dot(*sc["kite"]["kite"], "kite")
dot(*sc["walkers"]["from"], "walk from"); dot(*sc["walkers"]["to"], "walk to")
for g in sc.get("gulls", []): dot(*g, "gull", (90, 90, 90))
walk = json.load(open(os.path.join(ROOT, "tests/park-crowd/walk.json")))
for pl in walk["places"]:
    if pl["kind"] == "beach":
        dot(*pl["slots"][0], "crowd " + pl.get("mode", "?"), (0, 140, 60))
im.save(out); print(out, im.size)
