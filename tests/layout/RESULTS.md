# Layout test: the whole park on one map

This test places every ride, attraction and key building of the Santa Cruz Beach Boardwalk on the official map and on
OpenStreetMap (OSM). It measures how the two disagree and proposes how to cut the park into stage slices.

## What was built

| File | What it is |
|---|---|
| `layout.json` | 51 items: 39 rides, 5 attractions and 7 buildings, plus the fit, the slices and the stage registration (116 KB) |
| `layout_data.py` | The hand measurements: map bases, silhouettes, OSM refs, kinds, motion, stage landmarks |
| `build_layout.py` | Builds `layout.json`: OSM lookup, marker refinement by colour, fits, slices, stage registration |
| `render_shots.py` | Draws the overlays in `shots/` |
| `fitlib.py` | Affine fit, thin-plate spline (TPS) and the lat/lon to metre conversion |
| `layer.js` | Debug layer (`compose.html?tests=layout`): marks this slice's rides on the stage |

Rebuild from the repo root with `uv run -q --with pillow --with numpy --with scipy python -I tests/layout/build_layout.py`,
then `render_shots.py` with the same command.

### Each item records

- Its number, name and group (kiddie, family, thrill, attraction or building).
- Its kind and model, from the legend, coasterpedia.net and Amusement Today (Aug 2017).
- Its motion: spin, swing, path, slide, static or mixed, with a note on how it moves.
- On the official map, in pdf px:
  - `marker`: the number circle. All 45 markers (the Sky Glider has two) were refined by colour; they moved at most 4.5 px from my reading, so the reading was correct.
  - `base`: where the ride stands. Confidence is high (±4 px), medium (±8) or low (±15).
  - `outline`: the drawn silhouette, recorded for 26 items.
  - `path`: recorded for the Sky Glider.
  - `png_1400`: the same point on the 1400 px png.
- On OSM:
  - id, URL, lat/lon of the centroid, metres on the ground, tags.
  - Footprint as lat/lon (or a line for open ways), and related ways (the flume channel, the Undertow roof, the trestle rail).
  - 39 items have OSM data.
  - The 12 that don't get `ground_estimated` (lat/lon) through the inverse warp, ±10–20 m: Bouncin' Buggies, Speedway, Jet Copters, Bulgy the Whale, Beach Swing, Boardwalk Racers, Wave Rider, Dream Wheel, Twirlin' Teacups, Surge, Laser Tag and The Vault Laser Maze.
  - `osm_unmatched` lists 7 OSM attraction entries for retired rides: Cliff Hanger, Climb 'N Conquer, an old Ferris Wheel, Red Baron, Rugged Buggies, Kiddie Cruzers and one unnamed node.
- The rides' motions break down as: 13 spin, 9 path, 7 mixed, 4 slide, 3 swing, 3 static.

## Findings

1. **The legend has 39 rides, not 38.** They are numbered 1–39: 9 kiddie, 19 family and 11 thrill. There are 5 attractions (A–E). The 2026 map adds a 40th ride, Vertigo 360 (a Zamperla frisbee).

2. **The official map's layout is not a projection; only its ride icons are.** One affine fit maps OSM ground to the map with these residuals (pdf px; about 2.1 px per metre along the strip):

   | Region (map x) | Points | Affine RMS | Affine leave-one-out | Mean offset | TPS leave-one-out |
   |---|---|---|---|---|---|
   | West (< 600): Casino to Undertow | 8 | 30.2 | 36.9 | (+6, +6) | 21.3 |
   | Centre (600–1150): Carousel to Sea Swings | 10 | 34.4 | 36.5 | (−14, −9) | 21.3 |
   | East (> 1150): Funland to the river | 21 | 36.7 | 39.9 | (+10, +1) | 41.3 |

   The control points are 30 ride and building centroids, 6 Beach Street intersections and 3 structure points. They are weighted by confidence.
   - **The plan is rotated, not seen from the stage camera.** The promenade (18.1° north of east) is drawn horizontal: screen slope −0.01, where the stage camera would give 0.215. Inland points straight up (91°, the camera would give 47°).
   - **Depth is stretched.** Inland is drawn at 1.32× the along-strip scale; the camera would foreshorten it to 0.64×. So the map draws the park about 2× deeper than the icons' camera implies.
   - **Inland lines fan out.** The inland direction turns from 71° in the west, through 84°, to 100° in the east. That is a fan converging roughly 1,800 px above the middle of the park.
   - **The along-strip scale is steady for streets but not for rides.** Between streets it is 1.77–1.94 px/m. Between rides it ranges from 1.37 (Carousel → Haunted Castle) to 3.5 (Rock-O-Plane → Tsunami).
   - **The stage camera can't place things from metres.** Yaw 24.1° and pitch 28.7°, with a free scale and depth stretch, misses by 90 px RMS. Those angles describe the drawn icons, not where they stand.
   - **Rule:** positions come from the map (`layout.json` pdf px). The stage camera only orients and sizes each ride at its spot. A coaster or flume path must be drawn in map/stage px, not from OSM metres.

3. **The east end is the most distorted.** Biggest affine residuals:
   - Giant Dipper east turn: (72, −60)
   - Sea Dragons: (51, −44)
   - Cliff St: (65, −2)
   - Trestle: (−58, −6)
   - Park Pl: (−44, 10)

   The map pulls the street side west and pushes the boardwalk rides east. Even the TPS predicts east positions only to 41 px.

4. **The existing stage does not sit on the map.** Using the plain crop `(pdf − [780, 430]) × 2.56` (`shots/stage_registration.png`):

   | What | Offset on the stage, in map px | In stage px |
   |---|---|---|
   | Big structures (Dipper, flags, mill house) | −15 to +10 sideways, −7 to −22 up | 43 RMS |
   | Beach wall | 26–30 up | 72 RMS |
   | Fireball, Dream Wheel, Sea Swings platforms | 38–57 up | 127 RMS |

   An affine fitted on the structures reduces the structure error to 17 px but leaves the platforms 65 px off. The redraw squeezed the rides toward the Dipper and added promenade in front of them.
   - Without the warp, the map's Dream Wheel and Sea Swings bases land on the stage's wall stairs (`shots/layer_crop_vs_calibration.png`).
   - `layout.json → stage_registration` holds a TPS through 11 landmarks. `layer.js` uses it, so the bases land on the platforms (`shots/layer_registered.png`).
   - `stage.json`'s `east_flat_ride` is most likely WipeOut (36): under the crop transform the map's WipeOut base falls inside that platform.

## Slices

Every slice is a crop of the same official map at the stage's 2.56× scale, so all share one camera. The origins sit on
a 25 px grid, so each slice's offset in the panorama is a whole multiple of 64 stage px.

**Panorama:** **3904 × 1344 stage px**, covering pdf (30, 305)–(1555, 830). `pano = (pdf − [30, 305]) × 2.56`. See `shots/slices.png`.

| Slice | Map rect (pdf px) | Size | Panorama offset | Contents |
|---|---|---|---|---|
| S0_west | 30, 305 – 630, 705 | 1536 × 1024 | 0, 0 | Casino, Cocoanut Grove, Neptune's, Bowl, Pirate Ship, Double Shot, Typhoon |
| S1_entrance | 405, 355 – 1005, 755 | 1536 × 1024 | 960, 128 | Main entrance, Shockwave, Undertow, Wave Rider, kiddie rides, Carousel, Haunted Castle |
| S2_dipper | 780, 430 – 1380, 830 | 1536 × 1024 | 1920, 320 | The existing `base/stage.png` |
| S3_river | 1155, 405 – 1555, 805 | 1024 × 1024 | 2880, 256 | Flume, the east-end rides, Tsunami, the river and the trestle |

Each overlap is 225 pdf px (576 stage px).

**Where to cut the seams** (pdf x):
- **S0 | S1 at about 470:** the entrance plaza between Double Shot and Shockwave. No ride-free corridor exists here.
- **S1 | S2 at about 810:** the one clean corridor (792–830), between the Haunted Castle and the Dipper.
- **S2 | S3 at about 1320:** between the mill house / Dipper end and Ghost Blasters.

**Generating a slice without seams:**
1. Grow outward from S2, one slice at a time.
2. Build the input from the official-map crop with the map graphics removed. Paste in the neighbour's painted overlap; it lines up by a pure integer shift.
3. Draw flat platform discs at the `layout.json` bases so rides can't drift.
4. Mask everything except the pasted overlap, keeping a 48 px blend band at its inner edge. Use the same style frames and prompt, plus `stage.png` as a style reference.
5. After generating:
   - Colour-match the new slice on the overlap.
   - Check any shift by phase correlation; redo the slice if it is more than 8 px.
   - Cut a minimum-error seam near the hint and blend 32–48 px across it.
6. Register the slice back to the map with 10 or more landmarks and store the warp beside its stage.json. Reject a slice whose platforms land more than 20 px from `layout.json`.
7. Ship the four crops as WebP tiles.

## Proposed base/ changes

- **`stage.json`:** add the slice rect, the panorama offset and a map → stage warp, with its landmarks. Without the warp, map positions are up to 145 stage px wrong on this slice.
- **`stage.json`:** rename `east_flat_ride` to `wipeout`, after checking.
- **STYLE.md:** "parallel projection" holds for the ride icons only. The map's layout is a plan with the strip horizontal, depth stretched about 1.3× and a ±15° fan.

## Open problems

- **The east end is dense.** Bases for Tornado, Cyclone, Crazy Surf, Convoy, WipeOut, Space Race, Ghost Blasters and Cave Train are low confidence (±15 px). Their OSM nodes are old hand-placed points, and several neighbours are retired rides.
- **The aerial is too coarse.** The USGS photo (about 0.5 m/px, blurry) can't confirm the small rides, so the 12 estimated lat/lon values are unverified.
- **Silhouettes are coarse.** The flume and Dipper outlines and the building splits (Casino Arcade versus Cocoanut Grove, both one OSM polygon) were traced roughly.
- **Speed Bumps** sits indoors under the Undertow roof; its base is a guess.
- **No benchmark.** `layer.js` is static SVG with no per-frame work.
