# Next session: handoff

Updated 2026-10-26 (evening). Start Claude Code in `~/boardwalk` (its memory lives there).

## Where things are

- **Live:** http://ran:5178/ (the park; `board.html` is the style board). Tailnet only. Never hand the user localhost
  links. Server: `nohup setsid python3 -I tools/serve.py > .server.log 2>&1 < /dev/null &` on 127.0.0.1:15178 (no-cache
  headers); Tailscale (Windows CLI) maps it to `ran:5178`; the mapping persists across restarts.
- **Public site:** https://me.infinityopus.com (Vercel project `boardwalk`, team blueif16s-projects; DNS at Cloudflare,
  a CNAME to Vercel). Publish with `tools/deploy.sh` (crawls the page into `dist/`, checks it, `vercel deploy --prod`).
  Explore leaves for the original site, the Vercel project `astro-blog`: `EXPLORE` in index.html points at
  astro-blog-lemon.vercel.app until the Cloudflare CNAME for blog.infinityopus.com is in (already added in Vercel);
  then switch it and redeploy.
- **Repo:** github.com/blueif16/boardwalk (private). Tonight's work is on branch `park-night-beach` (pushed); main
  is one commit behind until it's merged. Repo is 1.5 GB because every ride commits its raw
  4K source images in its history. Since 2026-10-26 every `gen/` and `work/` folder is out of git (`.gitignore` keeps
  their json/txt/glb records and the style frame) and backed up to D:\boardwalk-raw (`/mnt/d/boardwalk-raw`, same
  paths; refresh with rsync, see `.gitignore`). Shrinking the old history needs a force-push: ask first.
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
  Review every ride at full resolution beside the painting before adding it to `RIDES` in `index.html`. Give them a
  time box: the user found 1.5 h runs too long (2026-10-26) and asked them to wrap up.
- One carousel only: the west one (the Looff Carousel's place). The east one became the Sea Swings, where the
  official map puts it.
- The hidden corgi: no reward for finding it; an animation every find, the paw count and the woof hint.

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
| `rides/carousel` | The west carousel turns, horses bob | Roof and bands turn using the painting's own pixels (unwrap, delight, tile, shader); generated horses |
| `rides/swings` | Sea Swings (replaced the east carousel): canopy lifts and spins, chairs swing out | Plate painted in by one edit; canopy turned by the carousel method; 12 chair sprites as damped pendulums |
| `rides/beach` | 34 beach-goers: 2v2 volleyball, sunbathers, camps, lifeguard, swimmers, body-boarder, waders, dog, kite | Pose sheets for 12 species; props with a finishing pass; motion on the clock, swimmers timed to the sea |
| `rides/wildlife` | Gulls, a gull on a stair post, pelicans diving, otter, fish, seal, dolphins, a whale | Generated sheets with the painting's whites, grain and softened outlines; birds on small travelling canvases |
| `rides/corgi` | Find-the-corgi game: 7 hiding scenes, "?" badge top right, paw count, woof hint | The crowd's corgi sheet at 4 px per park px; `localStorage` for spots found |
| `rides/thrill` | Double Shot drop, Typhoon loops | Painted towers kept; moving parts generated; Shockwave skipped (not in the painting) |
| `tests/park-crowd` | 120 animals: 35 species, kids, pets; they pass behind rides, lamps, stalls and the rail | Characters-test sim on a network measured on the painting; atlas from `build_atlas.py --park`; depth in `DEPTH.md` |

Shared pieces: `tools/park_patch.py` (crop / paste with `--match`, `--changed`, hard polygon / cut),
`tools/park_world.py` (master -> 4K tiles -> stitch), `rides/RIDERS.md` (how the crowd boards rides), the
`mount(ctx)` contract in `index.html`'s header.

## Riders

Working on all eight passenger rides (coaster, wheel, teacups, flume, pirate, carousel, swings, thrill): animals walk to a
gate, queue, board at the ride's load events, appear in the vehicle and step out at the exit. Gates, keys and the
implementation are in `rides/RIDERS.md`. About a quarter of the 120 animals ride at once (`&rideBoost=`, default 3).
Each ride still runs alone with its own riders (`?crowd=0`). The crowd canvas now renders at 1.5 px per park px over
only the band animals can reach (about 4x sharper); coaster, wheel and teacups got the same rule.

## Open issues, in priority order

1. **Merge `park-night-beach` into main**, and switch Explore to blog.infinityopus.com once its DNS record exists.
2. **Page weight** (applied 2026-10-26: WebP re-encodes and the load order; still open: AVIF, a check on a real
   MacBook over 4G, per-file cache hashes): `tests/perf/ASSETS.md` (WebP re-encodes at the same URLs:
   14.8 -> 7.2 MB at 2560, no code change; AVIF about 5.9 MB but needs code in every layer) and
   `tests/perf/LOADING.md` (painting first, rides after, loop started first, placeholders: sharp painting at 3.0 s
   instead of 7.1 s on 4G; `tests/perf/index_loading.diff`, re-made by `tests/perf/tools/load_apply.py`; host:
   Cloudflare). Each has a decisions list for the user.
3. **Time of day** (designed and prototyped on one slice, not on the park): `tests/night-park/` (the look: relight
   fields fitted to relit plates, about 1 MB for all times) and `tests/night-lights/` (every light from an inventory of
   painted fixtures; whole park about 10-12 h, no generations). Both RESULTS.md end with the user's decisions.
4. **Depth leftovers.** The depth order is done (`tests/park-crowd/DEPTH.md`); still open: the flume exit path runs
   through a kiosk, ride-against-ride order, crowd animals joining beach activities (needs a sand-level queue).
5. **Shared finishing pass.** Live layers are still a little cleaner and brighter than the painting (cups, cars,
   ship): paper grain, tinted lighter outlines.
6. **Sharpness on the remaining rides:** flume, pirate and thrill canvases are still at screen density (soft at
   2560); give them the carousel's 1.5-2.5 px per park px rule.
7. **One three.js renderer** for the 3D rides (teacups is its own WebGL context today); a `ready` promise from
   `mount` so the page's ready flag waits for ride assets; `ctx.canvas(slot, {rect})`.
8. **Sitting and waving poses** for riders (all riders are standing sprites clipped by the seat).
9. **Painting flaws:** the Undertow's yellow track is a tangle, a broken staircase near the wheel, the east-end
   kiddie rides are hard to tell apart. Fix with `park_patch.py`.
10. **Rides not yet moving:** Fireball (the coaster lays its hub over the train; move both together),
   Undertow, Sky Glider chairs, the east-end kiddie and flat rides, bumper cars, Shockwave (needs painting in),
   the trestle train. Each ride's RESULTS.md ends with what transfers.
11. **Phones in portrait** need their own layout; the 3:2 painting can't fill a tall screen.
