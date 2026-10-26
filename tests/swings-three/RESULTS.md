# Sea Swings: live three.js vs pre-rendered Rive

Two builds of the same swing ride on the `sea_swings` platform, driven by one shared motion model, so that both show the
same pose at the same `&t=`.

| | URL |
|---|---|
| A, live three.js | `http://localhost:5178/base/compose.html?tests=swings-three` |
| B, Rive with pre-rendered views | `http://localhost:5178/base/compose.html?tests=swings-rive` |
| Frozen frames | add `&t=2` (stopped), `&t=10` (spinning up), `&t=20` (full speed); `&time=night` for the bulbs |

## What was built

**Shared (in this folder)**

- `ride.js`: dimensions, the speed program, input, swing dynamics, chair poses and bulb positions.
  - A 48 s cycle on the master clock: stopped 0–4 s, spin-up 4–12 s, full speed 12–36 s (one turn per 5.5 s), coast
    36–44 s, stopped 44–48 s. The rotation angle is the closed-form integral of that profile, so any `&t=` gives the
    exact pose.
  - Hover adds up to 0.8 × full speed (time constant 1.2 s up, 3.5 s down); each tap adds a 0.45 × kick. The total is
    capped at 1.3 × full speed. Both are integrated from master-clock deltas, so a frozen clock stays frozen.
  - Swing-out comes from `tan θ = ω²(r₀ + L sin θ)/g`, solved by fixed-point iteration, with g tuned so full speed gives
    about 38°. A damped spring (ωₙ 3 rad/s, ζ 0.7) makes the chairs lag behind the speed; the angle is clamped at 56°.
  - Each chair gets a pivot, a seat point, two chain lines, a heading and a tilt, plus a front/back flag and a depth.
- `bulbs.js`: night bulbs in the `lights` slot, scaled by `time.look.lights`, with a chase pattern from the master
  clock. 32 sit on the valance crown and 32 on the roof seams, plus one on the finial. Bulbs on back-facing surfaces are
  culled analytically. Both versions use this file.

**A: `layer.js` + `model.js`**

- A procedural model: base drum, striped column with rings, a conical striped roof, a scalloped crown valance with
  framed panels, a finial, and 16 chairs. Each chair carries a rider (bear, bunny, cat or dog) on two chains.
- One ShaderMaterial does all the shading:
  - two-tone toon with a soft terminator and a plum-tinted shade;
  - procedural gore, panel and stripe patterns with ~1 px tinted seam lines (`fwidth`);
  - inverted-hull outlines in a darker shade of each fill mixed with the `#2c201b` ink.
- Each chair is merged into one geometry: 45 draw calls and 62k triangles for the whole ride.
- The canvas covers only the ride's 320 × 290 px box, with the camera frustum cropped to match. That is 17× fewer
  pixels than a full-stage canvas.

**B: `../swings-rive/`**

- `bake/bake.html`, `bake.js`: render sprites from the same `model.js` with the stage camera at 2× (in-browser), all
  views in about 5 s:
  - 640 chair views: 4 riders × 32 headings × 5 tilts (0–56°);
  - 16 canopy frames over its 45° symmetry period;
  - the static tower.
- `bake/bake.mjs` runs the bake headless and writes lossless WebP atlases plus `atlas.json`.
- `bake/gen_rml.mjs` writes `rive/scene.rml`; `rive . --once` builds `rive/build/swings.riv` (1.26 MB, 334 objects).
- `layer.js` drives the file through `@rive-app/canvas-advanced@2.42.2` and sets node transforms from JS each frame.
- How the Rive file is put together:
  - **Slots, not chairs.** Rive can't reorder drawables from JS, so the file has fixed depth slots, in this paint order:
    9 back chairs → tower → 9 front chain pairs → canopy → 9 front seats. Each frame, JS sorts the chairs by depth and
    fills the slots; unused slots get scale 0.
  - **The split you need is in the chains, not the canopy.** Chains of front chairs start under the canopy, so they are
    drawn between the tower and the canopy, and their seats after the canopy. The canopy itself didn't need a back/front
    split: nothing passes through it.
  - **View swap = clipped atlas.** An `Image` has no source rectangle, so each slot clips an atlas image to one cell
    and moves the image to choose heading and tilt. The canopy works the same way.
  - Chains are 1 × 1 rectangles that JS positions, rotates and stretches.

## Screenshots

Each comparison is look target | A three.js | B Rive, same `&t=`, same crop, DPR 2.

| Shot | File |
|---|---|
| Stopped, `t=2` | `shots/side_t2_rest.png` |
| Spinning up, `t=10` | `shots/side_t10_spinup.png` |
| Full speed, `t=20` | `shots/side_t20_full.png` |
| Dusk, `t=10&time=19.6` | `shots/side_t10_dusk.png` |
| Night, `t=20&time=night` | `shots/side_t20_night.png` |
| One chair over 10 frames at full speed: A, then B at 16 headings, then B at 32 | `shots/strip_chair_three_rive16_rive32.png` |
| Hover then two taps on a live clock (A after hover, A after taps, B after taps) | `shots/hover_A1_A2_B2.png` |
| Whole stage at golden hour | `shots/full_three_t20_golden.png`, `../swings-rive/shots/full_rive_t20_golden.png` |
| B's atlases | `../swings-rive/shots/atlas_chairs_top_third.png`, `../swings-rive/shots/atlas_canopy.png` |

At the same `&t=` the two builds are near-identical: same pose, depth order, chains behind the valance and occlusion by
the column. Two captures of either build at `t=33.3` are pixel-identical.

## Benchmarks

All numbers are from headless Chrome rendering WebGL in software (SwiftShader). They are headless numbers, not GPU
numbers. The bench ran with `&bench=10&time=midday` on a live clock (stopped → spin-up → full speed), 1536 × 1068
viewport. This machine's RTX 4070 SUPER could not be reached from headless Chrome under WSL.

| | fps | p50 / p95 ms | long frames | heap MB | draws | main-thread cost per update (p50 / p95) |
|---|---|---|---|---|---|---|
| Stage only | 60.1 | 16.7 / 16.7 | 0 | 1.7 | – | – |
| A three.js, DPR 1 | 47.1, 47.5 | 16.7 / 33.4 | 25–30 | 12–13 | 45 calls, 62k triangles | 0.40 / 0.60 ms |
| A three.js, DPR 2 | 44.2 | 16.7 / 33.4 | 31 | 13 | | |
| A before cutting tessellation (130k triangles) | 17.2 | 50 / 83 | 152 | 25 | | |
| B Rive, DPR 1 | 59.6, 59.6 | 16.7 / 16.8 | 1 | 5.2 | 50 | 1.20 / 2.40 ms |
| B Rive, DPR 2 | 59.7 | 16.7 / 16.8 | 1 | 4.9 | | |

- A's headless frame rate is limited by SwiftShader's vertex work: halving the triangle count took it from 17 to 47
  fps. On a real GPU, 62k triangles and 45 calls are trivial.
- On the main thread, A is the cheaper of the two: 0.4 ms against 1.2 ms for Rive's wasm plus Canvas2D.

### Download and memory

| | Transfer | Detail |
|---|---|---|
| A | ~193 KB | `three.module.min.js` 167 KB (brotli), own code 26 KB |
| B | ~1.9 MB | `swings.riv` 1.26 MB (chairs.webp 714 KB, canopy.webp 529 KB, tower 12 KB), `rive.wasm` 607 KB (brotli; 1.89 MB raw), `canvas_advanced.mjs` 25 KB, code 12 KB |
| B, first bake (16 headings, PNG) | `.riv` 2.2 MB | Lossless WebP cut the atlases from 3.3 MB of PNG to 1.25 MB with no visible loss |

- B's decoded bitmaps take about 43 MB: 3120 × 2943 chairs plus 1408 × 1148 canopy, RGBA. A's geometry is a few MB.
- three.js and the Rive runtime are both paid once per page. After that, each extra ride costs:
  - A: about 15–30 KB of code;
  - B: about 1.3 MB of atlases plus ~40 MB of decoded memory for a ride of this kind.

### Effort to make the assets

| | Lines | What it took |
|---|---|---|
| Shared | 211 | `ride.js` 152, `bulbs.js` 59 |
| A | 393 | `model.js` 325, `layer.js` 68 |
| B | 342 + a generated 471-line RML | A's model, plus `bake.js` 124, `bake.mjs` 65, `gen_rml.mjs` 60, `layer.js` 86 |

- B can't exist without A's 3D model: the views have to match each other across 640 frames. Image generation can't
  produce that, and hand-painting it isn't realistic. So the 2D route is strictly more work for this ride: same model,
  plus a bake pipeline.
- Every model change means re-running the bake (~5 s) and the Rive build (30 ms). I did that five times during this
  test.

## What worked

- **One motion model for both builds.** Poses depend only on the master clock plus integrated speed, so A and B line up
  frame for frame at any `&t=`, and hover and taps behave the same. In the driven check:
  - stopped ride + hover → ω 0.67 rad/s, θ 6.5°;
  - two taps → ω 1.2 rad/s, θ settling at about 44°;
  - pointer leaves → the ride coasts back to the program.
- **Toon look from one shader.** Two-tone shading, hull outlines in darker shades of each fill, and pixel-width seam
  lines read as the style frame's flat colours and tinted lines.
- **Rive works for this ride, with restructuring.** Depth slots refilled each frame, a clipped atlas for view swaps, and
  the low-level runtime driven from the page's own frame loop via `rive.resolveAnimationFrame()`.
- **B is cheap per frame.** 60 fps headless at both DPRs with one long frame, against A's 25–30 in software.

## What didn't, and open problems

- **B's view pops are the main quality cost.**
  - With 16 headings, every chair swaps view on the same frame every 0.34 s at full speed, because 16 chairs spaced
    22.5° apart all cross the 22.5° heading grid together. It reads as a ride-wide tick (strip, middle row).
  - 32 headings halves the step and the size of each jump (bottom row) at twice the atlas size.
  - Tilt is quantised to 14° steps, so during spin-up and coast all chairs change tilt together.
  - A rotates continuously (top row).
- **No cross-fade in Rive from JS.** The low-level `Node` exposes x, y, rotation and scale, but not opacity, so views
  can't be blended to hide pops. Data-binding opacity through a view model would be the route to try.
- **B is capped at the bake resolution (2×).** Zooming the map past 2× softens the sprites; A stays sharp at any zoom.
- **Rive brings nothing here that plain Canvas2D sprites wouldn't.** Every pose comes from JS, so state machines, bones
  and the editor go unused, and the runtime still adds 607 KB of wasm.
- **Rive runtime traps:**
  - `canvas_advanced.mjs` requests `canvas_advanced.wasm`, but the package ships `rive.wasm`, so `locateFile` must
    map it.
  - The Canvas2D renderer is deferred: you need `resolveAnimationFrame()` when you own the frame loop.
  - One run failed to import the runtime from jsDelivr.
- **Look gap against the style frame.**
  - Both builds are cleaner and more CG-looking than the painted target: no wobbly ink, flatter canopy colours.
  - In a true orthographic view, the canopy hides the back chairs. The painting cheats and shows them below it.
  - Light is fixed to the upper left to match the painted stage.
- **Capture race.** `capture.mjs` uses a fixed wait, and twice it shot before a CDN-loaded layer had mounted: a blank
  ride with a clean console. `drive.mjs` with `["until","window.__swings"]` is reliable.
- **No GPU numbers.** WSL's GPU (d3d12) couldn't be reached from headless Chrome, so frame times on a real GPU are still
  unmeasured.
- **Per-layer canvases.** Each build is one canvas, so walking characters can't pass between the chairs and the column.
  The riders are inside the model, which avoids it for them.

## Recommendation: where the line between Rive and 3D falls

**Rule:** if a moving part turns out of the picture plane (shows different sides as it moves), or its draw order
against other parts changes while it moves, use 3D. If all motion stays in a plane, use Rive. That covers a wheel
turning, a gondola swinging in the wheel's plane, a drop tower sliding, a flag waving: `camera.planeAffine` makes these
exact, and Rive's authoring tools pay off.

| Ride or element | Use | Why |
|---|---|---|
| Dream Wheel (Ferris wheel) | Rive | In-plane rotation; gondolas swing in the same plane and always show the same face |
| Sea Swings, teacups, carousels, any turntable ride | 3D | Out-of-plane heading for every seat; depth order changes every half turn |
| Fireball (spinning ring on a pendulum) | 3D | The ring spins out of plane |
| Giant Dipper train, log-ride boats | 3D | Heading and bank change along a 3D track; sprites would need many headings and would pop like B |
| Awnings, flags, signs, lights, small decor loops | Rive | Planar, designer-friendly |
| Crowd of walkers | Sprite atlas, as in `CHARACTERS.md` | 3–4 views are acceptable for people; Rive only for featured characters |

Cost backs the rule:

- A 3D ride costs one 167 KB library shared by all rides, plus ~20 KB of code and ~50k triangles.
- A pre-rendered 2D version of the same ride costs ~1.3 MB, ~40 MB of decoded memory, and a bake pipeline that needs
  the 3D model anyway.

## Proposals for `base/` (not made)

1. `compose.js` sets `window.__ready = true` after every layer has mounted and drawn one frame, and `capture.mjs`
   waits for it. That would fix the blank-ride captures above.
2. Add an import map in `compose.html` for `three` and `three/addons/`, so layers can use addons. Bare `three` imports
   from addons fail today; I wrote my own merge and smooth-normal helpers instead.
3. `.slot canvas` forces 1536 × 1024. Make it a default (`:where(.slot canvas)`) so layers can use small canvases over
   their own box without inline overrides. Both builds here use a 320 × 290 box.
4. Render every 3D ride into one shared WebGL canvas and scene passed in `ctx`. That gives one context, one copy of the
   toon material, and correct depth order between 3D rides.
5. Optionally add a light direction to `time.look`, if 3D rides should follow the sun. The painted stage's shading is
   fixed, so I kept a fixed upper-left light.

## Rebuilding B

```sh
node boardwalk/tests/swings-rive/bake/bake.mjs              # options: "?headings=32&tilts=0,14,28,42,56&frames=16&scale=2"
node boardwalk/tests/swings-rive/bake/gen_rml.mjs
cd boardwalk/tests/swings-rive/rive && rive . --once
```
