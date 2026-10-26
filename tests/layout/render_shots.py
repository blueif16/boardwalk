"""Overlay shots for tests/layout (run after build_layout.py, from the repo root):
uv run -q --with pillow --with numpy python -I tests/layout/render_shots.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BW = HERE.parent.parent
sys.path.insert(0, str(HERE))
from fitlib import en, apply_affine, TPS  # noqa: E402

L = json.load(open(HERE / "layout.json"))
SHOTS = HERE / "shots"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = lambda n, bold=True: ImageFont.truetype(FB if bold else FR, n)
GROUP_COL = {"kiddie": (230, 120, 20), "family": (110, 60, 140), "thrill": (20, 135, 120), "attraction": (215, 20, 85),
             "building": (90, 90, 90)}
OSM_COL = (25, 95, 210)
WARP_COL = (0, 150, 70)

fit = L["fit"]
cps = fit["control_points"]
G = np.array([c["ground"] for c in cps], float)
P = np.array([c["map"] for c in cps], float)
W = np.array([c["w"] for c in cps], float)
A = np.array(fit["global_affine"]["matrix_ground_to_pdf"])
LAM = fit["thin_plate_spline"]["lambda"]
tps = TPS(G, P, W, LAM)
tps_inv = TPS(P, G, W, LAM)
ITEMS = L["items"]

# ------------------------------------------------------------------ OSM context features (ground metres)
OSM = json.load(open(BW / "reference/map/osm_area.json"))["elements"]
ZONE = (-380, -130, 430, 200)


def inzone(pts):
    a = np.array(pts)
    c = a.mean(0)
    return ZONE[0] < c[0] < ZONE[2] and ZONE[1] < c[1] < ZONE[3]


features = {"building": [], "attraction": [], "street": [], "rail": [], "promenade": [], "beach": [], "water": []}
for el in OSM:
    t = el.get("tags") or {}
    geoms = []
    if el["type"] == "way" and el.get("geometry"):
        geoms = [el["geometry"]]
    elif el["type"] == "relation" and (t.get("natural") in ("beach", "water") or t.get("water")):
        geoms = [m["geometry"] for m in el.get("members", []) if m.get("geometry")]
    for g in geoms:
        pts = [en(p["lat"], p["lon"]) for p in g]
        if t.get("natural") == "beach" or t.get("natural") == "water" or t.get("water") or t.get("waterway") == "riverbank":
            k = "beach" if t.get("natural") == "beach" else "water"
            pts = [p for p in pts if ZONE[0] - 100 < p[0] < ZONE[2] + 100 and ZONE[1] - 60 < p[1] < ZONE[3]]
            if len(pts) > 1:
                features[k].append(pts)
            continue
        if not inzone(pts):
            continue
        if "attraction" in t or t.get("aerialway") or t.get("roller_coaster") or t.get("man_made") == "bridge":
            features["attraction"].append(pts)
        elif "building" in t or "building:part" in t:
            features["building"].append(pts)
        elif t.get("railway") == "rail":
            features["rail"].append(pts)
        elif t.get("name") == "Boardwalk":
            features["promenade"].append(pts)
        elif t.get("highway") in ("primary", "secondary", "tertiary", "residential", "unclassified"):
            features["street"].append(pts)
nodes = []
for el in OSM:
    t = el.get("tags") or {}
    if el["type"] == "node" and "attraction" in t:
        p = en(el["lat"], el["lon"])
        if inzone([p]):
            nodes.append((p, t.get("name", "?")))


def densify(pts, step=3.0):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b) / step))
        for i in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    return out


# ------------------------------------------------------------------ drawing helpers
MAP = Image.open(BW / "reference/map/boardwalk-map-2025-pdf.jpg").convert("RGB")


def faded(img, k=0.5):
    return Image.blend(img, Image.new("RGB", img.size, "white"), k)


class Canvas:
    def __init__(self, img, x0, y0, s):
        self.img, self.x0, self.y0, self.s = img, x0, y0, s
        self.d = ImageDraw.Draw(img, "RGBA")

    def P(self, p):
        return ((p[0] - self.x0) * self.s, (p[1] - self.y0) * self.s)

    def line(self, pts, col, w=1, closed=False):
        q = [self.P(p) for p in pts]
        if closed:
            q.append(q[0])
        if len(q) > 1:
            self.d.line(q, fill=col, width=w, joint="curve")

    def dot(self, p, r, fill, outline=None):
        x, y = self.P(p)
        self.d.ellipse((x - r, y - r, x + r, y + r), fill=fill, outline=outline, width=2)

    def arrow(self, a, b, col, w=2):
        (x0, y0), (x1, y1) = self.P(a), self.P(b)
        self.d.line([(x0, y0), (x1, y1)], fill=col, width=w)
        ang = math.atan2(y1 - y0, x1 - x0)
        for da in (2.6, -2.6):
            self.d.line([(x1, y1), (x1 + 8 * math.cos(ang + da), y1 + 8 * math.sin(ang + da))], fill=col, width=w)

    def text(self, p, s, col, size=12, bold=True, anchor="la", dx=0, dy=0):
        x, y = self.P(p)
        self.d.text((x + dx, y + dy), s, fill=col, font=font(size, bold), anchor=anchor, stroke_width=3, stroke_fill=(255, 255, 255))

    def badge(self, p, s, col, r=9, size=11):
        x, y = self.P(p)
        self.d.ellipse((x - r, y - r, x + r, y + r), fill=col, outline=(255, 255, 255), width=2)
        self.d.text((x, y), s, fill=(255, 255, 255), font=font(size), anchor="mm")


def draw_osm(cv, warp, col, width=1, alpha=200):
    c = col + (alpha,)
    for k, wdt in (("water", 1), ("beach", 2), ("street", 2), ("rail", 1), ("promenade", 2), ("building", width),
                   ("attraction", width + 1)):
        for pts in features[k]:
            q = warp(np.array(densify(pts)))
            cc = c if k not in ("beach", "water") else (60, 140, 220, 200)
            if k == "rail":
                cc = (120, 60, 20, 200)
            cv.line(q, cc, wdt)
    for p, name in nodes:
        q = warp(np.array([p]))[0]
        cv.dot(q, 3, col + (230,))


def label_items(cv, names=True, size=11, only=None):
    for o in ITEMS:
        if only and not only(o):
            continue
        b = o["map"]["base"]
        col = GROUP_COL[o["group"]]
        cv.dot(b, 4, col + (255,), (255, 255, 255, 255))
        tag = o["num"] or ""
        if names:
            short = o["name"].replace(" (one way)", "")
            cv.text(b, f"{tag} {short}".strip(), col, size, dx=6, dy=-6)
        elif tag:
            cv.text(b, tag, col, size, dx=5, dy=-14)


warp_aff = lambda q: apply_affine(A, q)
warp_tps = lambda q: tps(q)

# ------------------------------------------------------------------ 1. whole park: affine and TPS
X0, Y0, X1, Y1 = 20, 290, 1545, 870
S = 1.25
for name, warp, col, title in (
        ("overlay_affine.png", warp_aff, OSM_COL, "OSM (blue) through ONE global affine fit onto the official map; red arrows: where the affine puts each ride -> where the map draws it"),
        ("overlay_tps.png", warp_tps, WARP_COL, "OSM (green) through the thin-plate-spline warp fitted on the control points; dots: ride bases on the official map")):
    img = faded(MAP.crop((X0, Y0, X1, Y1)).resize((int((X1 - X0) * S), int((Y1 - Y0) * S)), Image.LANCZOS), 0.45)
    cv = Canvas(img, X0, Y0, S)
    draw_osm(cv, warp, col, 1)
    if warp is warp_aff:
        for c in cps:
            pa = apply_affine(A, np.array([c["ground"]]))[0]
            cv.arrow(pa, c["map"], (220, 30, 30, 230), 2)
    label_items(cv, names=False, size=12)
    for r, x in (("west | centre", 600), ("centre | east", 1150)):
        cv.line([(x, Y0), (x, Y1)], (0, 0, 0, 90), 1)
        cv.text((x, Y0 + 4), r, (60, 60, 60), 13, dx=4)
    st = fit["global_affine"]["residuals"] if warp is warp_aff else fit["thin_plate_spline"]["leave_one_out"]
    lab = "affine residual RMS" if warp is warp_aff else "TPS leave-one-out RMS"
    cv.d.rectangle((0, 0, img.width, 26), fill=(255, 255, 255, 230))
    cv.d.text((8, 5), title, fill=(30, 30, 30), font=font(14))
    cv.d.text((8, img.height - 22), f"{lab}: west {st['west']['rms_px']} px, centre {st['centre']['rms_px']} px, east {st['east']['rms_px']} px "
              f"(official-map px; ~2.1 px per metre along the strip)", fill=(30, 30, 30), font=font(14), stroke_width=3,
              stroke_fill=(255, 255, 255))
    img.save(SHOTS / name)

# ------------------------------------------------------------------ 2. regional zooms with names
ZOOMS = {"overlay_west.png": (40, 320, 660, 700), "overlay_centre.png": (600, 420, 1180, 780),
         "overlay_east.png": (1150, 380, 1545, 830)}
for name, (x0, y0, x1, y1) in ZOOMS.items():
    s = 2.4 if name != "overlay_east.png" else 3.0
    img = faded(MAP.crop((x0, y0, x1, y1)).resize((int((x1 - x0) * s), int((y1 - y0) * s)), Image.LANCZOS), 0.4)
    cv = Canvas(img, x0, y0, s)
    draw_osm(cv, warp_tps, WARP_COL, 2, 210)
    for o in ITEMS:
        if o["map"].get("outline"):
            cv.line(o["map"]["outline"], GROUP_COL[o["group"]] + (200,), 2, closed=True)
        mk = o["map"].get("marker")
        if mk and not isinstance(mk[0], list):
            cv.line([mk, o["map"]["base"]], GROUP_COL[o["group"]] + (160,), 1)
        if o["map"].get("path"):
            cv.line(o["map"]["path"], GROUP_COL[o["group"]] + (200,), 2)
    for c in cps:
        pa = apply_affine(A, np.array([c["ground"]]))[0]
        cv.arrow(pa, c["map"], (220, 30, 30, 170), 1)
    label_items(cv, names=True, size=13)
    cv.d.rectangle((0, 0, img.width, 24), fill=(255, 255, 255, 230))
    cv.d.text((8, 4), "dot = ride base (official map); coloured outline = drawn silhouette; green = OSM through the TPS warp; "
              "thin red arrow = global-affine error", fill=(30, 30, 30), font=font(13))
    img.save(SHOTS / name)

# ------------------------------------------------------------------ 3. OSM plan with the map's rides carried back
strip = math.radians(18.1)
rot = np.array([[math.cos(-strip), -math.sin(-strip)], [math.sin(-strip), math.cos(-strip)]])
SC = 2.4
gx0, gy0, gx1, gy1 = -360, -110, 420, 190
corners = np.array([[gx0, gy0], [gx1, gy0], [gx0, gy1], [gx1, gy1]]) @ rot.T
cx0, cy0 = corners.min(0)
cx1, cy1 = corners.max(0)
Wp, Hp = int((cx1 - cx0) * SC), int((cy1 - cy0) * SC)


def gp(q):
    q = np.atleast_2d(q) @ rot.T
    return np.stack([(q[:, 0] - cx0) * SC, (cy1 - q[:, 1]) * SC], 1)


img = Image.new("RGB", (Wp, Hp), (246, 243, 236))
cv = Canvas(img, 0, 0, 1)
for k, col, wdt in (("water", (120, 180, 225), 2), ("beach", (220, 180, 120), 3), ("street", (170, 165, 155), 6),
                    ("rail", (110, 70, 40), 2), ("promenade", (200, 170, 140), 3), ("building", (140, 130, 115), 1),
                    ("attraction", (200, 70, 50), 2)):
    for pts in features[k]:
        cv.line(gp(np.array(pts)), col + (255,), wdt)
for p, nm in nodes:
    q = gp(np.array(p))[0]
    cv.dot(q, 3, (200, 70, 50, 255))
for o in ITEMS:
    col = GROUP_COL[o["group"]]
    est = tps_inv(np.array([o["map"]["base"]]))[0]
    if o["osm"]:
        g = np.array(o["osm"]["ground"])
        cv.arrow(gp(g)[0], gp(est)[0], (220, 30, 30, 160), 1)
        cv.dot(gp(g)[0], 5, col + (255,), (255, 255, 255, 255))
        anchor = gp(g)[0]
    else:
        cv.dot(gp(est)[0], 5, (255, 255, 255, 255), col + (255,))
        anchor = gp(est)[0]
    cv.text(anchor, f"{o['num'] or ''} {o['name'].replace(' (one way)', '')}".strip(), col, 12, dx=6, dy=-7)
cv.d.rectangle((0, 0, Wp, 26), fill=(255, 255, 255, 230))
cv.d.text((8, 5), "OSM plan, rotated 18.1 deg so the promenade runs left-right (north points up, 18 deg to the right). Filled dot: OSM position; hollow: not in OSM, "
          "placed by the inverse warp from the official map; red arrow: OSM -> where the official map's position lands", fill=(30, 30, 30),
          font=font(13))
cv.d.line([(20, Hp - 20), (20 + 100 * SC, Hp - 20)], fill=(30, 30, 30), width=5)
cv.d.text((28 + 100 * SC, Hp - 30), "100 m", fill=(30, 30, 30), font=font(14))
img.save(SHOTS / "osm_plan_overlay.png")

# ------------------------------------------------------------------ 4. slices
sl = L["slices"]
X0, Y0, X1, Y1 = 0, 280, 1565, 883
S = 1.0
img = faded(MAP.crop((X0, Y0, X1, Y1)), 0.35)
cv = Canvas(img, X0, Y0, S)
cols = [(214, 40, 40), (30, 120, 220), (20, 150, 60), (200, 120, 0)]
for s_, col in zip(sl["slices"], cols):
    x0, y0, x1, y1 = s_["rect"]
    cv.d.rectangle((x0 - X0, y0 - Y0, x1 - X0, y1 - Y0), outline=col + (255,), width=3)
    cv.text((x0, y0), f"{s_['id']}  {s_['size'][0]}x{s_['size'][1]}" + ("  (existing stage)" if s_.get("existing") else ""), col, 14, dx=6, dy=4)
for ov in sl["overlaps"]:
    x0, x1 = ov["x"]
    y0, y1 = ov["y"]
    cv.d.rectangle((x0 - X0, y0 - Y0, x1 - X0, y1 - Y0), fill=(40, 40, 40, 28))
    cv.text((x0 + 4, y1 - 18), f"overlap {ov['width_px']} px", (40, 40, 40), 12)
    for a, b in ov["free_vertical_corridors"]:
        cv.d.rectangle((a - X0, y0 - Y0, b - X0, y1 - Y0), fill=(20, 160, 60, 50))
for o in ITEMS:
    b = o["map"]["base"]
    cv.dot(b, 3, GROUP_COL[o["group"]] + (255,))
pw, ph = sl["panorama"]["size_stage_px"]
cv.d.rectangle((0, 0, img.width, 26), fill=(255, 255, 255, 230))
cv.d.text((8, 5), f"Slices of the official map at the stage's scale (x2.56). Panorama {pw} x {ph} stage px from pdf {sl['panorama']['origin_pdf']} "
          f"to (1555, 830). Grey: overlaps (225 pdf px = 576 stage px each); green: vertical corridors with no ride.", fill=(30, 30, 30), font=font(13))
img.save(SHOTS / "slices.png")

# ------------------------------------------------------------------ 5. the existing stage against the map
reg = L["stage_registration"]
st = Image.open(BW / "base/stage.png").convert("RGB")
img = faded(st, 0.3)
cv = Canvas(img, 0, 0, 1)
mp = MAP.crop((780, 430, 1380, 830)).resize((1536, 1024), Image.LANCZOS)
edges = np.asarray(mp.convert("L").filter(__import__("PIL.ImageFilter", fromlist=["FIND_EDGES"]).FIND_EDGES)) > 70
ov = np.zeros((1024, 1536, 4), np.uint8)
ov[edges] = (220, 30, 60, 90)
img.paste(Image.fromarray(ov, "RGBA"), (0, 0), Image.fromarray(ov, "RGBA"))
cv = Canvas(img, 0, 0, 1)
for l in reg["landmarks"]:
    pc = l["crop_prediction"]
    ps = l["stage"]
    col = {"structure": (30, 110, 220), "wall": (120, 60, 20), "platform": (215, 20, 85)}[l["kind"]]
    cv.arrow(pc, ps, col + (255,), 3)
    cv.dot(pc, 5, (255, 255, 255, 255), col + (255,))
    cv.text(ps, f"{l['id']} {l['offset_pdf_px'][0]:+.0f},{l['offset_pdf_px'][1]:+.0f} map px", col, 15, dx=8, dy=4)
for it in reg["items_on_stage"]:
    cv.dot(it["crop_px"], 4, (60, 60, 60, 255))
    if it["num"]:
        cv.text(it["crop_px"], it["num"], (60, 60, 60), 14, dx=5, dy=-16)
cv.d.rectangle((0, 0, img.width, 30), fill=(255, 255, 255, 230))
cv.d.text((8, 6), "base/stage.png with the official map's edges (red). Arrow: where the plain crop transform puts a map feature -> where the "
          "stage painted it. Grey dots: map ride bases by crop transform.", fill=(30, 30, 30), font=font(15))
img.save(SHOTS / "stage_registration.png")
print("shots written:", sorted(p.name for p in SHOTS.glob("*.png")))
