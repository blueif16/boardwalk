// The sky: one clock of the day for every layer (tests/night-park/RESULTS.md, INTERFACE).
//
// createSky({ params }) -> sky with
//   hour            0-24, continuous (the clock below, or &hour= fixed)
//   sun             { alt (deg), rise, set (hours), morning }: &sun=real is Santa Cruz's sun on today's date (or
//                   &date=YYYY-MM-DD); the default &sun=story is the same late-summer day all year (rise 06:30, set 18:59)
//   keys            weights { day, dawn, golden, dusk, night } (sum 1), from the sun's altitude
//   dark            0 (full day) .. 1 (full night): how much a light shows
//   progress, dusk  0..1 the park's switch-on progress (dusk 0 -> 1, dawn 1 -> 0); `dusk` is the lights' name for it
//   wave(x, y)      0..1 switch-on progress of the park's lights at park px (x, y): a sweep out from the Giant
//                   Dipper during dusk, off in reverse at dawn. A light adds its own jitter.
//   mode            "fixed" | "local" | "santacruz"
//   set(hour, {tween}), follow(mode), onChange(fn)
//
// Clock modes (&clock=): local = the visitor's own clock; santacruz = the time in Santa Cruz now; a number = fixed
// hour. &hour= fixes the hour (and is what the crowd reads too). The sun is always Santa Cruz's for today's date, so
// at 18:30 a visitor sees the Boardwalk's own October dusk whatever their time zone.
export const SANTA_CRUZ = { lat: 36.9643, lon: -122.0177, tz: "America/Los_Angeles" };

const D = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function tzOffsetHours(date, tz) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(date)
    .find((p) => p.type === "timeZoneName").value; // "GMT-7"
  const m = s.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) + Math.sign(Number(m[1])) * (Number(m[2] || 0) / 60) : 0;
}

function dayOfYear(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const d = Date.UTC(+p.year, +p.month - 1, +p.day), y0 = Date.UTC(+p.year, 0, 1);
  return 1 + Math.round((d - y0) / 86400000);
}

// NOAA's simple solar position: altitude (deg) and hour angle (deg, < 0 before noon) at local clock hour h.
export function sunAt(h, doy, tzh, { lat, lon } = SANTA_CRUZ) {
  const g = (2 * Math.PI / 365) * (doy - 1 + (h - tzh - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = h * 60 + eq + 4 * lon - 60 * tzh;
  const ha = tst / 4 - 180;
  const cz = Math.sin(lat * D) * Math.sin(dec) + Math.cos(lat * D) * Math.cos(dec) * Math.cos(ha * D);
  return { alt: 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / D, ha };
}

// The storybook sun (&sun=story): the same day every day of the year, a late-summer day at Santa Cruz's latitude
// (declination +4 deg, solar noon 12:45): it rises at 06:30 and sets at 18:59, so dawn is 06:00-07:00, golden hour
// 17:50-18:50, the blue hour 19:05-19:40 and night from 19:55.
export const STORY = { noon: 12.75, dec: 4 };
export function storySun(h, { lat } = SANTA_CRUZ) {
  const ha = (h - STORY.noon) * 15;
  const sa = Math.sin(lat * D) * Math.sin(STORY.dec * D) + Math.cos(lat * D) * Math.cos(STORY.dec * D) * Math.cos(ha * D);
  return { alt: Math.asin(sa) / D, ha };
}

// Sunrise and sunset (alt -0.833 deg) by bisection on the hour.
function crossing(doy, tzh, a, b, rising, at = (m) => sunAt(m, doy, tzh)) {
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2, up = at(m).alt > -0.833;
    if (up === rising) b = m; else a = m;
  }
  return (a + b) / 2;
}

// Key plates along the sun's altitude. Evening (afternoon side): day -> golden -> dusk (blue hour) -> night.
// Morning: night -> dawn -> day (the dawn plate is lit from the right, where the sun rises).
const EVENING = [[14, "day"], [6, "golden"], [0, "golden"], [-4, "dusk"], [-7, "dusk"], [-12, "night"]];
const MORNING = [[-12, "night"], [-1, "dawn"], [5, "dawn"], [14, "day"]];

export function keysAt(alt, morning) {
  const pts = morning ? MORNING : EVENING;
  const k = { day: 0, dawn: 0, golden: 0, dusk: 0, night: 0 };
  const first = pts[0], last = pts[pts.length - 1];
  const before = morning ? alt <= first[0] : alt >= first[0];
  const after = morning ? alt >= last[0] : alt <= last[0];
  if (before) { k[first[1]] = 1; return k; }
  if (after) { k[last[1]] = 1; return k; }
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, n0] = pts[i], [a1, n1] = pts[i + 1];
    const inside = morning ? alt >= a0 && alt <= a1 : alt <= a0 && alt >= a1;
    if (!inside) continue;
    const t = smooth(a0, a1, alt);
    k[n0] += 1 - t; k[n1] += t;
    return k;
  }
  return k;
}

// The lights: evening switch-on from alt +3 (just before sunset) to -6; morning switch-off from -6 to +2.
const DIPPER = [2620, 1150], REACH = 2700, SPAN = 0.18;
export function progressAt(alt, morning) {
  return morning ? 1 - smooth(-6, 2, alt) : 1 - smooth(-6, 3, alt);
}

export function createSky({ params = new URLSearchParams(location.search), where = SANTA_CRUZ } = {}) {
  const listeners = new Set();
  const q = params.get("hour") ?? (params.get("clock") && !isNaN(Number(params.get("clock"))) ? params.get("clock") : null);
  let mode = q != null ? "fixed" : (params.get("clock") === "santacruz" ? "santacruz" : params.get("clock") === "local" ? "local" : "fixed");
  let fixed = q != null ? Number(q) : 13;
  let tween = null;
  const date = params.has("date") ? new Date(params.get("date") + "T12:00:00") : new Date();

  function clockHour(now = new Date()) {
    if (mode === "santacruz") {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: where.tz, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
        .formatToParts(now).map((x) => [x.type, x.value]));
      return +p.hour + +p.minute / 60 + +p.second / 3600;
    }
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }

  const doy = dayOfYear(date, where.tz), tzh = tzOffsetHours(date, where.tz);
  const sunMode = params.get("sun") === "real" ? "real" : "story";
  const sunOf = sunMode === "real" ? (h) => sunAt(h, doy, tzh, where) : (h) => storySun(h, where);
  const rise = crossing(doy, tzh, 3, 12, true, sunOf), set = crossing(doy, tzh, 12, 22, false, sunOf);

  const sky = {
    hour: 13, sun: null, keys: null, dark: 0, progress: 0, mode, sunMode,
    wave(x, y) {
      const d = Math.min(1, Math.hypot(x - DIPPER[0], (y - DIPPER[1]) * 1.6) / REACH);
      return clamp01((sky.progress * (1 + SPAN) - d) / SPAN);
    },
    set(h, { tween: ms = 0 } = {}) {
      mode = sky.mode = "fixed";
      if (ms > 0) {
        // Always run forward in time, so night -> morning passes through dawn.
        const from = sky.hour, to = h < from ? h + 24 : h;
        tween = { from, to, t0: performance.now(), ms };
      } else { tween = null; fixed = h; update(h); }
    },
    follow(m = "local") { mode = sky.mode = m; tween = null; update(clockHour()); },
    onChange(f) { listeners.add(f); f(sky); return () => listeners.delete(f); },
    tick() {
      if (tween) {
        const t = clamp01((performance.now() - tween.t0) / tween.ms), s = t * t * (3 - 2 * t);
        const h = tween.from + (tween.to - tween.from) * s;
        if (t >= 1) { fixed = h % 24; tween = null; }
        update(h % 24);
      } else if (mode !== "fixed") {
        const h = clockHour();
        if (Math.abs(h - sky.hour) > 1 / 3600) update(h);
      }
    },
  };

  function update(h) {
    h = ((h % 24) + 24) % 24;
    const s = sunOf(h);
    const morning = s.ha < 0;
    sky.hour = h;
    sky.sun = { alt: s.alt, rise, set, morning };
    sky.keys = keysAt(s.alt, morning);
    sky.dark = 1 - smooth(-10, 4, s.alt);
    sky.progress = progressAt(s.alt, morning);
    sky.dusk = sky.progress; // the lights agent's name for the evening switch-on progress
    listeners.forEach((f) => f(sky));
  }

  update(mode === "fixed" ? fixed : clockHour());
  return sky;
}

export const fmt = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
