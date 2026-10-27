// When each light is on: one rule per group, all closed-form in the hour (so &hour=, a frozen clock and the live clock
// agree), with a per-light seed for variety. level(light, hour, t) is 0..1 (t is the page clock in seconds, for the
// flicker while a light switches on and for patterns).
//
// The sky (from the base, tests/night-park: ctx.sky) gives `dark` 0..1 and the sun's set/rise hours. Without it the
// test page derives them from base/time.js (its KEYS are summer hours: dusk 19:00-20:30).
//
// Groups:
//   photocell  street lights, flag floods, car lights: on when dark passes 0.35 (+/- 0.06 per sensor), off at dawn
//   promenade  the park's lamp circuit: a wave along the strip from the Giant Dipper's station, both ways, during dusk;
//              stays on all night; off at dawn in the reverse order
//   ride       ride bulbs, signs, ride doors: with the wave (a little after the lamps), off at closing (22:45 + a
//              25-minute spread, as the Boardwalk does it), back on never before dawn
//   stall      stall fronts: each keeper switches on at a random point of the wave, off with closing
//   home       town windows: a random evening on-time and night off-time; 30% stay dark; 5% on all night; 15% come on
//              again before sunrise; 8% of the lit ones are a TV (cool flicker)
//   shop       street-level shop windows: on at dusk, off at 21:00-23:00
export const PARK = { origin: 2300, span: 1700, close: 22.75, closeSpread: 0.42 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const k = clamp01((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k); };
export function hash(n) { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x7f4a7c15; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
const rnd = (seed, k) => hash(Math.floor(seed * 1e5) * 31 + k);

// The sky's numbers from base/time.js's look(hour) when the base has no ctx.sky: dark from the exposure (1 -> 0,
// 0.62 -> 1), and dusk progress from look.lights (0.25 at 18:00 .. 1 at 20:30).
export function skyFromLook(look) {
  return { hour: look.hour, dark: clamp01((1 - look.exposure) / 0.38), dusk: clamp01((look.lights - 0.25) / 0.75), sun: { set: 19.6, rise: 6.2 } };
}

// The wave's progress at hour h: 0 before dusk, 1 at full night; at dawn it runs back to 0.
function waveProgress(sky) {
  const h = sky.hour;
  if (h > 12) return smooth(0.45, 1, sky.dusk ?? sky.dark);
  return 1 - smooth(sky.sun.rise - 0.6, sky.sun.rise + 0.25, h); // morning: off in reverse
}

// Where a light sits on the wave: 0 at the Dipper's station, 1 at either end of the strip.
const along = (x) => Math.min(1, Math.abs(x - PARK.origin) / PARK.span);

// The hour gap (h1 - h0) on a clock that wraps at midnight, taking evening hours as before morning ones.
const night = (h) => (h < 12 ? h + 24 : h);

function closing(L, sky) {
  // 1 while the park is open, falling to 0 over the closing spread; rides stay off after midnight until the next day.
  const h = night(sky.hour), t0 = PARK.close + rnd(L.seed, 7) * PARK.closeSpread;
  return 1 - smooth(t0, t0 + 0.03, h);
}

export function level(L, sky, t) {
  const g = L.group;
  const p = waveProgress(sky);
  let on;
  if (g === "photocell") on = smooth(0.35 + (rnd(L.seed, 1) - 0.5) * 0.12, 0.42 + (rnd(L.seed, 1) - 0.5) * 0.12, sky.dark);
  else if (g === "promenade" || g === "ride" || g === "stall") {
    let th = 0.05 + 0.8 * along(L.x ?? 0) + (rnd(L.seed, 2) - 0.5) * 0.08;
    if (g === "ride") th += 0.04;
    if (g === "stall") th = 0.1 + rnd(L.seed, 3) * 0.75;
    on = clamp01((p - th) / 0.025);
    if (g !== "promenade") on *= closing(L, sky);
  } else if (g === "home") {
    const r = rnd(L.seed, 4);
    const h = night(sky.hour);
    if (r < 0.3) on = 0;
    else {
      const tOn = (sky.sun.set - 0.6) + rnd(L.seed, 5) * 3;
      const tOff = r < 0.35 ? 30.5 : 21.4 + rnd(L.seed, 6) * 4.2;
      on = smooth(tOn, tOn + 0.01, h) * (1 - smooth(tOff, tOff + 0.01, h));
      if (rnd(L.seed, 8) < 0.15) { const m = sky.sun.rise - 1.1 + rnd(L.seed, 9) * 0.9; on = Math.max(on, smooth(m + 24, m + 24.01, h) * (1 - smooth(sky.sun.rise + 24.2, sky.sun.rise + 24.25, h))); }
    }
    on *= smooth(0.15, 0.3, sky.dark); // a window lit by day doesn't show
  } else if (g === "shop") {
    const h = night(sky.hour), tOff = 21 + rnd(L.seed, 10) * 2;
    on = smooth(0.2, 0.4, sky.dark) * (1 - smooth(tOff, tOff + 0.01, h)) * (rnd(L.seed, 11) < 0.85 ? 1 : 0);
  } else on = sky.dark;
  // A light that is switching on stutters for a moment (a cold lamp, a sticky relay): blink by the page clock.
  if (on > 0 && on < 1 && (g === "promenade" || g === "photocell" || g === "ride")) on *= hash(Math.floor(t * 9) + Math.floor(L.seed * 1e5)) < 0.35 + on * 0.6 ? 1 : 0.15;
  return on;
}

// Is a lit home window a TV? (cool, flickering)
export const isTV = (L) => L.group === "home" && rnd(L.seed, 12) < 0.08;
export function tvFlicker(L, t) { const k = Math.floor(t * 5 + rnd(L.seed, 13) * 50); return 0.6 + 0.4 * hash(k * 7 + 3); }
// The warm tint of a home window: most warm yellow, some soft orange, a few pale.
export function windowColour(L) {
  if (isTV(L)) return "#9fb8ff";
  const r = rnd(L.seed, 14);
  return r < 0.55 ? "#ffdc8e" : r < 0.85 ? "#ffc27e" : "#fff2cc";
}
