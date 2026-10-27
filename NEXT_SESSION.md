# Next session: handoff

Updated 2026-10-26. Start Claude Code in `~/boardwalk` (its memory lives there).

## Where things are

- **Live:** http://ran:5178/ (the park; `board.html` is the style board). Tailnet only. Never hand the user localhost
  links. Server: `nohup setsid python3 -I tools/serve.py > .server.log 2>&1 < /dev/null &` on 127.0.0.1:15178 (no-cache
  headers); Tailscale (Windows CLI) maps it to `ran:5178`; the mapping persists across restarts.
- **Repo:** github.com/blueif16/boardwalk (private), branch main. Repo is 1.5 GB because every ride commits its raw
  4K source images (`rides/*/gen/`); see open issue 1.
- **The painting:** `gen/park/world_v2_hd.png` (9600 x 6400, kept out of git; lossless `.webp` beside it), shipped as
  `site/park/world_{1920..5120}.webp`. Park frame = 3840 x 2560 park px; camera in `tests/park-crowd/park.json`.
- **Not ours, uncommitted on purpose:** another session's landing title ("Shiran" + Explore): `site/title/`, and its
  lines in `index.html` and `README.md`. Commit our own index.html lines by staging a blob built from HEAD
  (`git hash-object -w` + `git update-index --cacheinfo`) so theirs stay out.

## Decisions the user made

- The whole official map on one screen, cover-fit, no scrolling, good on a 28" monitor and a MacBook.
- Ship-quality images: gpt-image-2.5, 3840 x 2560, quality high (`tools/shyfai_image.py` defaults). Meshy is paid:
  key in `~/.meshy_key` (980 credits left this month); ask before big spends.
- Animals: size 38; fewer (120) and calmer; many species. Rides matter most to the user: roller coaster, small cars,
  spinning things. Animals should ride the rides.
- Parallel subagents are approved; each works in its own `rides/<name>/` folder and writes a `RESULTS.md` recipe.
  Review every ride at full resolution beside the painting before adding it to `RIDES` in `index.html`.

## What moves (all on the default page)

| Layer | What | Method (see its RESULTS.md) |
|---|---|---|
| `rides/sea` | Waves roll in, foam washes up the sand | Painting's own ripple strokes and foam moved by masks; mode b default (`?sea=a/c` alternatives) |
| `rides/traffic` | 4 toy cars on Beach Street, crosswalks, parking | Meshy models rendered at the painting's camera from 32 headings; `tools/occluders.py` cut-outs so cars pass behind trees |
| `rides/coaster` | Giant Dipper trains | Path traced and snapped to the painted rails; generated cars; painted lattice laid back over |
| `rides/wheel` | Dream Wheel turns, loading stops | Plate erase; generated wheel and cabins; front legs cut from the plate |
| `rides/teacups` | Cups spin on a turning drum | Plate erase; small three.js scene matched to the drum |
| `rides/flume` | Log boats, lift, drop, splash | The coaster's path method on the painted water |
| `rides/pirate` | Pirate Ship swings | Plate erase; generated ship; rotation with the camera's squash |
| `rides/carousel` | Both carousels turn, horses bob | Roof and bands turn using the painting's own pixels (unwrap, delight, tile, shader); generated horses |
| `rides/thrill` | Double Shot drop, Typhoon loops | Painted towers kept; moving parts generated; Shockwave skipped (not in the painting) |
| `tests/park-crowd` | 120 animals: 35 species, kids, pets | Characters-test sim on a network measured on the painting; atlas from `build_atlas.py --park` |

Shared pieces: `tools/park_patch.py` (crop / paste with `--match`, `--changed`, hard polygon / cut),
`tools/park_world.py` (master -> 4K tiles -> stitch), `rides/RIDERS.md` (how the crowd boards rides), the
`mount(ctx)` contract in `index.html`'s header.

## Riders

Working on all seven passenger rides (coaster, wheel, teacups, flume, pirate, carousel, thrill): animals walk to a
gate, queue, board at the ride's load events, appear in the vehicle and step out at the exit. Gates, keys and the
implementation are in `rides/RIDERS.md`. About a quarter of the 120 animals ride at once (`&rideBoost=`, default 3).
Each ride still runs alone with its own riders (`?crowd=0`). The crowd canvas now renders at 1.5 px per park px over
only the band animals can reach (about 4x sharper); coaster, wheel and teacups got the same rule.

## Open issues, in priority order

1. **Repo size.** Move raw `rides/*/gen/**/*.png` and other 4K scratch out of git (an LFS store or a separate backup;
   ask the user) and keep only request records, prompts and shipped assets.
2. **One depth order.** The crowd canvas sits above every ride, so animals behind a ride draw over it (Pirate Ship,
   wheel). The cheap fix is specified in `rides/RIDERS.md` (rides return `occluders: [{rect, sortY}]`, the crowd clips
   animals behind them); longer term one shared sorted pass. Lift `rides/traffic/tools/occluders.py` into `tools/` so
   the crowd also passes behind painted trees and lamps.
3. **Shared finishing pass.** Live layers are still a little cleaner and brighter than the painting (cups, cars,
   ship): paper grain, tinted lighter outlines.
4. **Sharpness on the remaining rides:** flume, pirate and thrill canvases are still at screen density (soft at
   2560); give them the carousel's 1.5-2.5 px per park px rule.
5. **One three.js renderer** for the 3D rides (teacups is its own WebGL context today); a `ready` promise from
   `mount` so the page's ready flag waits for ride assets; `ctx.canvas(slot, {rect})`.
6. **Sitting and waving poses** for riders (all riders are standing sprites clipped by the seat).
7. **Time of day.** Painted plates per slice were decided in the bakeoff; not yet made for the whole park.
8. **Painting flaws:** the Undertow's yellow track is a tangle, a broken staircase near the wheel, the east-end
   kiddie rides are hard to tell apart. Fix with `park_patch.py`.
9. **Rides not yet moving:** Fireball (the coaster lays its hub over the train; move both together), Sea Swings,
   Undertow, Sky Glider chairs, the east-end kiddie and flat rides, bumper cars, Shockwave (needs painting in),
   the trestle train. Each ride's RESULTS.md ends with what transfers.
10. **Phones in portrait** need their own layout; the 3:2 painting can't fill a tall screen.
