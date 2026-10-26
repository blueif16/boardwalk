"""Contact sheet: rows of labelled images, each scaled to a common width, optionally cropped.

  uv run --no-project --with pillow python -I tools/board.py OUT.png --width 512 [--crop x,y,w,h] \
      --row "label a=path_a" "label b=path_b" --row ...
"""
import sys
from PIL import Image, ImageDraw, ImageFont


def main():
    args = sys.argv[1:]
    out = args.pop(0)
    width, crop, rows = 512, None, []
    while args:
        a = args.pop(0)
        if a == "--width": width = int(args.pop(0))
        elif a == "--crop": crop = tuple(int(v) for v in args.pop(0).split(","))
        elif a == "--row": rows.append([])
        else: rows[-1].append(a.split("=", 1))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    cells = []
    for row in rows:
        r = []
        for label, path in row:
            im = Image.open(path).convert("RGB")
            if crop: im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            r.append((label, im))
        cells.append(r)
    pad, head = 8, 28
    cols = max(len(r) for r in cells)
    H = sum(max(im.height for _, im in r) + head + pad for r in cells) + pad
    board = Image.new("RGB", (cols * (width + pad) + pad, H), (246, 241, 234))
    d = ImageDraw.Draw(board)
    y = pad
    for r in cells:
        x = pad
        for label, im in r:
            d.text((x + 2, y + 4), label, fill=(54, 34, 35), font=font)
            board.paste(im, (x, y + head))
            x += width + pad
        y += max(im.height for _, im in r) + head + pad
    board.save(out, optimize=True)


main()
