"""Build tests/layout/layout.json and the overlay shots.

Run from the repo root:  uv run -q --with pillow --with numpy --with scipy python -I tests/layout/build_layout.py

Frames:
- pdf:    pixels of reference/map/boardwalk-map-2025-pdf.jpg (1565 x 883), origin top-left, y down.
- ground: metres on a local tangent plane at (LAT0, LON0); E east, N north.
- stage:  base/stage.png pixels; the existing slice is pdf crop (780, 430, 1380, 830) scaled by 2.56.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
BW = HERE.parent.parent
sys.path.insert(0, str(HERE))
from layout_data import ITEMS, STREETS, EXTRA, STAGE_LANDMARKS  # noqa: E402
from fitlib import en, ll, fit_affine, apply_affine, TPS, LAT0, LON0, KX, KY  # noqa: E402

STAGE_SCALE = 2.56
WEIGHT = {"high": 1.0, "medium": 0.6, "low": 0.3}
SHOTS = HERE / "shots"
SHOTS.mkdir(exist_ok=True)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


# ------------------------------------------------------------------ OSM
OSM = json.load(open(BW / "reference/map/osm_area.json"))["elements"]
BY = {}
for el in OSM:
    BY[el["type"][0] + str(el["id"])] = el
NODES = {}
for el in OSM:
    if el["type"] == "way" and el.get("geometry"):
        for nid, p in zip(el.get("nodes", []), el["geometry"]):
            NODES[nid] = p
    if el["type"] == "node":
        NODES[el["id"]] = el


def osm_points(ref):
    el = BY[ref]
    if el["type"] == "node":
        return [(el["lat"], el["lon"])]
    return [(p["lat"], p["lon"]) for p in el.get("geometry") or []]


def poly_centroid(pts):
    """Area centroid of a closed ring in ground metres; falls back to the vertex mean."""
    xy = np.array(pts, float)
    if len(xy) >= 4 and np.allclose(xy[0], xy[-1]):
        x, y = xy[:-1, 0], xy[:-1, 1]
        x1, y1 = np.roll(x, -1), np.roll(y, -1)
        cross = x * y1 - x1 * y
        a = cross.sum() / 2
        if abs(a) > 1e-6:
            return ((x + x1) * cross).sum() / (6 * a), ((y + y1) * cross).sum() / (6 * a)
    return tuple(xy.mean(0))


def osm_info(ref, point=None):
    el = BY[ref]
    pts = osm_points(ref)
    g = [en(*p) for p in pts]
    if point == "west_end":
        c = min(g, key=lambda q: q[0])
    else:
        c = poly_centroid(g)
    lat, lon = ll(*c)
    closed = len(pts) >= 4 and pts[0] == pts[-1]
    out = {"ref": ref, "url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
           "name": (el.get("tags") or {}).get("name"), "lat": round(lat, 7), "lon": round(lon, 7),
           "ground": [round(c[0], 1), round(c[1], 1)]}
    if el["type"] == "way":
        out["footprint" if closed else "line"] = [[round(a, 7), round(b, 7)] for a, b in pts]
        bb = np.array(g)
        out["size_m"] = [round(float(np.ptp(bb[:, 0])), 1), round(float(np.ptp(bb[:, 1])), 1)]
    tags = el.get("tags") or {}
    out["tags"] = {k: v for k, v in tags.items() if k in ("attraction", "building", "building:part", "leisure", "aerialway",
                                                            "man_made", "roller_coaster", "layer", "level", "amenity")}
    return out


# ------------------------------------------------------------------ marker refinement on the map
MAP_IMG = Image.open(BW / "reference/map/boardwalk-map-2025-pdf.jpg").convert("RGB")
MAP = np.asarray(MAP_IMG).astype(float)
COL = {"kiddie": (232, 136, 48), "family": (115, 70, 135), "thrill": (35, 148, 132), "attraction": (222, 20, 85)}


def refine_marker(xy, group):
    if group not in COL:
        return xy, False
    x, y = int(round(xy[0])), int(round(xy[1]))
    r = 11
    win = MAP[y - r:y + r + 1, x - r:x + r + 1]
    mask = np.sqrt(((win - np.array(COL[group])) ** 2).sum(-1)) < 70
    lab, n = ndi.label(mask)
    best = None
    for i in range(1, n + 1):
        filled = ndi.binary_fill_holes(lab == i)
        area = filled.sum()
        if area < 30:
            continue
        cy, cx = ndi.center_of_mass(filled)
        d = math.hypot(cx - r, cy - r)
        if best is None or d < best[0]:
            best = (d, cx + x - r, cy + y - r, area)
    if best and best[0] <= 6:
        return (round(best[1], 1), round(best[2], 1)), True
    return xy, False


# ------------------------------------------------------------------ fitting helpers
def rms(v):
    v = np.asarray(v, float)
    return float(np.sqrt((v ** 2).sum(-1).mean())) if len(v) else None


def region_of(x):
    return "west" if x < 600 else ("centre" if x < 1150 else "east")


# ------------------------------------------------------------------ strip direction from OSM
bw = osm_points("w566029386")  # the Boardwalk promenade (pedestrian way)
g = np.array([en(*p) for p in bw])
c = g - g.mean(0)
_, _, vt = np.linalg.svd(c)
d = vt[0] if vt[0][0] > 0 else -vt[0]
STRIP_DEG = math.degrees(math.atan2(d[1], d[0]))
STRIP_DIR = np.array([math.cos(math.radians(STRIP_DEG)), math.sin(math.radians(STRIP_DEG))])
STRIP_N = np.array([-STRIP_DIR[1], STRIP_DIR[0]])  # inland normal

# ------------------------------------------------------------------ items
items_out = []
gcps = []  # dict(id, name, map, ground, w, kind)
for it in ITEMS:
    o = {k: it[k] for k in ("id", "num", "name", "group", "kind", "model", "motion") if k in it}
    if it.get("motion_note"):
        o["motion_note"] = it["motion_note"]
    m = {"base": list(it["base"]), "conf": it["conf"]}
    if it.get("marker") is not None:
        mk = it["marker"]
        if isinstance(mk, list):
            m["marker"] = [list(refine_marker(p, it["group"])[0]) for p in mk]
        else:
            ref, ok = refine_marker(mk, it["group"])
            m["marker"] = list(ref)
            m["marker_refined"] = ok
    if it.get("outline"):
        m["outline"] = [list(p) for p in it["outline"]]
    if it.get("path"):
        m["path"] = [list(p) for p in it["path"]]
    m["png_1400"] = [round(it["base"][0] * 1400 / 1565, 1), round(it["base"][1] * 790 / 883, 1)]
    o["map"] = m
    o["region"] = region_of(it["base"][0])
    if it.get("osm"):
        o["osm"] = osm_info(it["osm"][0], it.get("osm_point"))
        if len(it["osm"]) > 1:
            o["osm"]["related"] = [osm_info(r) for r in it["osm"][1:]]
    else:
        o["osm"] = None
    if it.get("osm_note"):
        o["osm_note"] = it["osm_note"]
    items_out.append(o)
    if o["osm"] and it.get("gcp", True):
        gcps.append(dict(id=it["id"], name=it["name"], map=it["base"], ground=o["osm"]["ground"],
                         w=WEIGHT[it["conf"]], kind="ride/building"))

for s in STREETS:
    if "osm_node" in s:
        p = NODES[s["osm_node"]]
        gxy = np.array(en(p["lat"], p["lon"])) + 7.0 * STRIP_N
    else:
        gxy = np.array(s["osm_en"], float)
    gcps.append(dict(id=s["id"], name=s["name"], map=s["map"], ground=[round(float(v), 1) for v in gxy],
                     w=WEIGHT[s["conf"]], kind="street"))
for s in EXTRA:
    gcps.append(dict(id=s["id"], name=s["name"], map=s["map"], ground=list(s["osm_en"]), w=WEIGHT[s["conf"]], kind="structure"))

G = np.array([q["ground"] for q in gcps], float)
P = np.array([q["map"] for q in gcps], float)
W = np.array([q["w"] for q in gcps], float)
REG = np.array([region_of(q["map"][0]) for q in gcps])

# ------------------------------------------------------------------ global fits
A = fit_affine(G, P, W)
res_aff = P - apply_affine(A, G)

# The map's plan against the stage camera: px = T + s * (u * a0 + k * v * b0), where u, v are metres along the strip and
# inland, a0 / b0 the screen directions the stage camera (yaw 24.1 deg from the strip, pitch 28.7 deg) gives them, s the
# scale and k how much the map stretches the park's depth beyond that camera.
YAW_S, PITCH_S = math.radians(24.1), math.radians(28.7)
A0 = np.array([math.cos(YAW_S), math.sin(YAW_S) * math.sin(PITCH_S)])
B0 = np.array([math.sin(YAW_S), -math.cos(YAW_S) * math.sin(PITCH_S)])


def uv(ground):
    ground = np.atleast_2d(np.asarray(ground, float))
    return ground @ STRIP_DIR, ground @ STRIP_N


def fit_stage_cam(ground, px, w):
    u, v = uv(ground)
    X = np.zeros((2 * len(u), 4))
    X[0::2, 0] = 1
    X[1::2, 1] = 1
    X[0::2, 2], X[1::2, 2] = u * A0[0], u * A0[1]
    X[0::2, 3], X[1::2, 3] = v * B0[0], v * B0[1]
    sw = np.repeat(np.sqrt(w), 2)
    q, *_ = np.linalg.lstsq(X * sw[:, None], np.asarray(px, float).ravel() * sw, rcond=None)
    pred = (X @ q).reshape(-1, 2)
    return q, pred


qD, predD = fit_stage_cam(G, P, W)
res_D = P - predD
cam_stage_model = {"model": "px = T + s * (u * a0 + k * v * b0); a0, b0 from the stage camera (yaw 24.1 from strip, pitch 28.7)",
                   "scale_px_per_m": round(float(qD[2]), 3), "depth_stretch_k": round(float(qD[3] / qD[2]), 2),
                   "T": [round(float(qD[0]), 1), round(float(qD[1]), 1)]}


def describe_affine(M):
    a, b = M[:, :2] @ STRIP_DIR, M[:, :2] @ STRIP_N
    along, inland = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return {"along_strip_px_per_m": round(along, 2), "along_strip_screen_slope": round(float(a[1] / a[0]), 3),
            "inland_px_per_m": round(inland, 2), "inland_screen_angle_deg": round(math.degrees(math.atan2(-b[1], b[0])), 1),
            "inland_over_along": round(inland / along, 2)}


STAGE_EXPECT = {"along_strip_screen_slope": round(A0[1] / A0[0], 3),
                "inland_screen_angle_deg": round(math.degrees(math.atan2(-B0[1], B0[0])), 1),
                "inland_over_along": round(float(np.linalg.norm(B0) / np.linalg.norm(A0)), 2)}
cam = describe_affine(A)


def loo_affine():
    out = np.zeros_like(P)
    for i in range(len(P)):
        k = np.arange(len(P)) != i
        out[i] = P[i] - apply_affine(fit_affine(G[k], P[k], W[k]), G[i:i + 1])[0]
    return out


def loo_tps(lam):
    out = np.zeros_like(P)
    for i in range(len(P)):
        k = np.arange(len(P)) != i
        out[i] = P[i] - TPS(G[k], P[k], W[k], lam)(G[i:i + 1])[0]
    return out


res_aff_loo = loo_affine()
lams = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]
loo_by_lam = {lam: rms(loo_tps(lam) * np.sqrt(W)[:, None]) for lam in lams}
LAM = min(loo_by_lam, key=loo_by_lam.get)
tps_fwd = TPS(G, P, W, LAM)
tps_inv = TPS(P, G, W, LAM)
res_tps_loo = loo_tps(LAM)


def region_stats(res):
    out = {}
    for r in ("west", "centre", "east"):
        k = REG == r
        v = res[k]
        out[r] = {"n": int(k.sum()), "rms_px": round(rms(v), 1), "mean_px": [round(float(a), 1) for a in v.mean(0)],
                  "max_px": round(float(np.linalg.norm(v, axis=1).max()), 1)}
    out["all"] = {"n": len(res), "rms_px": round(rms(res), 1)}
    return out


# per-region affine: local scale along the strip and across it
local = {}
for r in ("west", "centre", "east"):
    k = REG == r
    M = fit_affine(G[k], P[k], W[k])
    along = M[:, :2] @ STRIP_DIR
    across = M[:, :2] @ STRIP_N
    qr, pr = fit_stage_cam(G[k], P[k], W[k])
    local[r] = {"n": int(k.sum()), **describe_affine(M), "rms_px": round(rms(P[k] - apply_affine(M, G[k])), 1),
                "stage_camera_model": {"scale_px_per_m": round(float(qr[2]), 2), "depth_stretch_k": round(float(qr[3] / qr[2]), 2),
                                       "rms_px": round(rms(P[k] - pr), 1)},
                "affine": np.round(M, 4).tolist()}

# along-strip spacing between anchors in order (map px vs metres)
chain_ids = ["pirate_ship", "double_shot", "lighthouse_lift_off", "looff_carousel", "haunted_castle", "fireball", "sea_swings",
             "funland_arcade", "rock_o_plane", "tsunami"]
gid = {q["id"]: q for q in gcps}
chain = []
for a, b in zip(chain_ids, chain_ids[1:]):
    ga, gb = np.array(gid[a]["ground"]), np.array(gid[b]["ground"])
    ma, mb = np.array(gid[a]["map"]), np.array(gid[b]["map"])
    dm = float((gb - ga) @ STRIP_DIR)
    chain.append({"from": a, "to": b, "metres_along_strip": round(dm, 1), "map_dx_px": round(float(mb[0] - ma[0]), 1),
                  "px_per_m": round(float(mb[0] - ma[0]) / dm, 2) if abs(dm) > 1 else None})
street_ids = ["cliff_st", "riverside_ave", "raymond_st", "leibrandt_ave", "park_pl"]
street_chain = []
for a, b in zip(street_ids, street_ids[1:]):
    ga, gb = np.array(gid[a]["ground"]), np.array(gid[b]["ground"])
    dm = float((gb - ga) @ STRIP_DIR)
    dx = gid[b]["map"][0] - gid[a]["map"][0]
    street_chain.append({"from": a, "to": b, "metres_along_strip": round(dm, 1), "map_dx_px": round(dx, 1),
                         "px_per_m": round(dx / dm, 2)})

# residuals per GCP
gcp_out = []
for i, q in enumerate(gcps):
    gcp_out.append({**q, "region": REG[i], "affine_residual_px": [round(float(v), 1) for v in res_aff[i]],
                    "affine_loo_residual_px": [round(float(v), 1) for v in res_aff_loo[i]],
                    "tps_loo_residual_px": [round(float(v), 1) for v in res_tps_loo[i]]})

# predicted map positions for every item with OSM, estimated ground for items without
for o in items_out:
    b = np.array(o["map"]["base"], float)
    if o["osm"]:
        gpt = np.array(o["osm"]["ground"], float)
        pa = apply_affine(A, gpt[None])[0]
        pt = tps_fwd(gpt[None])[0]
        o["fit"] = {"affine_px": [round(float(v), 1) for v in pa], "affine_residual_px": [round(float(v), 1) for v in b - pa],
                    "tps_px": [round(float(v), 1) for v in pt]}
    else:
        ge = tps_inv(b[None])[0]
        lat, lon = ll(*ge)
        o["ground_estimated"] = {"ground": [round(float(v), 1) for v in ge], "lat": round(lat, 7), "lon": round(lon, 7),
                                 "method": "inverse thin-plate spline (map px -> metres) through the control points; +-10-20 m"}

# ------------------------------------------------------------------ slices
SL = [
    {"id": "S0_west", "rect": [30, 305, 630, 705], "size": [1536, 1024],
     "covers": "Aloha Terrace, Casino Arcade, Cocoanut Grove, Neptune's Kingdom, Boardwalk Bowl, Pirate Ship, Double Shot, Typhoon"},
    {"id": "S1_entrance", "rect": [405, 355, 1005, 755], "size": [1536, 1024],
     "covers": "main entrance plaza, Shockwave, Undertow, Wave Rider, kiddie rides, Looff Carousel, Haunted Castle, Dipper west end"},
    {"id": "S2_dipper", "rect": [780, 430, 1380, 830], "size": [1536, 1024], "existing": "base/stage.png",
     "covers": "Giant Dipper, Fireball, Dream Wheel, Sea Swings, Funland Arcade, Logger's Revenge mill house"},
    {"id": "S3_river", "rect": [1155, 405, 1555, 805], "size": [1024, 1024],
     "covers": "Logger's Revenge, east-end rides, kiddie rides, Tsunami, the river and the trestle"},
]
PAN_ORIGIN = (30, 305)
pan_w = round((1555 - PAN_ORIGIN[0]) * STAGE_SCALE)
pan_h = round((830 - PAN_ORIGIN[1]) * STAGE_SCALE)


def bbox_of(o):
    pts = o["map"].get("outline")
    if pts:
        a = np.array(pts)
        return a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()
    x, y = o["map"]["base"]
    return x - 12, y - 18, x + 12, y + 6


for s in SL:
    x0, y0, x1, y1 = s["rect"]
    s["scale"] = STAGE_SCALE
    s["panorama_offset"] = [round((x0 - PAN_ORIGIN[0]) * STAGE_SCALE), round((y0 - PAN_ORIGIN[1]) * STAGE_SCALE)]
    s["to_slice_px"] = f"slice = (pdf - [{x0}, {y0}]) * {STAGE_SCALE}"
    inside, cut = [], []
    for o in items_out:
        bx0, by0, bx1, by1 = bbox_of(o)
        bx, by = o["map"]["base"]
        if x0 <= bx < x1 and y0 <= by < y1:
            inside.append(o["id"])
        if (bx0 < x0 < bx1 or bx0 < x1 < bx1 or by0 < y0 < by1 or by0 < y1 < by1) and not (bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1):
            cut.append(o["id"])
    s["items"] = inside
    s["items_cut_by_edge"] = cut
overlaps = []
for a, b in zip(SL, SL[1:]):
    ox0, ox1 = b["rect"][0], a["rect"][2]
    oy0, oy1 = max(a["rect"][1], b["rect"][1]), min(a["rect"][3], b["rect"][3])
    # vertical corridors in the overlap free of every item's box
    busy = np.zeros(int(ox1 - ox0), bool)
    for o in items_out:
        bx0, by0, bx1, by1 = bbox_of(o)
        if by1 < oy0 or by0 > oy1:
            continue
        lo, hi = int(max(ox0, bx0) - ox0), int(min(ox1, bx1) - ox0)
        if hi > lo:
            busy[lo:hi] = True
    free, start = [], None
    for i, v in enumerate(list(busy) + [True]):
        if not v and start is None:
            start = i
        if v and start is not None:
            if i - start >= 6:
                free.append([ox0 + start, ox0 + i])
            start = None
    overlaps.append({"between": [a["id"], b["id"]], "x": [ox0, ox1], "y": [oy0, oy1], "width_px": ox1 - ox0,
                     "width_stage_px": round((ox1 - ox0) * STAGE_SCALE),
                     "y_offset_px": b["rect"][1] - a["rect"][1], "free_vertical_corridors": free})

# ------------------------------------------------------------------ the existing stage against the map
LM = STAGE_LANDMARKS
lm_map = np.array([l["map"] for l in LM], float)
lm_stage = np.array([l["stage"] for l in LM], float)
crop_pred = (lm_map - [780, 430]) * STAGE_SCALE
crop_res = lm_stage - crop_pred
struct = np.array([l["kind"] != "platform" for l in LM])
A_stage = fit_affine(lm_map[struct], lm_stage[struct])
aff_res = lm_stage - apply_affine(A_stage, lm_map)
stage_reg = {
    "crop_transform": "stage = (pdf - [780, 430]) * 2.56",
    "landmarks": [{**l, "crop_prediction": [round(float(v)) for v in crop_pred[i]],
                   "offset_stage_px": [round(float(v)) for v in crop_res[i]],
                   "offset_pdf_px": [round(float(v) / STAGE_SCALE, 1) for v in crop_res[i]],
                   "after_structure_affine_stage_px": [round(float(v)) for v in aff_res[i]]} for i, l in enumerate(LM)],
    "structure_affine_pdf_to_stage": np.round(A_stage, 4).tolist(),
    "rms_crop_stage_px": {k: round(rms(crop_res[[l['kind'] == k for l in LM]]), 1) for k in ("structure", "wall", "platform")},
    "rms_after_affine_stage_px": {k: round(rms(aff_res[[l['kind'] == k for l in LM]]), 1) for k in ("structure", "wall", "platform")},
}
# map -> stage TPS through every landmark: carries layout positions onto the painted stage
tps_stage = TPS(lm_map, lm_stage, None, 0.002)
stage_items = []
x0, y0, x1, y1 = SL[2]["rect"]
for o in items_out:
    bx, by = o["map"]["base"]
    if x0 - 20 <= bx <= x1 + 20 and y0 - 20 <= by <= y1 + 20:
        crop = ((np.array([bx, by]) - [780, 430]) * STAGE_SCALE).round().tolist()
        reg = tps_stage(np.array([[bx, by]]))[0].round().tolist()
        stage_items.append({"id": o["id"], "num": o["num"], "name": o["name"], "group": o["group"], "kind": o["kind"],
                            "motion": o["motion"], "crop_px": crop,
                            "registered_px": reg})

# ------------------------------------------------------------------ write layout.json
layout = {
    "about": "Layout of the whole Santa Cruz Beach Boardwalk: every ride and attraction in the 2025 official map legend plus the key "
             "buildings, placed on the official map (pdf px) and on OpenStreetMap (lat/lon, ground metres), with the fitted "
             "mapping between them, its distortion, and the proposed slices for the painted stage. Built by tests/layout/build_layout.py "
             "from tests/layout/layout_data.py.",
    "sources": {
        "map": "reference/map/boardwalk-map-2025-pdf.jpg (1565 x 883); png_1400 = same point on boardwalk-map-2025.png (1400 x 790)",
        "osm": "reference/map/osm_area.json (Overpass, bbox 36.9612,-122.0228,36.9670,-122.0112), (c) OpenStreetMap contributors, ODbL",
        "kinds": "official legend + coasterpedia.net/wiki/Santa_Cruz_Beach_Boardwalk + Amusement Today Aug 2017 (Shockwave, Typhoon)",
    },
    "frames": {
        "pdf": "official map pixels, origin top-left, y down",
        "ground": f"metres on a tangent plane at lat {LAT0}, lon {LON0}: E = (lon - {LON0}) * {KX:.1f}, N = (lat - {LAT0}) * {KY}",
        "strip": f"the promenade (OSM w566029386) runs {STRIP_DEG:.1f} deg north of east; strip_dir = {np.round(STRIP_DIR, 4).tolist()}",
        "stage": "base/stage.png px = (pdf - slice.rect[0:2]) * 2.56 before registration",
    },
    "legend_count": {"kiddie": 9, "family": 19, "thrill": 11, "rides": 39, "attractions": 5,
                     "note": "the 2025 legend numbers rides 1-39 (39 rides, not 38); the 2026 map adds 40 Vertigo 360 (Zamperla frisbee)"},
    "items": items_out,
    "osm_unmatched": [
        {"ref": r, **{k: v for k, v in osm_info(r).items() if k in ("name", "lat", "lon", "ground")},
         "note": n} for r, n in [
            ("n1380995282", "Cliff Hanger: retired; sits between Funland and Riptide where the map draws Surge"),
            ("n1380995284", "Climb 'N Conquer: retired"),
            ("n1380995297", "Ferris Wheel: an older wheel next to Rock-O-Plane, not the 2024 Dream Wheel"),
            ("n1380995312", "Red Baron: retired kiddie ride; the map has Bulgy / Beach Swing / Boardwalk Racers here"),
            ("n1380995321", "Rugged Buggies: retired; the map's Bouncin' Buggies is at the west end"),
            ("w881447633", "Kiddie Cruzers: retired kiddie ride next to Sea Swings"),
            ("n5060865213", "unnamed amusement_ride node next to Rock-O-Plane"),
        ]],
    "fit": {
        "control_points": gcp_out,
        "weights": WEIGHT,
        "global_affine": {"matrix_ground_to_pdf": np.round(A, 5).tolist(), "shape": cam,
                          "residuals": region_stats(res_aff), "leave_one_out": region_stats(res_aff_loo)},
        "stage_camera_model": {**cam_stage_model, "residuals": region_stats(res_D)},
        "stage_camera_expects": STAGE_EXPECT,
        "per_region_affine": local,
        "along_strip_spacing_rides": chain,
        "along_strip_spacing_streets": street_chain,
        "thin_plate_spline": {"lambda": LAM, "loo_weighted_rms_by_lambda": {str(k): round(v, 1) for k, v in loo_by_lam.items()},
                              "leave_one_out": region_stats(res_tps_loo),
                              "note": "use for carrying OSM geometry onto the map and back; the leave-one-out error is the honest accuracy"},
        "stage_camera": {"yawDeg": 24.1, "pitchDeg": 28.7, "note": "base/stage.json, measured on the redrawn slice; yaw is from the strip"},
    },
    "slices": {
        "slices": SL,
        "overlaps": overlaps,
        "panorama": {"origin_pdf": list(PAN_ORIGIN), "size_stage_px": [pan_w, pan_h], "scale": STAGE_SCALE,
                     "to_panorama_px": f"pano = (pdf - {list(PAN_ORIGIN)}) * {STAGE_SCALE}",
                     "note": "slice origins sit on a 25 pdf px grid from the panorama origin, so every slice offset is a whole multiple of 64 stage px"},
        "seam_hints": [
            {"between": ["S0_west", "S1_entrance"], "x_pdf": 470,
             "why": "the main-entrance plaza between Double Shot / Typhoon (x <= 462) and Shockwave (x >= 478); no ride-free vertical corridor exists, so let a min-cut seam wander +-30 px"},
            {"between": ["S1_entrance", "S2_dipper"], "x_pdf": 810,
             "why": "the only ride-free corridor (792-830): between the Haunted Castle and the Giant Dipper's west loop, down Raymond Street"},
            {"between": ["S2_dipper", "S3_river"], "x_pdf": 1320,
             "why": "between the mill house / Dipper east end (x <= 1326) and Ghost Blasters / Rock-O-Plane (x >= 1325); cutting through the Dipper lattice or the flume chute shows, so search a min-cut path +-40 px around it"},
        ],
        "procedure": [
            "Same camera by construction: every slice is a crop of the same official map at the same 2.56 scale, redrawn with the same style frames and prompt template as base/stage.png (add stage.png itself as a style reference).",
            "Grow outward from the existing S2: S1 then S0 to the west, S3 to the east, one at a time.",
            "Input for a new slice: the official-map crop with map graphics removed, the overlap pasted in from the already-painted neighbour (same pdf frame and scale, so it is a pure integer shift by the panorama offsets), and flat platform discs drawn at layout.json bases so rides cannot drift; edit mask = everything except the pasted overlap, minus a 48 px band at its inner edge for blending.",
            "After generation: colour-match the new slice to the neighbour on the overlap, measure any residual shift by phase correlation (re-run if > 8 stage px), cut a minimum-error seam through the overlap near the seam hint, and blend 32-48 px across it.",
            "Register every painted slice back to the official map (10+ landmarks: platforms, building corners, wall stairs) and store its pdf -> slice warp next to its stage.json; reject a slice whose platforms land > 20 stage px from layout.json.",
            "Ship the panorama as the four slices cropped at the seams (WebP tiles placed by panorama_offset); layers keep working in panorama px = (pdf - origin) * 2.56.",
        ],
    },
    "stage_registration": {**stage_reg, "items_on_stage": stage_items},
}
json.dump(layout, open(HERE / "layout.json", "w"), indent=1)

# ------------------------------------------------------------------ console report
print(f"strip {STRIP_DEG:.1f} deg; {len(items_out)} items; {len(gcps)} control points")
print("global affine shape", cam, "stage camera expects", STAGE_EXPECT)
print("stage-camera model", cam_stage_model, region_stats(res_D))
print("affine residuals", region_stats(res_aff))
print("affine LOO", region_stats(res_aff_loo))
print("TPS lam", LAM, {k: round(v, 1) for k, v in loo_by_lam.items()})
print("TPS LOO", region_stats(res_tps_loo))
for r, v in local.items():
    print("local", r, {k: v[k] for k in v if k != "affine"})
for c_ in chain:
    print("chain", c_)
for c_ in street_chain:
    print("streets", c_)
for q in gcp_out:
    print(f"  {q['id']:24s} {q['region']:6s} w={q['w']:.1f} aff={q['affine_residual_px']} loo_tps={q['tps_loo_residual_px']}")
print("overlaps", json.dumps(overlaps))
print("stage reg", json.dumps({k: v for k, v in stage_reg.items() if k.startswith('rms')}))
for l in stage_reg["landmarks"]:
    print("  ", l["id"], l["kind"], "offset pdf", l["offset_pdf_px"], "after affine", l["after_structure_affine_stage_px"])
print("panorama", pan_w, pan_h)
for o in items_out:
    if o.get("ground_estimated"):
        print("  est", o["id"], o["ground_estimated"]["ground"])
