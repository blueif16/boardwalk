"""Local repaints of the whole-park painting ("plates"): erase a ride's moving parts, or fix a flaw, without softening
anything else. The painting itself is never rewritten; each repaint ships as a small RGBA patch that the page lays
over the painting (ctx.addPatch in a ride layer), so several people can patch different places at once.

  P="uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/park_patch.py"
  $P crop X0 Y0 X1 Y1 OUT.png
  $P paste EDIT.png X0 Y0 X1 Y1 OUT_PREFIX (--mask MASK.png | --poly POLY.json) [--feather 6] [--grow 4] [--match]

Coordinates are park px (the 3840 x 2560 frame, tests/park-crowd/park.json). The region must be 3:2; `crop` widens
it to 3:2 around its centre if needed and prints the region it used.

crop: cuts the region from gen/park/world_v2_hd.png (9600 x 6400, 2.5 HD px per park px) at full detail, for use as
  --ref of tools/shyfai_image.py (whose default output, 3840 x 2560, is then 3840 / (X1 - X0) px per park px: keep
  regions at most 1536 park px wide so the edit is at least as detailed as the painting).

paste: takes the edit back to HD density, measures and removes any shift against the original crop, matches its
  colour to the original in a ring just outside the mask, and keeps only the masked area (white = replace, feathered).
  The mask is either a PNG over the region (any size, white = replace) or a JSON list of polygons in park px
  ([[[x, y], ...], ...]). Writes OUT_PREFIX.webp (RGBA, lossless, cropped to the mask, at HD density),
  OUT_PREFIX.json ({"rect": [x, y, w, h] in park px, "source": ...}) and OUT_PREFIX_check.png (before | after, the
  mask outlined), to look at before using it. The colour offset is the median over a ring outside the feather; the
  feather straddles the mask's edge (50% on the outline). --match also softens the edit to the painting's sharpness and
  matches each channel's spread, measured in that ring: edits of a small region come back crisper and bolder than
  the painting, which shows as a window where the patch meets redrawn texture (lattice, planks). Dream Wheel plate,
  2026-10-26: blur sigma 1.1 HD px, gains about 0.9.
  --changed T keeps only what the edit really changed (blurred difference above T levels) inside the polygon, then
  --grow widens it (never past the polygon): the patch then follows the erased object's own outline, so no half-blended edge of it is left.

  $P cut POLY.json OUT_PREFIX [--feather 1] [--classmask MASK.png --region X0,Y0,X1,Y1]

cut: the painting's own pixels inside the polygons (park px), as an RGBA overlay at HD density, for drawing over a
  moving part where something painted stands in front of it (a ride's arm over a coaster train). --classmask limits
  it per pixel (white = keep), e.g. to lattice members only so the part shows through the gaps.
  Tested 2026-10-26 (paste): a synthetic edit shifted (+12, -8) HD px and offset (+9, -6, +4) came back exact.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HD = os.path.join(ROOT, "gen/park/world_v2_hd.png")
F = 2.5  # HD px per park px
W, H = 3840, 2560


def region(x0, y0, x1, y1):
    w, h = x1 - x0, y1 - y0
    if abs(w / h - 1.5) > 0.01:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        w, h = max(w, h * 1.5), max(h, w / 1.5)
        x0, y0 = cx - w / 2, cy - h / 2
        x0, y0 = min(max(0, x0), W - w), min(max(0, y0), H - h)
        x1, y1 = x0 + w, y0 + h
    return [round(x0), round(y0), round(x1), round(y1)]


def hd_crop(r):
    x0, y0, x1, y1 = r
    with Image.open(HD) as im:
        return im.convert("RGB").crop((round(x0 * F), round(y0 * F), round(x1 * F), round(y1 * F)))


def crop(a):
    r = region(a.x0, a.y0, a.x1, a.y1)
    hd_crop(r).save(a.out)
    print(f"region {r} (park px), {r[2] - r[0]} x {r[3] - r[1]} -> {a.out}")


def shift_of(ref, img):
    g = lambda a: (a @ np.array([0.299, 0.587, 0.114], np.float32))
    p = lambda a: (g(a) - ndimage.uniform_filter(g(a), 15)) * np.hanning(a.shape[0])[:, None] * np.hanning(a.shape[1])[None, :]
    A, B = np.fft.rfft2(p(ref)), np.fft.rfft2(p(img))
    R = A * np.conj(B)
    r = np.fft.irfft2(R / (np.abs(R) + 1e-6), s=ref.shape[:2])
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    return int(dy - ref.shape[0] if dy > ref.shape[0] // 2 else dy), int(dx - ref.shape[1] if dx > ref.shape[1] // 2 else dx)


def hipass_energy(img, where):
    g = img @ np.array([0.299, 0.587, 0.114], np.float32)
    return float(np.var((g - ndimage.gaussian_filter(g, 1.5))[where]))


def match_look(orig, edit, ring):
    """Make the edit look like the painting around it: soften it to the painting's sharpness (the edit comes back at
    up to 3x the painting's density and reads crisper) and match each channel's spread, both measured in the ring
    outside the mask where the edit redrew the same things the painting shows."""
    target = hipass_energy(orig, ring)
    best = (abs(np.log(hipass_energy(edit, ring) / target)), 0.0, edit)
    for sigma in (0.5, 0.8, 1.1, 1.5, 2.0, 2.6, 3.4):
        e = ndimage.gaussian_filter(edit, (sigma, sigma, 0))
        err = abs(np.log(hipass_energy(e, ring) / target))
        if err < best[0]:
            best = (err, sigma, e)
    edit = best[2]
    out = edit.copy()
    gains = []
    for c in range(3):
        lo_o, md_o, hi_o = np.percentile(orig[..., c][ring], (10, 50, 90))
        lo_e, md_e, hi_e = np.percentile(edit[..., c][ring], (10, 50, 90))
        k = float(np.clip((hi_o - lo_o) / max(hi_e - lo_e, 1), 0.7, 1.3))
        out[..., c] = md_o + (edit[..., c] - md_e) * k
        gains.append(round(k, 3))
    print(f"look matched: blur sigma {best[1]} HD px, contrast gains {gains}")
    return out


def paste(a):
    r = region(a.x0, a.y0, a.x1, a.y1)
    orig_im = hd_crop(r)
    ow, oh = orig_im.size
    orig = np.asarray(orig_im).astype(np.float32)
    edit = np.asarray(Image.open(a.edit).convert("RGB").resize((ow, oh), Image.LANCZOS)).astype(np.float32)
    q = 4
    dy, dx = shift_of(orig[::q, ::q], edit[::q, ::q])
    dy, dx = dy * q, dx * q
    if max(abs(dy), abs(dx)) > 40:
        print(f"warning: implausible shift ({dy}, {dx}) ignored")
        dy = dx = 0
    edit = ndimage.shift(edit, (dy, dx, 0), order=1, mode="nearest")

    if a.mask:
        m = np.asarray(Image.open(a.mask).convert("L").resize((ow, oh), Image.BILINEAR)) > 127
    else:
        polys = json.load(open(a.poly))
        mi = Image.new("L", (ow, oh), 0)
        d = ImageDraw.Draw(mi)
        for poly in polys:
            d.polygon([((x - r[0]) * F, (y - r[1]) * F) for x, y in poly], fill=255)
        m = np.asarray(mi) > 127
    if a.changed:
        # Keep only what the edit really changed inside the polygon/mask: blurred difference over a threshold, specks
        # dropped, holes filled. Follows an erased object's outline (cabins, arms) instead of a hand-drawn shape.
        diff = np.abs(ndimage.gaussian_filter(orig, (2 * F, 2 * F, 0)) - ndimage.gaussian_filter(edit, (2 * F, 2 * F, 0))).max(-1)
        ch = ndimage.binary_opening(diff > a.changed, iterations=round(2 * F))
        ch = ndimage.binary_fill_holes(ndimage.binary_closing(ch, iterations=round(6 * F)))
        if a.grow:  # grown before the cut, so the allowed area stays a hard limit
            ch = ndimage.binary_dilation(ch, iterations=round(a.grow * F))
        print(f"changed area: {ch[m].mean():.0%} of the allowed area")
        m = m & ch
    elif a.grow:
        m = ndimage.binary_dilation(m, iterations=round(a.grow * F))
    if not m.any():
        raise SystemExit("the mask is empty")

    # Colour match: the median difference in a ring outside the mask (beyond the feather), removed from the edit. The
    # median, because the edit often changes things just outside the mask too (what it erased spills over).
    feather = max(1.0, a.feather * F)
    near = ndimage.binary_dilation(m, iterations=round(feather))
    ring = ndimage.binary_dilation(m, iterations=round(feather + 10 * F)) & ~near
    if a.match and ring.any():
        edit = match_look(orig, edit, ring)
    if ring.any():
        off = np.median(orig[ring] - edit[ring], axis=0)
        edit = edit + off
        print(f"colour offset removed: {np.round(off, 1).tolist()}, shift ({dy}, {dx}) HD px")
    # The feather straddles the mask's edge: 50% on the outline, fully replaced feather/2 inside it.
    if a.feather:
        sd = ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)
        alpha = np.clip(0.5 + sd / feather, 0, 1).astype(np.float32)
        m = alpha > 0
    else:
        alpha = m.astype(np.float32)
    ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([np.clip(edit, 0, 255), alpha * 255])[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(a.out + ".webp", lossless=True, quality=100)
    rect = [round(float(v), 2) for v in (r[0] + x0 / F, r[1] + y0 / F, (x1 - x0) / F, (y1 - y0) / F)]
    json.dump({"rect": rect, "region": r, "source": os.path.relpath(a.edit, ROOT), "hd_px_per_park_px": F}, open(a.out + ".json", "w"))

    after = orig * (1 - alpha[..., None]) + edit * alpha[..., None]
    pad = round(30 * F)
    cy0, cy1, cx0, cx1 = max(0, y0 - pad), min(oh, y1 + pad), max(0, x0 - pad), min(ow, x1 + pad)
    before_c, after_c = orig[cy0:cy1, cx0:cx1].copy(), after[cy0:cy1, cx0:cx1].copy()
    edge = (ndimage.binary_dilation(m, iterations=2) & ~m)[cy0:cy1, cx0:cx1]
    for img in (before_c, after_c):
        img[edge] = (230, 30, 60)
    check = np.concatenate([before_c, np.full((before_c.shape[0], 8, 3), 255, np.float32), after_c], 1)
    Image.fromarray(np.clip(check, 0, 255).astype(np.uint8)).save(a.out + "_check.png")
    print(f"patch {a.out}.webp: rect {rect} (park px); check {a.out}_check.png")


def cut(a):
    """Front cut-out: the painting's own pixels inside polygons, as an RGBA overlay drawn over a moving part where
    something painted stands in front of it. --classmask (a PNG over --region, white = keep) limits it per pixel, e.g.
    to the lattice members only, so the moving part shows through the gaps."""
    polys = json.load(open(a.poly))
    xs = [x for p in polys for x, _ in p]
    ys = [y for p in polys for _, y in p]
    pad = a.feather
    r = [max(0, min(xs) - pad), max(0, min(ys) - pad), min(W, max(xs) + pad), min(H, max(ys) + pad)]
    im = hd_crop(r)
    ow, oh = im.size
    rgb = np.asarray(im).astype(np.float32)
    mi = Image.new("L", (ow, oh), 0)
    d = ImageDraw.Draw(mi)
    for poly in polys:
        d.polygon([((x - r[0]) * F, (y - r[1]) * F) for x, y in poly], fill=255)
    m = np.asarray(mi) > 127
    if a.feather:
        f = max(1.0, a.feather * F)
        sd = ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)
        alpha = np.clip(0.5 + sd / f, 0, 1).astype(np.float32)
    else:
        alpha = m.astype(np.float32)
    if a.classmask:
        cr = [float(v) for v in a.region.split(",")]
        cm = Image.open(a.classmask).convert("L")
        # Place the class mask (covering region cr in park px) onto this crop.
        sx, sy = cm.width / ((cr[2] - cr[0]) * F), cm.height / ((cr[3] - cr[1]) * F)
        box = ((r[0] - cr[0]) * F * sx, (r[1] - cr[1]) * F * sy, (r[2] - cr[0]) * F * sx, (r[3] - cr[1]) * F * sy)
        alpha = alpha * (np.asarray(cm.transform((ow, oh), Image.EXTENT, box, Image.BILINEAR)).astype(np.float32) / 255)
    keep = alpha > 0.004
    if not keep.any():
        raise SystemExit("nothing to cut")
    yy, xx = np.where(keep)
    y0, y1, x0, x1 = yy.min(), yy.max() + 1, xx.min(), xx.max() + 1
    rgba = np.dstack([rgb, alpha * 255])[y0:y1, x0:x1].astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(a.out + ".webp", lossless=True, quality=100)
    rect = [round(float(v), 2) for v in (r[0] + x0 / F, r[1] + y0 / F, (x1 - x0) / F, (y1 - y0) / F)]
    json.dump({"rect": rect, "source": "gen/park/world_v2_hd.png", "polygons": os.path.relpath(a.poly, ROOT), "hd_px_per_park_px": F}, open(a.out + ".json", "w"))
    print(f"cut-out {a.out}.webp: rect {rect} (park px)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("cut", help="the painting's pixels inside polygons, for drawing over a moving part")
    p.add_argument("poly"); p.add_argument("out")
    p.add_argument("--feather", type=float, default=1.0, help="park px")
    p.add_argument("--classmask", help="PNG over --region, white = keep this pixel")
    p.add_argument("--region", help="X0,Y0,X1,Y1 in park px that --classmask covers")
    p = sub.add_parser("crop")
    for k in ("x0", "y0", "x1", "y1"): p.add_argument(k, type=float)
    p.add_argument("out")
    p = sub.add_parser("paste")
    p.add_argument("edit")
    for k in ("x0", "y0", "x1", "y1"): p.add_argument(k, type=float)
    p.add_argument("out")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--mask"); g.add_argument("--poly")
    p.add_argument("--feather", type=float, default=6, help="park px")
    p.add_argument("--grow", type=float, default=0, help="grow the mask by this many park px")
    p.add_argument("--match", action="store_true", help="soften and match contrast to the painting around the mask")
    p.add_argument("--changed", type=float, default=0, help="keep only where the edit differs from the painting by more than this (levels, after a 2 px blur), inside the mask; use with --grow")
    a = ap.parse_args()
    {"crop": crop, "paste": paste, "cut": cut}[a.cmd](a)


if __name__ == "__main__":
    main()
