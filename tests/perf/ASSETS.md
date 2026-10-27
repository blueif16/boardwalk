# Asset weight: smaller files at the same quality

Research only: nothing shipped was replaced. Scripts are in `tests/perf/tools/`, small comparison shots in `tests/perf/shots/`,
and the candidate files are in `/tmp/claude-1000/boardwalk-assets/` (outside the repo). Measured on 2026-10-26 on the tree as it
stood. Rides added while I worked (beach, swings, corgi, wildlife) are not in these numbers, but the same rules apply to them (see
Rules).

## Applied (2026-10-26, WebP-only route, approved by the user)

All 42 files below were re-encoded in place. Each one keeps its file name, its pixel size and its format: WebP stays WebP,
PNG stays PNG. No code changed. Each one was scored first with `tools/score.py` (display / zoomed SSIMULACRA2, see "How
quality was judged") and applied only if its verdict was **indistinguishable**. The sea masks are bit-exact. Before copying,
each shipped file was checked to still have exactly the pixels the candidate was encoded from.

| file | before kB | after kB | encoding | score (display / zoomed) |
|---|---:|---:|---|---|
| tests/park-crowd/atlas.png | 3,449 | 840 | palette PNG (imagequant, dither 1) | 91.4 / 87.8 |
| rides/traffic/occ.webp | 672 | 237 | WebP q90, sharp YUV, exact alpha | 94.1 / 91.8 |
| rides/traffic/patch_R2.webp | 400 | 46 | WebP q90, sharp YUV, exact alpha | 95.0 / 91.5 |
| rides/wheel/plate.webp | 394 | 86 | WebP q90, sharp YUV, exact alpha | 94.7 / 90.8 |
| rides/traffic/patch_R1.webp | 354 | 52 | WebP q90, sharp YUV, exact alpha | 95.2 / 92.0 |
| rides/teacups/plate.webp | 304 | 53 | WebP q90, sharp YUV, exact alpha | 94.2 / 88.2 |
| rides/flume/sprites.png | 345 | 97 | palette PNG (libimagequant, dither 1) | 95.0 / 93.2 |
| rides/thrill/plate_typhoon.webp | 307 | 62 | WebP q90, sharp YUV, exact alpha | 94.6 / 90.4 |
| rides/carousel/horses.webp | 362 | 134 | WebP q90, sharp YUV, exact alpha | 94.6 / 92.3 |
| rides/traffic/patch_R3.webp | 248 | 26 | WebP q90, sharp YUV, exact alpha | 95.1 / 91.8 |
| rides/wheel/wheel.webp | 317 | 115 | WebP q90, sharp YUV, exact alpha | 93.9 / 90.2 |
| rides/coaster/sprites.png | 240 | 61 | palette PNG (libimagequant, dither 1) | 93.9 / 92.8 |
| rides/pirate/plate.webp | 209 | 39 | WebP q90, sharp YUV, exact alpha | 94.9 / 90.7 |
| rides/flume/sprites_empty.png | 255 | 93 | palette PNG (libimagequant, dither 1) | 96.5 / 95.7 |
| rides/coaster/occ_lattice.webp | 346 | 189 | WebP q90, sharp YUV, exact alpha | 96.6 / 94.4 |
| rides/wheel/cabins.webp | 219 | 78 | WebP q90, sharp YUV, exact alpha | 91.7 / 87.2 |
| rides/sea/dashpaint.webp | 287 | 178 | WebP q90, sharp YUV, exact alpha | 90.0 / 88.3 |
| rides/thrill/occ_typhoontower.webp | 120 | 27 | WebP q90, sharp YUV, exact alpha | 95.1 / 92.7 |
| rides/thrill/occ_dropcolumn.webp | 108 | 25 | WebP q90, sharp YUV, exact alpha | 94.5 / 91.9 |
| rides/pirate/front.webp | 127 | 47 | WebP q90, sharp YUV, exact alpha | 95.9 / 94.0 |
| rides/carousel/plate_west.webp | 99 | 20 | WebP q90, sharp YUV, exact alpha | 95.0 / 90.8 |
| rides/thrill/ring_front.webp | 103 | 33 | WebP q90, sharp YUV, exact alpha | 93.2 / 90.1 |
| rides/thrill/arm.webp | 93 | 24 | WebP q90, sharp YUV, exact alpha | 92.1 / 87.7 |
| rides/thrill/ring_back.webp | 99 | 31 | WebP q90, sharp YUV, exact alpha | 92.9 / 90.3 |
| rides/sea/masks.png | 235 | 167 | oxipng -o6 zopfli | bit-exact |
| rides/corgi/corgi.webp | 89 | 34 | WebP q90, sharp YUV, exact alpha | 95.2 / 93.0 |
| rides/flume/plate_pool.webp | 67 | 16 | WebP q90, sharp YUV, exact alpha | 94.5 / 89.7 |
| rides/thrill/occ_bush.webp | 52 | 12 | WebP q90, sharp YUV, exact alpha | 94.8 / 92.1 |
| rides/corgi/pin.webp | 50 | 18 | WebP q90, sharp YUV, exact alpha | 96.0 / 93.7 |
| rides/wheel/legs.webp | 47 | 16 | WebP q90, sharp YUV, exact alpha | 95.7 / 92.8 |
| rides/sea/strokes.png | 60 | 37 | oxipng -o6 zopfli | bit-exact |
| rides/coaster/occ_station.webp | 29 | 7 | WebP q90, sharp YUV, exact alpha | 95.2 / 91.7 |
| rides/thrill/car.webp | 31 | 10 | WebP q90, sharp YUV, exact alpha | 90.9 / 86.6 |
| rides/flume/occ_porch.webp | 28 | 8 | WebP q90, sharp YUV, exact alpha | 94.7 / 92.5 |
| rides/traffic/sprites.webp | 1,051 | 1,033 | WebP q90, sharp YUV, exact alpha | 93.7 / 89.9 |
| rides/flume/occ_box.webp | 28 | 10 | WebP q90, sharp YUV, exact alpha | 95.3 / 92.7 |
| rides/coaster/occ_fireball.webp | 19 | 5 | WebP q90, sharp YUV, exact alpha | 94.6 / 91.7 |
| rides/sea/hole.png | 49 | 38 | oxipng -o6 zopfli | bit-exact |
| rides/wheel/hub.webp | 16 | 5 | WebP q90, sharp YUV, exact alpha | 94.0 / 89.0 |
| rides/flume/occ_disc.webp | 15 | 4 | WebP q90, sharp YUV, exact alpha | 93.9 / 91.6 |
| rides/flume/occ_s_tube.webp | 14 | 4 | WebP q90, sharp YUV, exact alpha | 94.7 / 92.3 |
| rides/carousel/column_west.webp | 9 | 3 | WebP q90, sharp YUV, exact alpha | 95.1 / 91.8 |
| **42 files** | **11,344** | **4,021** | −7.32 MB | all indistinguishable or bit-exact |

**Total MB per fresh load now**, measured after applying (`tools/measure.mjs`, no cache, the dev server sends everything raw):

| screen | now | without this change |
|---|---:|---:|
| 1920x1080 @1x | **8.91 MB** | 16.23 MB |
| 2560x1440 @1x | **9.25 MB** | 16.49 MB |
| MacBook 1512x982 @2x | **10.44 MB** | 17.76 MB |
| 4K (2560x1440 @1.5x; @2x loads the same) | **10.87 MB** | 18.20 MB |

These totals are higher than the 14–16 MB "now" in the headline below: the page grew while I worked. It gained the beach,
swings, corgi and wildlife layers, and three.js and gsap are now served locally as `vendor/vendor.js` (0.61 MB). The second
column is today's page with the 42 originals put back. The 1920, MacBook and 4K runs fetched 140 files; the 2560 run fetched
128, which may mean some requests had not finished by the end of that run.

- **Page check:**
  - The default page `?t=100` was captured before and after at 2560x1440 @1x and 1512x982 @2x (`scripts/capture.mjs`). Both
    consoles are clean.
  - At 2560 the park strip scores SSIMULACRA2 93.6 between the two shots (worst 512 px tile 93.1). See
    `shots/applied_2560_before_after.webp`.
  - The only large differences are things that move on their own clock: the title animating in, the sea's swash line and the
    corgi's "woof!" bubble.
  - At MacBook size SSIM is 0.995. SSIMULACRA2 isn't meaningful for that pair because of the bubble and the title.
- **Undo:** every original is in `/tmp/claude-1000/boardwalk-assets/originals/<same path>`; copy it back. The list and
  scores are in `/tmp/claude-1000/boardwalk-assets/applied.json`.
- **Rebuilds keep the atlas small:** `tests/characters/tools/build_atlas.py --park` now writes atlas.png as a 256-colour
  palette PNG through the `imagequant` pip package (the pngquant library). That is the 840 kB version applied here.
  `--lossless` skips it, and without imagequant installed it falls back to lossless with a message. The usage line now says
  `--with imagequant`. The other ride build tools still write lossless files: a rebuild of a ride restores its old size until
  those tools get the same q90 / palette step (rules below).
- **Not applied:**
  - Already lossy, where re-encoding would only stack a second loss: traffic sprites was the exception (see below), sea
    clean, pirate ship_back and ship_front, teacups textures, beach and wildlife atlases, swings plate and surfaces.
  - `rides/swings/chairs, drum, fence`: the swings agent had already made them lossy, and another pass saved only 1–2%, so
    they were restored.
  - `rides/carousel/surfaces.webp`: scored 84.9, visible.
  - Out of scope: the painting, world_960, index.html, layer.js.
  - `rides/traffic/sprites.webp` was re-encoded from its lossless master `gen/sprites.png` (q92 → q90). It scored 93.7 / 89.9
    against that master, which matches the old shipped file (PSNR 37.9). It saved only 18 kB.

## Headline

A fresh load (no cache, dev server, which compresses nothing) measured with `tools/measure.mjs`:

| screen | painting it loads | now | after, WebP only (no code change) | after, AVIF + WebP fallback | either route + brotli on the host |
|---|---|---:|---:|---:|---:|
| 1920x1080 @1x | world_1920 (909 kB) | **14.2 MB** | 6.6 MB | 5.4 MB | 6.1 / **4.9 MB** |
| 2560x1440 @1x | world_2560 (1.56 MB) | **14.8 MB** | 7.2 MB | 5.9 MB | 6.7 / **5.4 MB** |
| MacBook 1512x982 @2x | world_3456 (2.44 MB) | **15.7 MB** | 8.0 MB | 6.6 MB | 7.5 / **6.0 MB** |
| 4K 3840x2160 @1.5x or @2x | world_3840 (2.87 MB) | **16.1 MB** | 8.4 MB | 6.9 MB | 7.9 / **6.4 MB** |

That's 55–60% less with WebP alone and about 62% with AVIF; host compression of the text adds about 0.55 MB more. The CDN
scripts (three, gsap: 0.25 MB) are not counted. How the "after" figures were built:
- the 42 ride and crowd images go from 11.58 MB to 4.21 MB (WebP lossy at the current pixel size, and the crowd atlas as a
  palette PNG) or to 3.21 MB (AVIF);
- the sea masks go from 344 kB to 241 kB (oxipng, still PNG) or to 191 kB (lossless WebP);
- the painting shrinks 7% (WebP with sharp YUV) or 24% (AVIF 4:4:4);
- text is 700 kB raw and 148 kB with brotli.

**Not every row is scored yet.** The machine was overloaded by other agents' jobs, so only the painting (at 1920), the crowd
atlas, `traffic/occ.webp` and `wheel/plate.webp` went through the full quality guard. The other sizes come from real encodes with
the same settings, which passed on those four, but they have not been scored. See Open.

## How quality was judged

- **What a screen shows.** The page draws everything in the 3840 x 2560 park frame. Screen density d = scale x devicePixelRatio
  is 0.5 (1080p), 0.667 (1440p), 0.79 (MacBook) and **1.0 (4K)**, so no target screen shows more than 1 device px per park px.
  Canvases then cap or raise that per layer. traffic, flume, pirate and thrill draw at min(d, 2). The sea draws at min(d, 1.25).
  coaster, wheel, carousel and teacups draw at clamp(d, 1.5, 2.5) and let the browser shrink the result. The crowd's canvas is
  always 1.5, so it is 5760 x 1680 on every screen. Most ride art ships at 2.5 image px per park px, and some at 4. That is 2.5–4x
  more than any target screen can show, and 6–16x more pixels.
- **Metric.** `tools/score.py` puts the lossless original and each candidate through the page's own path: the image, then the
  canvas density, then the screen density, with premultiplied Lanczos resampling. It then composites both over what is really
  behind them: the painting at the asset's own park rect for plates and occluders, else a light and a dark ground. The score is
  SSIMULACRA2 (pip `ssimulacra2`, libjxl's metric), worst over d = 0.79 and 1.0 ("display") and at 2x on 4K ("zoomed"; for an
  `<img>` that means Chrome re-rasters at 2.0, for a canvas it means the canvas magnified). Large images are scored on their
  most detailed 512 px tiles. Small composites are repeated up to 512 px so that all six scales count.
- **Verdicts.** *Indistinguishable* means display ≥ 88 and zoomed ≥ 85. *Visible only zoomed* means display ≥ 88 and zoomed below
  85. *Visible* means display below 88. For scale: **the shipped painting scores 82–83 against its own master at 1:1** (it is
  WebP q90), so 88 is stricter than what ships today.
- **Eye checks.** I looked at crops at 2–4x (`shots/painting_1920_crops.webp`). WebP q90 already flattens the sea's diagonal
  paper grain and lightens the blue slightly. AVIF 4:4:4 keeps more of the grain. Line art looks the same.

## Per asset

"now" is the shipped file. "WebP q90" is the same pixels, lossy, with sharp YUV and exact (lossless) alpha. It needs no code
change: same URL, same size. "AVIF q70" is the same pixels in 4:4:4. "@1.5" is WebP q90 after resizing to 1.5 image px per park
px. All sizes are in kB. A score is shown only where the candidate was run through score.py (display / zoomed).

| file | kind | density / drawn at | now | WebP q90 | AVIF q70 | WebP q90 @1.5 | palette PNG | score WebP q90 | score AVIF q70 |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| tests/park-crowd/atlas.png | sheet | 2.0 / 1.5 fixed | 3449 | 1294 | 941 | 997 | **817** | 92.3 / 89.7 | 93.7 / 88.9 |
| rides/traffic/sprites.webp | sheet | 2.0 / cap2 | 1051 (lossy q92 now) | 1033 | 634 | 715 | 897 |  |  |
| rides/traffic/occ.webp | occluder | 2.0 / cap2 | 672 | 237 (q85: 201) | 294 | 241 |  | 94.1 / 91.8 | 94.1 / 91.3 |
| rides/sea/clean.webp | texture | 0.5 / cap1.25 | 411 (lossy q92 now) | 358 | 218 | – |  |  |  |
| rides/traffic/patch_R2.webp | plate | 2.5 / img | 400 | 46 | 36 | 25 |  |  |  |
| rides/wheel/plate.webp | plate | 2.5 / img | 394 | 86 | 50 | 55 |  | 94.7 / 90.8 | 94.4 / 90.1 |
| rides/carousel/horses.webp | sheet | 4.0 / max1.5 | 362 | 134 | 96 | 38 | 120 |  |  |
| rides/traffic/patch_R1.webp | plate | 2.5 / img | 354 | 52 | 40 | 28 |  |  |  |
| rides/coaster/occ_lattice.webp | occluder | 2.5 / max1.5 | 346 | 189 | 118 | 98 |  |  |  |
| rides/flume/sprites.png | sheet | 4.0 / cap2 | 345 | 78 | 53 | 21 | 97 |  |  |
| rides/wheel/wheel.webp | sprite | 2.5 / max1.5 | 317 | 115 | 82 | 63 | 118 |  |  |
| rides/thrill/plate_typhoon.webp | plate | 2.5 / img | 307 | 62 | 43 | 40 |  |  |  |
| rides/teacups/plate.webp | plate | 2.5 / img | 304 | 53 | 37 | 27 |  |  |  |
| rides/sea/dashpaint.webp | sprite | 1.0 / cap1.25 | 287 | 178 | 151 | – | 138 |  |  |
| rides/flume/sprites_empty.png | sheet | 4.0 / cap2 | 255 | 52 | 32 | 15 | 93 |  |  |
| rides/traffic/patch_R3.webp | plate | 2.5 / img | 248 | 26 | 21 | 15 |  |  |  |
| rides/coaster/sprites.png | sheet | 4.0 / max1.5 | 240 | 56 | 39 | 18 | 61 |  |  |
| rides/wheel/cabins.webp | sheet | 2.5 / max1.5 | 219 | 78 | 51 | 41 | 71 |  |  |
| rides/pirate/plate.webp | plate | 2.5 / img | 209 | 39 | 26 | 25 |  |  |  |
| rides/teacups/textures.webp | texture | – / three.js | 174 (lossy q92 now) | 136 | 93 | – |  |  |  |
| rides/pirate/front.webp | occluder | 2.5 / cap2 | 127 | 47 | 42 | 37 |  |  |  |
| rides/thrill/occ_typhoontower.webp | occluder | 2.5 / cap2 | 120 | 27 | 18 | 17 |  |  |  |
| rides/thrill/occ_dropcolumn.webp | occluder | 2.5 / cap2 | 108 | 25 | 16 | 16 |  |  |  |
| rides/thrill/ring_front.webp | sprite | 2.5 / cap2 | 103 | 33 | 22 | 17 | 39 |  |  |
| rides/thrill/ring_back.webp | sprite | 2.5 / cap2 | 99 | 31 | 21 | 16 | 40 |  |  |
| rides/carousel/plate_west.webp | plate | 2.5 / img | 99 | 20 | 16 | 14 |  |  |  |
| rides/thrill/arm.webp | sprite | 2.5 / cap2 | 93 | 24 | 15 | 14 | 36 |  |  |
| rides/flume/plate_pool.webp | plate | 2.5 / img | 67 | 16 | 12 | 11 |  |  |  |
| rides/carousel/surfaces.webp | texture | – | 62 | 12 | 8 | – |  |  |  |
| rides/thrill/occ_bush.webp | occluder | 2.5 / cap2 | 52 | 12 | 8 | 9 |  |  |  |
| rides/pirate/ship_back.webp | sprite | 2.5 / cap2 | 50 (lossy now) | 46 | 28 | 23 | 54 |  |  |
| rides/wheel/legs.webp | occluder | 2.5 / img | 47 | 16 | 15 | 13 |  |  |  |
| rides/thrill/car.webp | sprite | 2.5 / cap2 | 31 | 10 | 7 | 5 | 14 |  |  |
| rides/coaster/occ_station.webp | occluder | 2.5 / max1.5 | 29 | 7 | 5 | 5 |  |  |  |
| rides/flume/occ_box.webp, occ_porch, occ_disc, occ_s_tube | occluder | 2.5 / cap2 | 85 | 26 | 21 | 19 |  |  |  |
| rides/pirate/ship_front.webp | sprite | 2.5 / cap2 | 22 (lossy now) | 21 | 13 | 11 | 28 |  |  |
| rides/coaster/occ_fireball.webp, wheel/hub.webp, carousel/column_west.webp | small | 2.5 | 44 | 13 | 9 | 9 |  |  |  |
| **42 images** | | | **11,580** | **4,689** | **3,331** | **3,381** | | | |

Two more scored ladders:
- **wheel/plate.webp**, by density (WebP / AVIF that pass everything): at 2.5, WebP q90 86 kB and AVIF q70 50 kB, both
  indistinguishable. At 2.0, AVIF q75 48 kB is indistinguishable. At 1.5, AVIF q85 46 kB is indistinguishable, and AVIF q70
  32 kB is visible only zoomed. At 1.0 every candidate is visible only zoomed or worse (AVIF q85 28 kB scores 90.2 / 77.9).
  Right-sizing an `<img>` plate below 1.5 softens it under 2x pinch zoom on 4K. The painting around it is 3840 there, so at
  1.0 the plate only becomes as soft as its surroundings.
- **crowd atlas**: palette PNG at 2.0 is 817 kB (90.6 / 86.4, indistinguishable). WebP q80 at 2.0 is 1019 kB (91.0 / 86.1).
  At 1.5, AVIF q75 is 810 kB (92.7 / 86.6), and the palette PNG is 647 kB but visible only zoomed (89.2 / 83.3).

Sea masks: data, so they must stay lossless and keep their size. All three round-trips were checked bit-exact.

| file | now | PNG, alpha dropped, oxipng/zopfli | lossless WebP (exact) |
|---|---:|---:|---:|
| rides/sea/masks.png (alpha is always 255) | 235 | 167 | **140** |
| rides/sea/hole.png | 49 | 38 | **34** |
| rides/sea/strokes.png (id = R + 256 G, NEAREST) | 60 | 37 | **17** |

## The painting

The master is `gen/park/world_v2_hd.png`, resized with Lanczos to each width. The shipped ladder is WebP q90: my q90 encode of
1920 is 908,488 bytes against the shipped 908,938. Scored at 1920 (1:1 on a 1080p screen):

| 1920 candidate | bytes | SSIMULACRA2 vs master | worst 256 px tile |
|---|---:|---:|---:|
| **shipped, WebP q90** | 908,938 | 82.3 | 81.9 |
| WebP q90, sharp YUV | 929,282 | 84.3 | 84.3 |
| WebP q85, sharp YUV | 709,582 | 78.9 | 78.7 |
| AVIF 4:2:0 q80 (Pillow) | 778,104 | 82.8 | 82.0 |
| AVIF 4:4:4 q70 (Pillow) | 629,787 | 80.9 | 79.5 |
| **AVIF 4:4:4 q72** | 672,149 | about 82 | |
| **AVIF 4:4:4 q75** | 724,387 | 83.4 | 82.3 |
| AVIF 4:4:4 q75, sharp/libheif instead of Pillow/libavif | 884,619 | 83.5 | 82.1 |

- **AVIF 4:4:4 at q73–75 equals or beats today's quality at 20–25% fewer bytes**, and it keeps the paper grain better (eye
  check). WebP only gains about 7% (sharp YUV at about q88). Use Pillow's libavif 1.4 / aom 3.14: sharp's libheif path is about
  20% bigger at the same score. 4:4:4 beats 4:2:0 on this art. The SSIM column is in the raw files.
- Other widths, estimated with the 1920 ratio (0.74–0.76x) and not encoded with Pillow yet: 2560 → about 1.18 MB,
  3456 → about 1.84 MB, 3840 → about 2.17 MB, 5120 (4.20 MB now) → about 3.2 MB.
- **For the loading strategy:**
  - Placeholders for a first paint (`shots/preview_placeholders.webp`): 96 px wide is 1.2 kB (WebP q50, blurred by CSS),
    160 px is 2.6 kB (AVIF q50), 320 px is 8.7–10 kB, 480 px is 18.5–21 kB (readable unblurred), 640 px is 32–37 kB.
  - Tiles cost almost nothing: splitting 1920 into 2x2 tiles costs +1.4% in AVIF and 4x4 costs +2%; WebP tiles even come out
    3–4% smaller.
  - The MacBook loads 3456 to show 3024. A 3024 rung would save about 0.5 MB there.

## Data (JSON)

`tools/data.py` measured all 36 JSON files the page loads. They are 480 kB raw, 75.6 kB with gzip −9 and **74.9 kB with brotli
11**. A static host such as Vercel, Netlify or Cloudflare Pages compresses text by itself; this dev server doesn't. Rounding
coordinates on top of brotli:

| file | brotli as is | rounded to 0.1 px | rounded to 1 px |
|---|---:|---:|---:|
| rides/traffic/lanes.json (151 kB raw) | 24.1 | 15.5 | 8.4 |
| rides/flume/track.json | 10.0 | 7.4 | 3.5 |
| rides/coaster/track.json | 10.2 | 7.4 | 3.5 |
| tests/park-crowd/walk.json | 8.2 | 8.2 | 6.8 |
| tests/park-crowd/atlas.json | 7.2 | 6.8 | 5.6 |
| all 36 files | 74.9 | 59.3 | 40.1 |

Rounding to 0.1 park px means at most 0.1 device px of error, which no one can see: it saves about 16 kB. Binary formats aren't
worth it at these sizes. A bigger win belongs to the loading agent: **atlas.json is fetched 9 times** (once per layer, 53 kB
each), and 9 separate `Image` objects load atlas.png.

## GPU memory (decoded)

Measured by hooking `<img>` loads, canvas sizes and `texImage2D` (`tools/measure.mjs`). Totals: decoded images 182–212 MB,
canvas backing stores 64–95 MB, WebGL textures 157–173 MB, which comes to **400–480 MB of pixels** on desktop.

The biggest items:
- the painting: 9.8 MB at 1920, 39 MB at 3840, 70 MB at 5120;
- the crowd canvas: 5760 x 1680 at density 1.5 on every screen, 38.7 MB;
- the sea's five textures: 74 MB (three of them are 3840 x 1373);
- the crowd atlas: uploaded as a texture 3 times (crowd, teacups, carousel's packed texture) at about 22 MB each with mipmaps.

What would help:
- Right-sizing ride art to 1.5 cuts its decoded pixels to 0.36x.
- **The atlas only uses rows 0–1354 of its 2048**: cropping it to 2048 x 1360 saves about 7.6 MB per upload (WebGL2 mipmaps
  NPOT textures fine). It has no duplicate frames, and trimming the frames would save 14% more.
- KTX2/Basis (`tools/ktx2.mjs`) only pays for GPU memory, not download. Atlas: ETC1S 625–848 kB, UASTC+RDO+zstd 2.04 MB,
  against 817 kB as palette PNG. Sea clean: ETC1S 194–305 kB, UASTC 1.42 MB. Teacups textures: ETC1S 190–263 kB. On top of
  that, the transcoder is 527 kB of wasm plus 85 kB of JS, and ETC1S blocks line art. On the GPU it would cut the atlas from
  16.8 to 4.2 MB (BC7/ASTC) and the sea from 74 to about 18 MB. **Not worth it now**: the big memory items are 2D canvases and
  the painting `<img>`, which can't be KTX2. Revisit if phones crash.

## Rules (for every asset, including new rides)

1. **Density.**
   - **Painting-derived `<img>` plates and patches:** store at ≥ 1.5 image px per park px (2.0 if 4K pinch zoom must stay
     sharper than the painting).
   - **Canvas sprites and occluders:** store at the density their canvas reaches on a 4K screen. cap2 layers draw at 1.0, so
     1.0–1.5 is enough (1.5 also covers 5K/6K). max1.5 layers need 1.5. The crowd atlas needs 1.5–2.
   - **Never ship density 4.** Build tools take a density: rebuild sheets at 1.5 rather than resizing a packed sheet.
2. **Colour art** (plates, occluders, sprites, sheets, textures), from the lossless source:
   - WebP only: `quality 90, smartSubsample (sharp_yuv), alphaQuality 100, effort 6`. Pillow can't do sharp_yuv; use cwebp
     `-q 90 -sharp_yuv -alpha_q 100 -m 6` or sharp. Use q85 for occluders over moving cars.
   - With AVIF: Pillow ≥ 11.3, `im.save(p, "AVIF", quality=70, subsampling="4:4:4", speed=4)`. That's 30% smaller than WebP
     q90 on this art. Its alpha is lossy (max error 15 at q70, mean 1.5 levels on edges): use q80+ for sprites with soft alpha.
   - Never 4:2:0 on line art.
   - Palette PNG (libimagequant, 256 colours, dither 1) only for many-coloured small sprites in one sheet. It won on the crowd
     atlas and lost on painted plates (84.6 / 74, visible).
3. **Masks and ids:** lossless only, at their own size. Drop unused channels, then lossless WebP with `exact`, or oxipng
   `-o 6 --zopfli` to stay PNG. Check the round-trip is bit-exact (`np.array_equal`).
4. **Painting:** AVIF 4:4:4 q73–75 (Pillow/libavif), with WebP q88–90 + sharp_yuv as the fallback.
5. **Data:** let the host brotli it. Round coordinates to 0.1 px in the tools that write them. Minify (`separators=(",", ":")`).

### Commands

```
PY="uv run -q --no-project --with pillow --with numpy --with scipy --with ssimulacra2 --with imagecodecs --with brotli --with scikit-image --with pyoxipng --with imagequant python -I"
export NODE_PATH=/tmp/claude-1000/boardwalk-assets/node/node_modules     # npm i sharp@0.34 ktx2-encoder@0.6 there
node tests/perf/tools/measure.mjs --out shots/measure.json               # bytes, decoded pixels and textures per screen
$PY tests/perf/tools/inventory.py shots/measure.json > shots/inventory.md
$PY tests/perf/tools/recompress.py painting --widths 1920,2560,3024,3456,3840,5120
$PY tests/perf/tools/recompress.py assets [--only 'rides/beach/*']       # needs a row in tools/assets.py for new files
$PY tests/perf/tools/recompress.py masks ; $PY tests/perf/tools/recompress.py preview
OMP_NUM_THREADS=1 $PY tests/perf/tools/score.py [--only ...] [--screens all] > scores.jsonl ; $PY tests/perf/tools/pick.py scores.jsonl
$PY tests/perf/tools/score_painting.py 1920            # painting candidates vs master and vs shipped
$PY tests/perf/tools/crops.py out.png --zoom 4 --box fx,fy,fw,fh label=file ...   # eye checks
$PY tests/perf/tools/data.py ; node tests/perf/tools/ktx2.mjs outdir files...
node tests/perf/tools/swap.mjs --map map.json --out dir   # real page, shipped vs candidate bytes, screenshots per screen
node tests/perf/tools/decode.mjs dir files...             # decode ms per file in Chrome
```
Run score.py with `OMP_NUM_THREADS=1`, or the processes oversubscribe the threads.

## Risks

- **AVIF:**
  - It needs Safari 16.4+ (macOS 13 / iOS 16.4) and Chrome 85+, so it needs a fallback path in code. Every layer.js hard-codes
    `.webp`/`.png`, so one helper in `ctx` would have to pick the extension.
  - It decodes slower than WebP (not measured: decode.mjs is written but wasn't run).
  - First `drawImage` of a not-yet-decoded image decodes on the main thread.
- **Lossy occluders and plates** sit on the painting, so a colour shift would show as a faint patch edge. That is why they are
  scored over the painting at their own rect. Keep alpha lossless (WebP) or q80+ (AVIF).
- **Right-sizing sheets** changes `density`/`scale` and the rects in their JSON: rebuild with the tools, don't resize a packed
  sheet. Plates and occluders placed by park rect need no JSON change.
- **Right-sizing `<img>` plates to 1.0** is visible only under pinch zoom on 4K, and only to the level of the painting around
  them. 5K/6K screens (d = 1.33–1.57) want 1.5.
- **Palette PNG atlas:** 256 colours across 65 looks. It scored as indistinguishable, but a new species with new hues could
  band. Re-score when the cast grows.
- Other agents keep changing these files: carousel plates/columns, surfaces.webp and walk.json changed while I measured. Every
  number here is a snapshot.

## Open (not done in this pass)

- **Scored and applied since:** every same-pixel candidate (see Applied). Still unscored: the right-sized (@1.5) and AVIF
  variants of most assets, which only matter for the AVIF or right-sizing routes.
- Painting AVIF at 2560–5120 with Pillow, plus a 3024 rung. The figures above are estimates from the 1920 ratio.
- The in-browser end-to-end check (`swap.mjs`). It works, but under the machine's load the page took over 90 s to mount, so the
  baseline shot came before the rides were up. Rerun on a quiet machine with `--query t=100`.
- Decode-time benchmark AVIF vs WebP (`decode.mjs`).
- New rides: beach atlas 557 kB (lossy already), swings chairs 232 kB lossless, corgi 89 + 50 kB lossless, wildlife atlas
  221 kB. Add them to `tools/assets.py` and run the same ladder.
- Crowd atlas at scale 1.5 in real WebGL. WebGL's trilinear mipmaps make it look different from the Lanczos simulation, so it
  needs a look in the page.
