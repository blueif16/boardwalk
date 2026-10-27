"""Boards for RESULTS.md: the switch-on wave strip, close-ups (day painting | the model's lit edit | ours), and the
inventory check.

  uv run -q --no-project --with pillow --with numpy python -I tests/night-lights/tools/board.py
"""
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
R = "tests/night-lights"
day = Image.open("gen/park/world_v2_hd.png").convert("RGB")
lit = Image.open(f"{R}/gen/reg/lit_v1_0_reg.png").convert("RGB")      # 3840 x 2560 over park (1700, 650)-(3200, 1650)
ours = Image.open(f"{R}/shots/slice_22.png").convert("RGB")           # 2 px per park px from (1900, 650)
off = Image.open(f"{R}/shots/slice_22_off.png").convert("RGB")


def crop(src, box, k, ox=0, oy=0):
    x0, y0, x1, y1 = box
    return src.crop((round((x0 - ox) * k), round((y0 - oy) * k), round((x1 - ox) * k), round((y1 - oy) * k)))


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 9 + 7 * len(text), 18], fill=(20, 20, 30))
    d.text((5, 3), text, fill=(240, 236, 228))
    return im


# Wave strip.
hours = ["18.9", "19.2", "19.5", "19.8", "20.1", "20.4"]
fr = [Image.open(f"{R}/shots/wave_{h}.png").convert("RGB").crop((0, 0, 1100, 1000)).resize((550, 500), Image.LANCZOS) for h in hours]
strip = Image.new("RGB", (550 * 3, 500 * 2), "black")
for i, (h, im) in enumerate(zip(hours, fr)):
    hh, mm = int(float(h)), round((float(h) % 1) * 60)
    strip.paste(label(im, f"{hh:02d}:{mm:02d}"), ((i % 3) * 550, (i // 3) * 500))
strip.save(f"{R}/shots/board_wave.png")

# Close-ups: day | model lit edit | ours lights off (the base's grade) | ours lights on, 22:00.
boxes = [("lamps and stalls", (2255, 1330, 2515, 1505)), ("town windows", (2630, 650, 2890, 790)),
         ("wheel and carousel", (2480, 1180, 2900, 1540)), ("coaster crest and flags", (2560, 860, 2900, 1080))]
rows = []
for name, b in boxes:
    w = 520
    cells = [crop(day, b, 2.5), crop(lit, b, 3840 / 1500, 1700, 650), crop(off, b, 2, 1900, 650), crop(ours, b, 2, 1900, 650)]
    h = round(w * (b[3] - b[1]) / (b[2] - b[0]))
    cells = [c.resize((w, h), Image.LANCZOS) for c in cells]
    row = Image.new("RGB", (w * 4 + 12, h + 4), (16, 16, 24))
    for i, (c, t) in enumerate(zip(cells, ["day painting", "image model's lit edit", "ours: base grade, lights off", "ours: lights on, 22:00"])):
        row.paste(label(c, t if name == boxes[0][0] else name if i == 0 else t), (i * (w + 4), 2))
    rows.append(row)
H = sum(r.height for r in rows)
board = Image.new("RGB", (rows[0].width, H), (16, 16, 24))
y = 0
for r in rows:
    board.paste(r, (0, y)); y += r.height
board.save(f"{R}/shots/board_closeups.png")
print("ok")
