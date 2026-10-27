// Park hours: the Boardwalk opens at 10:30 and closes at 22:45 (rides/lights/behaviour.js switches the ride lights off
// from 22:45 over about 25 minutes). The hour is the sky's (base/sky.js: ctx.sky ?? getSky()), so it follows the
// visitor's clock, &hour= and the sky badge's scrub and play.
//
//   parkOpen(hour)                   true from OPEN to CLOSE
//   rideHours(sky, { period, rest }) a ride's own clock: run(t) -> ride time. While the park is open it runs with the
//                                    master clock; once it closes, the ride finishes its cycle and holds at `rest`
//                                    (seconds into its cycle: a natural stop, e.g. stopped at the platform, emptied);
//                                    when it opens again it starts from there. A frozen clock (&t=) or a page that
//                                    loads closed goes straight to the rest of the current cycle.
//     .run(t)        call once per frame with the master clock (more calls with the same t change nothing)
//     .master(tau)   ride time -> master time, for ctx.riders(name, key, ...) (the crowd records trips in master time)
//     .loads(fn)     wraps a riders block's loads(t0, t1) written in ride time into master time
//     .held, .open   state after the last run()
import { getSky } from "./sky.js";

export const OPEN = 10.5, CLOSE = 22.75;
export const parkOpen = (hour) => hour >= OPEN && hour < CLOSE;

// release(): optional, asked while held with the park open: false keeps waiting (a second train that must keep its
// distance from the first).
export function rideHours(sky = getSky(), { period, rest = 0, frozen = false, release = null } = {}) {
  let offset = 0, held = false, holdAt = 0, target = null, lastT = null, cur = 0;
  const restAfter = (tau) => Math.ceil((tau - rest) / period - 1e-9) * period + rest;   // the next rest at or after tau
  const restBefore = (tau) => Math.floor((tau - rest) / period + 1e-9) * period + rest; // the last one at or before
  const h = {
    open: true,
    get held() { return held; },
    run(t) {
      if (t === lastT) return cur;
      const first = lastT === null;
      lastT = t;
      sky.tick?.();
      h.open = parkOpen(sky.hour);
      if (h.open) {
        target = null;
        if (held && (!release || release())) { held = false; offset = t - holdAt; } // start again from the rest
      } else if (!held) {
        const tau = t - offset;
        if (first || frozen) { held = true; holdAt = restBefore(tau) >= 0 ? restBefore(tau) : restAfter(tau); }
        else {
          target ??= restAfter(tau);
          if (tau >= target) { held = true; holdAt = target; } // the cycle is finished: stop at its rest
        }
      }
      return (cur = held ? holdAt : t - offset);
    },
    master: (tau) => tau + offset,
    // The crowd boards nobody while the park is closed (tests/characters/sim.js `open`), so this only maps times.
    loads: (fn) => (t0, t1) => fn(t0 - offset, t1 - offset).map((e) => ({ ...e, t: e.t + offset, until: e.until + offset })),
  };
  return h;
}
