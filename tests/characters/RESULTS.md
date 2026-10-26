# Characters test: the crowd on the stage

View: `http://localhost:5178/base/compose.html?tests=characters`

| Param | Meaning |
|---|---|
| `&n=150` | crowd size at midday (the default); other hours scale it by the density table below |
| `&time=morning\|midday\|golden\|night` | time of day (the base's param); the crowd follows live changes too |
| `&walk=1` (`&walk=plain`) | debug view of the walking network, with (without) labels |
| `&sprites=shyfai\|m3d_child\|m3d_child_flat\|mix` | sprite set: shyfai sheets (default), the rendered Meshy figure lit or unlit, or both |
| `&px=30` | character height in stage px (30 = the brief; 47 = what the map crop draws, see below) |
| `&occ=0` | turns off the stage cut-outs that people walk behind |
| `&seed=1`, `&t=…`, `&bench=10`, `&finish=1` | crowd seed; frozen clock (the crowd is a deterministic sim fast-forwarded to `t`); benchmark; `gl.finish()` timing |

## What I built

| File | What it is |
|---|---|
| `walk.json` | the walking network, stage px + `h` + ground `g` from `camera.toGround`: 255 nodes, 267 edges, 175 places |
| `layer.js` | mounts the crowd: loads `walk.json` + atlas, runs the sim on the master clock, draws, reports 1 draw call |
| `sim.js` | the crowd: groups, destinations, activities, queues, facing, time-of-day density (plain JS, also runs in Node) |
| `render.js` | WebGL2 sprite batcher: one texture, one dynamic vertex buffer, one `drawElements` per frame |
| `debug.js` | the network debug view (`&walk=1`) |
| `atlas.png/json` | one 1024² atlas: 9 shyfai characters × 12 frames, 2 rendered 3D sets × 40 frames, shadow, ink, 91 stage cut-out strips |
| `tools/make_walk.mjs` | traced points → `walk.json` (lanes, stairs, gates, queues, stalls, benches, rail, beach, exits) |
| `tools/build_atlas.py` | sheets → keyed, scaled, outlined frames; merges 3D renders and cut-outs; packs the atlas |
| `tools/make_occluders.py` | front cut-outs from `stage.png`: rail, 5 lamps, 3 stalls, a palm, each with a sort line |
| `tools/render3d.{html,js,mjs}` | renders a rigged GLB to sprites: stage pitch, 8 headings × (stand + 4 walk frames), exact feet anchor |
| `prompts/`, `gen/` | shyfai prompts and sheets, the bear turnaround for Meshy, the 3D test model and renders |

### 1. The walking network (`walk.json`, `shots/walk_debug.png`, `shots/walk_debug_zoom.png`)

- **Lanes:** an eastbound south lane near the rail (`s*`) and a westbound north lane (`n*`), so traffic keeps right. Each lane edge has a direction; going against it costs 2.6× in the route search. Cross links between the two lanes are placed automatically wherever no stall or platform is in the way.
- **Stairs:** the five stairs from `stage.json`, each traced top (deck, `h` 0) to bottom (sand, `h` −40: the wall is about 35 px tall on screen). A path runs along the sand below the stairs, with exits at the beach edges.
- **Places:**
  - queues at the two gates in `stage.json`, 12 slots each, curving along the platform front;
  - an approximate gate for fireball (`approx: true`; `stage.json` has none);
  - 6 stall counters, 2 benches, 9 hangouts, 4 photo spots, 10 ride-watching spots;
  - 31 rail spots and 110 beach spots (Poisson-sampled on the sand).
- **Ground coordinates:** every node and slot has them, from `camera.toGround(px, h)`. The sim runs in ground units and draws through `camera.toPixel`.
- **Rail finding:** the painted rail is not where `stage.json` puts it. The rail top measures (60, 562) … (1460, 900), a slope of 0.241 against `stage.json`'s 0.215. East of x ≈ 500 it is 10–45 px lower than `wall.railTop` (918 vs 878 at the right edge), so I traced my own polyline (`walk.json` `rail`). The deck edge is the rail top + 17 px, so people can stand that far "below" the rail bar on screen.

### 2. The agents (`sim.js`)

- **Destinations:** every group walks the graph to a destination, does something there, then picks the next destination, weighted by time of day and how near it is. Nobody loops.
  - queue at a ride gate;
  - buy at a stall, then eat at a nearby hangout, or right beside the stall when none is near;
  - sit on a bench, lean on the rail, take a photo, watch a ride;
  - go down a stair to a beach spot (towel sit, stand, sandcastle);
  - stroll a short way, or leave by an exit.
- **Queues:** members face the next person ahead and the front person faces the gate (`shots/queue_zoom.png`). Every 34–44 s the front 3–5 board as whole groups, disappear for the ride (the platforms are empty in this test) and come back out at the gate.
- **Groups:**
  - singles, couples, friends, families (a kid ahead of the parents), joggers, dog walkers with a pet and a 1 px lead;
  - one shared pace and route per group, with members at offsets, single file on stairs;
  - pauses (1–3 s) are triggered more often by kids: the kid turns, the group stops.
- **Facing:** walkers face their direction of travel, using the view nearest the camera-relative heading, with ±7° hysteresis and a 2 px hop when the view swaps. Still people face what they do:
  - the stall (back view), the sea (front: benches, rail, beach), each other (eating), the gate or the next in line (queue), the ride (watching, photo);
  - rail watchers and ride watchers turn their heads now and then.
- **Contact shadows:** one per character, flattened while hopping. Everything is depth-sorted by feet.
- **Stage cut-outs:** people walk behind the rail, lamps, stalls and a palm. These are cut from `stage.png` with the deck colour keyed out, sliced into 24 px strips, each with a sort line on the object's base, and sorted together with the characters in the same draw call (`shots/occ_off_on.png`: top without, bottom with).
- **Walker share:** averaged over 60–600 s of sim:

  | Case | Walker share |
  |---|---|
  | midday, n = 100–300 | 39–40% |
  | morning (joggers, dogs) | 45% |
  | golden | 43% |
  | night | 48% |
  | n = 1000 (places full) | 56% |

  The brief's starting point was about 1 in 3. The levers are the activity durations, the stroll and leave weights, and the pause rate in `sim.js`.

### 3. Sprites: shyfai sheets vs Meshy renders (`shots/compare_sprites.png`)

**shyfai sheets** (`prompts/sheet_common.txt`, refs `v1_1.png` + a crop of its characters):
- **What was made:** 9 sheets, one call each (36–103 s): bear, bunny, orange cat, shiba, grey cat, bear cub (kid), floppy-eared bunny, cream puppy, and a pet dog on four legs.
- **Layout:** a 4 × 3 grid of front / side / back × stand, walk A, walk B, plus one activity each (sit; ice cream; phone photo).
- **What worked:**
  - All 9 kept the grid on the first try.
  - Views match each other well at 30 px: same head shape, colours and clothes.
  - The look is the style frame's family (chunky, dot eyes, rosy cheeks, pastel t-shirts) once a 1 px ink outline is added after downscaling.
- **Defects, each handled automatically or in the prompt:**
  - The first sheet's two side-walk cells showed the same leg. Fixed in the prompt; the walk also plays walk A, stand, walk B, stand.
  - Three sheets drew one side cell facing left. These are detected by comparing head shapes and mirrored.
  - `background=transparent` was ignored, so the white is flood-keyed from the cell edges; white fur survives because the outlines are closed.
- **Weaker than the frames:** fills are flatter, more "sticker" than v1_1's painted characters. Only 3 views exist, so promenade walkers (camera-relative heading 66°) show a pure profile where a ¾ view would be true.

**Meshy 3D → sprites:**
- **Blocked.** Meshy refused task creation (HTTP 402, "task creation on the free plan is no longer supported") on the configured key (`msy_VYNl…`, 100 credits, nothing spent). The bear turnaround for it is ready (`gen/meshy/bear/front|side|back.png`, from `turnaround_bear_0.png`). Once the plan allows it, run `python3 -I ~/3d_director/qingming/tools/char_pipeline.py . front.png side.png back.png --height 1.0 --actions ""` from that folder (mesh 15 + retexture 10 + rig 5 credits), then `node tools/render3d.mjs ../gen/meshy/bear/3_rig/result_basic_animations_walking_glb_url.glb m3d_bear`.
- **What I tested instead** was the render half, on a Meshy character already paid for: qingming's `child` (sheet → mesh → retexture → rig → walking clip). It was rendered at the stage's 28.7° pitch from 8 headings, with stand + 4 walk frames from the rig's walk, and sent through the same downscale and outline (`&sprites=m3d_child`, `shots/m3d_child_zoom.png`, `shots/m3d_child_n150.png`).
- **What the 3D path gives:**
  - views that always match;
  - 8 (or any number of) headings, so the 66° promenade direction gets its ¾ view;
  - a smooth 4-frame walk, and any number of frames at no cost.
- **What it costs:**
  - The style lives entirely in the model. The realistic-proportioned child reads as small dark soldiers at 30 px, nothing like the chibi animals, and lit vs unlit makes no difference at that size.
  - Every extra pose (sit, eat, photo) is a paid library action or text-to-motion take per character.
  - A head as big as the body is the risky case for Meshy's humanoid rig; this is untested.

### 4. One atlas, one draw call; scale test

- **Per frame:** the CPU writes 4 vertices per quad into one `Float32Array` (shadows first, then characters, leads and cut-out strips sorted by feet y) and issues one `drawElements`. Draw calls reported: `{"characters": 1}` at every size.
- **Benchmark:** `&bench=10`, midday, 1536×1068 viewport. These are headless numbers: Chrome on SwiftShader (software WebGL), with the machine shared by 7 test agents (load average 9–13), so fps is noisy. The per-frame CPU times of this layer are the more useful figures.

| Crowd | Runs: fps (p50 / p95 ms) | Long frames | Quads | Sim ms/frame | Draw-build ms/frame |
|---|---|---|---|---|---|
| stage only (no layer) | 60 (16.7 / 16.7) | 0 | – | – | – |
| 100 | 46.3 (16.7/33.4), 43.6 (16.7/33.4), 35.1 (33.3/50) | 20–66 | 288 | 0.06–0.11 | 0.16–0.22 |
| 300 | 39.7 (16.7/33.4), 45.7 (16.7/33.4), 46.3 (16.7/33.4) | 25–35 | 686 | 0.11–0.17 | 0.25–0.28 |
| 1000 | 32.0 (33.3/49.9), 28.7 (33.3/50.1), 30.8 (33.3/50.0) | 57–80 | 2095 | 0.73–0.93 | 1.03–1.30 |

- **Reading the numbers:** headless, adding the full-size WebGL canvas costs more than the crowd itself (one run with 1 character measured 29 fps). At 1000 the layer's CPU cost is about 2 ms/frame plus one 2095-quad draw, small for a real GPU.
- **Sim cost in Node:** 0.05 ms/step at 150 people, 0.31 at 1000. Fast-forwarding a frozen `&t=300` replays about 9,750 steps.
- **Downloads:** `atlas.png` is 1.1 MB, but 0.5 MB of that is the 3D comparison sets and the stage cut-outs. `walk.json` is 61 KB.

### 5. Time of day

| | night (<5.5, >20) | morning (5.5–10.5) | midday (10.5–16.5) | golden (16.5–20) |
|---|---|---|---|---|
| density × n | 0.08–0.4 | 0.28–0.95 | 1.0 | 0.85–0.4 |
| groups | couples 62%, friends, singles | singles, couples, families **+ joggers 14% + dog walkers 12% (quotas)** | families, couples, friends, singles | couples 42%, families, friends |
| favoured | rail, benches, strolls; rides close at 22:30 | rail, beach, strolls; no queues before 11 | queues, stalls, beach | rail (sunset), queues, stalls |

- **Live hour changes:** the crowd thins or fills gradually. Groups leave after their current activity, and new ones arrive from the lane ends and the beach.
- **Joggers and dog walkers** have quotas of their own. Joggers cross the stage in about 35 s, so a plain spawn mix almost never shows them.
- Shots: `morning_n150.png` (46 people: 6 joggers, 3 dog walkers), `midday_n150.png`, `golden_n150.png`, `night_n150.png` (39 people, mostly couples), `midday_n300.png`, `midday_n1000.png`, `morning_dogs_zoom.png`, `golden_beach_zoom.png` (rail watchers behind the rail), `golden_east_zoom.png` (bench, stall, palm), `sheet_walk_midday.png` (12 frames, 300 ms apart).

## What worked

- The behaviour carries the realism, as `CHARACTERS.md` predicted:
  - real lanes in both directions;
  - queues facing their gate;
  - stall customers seen from behind;
  - rail watchers whose legs are hidden by the rail bars;
  - families with a kid ahead and stopping when it stops;
  - joggers in the morning and couples at night.
- shyfai sheets are cheap (9 characters in about 4 minutes), on-style, consistent enough at 30 px, and include activity poses.
- Stage cut-outs inside the same atlas and draw call fix "standing on the stall roof / in front of the lamp" without a second layer.
- A deterministic fixed-step sim on the master clock: a frozen `&t=` gives the same frame every time.

## What didn't, and open problems

- **Meshy could not be tested on our design** (402, free plan). The 3D comparison uses an off-style figure; the decision on Meshy waits on one chibi test.
- **Walkers are ~40%, not ~33%;** at n = 1000 the places fill up and 56% walk. There is no local avoidance: lanes and lateral offsets hide most overlaps, but walkers pass through queues and each other.
- **Layers can't sort against each other.** Characters draw over anything in the `rides` slot, so a person behind a ride's gondola covers it (README "Known limits"). Stage objects are handled by the cut-outs, but live rides need either one shared sorted layer or the ride layers' front parts as cut-outs.
- **Cut-out sort lines are per 24 px strip.** A character within ~3 px of a slanted stall front can sort the wrong way. The lamp masks are fitted to one measured lamp.
- **Missing on the beach and at night:** no towels or umbrellas under sitters, and no lamp light on people at night (only the grade darkens them).
- **Size:** the brief says 25–35 px, and I used 30. The map crop `dipper_wheel_v2_0.png`, at the stage's own scale, draws characters about 47 px tall. `&px=47` shows that size (`shots/px47_zoom.png` vs `px30_zoom.png`): closer to the frames, but it crowds the deck. At 47 px the frames would need a 3× atlas.
- **The 3D path's missing poses:** sit, eat and photo fall back to standing.

## Recommendation

- **Use the shyfai character sheets for the crowd** (12 frames per character, about 1 call each), and grow the cast by species and outfit. Add a second sheet per character for the poses still missing: bench sit, towel lie, carry, lead holding.
- **Hold Meshy until one chibi bear is meshed and rigged.** That test costs about 30 credits once a paid plan is on. Adopt it only if the render passes at 30 px. Its wins (8 headings, any number of walk frames) are real but small at this size; its costs are style risk and pay-per-pose.
- **Keep this layer's architecture:** a traced network with places, a group sim on the master clock, and one atlas with one draw call including stage cut-outs. It costs about 2 ms/frame at 1000 people.

## Proposals for `base/`

1. `stage.json` `wall.railTop`: use the measured polyline (`walk.json` `rail`; slope 0.241, (1536, 918) at the right). If the painting is truly parallel, the 0.215 slope behind `yawDeg` 24.1 deserves a second look (0.241 would mean about 26.7°).
2. Share the front cut-outs (`gen/occluders.json/.npz`: rail, lamps, stalls, palm, each with a sort line) as a base resource, so every layer that draws people or riders sorts against the same objects.
3. Decide the character height (30 px brief vs ~47 px map crop) before more sprites are made.
4. Plan one depth-sorted canvas for everything with feet (characters and ride riders), or give ride layers a way to export their front parts as cut-outs, so characters can pass behind live rides.
