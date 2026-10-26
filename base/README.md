# Boardwalk shared base

Every test builds on this folder and is judged against the same stage, camera, palette and time of day. Read
`../STYLE.md` first.

## Run

- The repo is served at `http://localhost:15178/` (`python3 -m http.server 15178 --bind 127.0.0.1` from the repo root); on the tailnet it is `http://ran:5178/`.
- One test: `http://localhost:15178/base/compose.html?tests=<name>`
- Several together: `?tests=wheel-rive,water,characters`
- Time of day: `&time=morning|midday|golden|night` or `&time=21.5` (hours). Without it the page follows the viewer's clock.
- Frozen clock for screenshots: `&t=12.5` (seconds).
- `&grade=off` turns off the base's colour grade, for a test that brings its own time-of-day look.
- Benchmark: `&bench=10` measures 10 s, prints `bench {json}` to the console and sets `window.__bench`.
- `?tests=calibration` draws the measured platforms and the camera's axes over the stage.

## Files

| File | What it is |
|---|---|
| `stage_4k.png`, `stage_4k.webp` | The empty stage at 3840 x 2560 (2.5 image px per stage px): the Giant Dipper slice of the official map in our style, with every ride's moving parts and every character removed. Live layers go on top. The page shows the WebP (1.7 MB); the PNG is the master. |
| `stage.png` | The same stage downscaled to 1536 x 1024, for tools that read stage pixels |
| `stage.json` | Measured camera, platforms (floor centre, radius, fence height, gate), the wall rail, the stairs |
| `camera.js` | `createCamera(stage)`: pixel/ground conversion, three.js camera, Rive affine helper |
| `time.js` | Four looks (morning, midday, golden, night) blended by hour |
| `clock.js` | The master clock: every motion is a function of `clock.now()` |
| `bench.js` | Frame-time statistics |
| `compose.html`, `compose.js`, `compose.css` | The page that stacks the layers |

## Coordinates and camera

- Stage pixels: 1536 x 1024, origin top-left, y down. Every layer draws in stage pixels; the page scales the whole world
  to fit the window.
- Ground units: world x runs along the strip (east), z towards the viewer (south), y up. One ground unit is one stage
  pixel along the screen's horizontal. The scale is the painting's, not metres: rides are sized to their platforms.
- Camera: orthographic, yaw 24.1°, pitch 28.7°, no roll. A ground circle of radius r appears as an ellipse r wide and
  r·sin(28.7°) = 0.48r tall, with its long axis horizontal.
- `camera.toGround([px, py], height = 0)` gives the world point under a pixel; `camera.toPixel([x, y, z])` the
  reverse. `camera.toGround(stage.platforms.sea_swings.floor)` is where that ride stands.
- three.js: `camera.three(THREE)` returns an `OrthographicCamera` that reproduces the stage's projection exactly, with
  world (0, 0, 0) at the stage centre (768, 512). Render into a transparent canvas of 1536 x 1024 CSS px.
- Rive: anything that moves in a flat plane (a wheel turning, a gondola swinging) is exact in 2D. `camera.planeAffine(u,
  v)` gives the 2 x 2 matrix that maps the plane's two unit axes (world vectors) to the screen, and
  `camera.riveTransform(m)` splits it into an outer node (`outerRotation`, `scaleX`, `scaleY`) and an inner rotation:
  spin the inner node by `innerRotation + angle`. Angles are radians, screen y down; check the sign once against Rive.

## Layer contract

A test lives in `tests/<name>/` and exports `mount(ctx)` from `tests/<name>/layer.js`:

```js
export async function mount({ stage, camera, time, clock, slots, world, bench, base, dir, params }) {
  return { update(dt, t) {} };
}
```

- `slots`: divs stacked bottom to top: `water`, `rides`, `characters`, `front`, then the colour grade, then `lights`
  and `debug`. Put your canvas or elements in the slot that matches what you draw. Slots ignore the pointer except for
  their children.
- `time.look`: `{ name, hour, tint, exposure, saturation, lights (0..1), sky, sea }`; `time.onChange(fn)`. The page
  grades the stage and the `water`, `rides`, `characters` and `front` slots for you. The `lights` slot sits above the
  grade, so lit bulbs and windows stay bright: draw them there, scaled by `look.lights`.
- `clock.now()`: seconds on the master clock. Derive every pose from it, so a frozen `&t=` gives a repeatable frame.
  State with memory (spin-up and coast-down) integrates `dt`.
- `bench.report(name, drawCalls)` adds your draw calls to the benchmark.
- `dir` is your test folder's URL, for loading your own assets.

## Rules for tests

- Write only inside your `tests/<name>/`. Propose changes to `base/` in your `RESULTS.md` instead of making them.
- Generated images: `python3 -I tools/shyfai_image.py OUT --prompt-file P --ref ...` from the repo root (see the tool's
  header). Its defaults are the shipping settings (gpt-image-2.5, 3840x2560, quality high); see `../STYLE.md`.
  Keep prompts and outputs in your test folder. Use `base/stage.png` and the style frames as references; never
  the third-party `reference/style_ref*.jpg`.
- 3D generation: Meshy through `~/3d_director/qingming/tools/meshy_task.py` (read its header first; Meshy deletes outputs
  after 3 days, so download at once).
- Screenshots and checks: `node scripts/capture.mjs <url> --select .world --out <png>` and `node scripts/drive.mjs`
  from the repo root. Headless Chrome renders WebGL in software, so its frame rates are not the real GPU's; report
  them as headless numbers.
- Finish with `tests/<name>/RESULTS.md`: what you built, screenshots (in `tests/<name>/shots/`), the benchmark,
  what worked, what didn't, and your recommendation.

## Known limits

- Each layer is its own canvas, so a character cannot pass behind one ride and in front of another across layers.
  Note where this shows; it decides how the final page sorts depth.
- `stage.json` positions were measured by eye on zoomed crops; platforms marked `approx` are rougher.
