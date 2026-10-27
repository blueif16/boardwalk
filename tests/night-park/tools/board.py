"""Contact sheets: label:path pairs in a grid, optionally cropped and scaled.

  uv run -q --no-project --with pillow python -I tools/board.py OUT.png --cols 3 [--crop x,y,w,h] [--width 900] \
      "day:path.png" "night:path2.png" ...

--crop is in the pixels of the first image; other images are cropped at the same fraction of their size, so plates of
different resolutions line up. --width is each cell's width.
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("items", nargs="+")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--crop")
    ap.add_argument("--width", type=int, default=900)
    ap.add_argument("--title")
    a = ap.parse_args()
    items = [s.rsplit(":", 1) for s in a.items]
    ref = Image.open(items[0][1]).size
    cells = []
    for label, path in items:
        im = Image.open(path).convert("RGB")
        if a.crop:
            x, y, w, h = [float(v) for v in a.crop.split(",")]
            fx, fy = im.width / ref[0], im.height / ref[1]
            im = im.crop((round(x * fx), round(y * fy), round((x + w) * fx), round((y + h) * fy)))
        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
        cells.append((label, im))
    ch = max(im.height for _, im in cells)
    pad, top = 10, 30
    rows = (len(cells) + a.cols - 1) // a.cols
    head = 40 if a.title else 0
    W = a.cols * (a.width + pad) + pad
    H = head + rows * (ch + top + pad) + pad
    sheet = Image.new("RGB", (W, H), (246, 241, 234))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 20)
        big = ImageFont.truetype("DejaVuSans-Bold.ttf", 24)
    except OSError:
        font = big = ImageFont.load_default()
    if a.title:
        d.text((pad, 8), a.title, fill=(54, 34, 35), font=big)
    for i, (label, im) in enumerate(cells):
        r, c = divmod(i, a.cols)
        x = pad + c * (a.width + pad)
        y = head + pad + r * (ch + top + pad)
        d.text((x, y + 4), label, fill=(54, 34, 35), font=font)
        sheet.paste(im, (x, y + top))
    sheet.save(a.out)
    print(f"wrote {a.out} {W}x{H}")


if __name__ == "__main__":
    main()
