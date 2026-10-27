"""What every shipped image is and how densely the page draws it: the shared table for inventory.py, recompress.py
and score.py.

Density is image px per park px (the park frame is 3840 x 2560). DRAW says where the page puts the pixels and at
how many device px per park px, as a function of the screen's own density d = scale * devicePixelRatio
(0.5 on 1920x1080 at 1x, 0.667 on 2560x1440 at 1x, 0.7875 on a 1512x982 MacBook at 2x, 1.0 on a 4K monitor at 1.5x
or 2x):
  img       an <img> in the world (plates, patches): d; Chrome re-rasters it under pinch zoom, so zoomed 2d
  cap2      a 2D canvas at min(d, 2) (traffic, flume, pirate, thrill)
  cap1.25   the sea's WebGL canvas at min(d, 1.25)
  max1.5    a canvas at clamp(d, 1.5, 2.5), shrunk by the browser (coaster, wheel, carousel, teacups)
  fixed1.5  the crowd's WebGL canvas, always 1.5
  nearest   an id map sampled with NEAREST: never resample, never lossy
KIND decides the encoding family: painting, plate (opaque-ish cut of the painting, alpha edge), occluder (painting
pixels with a hard polygon alpha), sprite (painted RGBA art), sheet (sprites packed with a JSON of rects), texture
(opaque colour for WebGL), mask (data in channels: lossless only), ids (lossless, exact size).
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRATCH = os.environ.get("PERF_SCRATCH", "/tmp/claude-1000/boardwalk-assets")

SCREENS = {  # name: (CSS width, CSS height, devicePixelRatio)
    "1920x1080@1": (1920, 1080, 1.0),
    "2560x1440@1": (2560, 1440, 1.0),
    "MacBook 1512x982@2": (1512, 982, 2.0),
    "4K 2560x1440@1.5": (2560, 1440, 1.5),
    "4K 1920x1080@2": (1920, 1080, 2.0),
}


def screen_density(w, h, dpr):
    return max(w / 3840, h / 2560) * dpr


def painting_width(w, h, dpr):
    need = 3840 * screen_density(w, h, dpr)
    return next((v for v in (1920, 2560, 3456, 3840, 5120) if v >= need * 0.95), 5120)


def drawn(rule, d):
    """Device (or canvas) px per park px the asset is rasterised at, for screen density d."""
    return {"img": d, "cap2": min(d, 2.0), "cap1.25": min(d, 1.25), "max1.5": min(2.5, max(1.5, d)),
            "fixed1.5": 1.5, "nearest": None, "painting": d}[rule]


# path: (kind, density, draw rule, source of best quality or None for the shipped file itself, note)
A = {
    "site/park/world_*.webp": ("painting", None, "painting", "gen/park/world_v2_hd.png", "9600x6400 master, 2.5 px per park px"),
    "tests/park-crowd/atlas.png": ("sheet", 2.0, "fixed1.5", None, "758 frames; also drawn by every ride for riders"),
    "rides/traffic/sprites.webp": ("sheet", 2.0, "cap2", "rides/traffic/gen/sprites.png", "32 headings x cars, lossy q92 now"),
    "rides/traffic/occ.webp": ("occluder", 2.0, "cap2", None, "atlas of painting cut-outs (occ.json)"),
    "rides/traffic/patch_R1.webp": ("plate", 2.5, "img", None, "street with the painted cars erased"),
    "rides/traffic/patch_R2.webp": ("plate", 2.5, "img", None, ""),
    "rides/traffic/patch_R3.webp": ("plate", 2.5, "img", None, ""),
    "rides/sea/clean.webp": ("texture", 0.5, "cap1.25", None, "water with the dashes filled in, lossy q92 now"),
    "rides/sea/dashpaint.webp": ("sprite", 1.0, "cap1.25", None, "the lifted ripple dashes, RGBA"),
    "rides/sea/masks.png": ("mask", 0.5, "cap1.25", None, "R sdf, G open water, B shore angle, A unused"),
    "rides/sea/hole.png": ("mask", 1.0, "cap1.25", None, "where the dashes were (R used)"),
    "rides/sea/strokes.png": ("ids", 1.0, "nearest", None, "dash id = R + 256 G, NEAREST"),
    "rides/wheel/plate.webp": ("plate", 2.5, "img", None, ""),
    "rides/wheel/wheel.webp": ("sprite", 2.5, "max1.5", None, "rotated every frame"),
    "rides/wheel/cabins.webp": ("sheet", 2.5, "max1.5", None, ""),
    "rides/wheel/legs.webp": ("occluder", 2.5, "img", None, ""),
    "rides/wheel/hub.webp": ("sprite", 2.5, "max1.5", None, ""),
    "rides/carousel/horses.webp": ("sheet", 4.0, "max1.5", None, "WebGL, 5 views x 4 horses"),
    "rides/carousel/surfaces.webp": ("texture", None, "max1.5", None, "roof/skirt bands, WebGL"),
    "rides/carousel/plate_west.webp": ("plate", 2.5, "img", None, ""),
    "rides/carousel/plate_east.webp": ("plate", 2.5, "img", None, ""),
    "rides/carousel/column_west.webp": ("occluder", 2.5, "max1.5", None, "packed into the carousel sprite texture"),
    "rides/carousel/column_east.webp": ("occluder", 2.5, "max1.5", None, ""),
    "rides/coaster/sprites.png": ("sheet", 4.0, "max1.5", None, "train cars"),
    "rides/coaster/occ_lattice.webp": ("occluder", 2.5, "max1.5", None, ""),
    "rides/coaster/occ_station.webp": ("occluder", 2.5, "max1.5", None, ""),
    "rides/coaster/occ_fireball.webp": ("occluder", 2.5, "max1.5", None, ""),
    "rides/flume/sprites.png": ("sheet", 4.0, "cap2", None, "logs with riders' seats"),
    "rides/flume/sprites_empty.png": ("sheet", 4.0, "cap2", None, ""),
    "rides/flume/plate_pool.webp": ("plate", 2.5, "img", None, ""),
    "rides/flume/occ_box.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/flume/occ_porch.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/flume/occ_disc.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/flume/occ_s_tube.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/teacups/plate.webp": ("plate", 2.5, "img", None, ""),
    "rides/teacups/textures.webp": ("texture", None, "max1.5", None, "cup pattern bands, three.js, anisotropy 4"),
    "rides/pirate/plate.webp": ("plate", 2.5, "img", None, ""),
    "rides/pirate/front.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/pirate/ship_back.webp": ("sprite", 2.5, "cap2", None, "lossy q92 now"),
    "rides/pirate/ship_front.webp": ("sprite", 2.5, "cap2", None, "lossy q92 now"),
    "rides/thrill/plate_typhoon.webp": ("plate", 2.5, "img", None, ""),
    "rides/thrill/occ_typhoontower.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/thrill/occ_dropcolumn.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/thrill/occ_bush.webp": ("occluder", 2.5, "cap2", None, ""),
    "rides/thrill/ring_front.webp": ("sprite", 2.5, "cap2", None, ""),
    "rides/thrill/ring_back.webp": ("sprite", 2.5, "cap2", None, ""),
    "rides/thrill/arm.webp": ("sprite", 2.5, "cap2", None, ""),
    "rides/thrill/car.webp": ("sprite", 2.5, "cap2", None, ""),
    # layers added while this was measured (scored with the stricter img rule where the canvas rule wasn't checked)
    "rides/swings/chairs.webp": ("sheet", 4.0, "max1.5", None, "swing chairs"),
    "rides/swings/drum.webp": ("occluder", 3.0, "max1.5", None, "cutouts.json"),
    "rides/swings/fence.webp": ("occluder", 3.0, "max1.5", None, "cutouts.json"),
    "rides/corgi/corgi.webp": ("sheet", 4.0, "img", None, ""),
    "rides/corgi/pin.webp": ("occluder", 4.0, "img", None, "corgi.json pin.rect"),
}


def lookup(path):
    if path.startswith("site/park/world_"):
        return A["site/park/world_*.webp"]
    return A.get(path)
