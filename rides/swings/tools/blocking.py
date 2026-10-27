"""Flat-colour blocking of the Sea Swings over a 4K crop of the painting, as image 1 for an edit: the image model then
paints the ride at exactly the size and place designed in rides/swings/geom.json.

  uv run -q --no-project --with pillow --with numpy python -I rides/swings/tools/blocking.py hole OUT.png
  uv run -q --no-project --with pillow --with numpy python -I rides/swings/tools/blocking.py ride OUT.png --on PLATE.webp

hole: the region (geom.json "region", 3:2) from gen/park/world_v2_hd.png at 3840 x 2560, with the old east carousel's
  silhouette (its measured surfaces, rides/swings/gen/east_geom.json) filled flat grey.
ride: the region with a plate patch laid over (--on rides/swings/gen/erase_vN.webp + its .json, the hole filled), and
  over it the whole ride: the base (platform, skirt, fence with two gaps, drum) and the top at full lift (column, crown
  band, top cone in 16 gores, collar, cupola, finial). No chairs or chains.
base / top: the base alone over the hole (plate_v1, rejected: the model enlarged the base to fill the grey), the top alone.

"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import G, P, ring, band, hull, polar, canopy_z, ROOT, RIDE  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
F = 2.5
OUT_W, OUT_H = 3840, 2560
X0, Y0, X1, Y1 = G["region"]
S = OUT_W / (X1 - X0)
INK = (74, 48, 44)


def px(pts):
    return [((x - X0) * S, (y - Y0) * S) for x, y in pts]


def crop_hd(patch=None):
    im = Image.open(os.path.join(ROOT, "gen/park/world_v2_hd.png")).convert("RGBA")
    box = (round(X0 * F), round(Y0 * F), round(X1 * F), round(Y1 * F))
    im = im.crop(box)
    if patch:
        meta = json.load(open(os.path.splitext(patch)[0] + ".json"))
        p = Image.open(patch).convert("RGBA")
        x, y = meta["rect"][0], meta["rect"][1]
        im.alpha_composite(p, (round((x - X0) * F), round((y - Y0) * F)))
    return im.convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS)


def old_carousel():
    g = json.load(open(os.path.join(RIDE, "gen/east_geom.json")))
    pts = [(g["apex"][0] - 9, g["apex"][1] - 14), (g["apex"][0] + 9, g["apex"][1] - 14)]
    for key, grow in (("rim", 5), ("val", 5), ("top", 4), ("bot", 5)):
        e = g[key]
        r = math.radians(e.get("rot", 0))
        for i in range(120):
            t = 2 * math.pi * i / 120
            u, v = (e["a"] + grow) * math.cos(t), (e["b"] + grow) * math.sin(t)
            pts.append((e["c"][0] + u * math.cos(r) - v * math.sin(r), e["c"][1] + u * math.sin(r) + v * math.cos(r)))
    return hull(pts)


def poly(d, pts, fill, outline=INK, width=None):
    d.polygon(px(pts), fill=fill)
    if outline:
        d.line(px(pts + pts[:1]), fill=outline, width=width or max(2, round(S * 0.55)), joint="curve")


def draw_base(d):
    pl, fe, dr = G["platform"], G["fence"], G["drum"]
    r, h = pl["r"], pl["h"]
    # platform: skirt (front half) and floor
    poly(d, band(r, 0, h), (205, 72, 62))
    poly(d, ring(r, h), (236, 222, 196))
    # fence: back half first (behind the drum), then the drum, then the front half
    def fence(a0, a1):
        gaps = fe["gaps"]
        top = h + fe["h"]
        for a in range(int(a0), int(a1), 12):
            if any(g0 <= a <= g1 for g0, g1 in gaps):
                continue
            (x0, y0), (x1, y1) = polar(fe["r"], a, h), polar(fe["r"], a, top)
            d.line(px([(x0, y0), (x1, y1)]), fill=(250, 248, 240), width=round(S * 1.1))
        n = 40
        for g in range(n):
            b0, b1 = a0 + (a1 - a0) * g / n, a0 + (a1 - a0) * (g + 1) / n
            if any(g0 <= (b0 + b1) / 2 <= g1 for g0, g1 in gaps):
                continue
            for zz in (top, h + fe["h"] * 0.45):
                d.line(px([polar(fe["r"], b0, zz), polar(fe["r"], b1, zz)]), fill=(250, 248, 240), width=round(S * 0.9))
    fence(180, 360)
    # drum: side and top, a dark opening for the column
    poly(d, band(dr["r"], h, dr["z1"]), (86, 150, 214))
    for i in range(10):
        a = 18 + i * 16
        cx, cy = polar(dr["r"], a, (h + dr["z1"]) / 2)
        rr = S * 3.2
        X, Y = (cx - X0) * S, (cy - Y0) * S
        d.ellipse([X - rr, Y - rr, X + rr, Y + rr], fill=(240, 140, 70))
    poly(d, ring(dr["r"], dr["z1"]), (232, 190, 90))
    poly(d, ring(G["column"]["r"] + 0.5, dr["z1"]), (70, 52, 50), outline=None)
    fence(0, 180)


def draw_top(d):
    c, col, dr = G["canopy"], G["column"], G["drum"]
    hc = G["rest"] + G["lift"]
    z = canopy_z(hc)
    # column (front half) from the drum to the canopy
    poly(d, band(col["r"], dr["z1"], z["band0"]), (238, 196, 96))
    for i in range(4):
        zz = dr["z1"] + (z["band0"] - dr["z1"]) * (i + 0.5) / 4
        poly(d, band(col["r"] * 0.7, zz - 5, zz + 5, 50, 130), (96, 160, 214), outline=None)
    # canopy top: 16 gores between the crown band's top and the collar, back to front
    gores = []
    for i in range(16):
        a0, a1 = i * 22.5, (i + 1) * 22.5
        q = ring(c["r"], z["band1"], a0, a1, 8) + ring(c["collar"], z["collar"], a0, a1, 8)[::-1]
        mid = math.sin(math.radians((a0 + a1) / 2))
        gores.append((mid, q, (242, 200, 96) if i % 2 else (110, 170, 222)))
    for _, q, col_ in sorted(gores, key=lambda g: g[0]):
        poly(d, q, col_, outline=None)
    d.line(px(ring(c["r"], z["band1"])), fill=INK, width=round(S * 0.5))
    # crown band (front half) with oval medallions
    poly(d, band(c["r"], z["band0"], z["band1"]), (236, 188, 80))
    for i in range(9):
        a = 10 + i * 20
        cx, cy = polar(c["r"], a, (z["band0"] + z["band1"]) / 2)
        X, Y = (cx - X0) * S, (cy - Y0) * S
        w = S * 3.6 * max(0.35, math.sin(math.radians(a)))
        d.ellipse([X - w, Y - S * 3.2, X + w, Y + S * 3.2], fill=(110, 170, 222), outline=(250, 240, 220), width=round(S * 0.5))
    # cupola: a dome of stripes, then the finial
    cr, ch = c["cupola_r"], c["cupola_h"]
    prof = [(cr * math.cos(t), z["collar"] + ch * math.sin(t)) for t in np.linspace(0, math.pi / 2, 12)]
    dome = []
    for i in range(12):
        a0, a1 = 180 * i / 12, 180 * (i + 1) / 12
        q = [polar(rr, a0, zz) for rr, zz in prof] + [polar(rr, a1, zz) for rr, zz in prof][::-1]
        dome.append(q)
        poly(d, q, (250, 248, 240) if i % 2 else (80, 150, 214), outline=None)
    outline = hull([p for q in dome for p in q])
    d.line(px(outline + outline[:1]), fill=INK, width=round(S * 0.5))
    fx, fy = P(0, 0, z["cupola"] + c["finial"] * 0.5)
    X, Y, rr = (fx - X0) * S, (fy - Y0) * S, S * 2.6
    d.ellipse([X - rr, Y - rr, X + rr, Y + rr], fill=(240, 196, 70), outline=INK, width=round(S * 0.4))


def main():
    mode, out = sys.argv[1], sys.argv[2]
    patch = sys.argv[sys.argv.index("--on") + 1] if "--on" in sys.argv else None
    im = crop_hd(patch)
    d = ImageDraw.Draw(im)
    if mode == "hole":
        d.polygon(px(old_carousel()), fill=(128, 128, 128))
    elif mode == "base":
        d.polygon(px(old_carousel()), fill=(128, 128, 128))
        draw_base(d)
    elif mode == "ride":
        draw_base(d)
        draw_top(d)
    else:
        draw_top(d)
    im.save(out)
    print(out, im.size, f"{S:.3f} px per park px")


if __name__ == "__main__":
    main()
