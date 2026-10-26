# wheel-rive: the Dream Wheel as a page-driven Rive ride

View: `http://localhost:5178/base/compose.html?tests=wheel-rive`
(add `&time=night`, `&time=golden`, `&t=3` for a frozen frame, `&rive=webgl2` for the WebGL2 runtime, `&bench=10`).

**Question:** does a page-driven Rive ride look right and run well?
**Answer:** yes, with the Canvas2D runtime.
- **Looks:** the projection is exact to 0.0001 px; cabins hang upright; the wheel stands in its fenced platform by day,
  golden hour and night. It is cleaner and flatter than the painted base.
- **Runs:** both artboards cost 2–4 ms of JS a frame, and the page holds 60 fps headless with the base grade off.
  With the grade on, any animated layer (Rive or a plain canvas) drops it to ~40 fps headless.
- **Driving:** the page owns the clock and the angle through the view model, without trouble.
- **WebGL2:** too slow to judge in headless Chrome.

## What I built

| File | What it is |
|---|---|
| `wheel.js` | Shared config (heading, hub height, rim, cabins, box) and geometry from `camera.planeAffine` / `camera.riveTransform` |
| `build.mjs` | Generates `rive/scene.rml` from the same geometry, builds it with the Rive CLI (`rive rive --once`), copies `wheel.riv`, writes `wheel.meta.json` |
| `wheel.riv` | 60.4 KB, two artboards (`Wheel`, `WheelLights`), one view model, no scripts, no images |
| `layer.js` | Loads `@rive-app/canvas-advanced@2.42.2` (or `webgl2-advanced`), drives both artboards from compose's frame, hover/tap, fence overlay |
| `shots/` | Screenshots below |

Rebuild after editing the art or geometry: `node boardwalk/tests/wheel-rive/build.mjs`.

### Projection
- **Heading:** the wheel's plane runs along world x, parallel to the strip and the wall rail. On this camera that
  reads almost face-on: a near-circle (0.91 wide x 0.90 tall per unit radius), tilted 11° like the rail. The style frame
  agrees: its front feet slope down to the right and the back rim sits up-right of the front one. Its painted wheel is a
  little taller than wide, which is painter's licence; a ~35° heading would match that ratio but no longer reads face-on.
- Plane axes `u = (1,0,0)`, `v = (0,-1,0)` (down, so plane coordinates are Rive's y-down coordinates). `planeAffine(u, v)`
  then `riveTransform` gives `outerRotation 0.7499, scaleX 1.0, scaleY 0.8007, innerRotation -0.6408`.
- Every planar group is `Outer (outerRotation, scaleX, scaleY) > Frame (innerRotation) > Offset > Spin (angle)`; the
  page writes all five values into the view model, so the page owns the projection, not the file.
- Depth along the axle (two rims at ±7, two A-frames at ±20, the axle, the hub cap) is the axle's screen vector pulled
  back into plane coordinates (`M⁻¹·project(n)`), so each layer is just a plane-space offset inside the same frame.
- **Sign convention verified against Rive:** `window.__wheelRive.check()` reads each anchor's `worldTransform()` from
  the runtime and compares it with `camera.toPixel` of the same 3D point. Max error at angles 0, π/4, π/2, 3π/2:
  **0.0001 px**. Positive angle in Rive (y down) turns plane +u towards +v (down), which is clockwise on screen, as
  `riveTransform` assumes. No sign flip needed.
- **Cabins** hang upright: each cabin node sits outside the squashed groups and carries a `TranslationConstraint`
  (world to world) to an anchor node on the spinning mid-plane. Check: cabin-to-anchor distance 0 px, cabin scale
  1.0 on both axes, cabin rotation equal to the page's sway value (error 0).
- The front of the platform's fence is cut from `stage.png` with a CSS `clip-path` (the calibrated rim and floor
  ellipses, plus the gate stairs) and placed over the wheel in the `rides` slot. That puts the front feet and contact
  shadows behind the painted fence, while characters in the slot above still pass in front.

### Page-driven motion
- `angle = ω · (clock.now() + extra)`, one turn per 36 s. `extra` integrates `(speed − 1)·dt`, so a frozen `&t=` gives
  a repeatable frame.
- Hover: speed eases to 2x with τ 0.2 s (1.96x after 0.6 s, measured) and coasts back with τ 0.8 s (measured: 1.41x after
  0.5 s, 1.11x after 1.5 s, 1.03x after 2.5 s). Touch taps give the same boost for 1.6 s.
- Cabin sway is a damped pendulum per cabin, driven by the tangential acceleration at that cabin while the wheel speeds
  up or slows down. 12 `sway` numbers are written each frame (~5° peak).
- Each frame: `spin` + 12 `sway` values per artboard, then `advanceAndApply(dt)` and draw. The Canvas2D renderer
  defers draws, so the page calls `rive.resolveAnimationFrame()` at the end of compose's frame: no second rAF loop, no
  frame of lag.
- Hit test in JS on the world element (plane coordinates for the rim and legs, boxes for the cabins), so it works
  whatever other layers stack above.

### Tap and night
- Tap fires a view-model trigger `tap`. In `Wheel` it plays `Jiggle`: a damped swing that runs round the cabins with a
  25 ms stagger, plus a hub-star pop. In `WheelLights` it plays `Sparkle`: a three-phase bulb chase. In daylight the page
  also raises the lights layer for 1.6 s, so a tap flashes the bulbs.
- `WheelLights` is a second canvas in the `lights` slot, above the grade, with `mix-blend-mode: screen`. It holds 36 rim
  bulbs, 12 ring bulbs, 12 roof lamps, warm window glows, a lit star and a faint spill. All of it is scaled by
  `time.look.lights` through a bound `opacity`. An idle `Twinkle` loop alternates odd and even bulbs. When lights are
  0 the canvas is hidden and not drawn.

### Vector, not raster
All art is vector RML, generated from code. Reasons:
- The rim, spokes and bulbs rotate. Thin lines in vector stay crisp at every angle and zoom; a rotated bitmap smears.
- The file is 60 KB. Glows and bulbs land exactly on the geometry.
- None of the Canvas2D image-mesh traps apply (the ~0.8 Mpx² mesh limit, `clip`, decode timing).

The cost is texture. The wheel reads as a clean storybook vector over a painted, watercolour-ish base (see
`vs_style_frame.png`). If that gap matters, the cabins are the place to go raster: they never rotate (only sway a few
degrees), so they could be plain `Image`s, not meshes, at ~60x80 px each. Not tried here.

## Screenshots

| Shot | |
|---|---|
| `shots/midday.png` | Midday, 2x |
| `shots/golden.png` | Golden hour: bulbs half lit |
| `shots/night.png` | Night: graded wheel plus the lights layer |
| `shots/midday_context.png`, `shots/night_context.png` | The wheel in the scene at 1x |
| `shots/vs_style_frame.png` | Left: style frame `dipper_wheel_v2_0.png`, same region. Right: this layer at midday |
| `shots/cabins_4x.png` | Cabin detail: pods with two passengers each |
| `shots/tap_day.png` | 250 ms after a daytime tap: bulb flash and cabin jiggle |
| `shots/night_webgl2.png` | Same frame with `&rive=webgl2`: identical |

Against the style frame: same place, same blue A-frame, colourful rim, 12 cabins with animals, thin tinted outlines.
Differences: the painting's cabins are larger, rounder pods with painted shading; its rim is a thick yellow-orange
tube; its wheel is drawn taller than the camera allows; and there is no watercolour texture. At night the wheel becomes
the focal light of the scene, and the window glow keeps the passengers visible.

## Performance

Headless Chrome only (SwiftShader software GL), 1536x1068 at dpr 1 unless noted, `&bench=10` (10 s each). The other
six agents were running their own tests at the same time (load average 3–20 on 16 cores), so read fps as ranges.
"Layer" is this layer's own JS per frame: view-model writes, `advanceAndApply`, draw and flush for both artboards.

| Run | fps | p95 ms | long frames | layer p50 / p95 ms |
|---|---|---|---|---|
| Stage only, midday (2 runs) | 60.1 | 16.7 | 0 | – |
| **canvas**, midday (3 runs) | 35.6–43 | 33–50 | 33–50 | 2.0–3.0 / 5.3–9.3 |
| **canvas**, night (3 runs) | 28.3–40.4 | 33–67 | 30–89 | 3.5–6.6 / 6.9–17.8 |
| canvas, night, dpr 2 | 39.9 | 50 | 42 | 3.3 / 8.8 |
| Control: plain 2D canvas, same box, 40 / 400 arcs per frame, no Rive | 36.8 / 47 | 33–50 | 31–48 | – |
| **canvas, `&grade=off`**, midday / night | **59.9 / 60.0** | **16.8** | 1 / 0 | 2.0 / 3.3, 3.6 / 7.8 |
| Control, 400 arcs, `&grade=off` | 60.1 | 16.7 | 0 | – |
| canvas, `&cpu2d` (CPU-rastered 2D canvas), midday / night | 53 / 44.9 | 33 | 16 / 18 | 1.8 / 3.8, 3.3 / 5.7 |
| **webgl2** (shared offscreen renderer), midday / night | 8.7–11.5 / 7.8–8.3 | 100–217 | 78–115 | 83–117 / 100–200 |
| webgl2, `&direct` (own GL context per canvas) | 8.7–10.8 | 100–133 | 87–108 | 1.4–1.6 / 2.9 |

- **Rive itself is cheap.** Both artboards cost 2–4 ms of JS a frame (p95 under 10 ms). With the base's colour grade off,
  the page holds 60 fps with p95 16.8 ms, by day and by night.
- **The ~40 fps with the grade on is not Rive.** A plain 2D canvas animating in the same box drops the page just as far,
  and both recover to 60 with `&grade=off`. The grade (a CSS `filter` on four slots plus a full-world
  `mix-blend-mode: multiply` div) makes the whole graded world recomposite in software every time anything under it
  changes. A real GPU may shrug this off, but it is the first thing to measure on hardware, and it affects every animated
  test.
- **WebGL2 is GPU-bound in SwiftShader**: 9–11 fps even when its JS is only 1.5 ms. Headless can't judge it.
- Weight: `.riv` 60.4 KB. The canvas runtime adds 0.68 MB transfer (wasm 621 KB compressed, 1.94 MB raw; js 65 KB), so
  the page goes from 2.65 to 3.33 MB. WebGL2 brings it to 3.41 MB (wasm 2.20 MB raw). JS heap 5–21 MB.
- Draws reported to the bench: 385 paints by day (`Wheel`), 532 at night (+147 for `WheelLights`).

**Runtime chosen: `@rive-app/canvas-advanced@2.42.2` (Canvas2D).** It hits 60 fps headless once the grade is out of the
way. It needs no WebGL context next to three.js and the water shader, and its wasm is the smaller one. This art is
vector-only, so it uses nothing the Rive Renderer adds (feathering, big image meshes). The low-level ("advanced") package
lets the page own the loop; the high-level `Rive` class would run its own rAF. Re-check WebGL2 on a real GPU before ruling
it out, especially for a ride with feathered glows or large image meshes. Diagnostic flags: `&rive=webgl2`, `&direct`,
`&cpu2d`.

## What worked
- RML generated from JS, sharing `camera.js` with the page. The build takes < 1 s and catches name errors. The runtime
  `worldTransform()` check turned "is the projection exact?" into a number.
- Binding transforms to view-model numbers. One view model serves both artboards; the page writes plain numbers; no
  Luau, nothing to sign.
- `TranslationConstraint` for unsquashed cabins: exact, and free at runtime.
- The low-level runtime inside compose's frame, flushed with `resolveAnimationFrame()`.
- View-model trigger to `AnyState` transition for Rive-authored reactions (the jiggle and the chase), layered over
  page-owned motion.

## What didn't
- **WebGL2 runtime in headless Chrome:** 8–11 fps, with identical pixels (`shots/night_webgl2.png`). With the default
  shared offscreen renderer the frame time lands in JS (83–117 ms); with `&direct` the JS drops to 1.5 ms but the
  frame is just as slow. SwiftShader executing the Rive Renderer's shaders is the bottleneck, so this needs a real GPU.
- **The page's colour grade costs ~20 fps headless for any animated layer** (see Performance). Not a Rive issue, but
  this test is where it showed.
- **`scripts/capture.mjs` misses this layer's canvas** (`captureBeyondViewport` shots show the stage only), while
  `scripts/drive.mjs` shots show it. All shots here come from `drive.mjs`. Worth a look in `capture.mjs`.
- The wasm asks for `canvas_advanced.wasm` but the package ships `rive.wasm`, so `locateFile` must return `rive.wasm`
  for any request.
- `rive --screenshot` takes ~3 minutes per frame on this machine (software 4x MSAA), so it is useless for iteration.
  The real page through `drive.mjs` takes ~15 s.
- Bulbs in the lights layer draw over the front A-frame where a leg crosses the rim (the lights slot is above
  everything). Barely visible.
- Hover sets `world.style.cursor`, a shared element; two layers doing this would fight.

## Recommendation
Use Rive for rides that turn or swing in a plane: wheel, gondolas, swings, flat rides seen side-on. Use the
**Canvas2D advanced runtime**, driven from the page's frame, with:
1. the projection split by `riveTransform` and bound through the view model;
2. constraints for anything that must hang upright;
3. a second artboard in the `lights` slot for night.

Keep the art vector for anything that rotates. Make the case-by-case texture call on the non-rotating parts.

Proposals for `base/`:
1. Measure the colour grade on real hardware. If the full-world `filter` plus `mix-blend-mode` recomposite costs
  there too, apply the grade per layer instead (a canvas can multiply its own pixels, or a layer can take
  `look.tint` itself), or as a single filter on `.world`.
2. A shared "front fence" helper that cuts a platform's front arc from `stage.png` (this test's `fenceOverlay`),
  since every ride standing on a fenced platform needs it.
3. Have `compose.js` own the cursor, or give layers a `ctx.setCursor(name, on)`.
4. Load the Rive runtime once for all Rive tests: one wasm (~0.6 MB transfer).
