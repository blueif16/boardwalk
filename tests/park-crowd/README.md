# The crowd on the whole park

The first live layer on the whole-park page (`index.html`, `http://ran:5178/`): the characters test's crowd sim and
sprite batcher, moved onto the park frame.

| File | What it is |
|---|---|
| `park.json` | The park frame: 3840 x 2560 px over `gen/park/world_v2_hd`, with the Dipper stage's camera angles (the painting's rail slopes about 0.20, the stage's 0.215) |
| `tools/grid_crops.py` | Gridded crops of the painting in park px, for tracing by eye |
| `tools/make_walk.mjs` | The measurements (rail, wall foot, waterline, 8 stairs, everything standing on the promenade) and the network built from them: `node tests/park-crowd/tools/make_walk.mjs` |
| `walk.json` | 537 nodes, 610 edges; places: 9 stalls, 2 benches, 6 ride-watching and 3 photo spots, 5 hangouts, 65 rail spots, 150 beach spots |
| `crowd.js` | `mountCrowd(canvas)`: the sim on the park network, drawn in one WebGL call sorted by feet, with the depth order (DEPTH.md) |
| `occlusion.js` | The rides' occluders and the painting's cut-outs packed into one mask texture for the renderer (DEPTH.md) |
| `occ.webp`, `occ.json`, `occ_reach.json`, `tools/make_occluders.py`, `tools/dump_reach.json`, `tools/save_reach.py` | The painting's cut-outs animals pass behind (lamps, stalls, the rail), and where animals can stand |

- **Size** 38 (the user's pick), 300 animals at 13:00 by default. Page params: `&n=`, `&hour=`, `&px=`, `&t=` (frozen
  clock), `&panel` (stats; H toggles it).
- **Lanes are computed, not traced:** for every x they run in the open band between the front edge of whatever stands
  on the promenade and the rail; at load they are moved to clear the cut-outs' real base lines (DEPTH.md).
- **Not yet:** ride queues and gates, the open deck behind the stalls and the entrance plaza, the town and the
  parking lots, cut-outs (walking behind things), the shared depth order with live rides, more species.
