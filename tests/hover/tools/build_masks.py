"""Cut the interactive items out of base/stage.png.

  uv run --no-project --with numpy --with pillow --with scipy --with opencv-python-headless \
      python tests/hover/tools/build_masks.py            # from the repo root

Masks come from two shyfai clean plates registered to the stage (phase correlation per 256 px tile: within 0.2 px):
  thin  = stage with palms, lamps, benches and flags removed (stalls kept and completed behind palms)
  all   = stage with every item removed
A thin item is where the stage differs from `thin`; a stall is where it differs from `all`. Soft contact shadows
(stage = plate x 0.6..0.97 in all three channels) are not part of an item. Each item is limited to its hand box or
polygon; where two items overlap, the one with the lower foot line (nearer the viewer) owns the pixel.

Writes, inside tests/hover/:
  masks/<id>.png     the item's visible mask, 8-bit, cropped to bbox
  sprites/<id>.png   stage pixels cut by the mask plus a 2 px ring of stage (alpha 255, then 128): exact at rest
  patches/<id>.png   the plate behind the item (inside the mask grown 3 px), shown only while the item moves
  hit.png            the ID image: red = item index + 1, 0 = nothing
  data.json          what layer.js loads;  front.json  the occluder list for the characters test
"""
import json, os, sys
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.dirname(HERE)
cfg = json.load(open(os.path.join(HERE, "items.json")))
load = lambda p: np.asarray(Image.open(os.path.join(TEST, p)).convert("RGB")).astype(np.float32)
S = load(cfg["stage"])
H, W = S.shape[:2]
plates = {k: load(v) for k, v in cfg["plates"].items()}
TAU = cfg.get("tau", 38)


def diff(a, b):
    d = np.abs(a - b).max(2)
    r = (a + 1) / (b + 1)
    shadow = (r.max(2) < 0.97) & (r.min(2) > 0.6) & (r.max(2) - r.min(2) < 0.09)
    d[ndi.binary_opening(shadow, np.ones((3, 3)))] = 0
    return d


def region(it):
    m = np.zeros((H, W), bool)
    if "poly" in it:
        mm = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mm, [np.round((np.array(it["poly"]) - 0.5) * 16).astype(np.int32)], 1, shift=4)
        m = mm.astype(bool)
    else:
        x0, y0, x1, y1 = it["box"]
        m[y0:y1, x0:x1] = True
    return m


def clean(e):
    e = ndi.binary_closing(e, np.ones((3, 3)), border_value=0)
    e = ndi.binary_fill_holes(e)
    e = ndi.binary_opening(e, np.ones((2, 2)))
    lab, n = ndi.label(e)
    if not n:
        return e
    sizes = ndi.sum(e, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.15 * sizes.max()]
    return ndi.binary_fill_holes(np.isin(lab, keep))


def depth_of(it):
    xs = [p[0] for p in it["foot"]]
    cx = (min(xs) + max(xs)) / 2
    return round(float(np.interp(cx, xs, [p[1] for p in it["foot"]])), 1)


def diff_mask(it):
    plate = plates[it.get("plate", "all" if it["kind"] == "stall" else "thin")]
    e = diff(S, plate) > it.get("tau", TAU)
    r = region(it)
    if it.get("method") != "snap":
        return clean(e & r) & r
    core = ndi.binary_erosion(r, iterations=2)
    band = ndi.binary_dilation(r, iterations=2)
    return clean(core | (e & band)) & band


def main(out_dir=TEST):
    items = cfg["items"]
    masks = {it["id"]: diff_mask(it) for it in items}
    for it in items:
        it["depth"] = depth_of(it)
    order = sorted(items, key=lambda it: it["depth"])
    owner = np.zeros((H, W), np.int16)
    for it in order:
        owner[masks[it["id"]]] = items.index(it) + 1
    for k in ("masks", "sprites", "patches"):
        os.makedirs(os.path.join(out_dir, k), exist_ok=True)
    data, front = [], []
    for i, it in enumerate(items):
        m = owner == i + 1
        m = clean(m) & (owner == i + 1)
        ys, xs = np.nonzero(m)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        pad = 4
        bx0, by0, bx1, by1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
        crop = (slice(by0, by1), slice(bx0, bx1))
        Image.fromarray((m[y0:y1, x0:x1] * 255).astype(np.uint8)).save(os.path.join(out_dir, "masks", f"{it['id']}.png"))
        r1 = ndi.binary_dilation(m, iterations=1)
        r2 = ndi.binary_dilation(m, iterations=2)
        alpha = np.where(r1, 255, np.where(r2, 128, 0)).astype(np.uint8)
        rgba = np.dstack([S.astype(np.uint8), alpha])[crop]
        Image.fromarray(rgba, "RGBA").save(os.path.join(out_dir, "sprites", f"{it['id']}.png"))
        plate = plates[it.get("plate", "all" if it["kind"] == "stall" else "thin")]
        pa = np.where(ndi.binary_dilation(m, iterations=2), 255, np.where(ndi.binary_dilation(m, iterations=3), 128, 0)).astype(np.uint8)
        Image.fromarray(np.dstack([plate.astype(np.uint8), pa])[crop], "RGBA").save(os.path.join(out_dir, "patches", f"{it['id']}.png"))
        entry = {k: it[k] for k in ("id", "kind", "name", "source")}
        entry.update(bbox=[int(x0), int(y0), int(x1 - x0), int(y1 - y0)], sprite=[int(bx0), int(by0)], depth=it["depth"], foot=it["foot"], area=int(m.sum()))
        for k in ("awning", "cloth", "caption"):
            if k in it:
                entry[k] = it[k]
        data.append(entry)
        front.append({"id": it["id"], "kind": it["kind"], "name": it["name"], "mask": f"tests/hover/masks/{it['id']}.png",
                      "cutout": f"tests/hover/sprites/{it['id']}.png", "cutoutOrigin": [int(bx0), int(by0)],
                      "bbox": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], "depth": it["depth"], "footLine": it["foot"]})
    hit = np.zeros((H, W, 3), np.uint8)
    hit[..., 0] = np.clip(owner, 0, 255)
    Image.fromarray(hit).save(os.path.join(out_dir, "hit.png"), optimize=True)
    json.dump({"size": [W, H], "items": data}, open(os.path.join(out_dir, "data.json"), "w"), indent=1)
    json.dump({
        "about": "Front-layer occluders cut from base/stage.png by tests/hover. Stage px, y down. mask: the item's visible pixels (8-bit, 255 = item), placed at bbox[0], bbox[1]. cutout: the same item as an RGBA sprite placed at cutoutOrigin (stage pixels plus a 2 px ring, exact over the stage). depth: y of the foot line at the item's centre; footLine: the front edge of its footprint. A character whose feet are above the foot line (smaller y, at the character's x) is behind the item: draw the cut-out over it.",
        "stage": "base/stage.png", "size": [W, H], "items": front}, open(os.path.join(out_dir, "front.json"), "w"), indent=1)
    print("items", len(data), "pixels", int((owner > 0).sum()))
    return owner


if __name__ == "__main__":
    main()
