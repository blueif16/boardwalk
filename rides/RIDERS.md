# Riders: the crowd takes the rides

The park's animals walk to a ride, queue at its gate, board when the ride loads, ride as the same animals that
queued, step out at the exit and walk on. The crowd (tests/park-crowd) and each ride layer meet through this contract.

## What a ride layer provides

In the object returned by `mount(ctx)`, a ride that carries passengers adds `riders`:

```js
riders: {
  gate: [x, y],            // park px: where the head of the queue stands, on the deck at the ride's entrance
  queue: [[x, y], ...],    // optional: queue slots from the gate backwards, park px, 8-16 of them, clear of anything
                           // standing on the deck (default: a short line from the gate along the promenade)
  exit: [x, y],            // park px: where riders step back onto the deck
  loads(t0, t1),           // every load event with t0 <= t < t1, as [{ t, key, seats, until }]
},
```

- `t` is master-clock time (seconds, the same `t` the layer's `update(t, dt)` gets). `loads` must be a pure function
  of time, closed form from the ride's cycle, and must answer any window from 0 on: the crowd fast-forwards from 0 to
  the current time (and to a frozen `&t=`), asking for the events in each step.
- `key` names the vehicle, cabin, cup or row that loads at `t` (e.g. `"train0"`, `"cabin7"`, `"cup3"`); `seats` is how
  many riders it takes (0 skips it); `until` is when those riders get off (at or after the next unload of that key).
- Several keys may load at the same `t` (a train's cars, all the teacups).

## What the ride asks back

`ctx.riders(name, key, t)` returns the riders on `key` at time `t`: an array of look names (atlas frame prefixes in
`tests/park-crowd/atlas.json`, e.g. `"panda"`, `"fox"`; kids and pets included), `[]` if nobody boarded (empty
seats), or `null` when the crowd is not running (`&crowd=0`): then the ride picks its own riders as before, so every
ride must still work alone. Draw riders with the crowd's atlas (`tests/park-crowd/atlas.png`) so they match.

`name` is the ride's folder name (`ctx.name`).

## What the crowd does

- A queue place per ride at `gate` / `queue`, linked to the nearest promenade lane; groups choose it like any other
  activity, more often at busy hours.
- At each load event it boards whole groups from the head of the queue until `seats` is full (a group that does not
  fit waits for the next event), hides them, and records their looks under `(name, key, t)`.
- At `until` they reappear at `exit` and go on with their day.

## As implemented (tests/characters/sim.js, tests/park-crowd/crowd.js, index.html)

- **Several gates per layer.** A block may carry `more: [{ gate, queue, exit, keys }]` for a second gate (two
  carousels, Double Shot and Typhoon). Events whose key is in an entry's `keys` board from that entry's queue; every
  other key boards from the block's own gate. Keys are free-form strings; prefix them per ride inside a layer
  (`east:horse3`, `typhoon:car0`).
- **Batches.** Events with the same `t` on the same entry are one batch: a train's cars, a carousel's horses, all the
  teacups. Whole groups board the batch in line order and fill its keys in order; a group starts a fresh key rather
  than split when it fits one, and otherwise spans adjacent keys (a family over two coaster cars). Only groups that
  have reached the queue board; groups still walking there keep their place. A group larger than the biggest batch a
  ride ever offers (measured from `loads(1, 400)`) never picks that queue.
- **Time.** The crowd runs on the page's clock (`mountCrowd(canvas, { clock })`), 25 s ahead as warm-up; it asks
  `loads` for consecutive windows `[t0, t1)` with `t0 >= 0` as it steps, so loads at exactly 0 are allowed (a ride
  already running at page load) and negative times are never asked. A frozen `&t=` replays the same windows.
- **Riders.** `ctx.riders(name, key, t)` is null until the crowd has mounted (and with `&crowd=0`). Afterwards it is
  the looks of the latest load of that key at or before `t`, or `[]` once its `until` has passed or if nobody boarded.
  The crowd keeps the last 6 loads per key. The page advances the crowd before the rides draw, so a load is visible in
  the frame it happens.
- **Queues.** Each gate becomes a queue place in the walking graph: its slots as given (or 2-8 slots, 15 px apart,
  from the gate towards the nearest lane), its tail linked to the two nearest promenade lane nodes. Groups pick ride
  queues like the sim's old queues (by hour; none before 11:00 or after 22:30), three times as often
  (`RIDE_BOOST` in crowd.js; `&rideBoost=` on the page). With every reviewed ride, about a quarter of the 120 animals
  ride at any moment and the promenade keeps the rest.
- **Draw.** Rides draw their riders with the crowd's atlas (`tests/park-crowd/atlas.png`), smaller than walkers
  (0.55 of the crowd's size in cars and cabins). A ride whose `ctx.riders` returns null keeps its own riders, so
  every ride still works alone.

## Gates

| Ride | Keys, seats | Gate | Queue | Exit | Loads |
|---|---|---|---|---|---|
| coaster | `t0c0`-`t1c2`, 2 per car | (2264, 1356) in front of the station, between the bench and the lamp | 6 slots south to (2269, 1426) | (2245, 1446) | 3 s into each train's station dwell; at 0 for a train already out |
| wheel | `cabin0`-`cabin11`, 2 | (2578, 1476) on the deck under the bottom cabin | 5 slots west between the A-frame's feet | (2600, 1488) | at each loading stop, 2.4 s in, for the cabin at the bottom; riding until its next service four cycles on; every cabin at 0 |
| teacups | `cup0`-`cup5`, 2 | (3318, 1616) just off the drum's east rim | 6 slots north-east up the drum's side | (3120, 1622) | all cups 5 s into each loading pause |
| flume | `log0`-`log3`, 3 | (3100, 1430) | 10 slots south | (3040, 1428) | 0.8 s after each log's arrival |
| pirate | `row0`-`row5`, 3 | (995, 1298) | rides/pirate/RESULTS.md | (850, 1290) | at its stop, row by row |
| carousel | `east:horse0-9`, `west:horse0-11`, 1 | east (2738, 1548); west in `more` | rides/carousel/RESULTS.md | east (2832, 1537), west (1756, 1290) | every horse at the loading stop |
| thrill | `doubleshot:ring` 8; `typhoon:car0/1` 2 in `more` | (1096, 1213); Typhoon (1196, 1198) | 6 slots each | (1122, 1246), (1108, 1222) | at each ride's stop |

## Open problems

- The crowd's canvas is above the rides slot, so an animal standing behind a ride (behind the Pirate Ship, between
  the wheel's legs) is drawn over it. A cheap fix that fits this contract: a ride layer may return
  `occluders: [{ rect: [x, y, w, h], sortY }]` (its screen-space footprint and the y of its base); the crowd skips, or
  clips away, the part of any animal whose feet are above `sortY` inside that rect. Not built.
- Riders sit as standing sprites cut at a rim or window; there is no seated pose in the sheets.
- Queues fill partly with groups still walking there from across the park (they reserve when they choose), so a line
  can look shorter than it is.
