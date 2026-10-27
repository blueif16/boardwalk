"""The review shots in rides/wildlife/shots/ (dev server on localhost:15178, repo root as cwd).

  uv run -q --no-project --with pillow --with numpy python -I rides/wildlife/tools/shots.py [which ...]

which: monitor, pairs, strip, shapes, finish, hours (default all). Each moment is a frozen clock (&t=), so the shots
repeat exactly (only the title's own wobble differs between runs).
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw

URL = "http://localhost:15178/"
OUT = Path("rides/wildlife/shots")
TMP = Path(tempfile.mkdtemp(prefix="wl_shots_"))
OUT.mkdir(exist_ok=True)


def capture(query, w, h, out, zoom=None):
    cmd = ["node", "scripts/capture.mjs", URL + "?" + query, "--ready", "html[data-ready]", "--width", str(w),
           "--height", str(h), "--scale", "1", "--wait", "3000", "--out", str(out)]
    if zoom:
        cmd += ["--zoom", ",".join(map(str, zoom)), "--zoom-scale", "1"]
    for _ in range(3):  # headless Chrome now and then times out on the first try
        if subprocess.run(cmd, capture_output=True).returncode == 0:
            return Image.open(out).convert("RGB")
    raise SystemExit("capture failed: " + query)


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, 10 + 6.2 * len(text), 20], fill=(255, 255, 255))
    d.text((7, 6), text, fill=(0, 0, 0))
    return im


def grid(ims, cols, gap=6):
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w + (cols - 1) * gap, rows * h + (rows - 1) * gap), (255, 255, 255))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * (w + gap), (i // cols) * (h + gap)))
    return sheet


def css2560(x, y):
    """Park px -> CSS px of a 2560 x 1440 window (scale 2/3, the world shifted up by 133.3 px)."""
    return round(x * 2 / 3), round(y * 2 / 3 - 400 / 3)


def monitor():
    # The whole window at monitor size, with the crowd and the sea, at a moment with most things out.
    im = capture("layers=sea,wildlife&t=41", 2560, 1440, OUT / "monitor_2560_t41.png")
    im.save(OUT / "monitor_2560_t41.png")
    # Painting (sea only) and live, the middle of the window enlarged 2x.
    box = (880, 820, 1900, 1440)
    pa = capture("layers=sea&t=41", 2560, 1440, TMP / "p.png").crop(box)
    li = im.crop(box)
    z = lambda i: i.resize((i.width * 2, i.height * 2), Image.NEAREST)
    grid([label(z(pa), "painting (sea layer only), 2560 window, 2x"), label(z(li), "with wildlife, t=41")], 1).save(OUT / "monitor_2560_x2.png")


# Moments at 1 CSS px per park px (a 3840 x 2560 window), shown 3x: (name, t, park rect x, y, w, h).
PAIRS = [
    ("gull on the post", 40, (1925, 1330, 110, 80)),
    ("otter eating", 15, (1640, 1905, 120, 80)),
    ("pelican line", 30, (1500, 1715, 330, 160)),
    ("dolphins arcing", 56.9, (1640, 1990, 260, 110)),
    ("seal looking round", 19, (2280, 2150, 110, 80)),
    ("whale's second breath", 104.6, (2420, 2230, 300, 140)),
]


def pairs():
    ims = []
    for name, t, (x, y, w, h) in PAIRS:
        live = capture(f"layers=sea,wildlife&crowd=0&t={t}", 3840, 2560, TMP / "l.png", (x, y, w, h))
        paint = capture(f"layers=sea&crowd=0&t={t}", 3840, 2560, TMP / "p.png", (x, y, w, h))
        z = lambda i: i.resize((i.width * 3, i.height * 3), Image.NEAREST)
        ims.append((label(z(paint), f"painting: {name}"), label(z(live), f"live, t={t}")))
    rows = [grid([a, b], 2) for a, b in ims]
    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height for r in rows) + 8 * (len(rows) - 1)), (255, 255, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height + 8
    sheet.save(OUT / "painting_vs_live_1to1_x3.png")


# Moments at monitor size (2560 window), each around its action, shown 2x.
STRIP = [
    ("gulls wheel over the surf", 22, (1950, 1650)),
    ("one lands on the stair post", 26.4, (1990, 1400)),
    ("pelicans skim the outer surf", 30, (1680, 1790)),
    ("the last one climbs out", 37.7, (2180, 2100)),
    ("folds and plunges", 39.0, (2230, 2140)),
    ("splash", 39.35, (2230, 2150)),
    ("sits and swallows", 43.6, (2230, 2160)),
    ("fish leap from the shoal", 8.45, (2200, 2190)),
    ("a seal looks round", 19, (2330, 2190)),
    ("dolphins pass", 57.2, (1780, 2060)),
    ("the whale blows", 95, (2560, 2280)),
    ("and dives: its tail", 110.5, (2560, 2280)),
    ("the otter rolls and dives", 68.9, (1700, 1945)),
    ("two gulls cross over the town", 60, (1600, 730)),
    ("the gull takes off", 64.9, (2000, 1360)),
]


def strip():
    full = {}
    ims = []
    for name, t, (px, py) in STRIP:
        if t not in full:
            full[t] = capture(f"layers=sea,wildlife&t={t}", 2560, 1440, TMP / f"s_{t}.png")
        cx, cy = css2560(px, py)
        im = full[t].crop((cx - 110, cy - 70, cx + 110, cy + 70)).resize((440, 280), Image.NEAREST)
        ims.append(label(im, f"t={t:g}  {name}"))
    grid(ims, 5).save(OUT / "strip_moments_2560_x2.png")


def shapes():
    ims = []
    for w, h in [(2560, 1440), (1920, 1080), (1512, 982), (3440, 1440)]:
        im = capture(f"layers=sea,wildlife&t=57", w, h, TMP / f"w{w}.png")
        k = 860 / im.width
        ims.append(label(im.resize((860, round(im.height * k)), Image.LANCZOS), f"{w} x {h}, t=57"))
    H = max(i.height for i in ims)
    sheet = Image.new("RGB", (860 * 2 + 6, H * 2 + 6), (255, 255, 255))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % 2) * 866, (i // 2) * (H + 6)))
    sheet.save(OUT / "window_shapes_t57.png")


def finish():
    # Raw keyed sprites against the finished ones, over the painting's water and sand, 3x a 1:1 view.
    subprocess.run(["uv", "run", "-q", "--no-project", "--with", "pillow", "--with", "numpy", "--with", "scipy", "python", "-I",
                    "rides/wildlife/tools/build_atlas.py", "--raw"], check=True, capture_output=True)
    hd = Image.open("gen/park/world_v2_hd.png").convert("RGB")
    names = ["gull/side_up", "gull/stand", "pelican/side_glide", "otter/shell", "seal/front", "dolphin/top", "whale/back"]
    rows = []
    for tag in ["atlas_raw", "atlas"]:
        meta = json.load(open(f"rides/wildlife/{tag}.json"))
        A = Image.open(f"rides/wildlife/{tag}.webp").convert("RGBA")
        D, K = meta["density"], 3
        cells = []
        for n in names:
            f = meta["frames"][n]
            x, y, w, h = f["rect"]
            sp = A.crop((x, y, x + w, y + h)).resize((round(w / D), round(h / D)), Image.LANCZOS)
            src = (3900, 4900) if not n.startswith("gull/stand") else (3500, 3600)
            bg = hd.crop((src[0], src[1], src[0] + 175, src[1] + 125)).resize((70, 50), Image.LANCZOS)
            ax, ay = f["anchor"][0] / D, f["anchor"][1] / D
            bg.paste(sp, (round(35 - ax), round(30 - ay) if "cut" not in n else round(40 - ay)), sp)
            cells.append(bg.resize((70 * K, 50 * K), Image.NEAREST))
        rows.append(label(grid(cells, len(cells), 2), "raw key" if tag == "atlas_raw" else "finished (shipped)"))
    grid(rows, 1).save(OUT / "finish_raw_vs_shipped_x3.png")
    for p in Path("rides/wildlife").glob("atlas_raw.*"):
        p.unlink()


HOURS = [7, 13, 18.5, 19, 23]


def hours():
    # The same moment at five hours of today's sun, with rides/sky's grade, at monitor size; then the roosts at night.
    ims = []
    for h in HOURS:
        im = capture(f"layers=sky,sea,wildlife&t=41&hour={h}", 2560, 1440, TMP / f"h{h}.png")
        ims.append(label(im.crop((760, 600, 1900, 1440)), f"hour={h:g}  t=41"))
    grid(ims, 2).save(OUT / "hours_2560.png")
    a = capture("layers=sky,sea,wildlife&t=41&hour=23", 3840, 2560, TMP / "n1.png", (1940, 1350, 120, 80))
    b = capture("layers=sky,sea,wildlife&t=41&hour=23", 3840, 2560, TMP / "n2.png", (1220, 1520, 120, 80))
    c = capture("layers=sky,sea,wildlife&t=41&hour=23", 3840, 2560, TMP / "n3.png", (1640, 1905, 120, 80))
    z = lambda i, t: label(i.resize((i.width * 3, i.height * 3), Image.NEAREST), t)
    grid([z(a, "23:00 stair posts"), z(b, "23:00 the sand"), z(c, "23:00 the otter")], 3).save(OUT / "night_roosts_1to1_x3.png")


if __name__ == "__main__":
    which = sys.argv[1:] or ["monitor", "pairs", "strip", "shapes", "finish", "hours"]
    for w in which:
        globals()[w]()
        print("done", w)
