# hover: interactive cut-outs and front-layer occluders

View: `http://localhost:15178/base/compose.html?tests=hover`

- `&walkers`: five demo bunnies, drawn in one depth-sorted pass with the cut-outs, to show the occlusion.
- `&poke=s5@0.25,f1@0.3`: freezes an item at a given time after a poke. Use it with `&t=` for repeatable frames.
- The 18 item ids are in `data.json`.

## What I built

18 items of 5 kinds, all cut from `base/stage.png`:

| Kind | Items | Sign text |
|---|---|---|
| stall | s1, s2, s3, s4, s5, s6 | s5 **Funland Arcade** and s6 **Tickets**: labels on the official map. s4 **MyBoardwalk Card Kiosk** and s1–s3 **Food**: map icons only |
| lamp | l1–l4 | Lamp post (the map gives no name) |
| palm | p1, p3, p4, p5 | Palm tree (no name) |
| bench | b1, b3 (b3 is behind Funland) | Bench (no name) |
| flag | f1, f2 | Flag of the United States and Flag of California (both drawn on the map) |

The stage is a loose redraw of the map, so I matched stalls to the map's labels and icons by position. Only s5, s6 and the flags carry real names.

- **Reaction (`poke`).** Hover and tap call the same function, which does three things:
  - A bounce with squash, 0.8 s, anchored at the foot line. Each kind has its own hop and squash; flags and palms move less.
  - An awning flutter on stalls, 1.8 s. Each 2-px column of the scalloped valance stretches downward in a travelling wave. Because it only stretches down, it never uncovers anything.
  - A sign that pops up with a spring and stays until 2.6 s after the last hover or tap.
  
  Flags wave their cloth instead of fluttering an awning, shifting each column more the further it is from the pole.
- **Signs.** Each sign is a DOM element in the `lights` slot, so it stays readable at night. It uses Fredoka 600 (jsdelivr `@fontsource/fredoka@5.1.0`), has a tag colour per kind, and is clamped inside the stage. It is counter-scaled by 1/worldScale (between 1x and 3.5x), so it stays legible on a 390 px phone.
- **Input.**
  - Listeners sit on `world`, and my canvases ignore the pointer, so other layers stay clickable.
  - Mouse: `pointermove` hovers and click re-pokes.
  - Touch and pen: a `pointerup` that has moved 12 px or less counts as a tap. A tap on empty space hides the sign.
  - The cursor changes over an item.
- **Hit map** (`hit.png`, 16 KB). The red channel holds the item number, 0 means nothing, and each pixel belongs to the item whose foot line is nearest the viewer.
  - It is read with `createImageBitmap(..., {colorSpaceConversion: "none"})`, so the IDs survive decoding.
  - Mouse lookups are exact pixel lookups. Touch falls back to the nearest item within 16 screen px.
  - Spot checks on the crowded s2/s3/p1/s4/l2 cluster all return the right item (`shots/hit_map_crowded.png`). For example, the s2 awning beside the s3 roof gives s2, a p1 frond over s3 gives p1, and an l2 globe over the s4 roof gives l2.
- **Cut-outs.** `sprites/<id>.png` holds the stage pixels inside the mask plus a 2 px ring of stage pixels (alpha 255, then 128). They are drawn on one 1536×1024 canvas in the `front` slot. While still, every pixel equals the stage underneath, which hides resampling seams at fractional scales.
- **Hole fill.** `patches/<id>.png` is the clean plate inside the mask grown 3 px. It is drawn in the `water` slot, the lowest slot and below the characters, but only while that item is moving.
- **Redraw.** Only the dirty rectangle of moving items is cleared and redrawn. Nothing is drawn while everything is still.
- **`front.json`** (for the characters test) lists every item with:
  - `mask`: the 8-bit visible mask, placed at `bbox`
  - `cutout`: the RGBA sprite, placed at `cutoutOrigin`
  - `depth`: the y of the foot line at the item's centre
  - `footLine`: a 2–3 point polyline along the front edge of the footprint
  
  The rule: a character whose feet are above the foot line at its own x goes behind the item. My `&walkers` demo uses exactly this rule.

## Masks: which method worked

The quality columns score each method's masks against the shipped masks (mean IoU / mean boundary distance in px). That is not independent ground truth, so I also checked every mask by eye on overlays (`shots/masks_*.png`, `shots/methods.png`).

| Method | Time | Quality | Notes |
|---|---|---|---|
| **A. Key colour** (shyfai paints one kind flat #FF00FF on a copy of the stage) | 4 edits in parallel, 34–83 s each (87 s wall), plus automatic extraction | 0.79 / 7.6 | Clean edges on isolated boxy stalls (s4, s5: 0.97). It merged the touching stalls s2+s3 into one blob, skipped bench b3, invented 5 benches and 2 lamps that are not there, stylised the palm silhouettes, and shifted one band of the image by 0.7 px vertically. Not reliable on its own. |
| **B. GrabCut** (OpenCV, initialised from the box) | seconds | 0.63 / 18.9 | Pastel items on a pastel ground defeat it: b1, b3 and p1 came out empty, and l2 and p5 were half missing. Not usable. |
| **C. Hand-traced polygons** (on 5 px-gridded 5–6x zooms) | about 3–4 min per stall, about 25 min for 6 stalls plus the junctions | 0.90 / 1.6 | Good on straight roof and counter edges and at junctions (s3 over s2, the s5 roof over b3). It misses posts, scallops and fringe, and it would be far too slow for palms. |
| **D. Clean-plate difference** (\|stage − plate\| thresholded, then hole-fill) | 2 shyfai edits (38 s and 64 s, 2 images each, best one kept), about 10 s compute | 0.87 / 2.7 | The best method for organic and thin shapes: palms, lamps and flags get sub-pixel edges, because the plates register within ±0.2 px. Its failure modes: stall interiors whose colour matches the plate's planks (s1 roof: 0.71), soft contact shadows (removed with a ratio test), and anything else the plate changed nearby (needs a rough region). |
| **E. Shipped = D + C** | — | — | Stalls and benches: the plate difference snapped to the hand polygon within a 2 px band. Thin items: the plate difference inside a rough box or polygon (about 1 min each). |

### Plates

`gen/clean_1.png` (everything removed) and `gen/clean_thin_1.png` (palms, lamps, benches and flags removed, with the stalls completed behind the palms).

- Registration, measured by phase correlation per 256 px tile: within 0.2 px for both. The rejected `clean_thin_0` was 0.9 px off, and `clean_0` wrongly removed the ride platforms.
- Difference images: `gen/diff_clean_1.png` and `gen/diff_clean_thin_1.png`. Outside the removed items they show only faint re-render edges.
- The thin plate means that when a palm moves, the stall behind it shows through, not bare planks.

## Exactness at rest (no halo, no shift)

| Comparison | Result |
|---|---|
| Native 1:1 | Exact by construction: the sprites are stage pixels |
| Stage only vs layer at rest, midday, world scale 0.934 (1446×968 capture) | max 18/255; 629 px > 3, 64 px > 8, 0 px > 20, out of 1.34 M px. The rest are sub-pixel resampling at mask edges (`shots/rest_diff_x10.png`, amplified 10×) |
| Same comparison at night | max 6/255 |

## Benchmark (`&bench=10`)

Headless Chrome with SwiftShader (software WebGL), 1440×1000 viewport. These are headless numbers, not real GPU numbers.

| Case | fps | p95 ms | long frames | draws/frame | heap MB | download MB |
|---|---|---|---|---|---|---|
| Stage only | 60.1 | 16.7 | 0 | – | 1.7 | 2.65 |
| hover, still | 59.6 | 16.8 | 2 (load) | 0 | 10.8 | 3.46 |
| One stall poked every 1 s (dirty-rect redraw) | 59.5 | 16.8 | 2 | 58 | 11.4 | 3.46 |
| Same, full-canvas redraw (first version) | 34.5 | 50 | 66 | 73 | 10.7 | 3.48 |
| All 18 poked every 0.5 s | 37.6 | 33.4 | 37 | 383 | 11.4 | 3.48 |
| All 18 + 5 walkers (full redraw) | 34.0 | 33.4 | 46 | 447 | 11.0 | 3.48 |

- The layer adds 0.8 MB to the download: sprites 508 KB, patches 364 KB, masks 76 KB, hit map 16 KB.
- Most of the draws are the 2 px awning column slices. Clearing and recompositing whole 1536×1024 canvases was the real cost, which is why the dirty-rect redraw takes one moving stall from 34.5 to 59.5 fps.

## Screenshots (`shots/`)

| Shot | What it shows |
|---|---|
| `s5_phases.png` | Funland Arcade at 0.07 s (squash), 0.25 s (hop), 0.45 s (land) and 1.2 s (settled), with its sign |
| `hover_s5_bounce.png`, `hover_s5_sign.png`, `hover_f1_flutter.png` | A real mouse hovering via `drive.mjs` |
| `golden_flag_f2.png` | The flag wave |
| `phone_tap_lamp*.png` | 390 px phone: a synthetic touch tap 2.3 screen px off a lamp pole selects it, and the sign is readable |
| `night_sign_s6.png` | Night, with the sign lit |
| `hover_overview.png` | Three items mid-reaction |
| `walkers_a.png`, `walkers_b.png` | Occlusion: a bunny hidden behind s4, a head peeking over the s4 roof, a bunny behind the p3 trunk, and others in front of stalls |
| `hit_map.png`, `hit_map_crowded.png` | The ID image |
| `masks_*.png`, `methods.png` | Mask outlines per item and per method |
| `plate_all_diff.png` | The plate difference image |

## What worked

- Plate-difference masks for thin and organic items. The same plate gives both the mask and the hole fill, and in my checks it never needed a manual retouch.
- Hand polygons as the frame for boxy stalls, with the plate difference snapping their edges.
- Sprites with a 2 px stage ring and hard alpha: no visible seam while still, at any scale I tried.
- One `poke()` for hover and tap. Pairing it with a touch tolerance makes 2 px lamp poles tappable on a phone.
- The dirty-rect canvas: it costs nothing while still and holds 60 fps in headless with one item moving.

## What didn't, and open problems

1. **Cross-layer depth.** The `front` slot sits above `characters`. If the characters test is mounted with this one, every character ends up behind every cut-out, even ones it stands in front of. Only a single depth-sorted pass gets this right (as `&walkers` does inside my canvas).
2. **Patches need a slot under the characters.** I used `water`, the lowest slot. The base has no ground slot.
3. **Reveal artifacts during motion**, visible for under 0.2 s:
   - When s5 squashes, the hidden lower half of bench b3 shows as planks, because the "all" plate removed b3.
   - When s3 moves, the hidden part of s2 shows as planks.
   - The stage's static contact shadow leaves a soft fringe under a hopping stall.
   
   Fixing these needs per-overlap plates (for example, one with only s3 removed), or a smaller hop.
4. **Mask leaks of 1–2 px.** At the top-left of the s1 roof, around the p1 fronds where the thin plate re-painted the stall, and along the ragged right edge of s1.
5. **Night lamp glow.** A glow drawn in `lights` by another test will not follow a bouncing lamp.
6. **Names.** Most stalls have only a map icon, so s1–s3 all read "Food". Real stand names would need another source.
7. **Re-running.** The masks are tied to this exact `stage.png`. A new stage means 2 new plates (about 2 min) plus re-checking the hand polygons; the build then takes about 10 s.

## Recommendation

- **Masks:** use the clean-plate difference with a rough region for anything organic or thin, and add a hand polygon for boxy items and junctions. Drop key-colour edits and GrabCut.
- **Ship the "all" plate as an underlay.** Generate one plate with every interactive or front item removed and treat it as the official underlay for front items, checking registration with tile phase correlation (pass at 0.3 px or less).
- **Proposals for `base/`:**
  1. A `ground` slot between the stage and the characters, for hole patches.
  2. A shared depth-sorted front pass: characters and `front.json` cut-outs sorted by the foot-line rule in one canvas or one WebGL batch. The hover layer would then only hand over poses (`sx`, `sy`, `dy`, flutter) per item.
  3. Lamp glows owned by the lamp item, so they move with it.
- **Keep the interaction model:** one poke for hover and tap, a touch tolerance in screen px, signs in vector, counter-scaled and placed above the grade.

## Files

| Path | What it is |
|---|---|
| `layer.js` | The layer |
| `data.json` | What the layer loads |
| `front.json` | Occluder list for the characters test |
| `hit.png` | ID image |
| `masks/`, `sprites/`, `patches/` | Per-item mask, cut-out and hole patch |
| `tools/items.json` | Items, rough boxes, hand polygons, foot lines, awning and cloth regions |
| `tools/build_masks.py` | Builds every output above (about 10 s) |
| `tools/compare_methods.py` | The method table and `shots/methods.png` |
| `gen/` | Prompts, shyfai outputs, plates and difference images |
