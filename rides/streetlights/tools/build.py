"""Ship the street lights: from each region's edit (gen/poles_<R>_0.png) keep only the new poles, with the painting's
own pixels everywhere else, and write the layer's assets.

  py build.py            -> plate_<R>.webp/json (plate slot), front_<R>.webp (south poles, front slot),
                            streetlights.json (what layer.js loads), work/check_<id>.png

Per pole: tools/park_patch.py's paste, on the page's base (painting + rides/traffic's car-erase patches, so no painted
car comes back), with a hard polygon around the pole as sketched (shaft, arm and head, foot) and --changed: only
what the edit really changed inside it is kept (the pole and its shadow). --match softens the edit to the
painting's sharpness. The front cut-out of a south pole is the same patch limited to the pole itself (pixels that
differ strongly from the painting, so no halo of the edit's asphalt is drawn over a passing car)."""
import json, os, sys, types
import numpy as np
from PIL import Image
from scipy import ndimage
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from base import base_crop, ROOT, F
sys.path.insert(0, os.path.join(ROOT, "tools"))
import park_patch

D = os.path.join(ROOT, "rides/streetlights")
_cache = {}
def hd_crop(r):
    k = tuple(r)
    if k not in _cache:
        _cache[k] = Image.fromarray(base_crop(r))
    return _cache[k]
park_patch.hd_crop = hd_crop

pos = json.load(open(os.path.join(D, "positions.json")))
poles = {p["id"]: p for p in pos["poles"]}
regions = json.load(open(os.path.join(D, "gen/regions.json")))
OWN = {}   # pole -> region whose edit it comes from (first one listing it)
for R, v in regions.items():
    for i in v["poles"]:
        OWN.setdefault(i, R)
OWN.update(json.load(open(os.path.join(D, "gen/own.json"))) if os.path.exists(os.path.join(D, "gen/own.json")) else {})


# Edit E's poles stand on bare asphalt and their pale arms and heads differ little from it: a lower threshold keeps
# them whole (edit E redrew the asphalt within a few levels). Elsewhere 6 would take the whole polygon.
CHANGED = {"s5": 6.0, "s6": 6.0}
CORE = {"s5": 18, "s6": 18}


def polys(p):
    fx, fy = p["foot"]; tx, ty = p["top"]; hx, hy = p["head"]
    ux, uy = hx - tx, hy - ty; n = np.hypot(ux, uy); ux, uy = ux / n, uy / n
    ex, ey_ = hx + ux * 10, hy + uy * 10
    x0, x1 = min(tx, hx, ex) - 9, max(tx, hx, ex) + 9
    y0, y1 = min(ty, hy, ey_) - 9, max(ty, hy, ey_) + 8
    if p["side"] == "south":  # the model paints these arms longer and some shafts taller than sketched (edit E)
        x1, y0, ty = tx + 72, ty - 52, ty - 32
    return [[[fx - 8, fy + 9], [fx + 8, fy + 9], [fx + 8, ty - 2], [fx - 8, ty - 2]],
            [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            [[fx - 18, fy - 9], [fx + 18, fy - 9], [fx + 18, fy + 10], [fx - 18, fy + 10]]]


def pole_patch(pid):
    p = poles[pid]; R = OWN[pid]; r = regions[R]["region"]
    os.makedirs(os.path.join(D, "work/patch"), exist_ok=True)
    pf = os.path.join(D, f"work/patch/{pid}_poly.json")
    json.dump(polys(p), open(pf, "w"))
    a = types.SimpleNamespace(edit=os.path.join(D, f"gen/poles_{R}_0.png"), x0=r[0], y0=r[1], x1=r[2], y1=r[3],
                              out=os.path.join(D, f"work/patch/{pid}"), mask=None, poly=pf, feather=1.0, grow=2.0,
                              match=True, changed=CHANGED.get(pid, 14.0))
    park_patch.paste(a)
    meta = json.load(open(a.out + ".json"))
    return Image.open(a.out + ".webp").convert("RGBA"), meta["rect"]


def measure_head(pid, core, rect):
    """The LED head as painted: the pole's pixel farthest out along its arm, above the shaft top's level - 30 px."""
    p = poles[pid]
    ys, xs = np.nonzero(core)
    X, Y = rect[0] + xs / F, rect[1] + ys / F
    tx, ty = p["top"]; hx, hy = p["head"]
    u = np.array([hx - tx, hy - ty]); u /= np.linalg.norm(u)
    up = Y < ty + 30 if p["side"] == "north" else Y < ty + 10
    if not up.any():
        print("no head found for", pid); return
    k = np.argmax((X[up] - tx) * u[0] + (Y[up] - ty) * u[1])
    tip = np.array([X[up][k], Y[up][k]])
    # the shaft's real top: highest core pixel within 4 px of the shaft line
    sh = np.abs(X - p["foot"][0]) < 4
    top_y = float(Y[sh].min()) if sh.any() else ty
    v = tip - np.array([tx, top_y]); v /= np.linalg.norm(v)
    c = tip - v * 5
    p["painted"] = {"tip": [round(float(tip[0]), 1), round(float(tip[1]), 1)], "head": [round(float(c[0]), 1), round(float(c[1]) + 1.5, 1)],
                    "top": [p["foot"][0], round(top_y, 1)]}
    print(pid, "painted", p["painted"])


def lights_records():
    """One record per pole for the lights module (tests/night-lights/RESULTS.md format)."""
    recs = []
    rng = np.random.default_rng(16)
    for p in poles.values():
        q = p.get("painted", {"head": p["head"], "top": p["top"]})
        hx, hy = q["head"]
        fx, fy = p["foot"]
        rise = 14  # the head sits about 1 m above the shaft top: its ground point is that much lower
        gx, gy = hx, hy + (fy - q["top"][1]) + rise
        tip = q.get("tip", p["head"])
        u = np.array([tip[0] - p["foot"][0], tip[1] - q["top"][1]]); u /= np.linalg.norm(u)
        recs.append({
            "id": f"street_{p['id']}", "kind": "streetlight", "group": "photocell", "slot": "over",
            "z": round(fy, 1), "src": [hx, hy], "ground": [round(gx, 1), round(gy, 1)],
            "colour": "#fff3e2",
            "lens": [round(hx - u[0] * 4, 1), round(hy - u[1] * 4 + 0.8, 1), round(hx + u[0] * 4, 1), round(hy + u[1] * 4 + 0.8, 1)],
            "halo": 20.0,
            "pool": {"c": [round(gx, 1), round(gy, 1)], "r": 84, "colour": "#ffe9c8"},
            "pole": {"side": p["side"], "foot": p["foot"], "top": q["top"],
                     "front": p["side"] == "south"},
            "seed": round(float(rng.random()), 5)})
    return {"about": "Beach Street's street lights (rides/streetlights): 13 slim LED poles painted into the street as plate patches. One record per pole, park px, in tests/night-lights/lights.json's format. kind streetlight: src = the LED head (lens: its underside, a segment), ground = the point under the head, the pool's centre. Neutral-warm white (the city's LED retrofit, about 3000-4000 K). group photocell. slot over: the head is above everything near it; south poles (pole.front) stand in front of the cars (their cut-out is in the front slot), north poles behind them. z = the pole's foot.",
            "counts": {"streetlight": len(recs)}, "lights": recs}


def main():
    out = {"plates": [], "fronts": [], "poles": []}
    groups = {}
    for pid in poles:
        if pid not in OWN:
            print("no region for", pid); continue
        im, rect = pole_patch(pid)
        groups.setdefault(OWN[pid], []).append((pid, im, rect))
    os.makedirs(os.path.join(D, "poles"), exist_ok=True)
    for R, items in groups.items():
        for pid, im, rect in items:
            # one small image per pole (decoded size matters more than the request count: a region-wide sheet of
            # mostly transparent pixels decodes to tens of MB)
            x0, y0 = np.floor(rect[0]), np.floor(rect[1])
            x1, y1 = np.ceil(rect[0] + rect[2]), np.ceil(rect[1] + rect[3])
            base = base_crop([x0, y0, x1, y1]).astype(np.float32)
            H, W = base.shape[:2]
            a = np.zeros((H, W, 4), np.float32)
            src = np.asarray(im).astype(np.float32)
            ox, oy = round((rect[0] - x0) * F), round((rect[1] - y0) * F)
            h, w = min(src.shape[0], H - oy), min(src.shape[1], W - ox)
            a[oy:oy + h, ox:ox + w] = src[:h, :w]
            al = a[..., 3:4] / 255
            # the pole itself: strong change from the painting, closed, a hair wider; not the cast shadow
            diff = np.abs(a[..., :3] - base).max(-1)
            core = (diff > CORE.get(pid, 30)) & (al[..., 0] > 0.5)
            core = ndimage.binary_closing(core, iterations=3)
            core = ndimage.binary_fill_holes(core)
            core = ndimage.binary_opening(core, iterations=1)
            lab, n = ndimage.label(core)
            if n:  # keep the components that touch the shaft line (drops stray shadow specks)
                fx = round((poles[pid]["foot"][0] - x0) * F)
                keep = set(np.unique(lab[:, max(0, fx - 6):fx + 7])) - {0}
                core = np.isin(lab, list(keep))
            r = [float(x0), float(y0), float(x1 - x0), float(y1 - y0)]
            measure_head(pid, core, r)
            kinds = [("plate", a)]
            if poles[pid]["side"] == "south":
                fa = ndimage.gaussian_filter(core.astype(np.float32), 0.7)
                fa = np.minimum(fa * 1.4, 1)[..., None] * al
                kinds.append(("front", np.dstack([a[..., :3], fa * 255])))
            for kind, arr in kinds:
                f = f"poles/{kind}_{pid}.webp"
                Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(D, f), quality=90, alpha_quality=100, method=6)
                out[kind + "s"].append({"file": f, "rect": r, "pole": pid})
                print(f, r, os.path.getsize(os.path.join(D, f)) // 1024, "KB")
    out["poles"] = [{**{k: poles[i][k] for k in ("id", "side", "foot")}, **poles[i].get("painted", {})} for i in poles]
    json.dump(out, open(os.path.join(D, "streetlights.json"), "w"), indent=1)
    L = lights_records()
    for f in (os.path.join(D, "lights.json"), os.path.join(ROOT, "tests/night-lights/lights_streetlights.json")):
        json.dump(L, open(f, "w"), indent=1)
        print("wrote", f)


if __name__ == "__main__":
    main()
