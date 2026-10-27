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
