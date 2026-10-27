// Logger's Revenge: log boats with animal riders on the painted flume.
//
// The circuit is the painting's own water: track.json is traced and snapped onto the painted chutes
// (tools/make_track.py). Four logs run it a quarter of a cycle apart, on one timetable integrated once at mount, so
// any clock time (and a frozen &t=) gives the same frame:
//   station (dwell) -> round the U and into the mill house -> out of sight to the lift's foot -> the lift (slow) ->
//   the elevated flume (water speed, a little faster downhill) -> the drop (gravity) -> the splash (hard braking, a
//   burst of spray and a foam ring) -> a glide back into the station.
// A log is placed by its front and rear points on the path, so it turns with the chute; in the flat pool it turns
// only partly (track "tilt"). Steep stretches (the tall drop tube, the S tube) switch to the end-on views.
// Where the painting has something in front, its own pixels are laid back over the logs (occ_*.webp, from
// tools/make_occluders.py). Stack, bottom to top: back canvas (logs on the lift where it passes behind the S tube),
// the S tube, front canvas (flow streaks, logs, wakes, spray), the porch, the box at the lift's foot, the disc.
// The painted log in the pool is erased by a plate patch (plate_pool.webp, tools/park_patch.py paste).
const BOX = [3010, 890, 3740, 1400]; // park px: the canvases only cover the flume
const DWELL = 4.5;       // s at the station
const V_POOL = 34;       // px/s round the U and out of the station
const V_HIDDEN = 70;     // px/s inside the mill house, out of sight
const V_LIFT = 36;       // px/s on the lift
const V_FLUME = 84;      // px/s: the water's speed along the flume
const G_FLUME = 60;      // px/s^2 along the screen's y on the flume (gentle: screen y is mostly "away", not height)
const DRAG = 1.6;        // 1/s: how fast the water pulls the log back to V_FLUME
const V_FLUME_MIN = 56;
const G_DROP = 175;      // px/s^2 on the drop
const A_SPLASH = 1500;   // px/s^2 of braking in the splash
const V_AFTER = 40;      // px/s after the splash
const A_STOP = 70;       // px/s^2 into the station
const A_START = 40;      // px/s^2 out of the station
const SPACING = 52, WHEELBASE = 30;
const SINK = 0.32;       // share of the hull below the waterline
const VIEW_END = [60, 70]; // screen slope (deg): end-on views from above 70, back to the side view below 60 (hysteresis)
const VIEW_FADE = 5;      // px of track either side of a view change over which the views dissolve
const SPLASH_LIFE = 1.5; // s
const N_LOGS = 4;
// Riders from the park's crowd (rides/RIDERS.md). Each log unloads as it reaches the station and loads BOARD s later,
// three seats; the riders get off at its next arrival. Without the crowd (ctx.riders returns null) the logs carry the
// riders painted on their own sheet.
const BOARD = 0.8;
const SEATS = 3;
const GATE = [3100, 1430];   // on the deck south of the flume's base, between the lamp and the teacups
const QUEUE = [[3100, 1430], [3099, 1446], [3098, 1462], [3097, 1478], [3096, 1494], [3095, 1510], [3094, 1526],
               [3093, 1542], [3092, 1558], [3091, 1574]];
const EXIT = [3040, 1428];   // the stone path west of the base
const RIDER = 0.72;          // a seated rider's size, against the crowd's
const RIM = { side: 0.37, back: 0.48, front: 0.71 }; // the near rim of an empty log, as a share of its height from the top
const SEAT_X = [15.5, 0, -15.5];  // side view, along the log from its front
const SEAT_UP = [0, 5.5, 11];     // end-on views: each seat further back sits this much higher on screen

import { rideHours } from "../../base/park_hours.js";
import { getSky } from "../../base/sky.js";

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

// A small deterministic hash -> [0, 1).
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const get = (f) => fetch(url(f)).then((r) => r.json());
  const crowdUrl = (f) => new URL(`../../tests/park-crowd/${f}`, ctx.dir).href;
  const [track, sheet, atlas, empty, atlasE, crowdMeta, crowdAtlas, plate, oS, oDisc, oPorch, oBox] = await Promise.all([
    get("track.json"), get("sprites.json"), loadImage(url("sprites.png")), get("sprites_empty.json"), loadImage(url("sprites_empty.png")),
    fetch(crowdUrl("atlas.json")).then((r) => r.json()), loadImage(crowdUrl("atlas.png")),
    get("plate_pool.json"), get("occ_s_tube.json"), get("occ_disc.json"), get("occ_porch.json"), get("occ_box.json"),
  ]);
  const P = track.points, L = track.keys.length, K = track.keys;
  const MODE = track.mode, KIND = track.kind, TILT = track.tilt, ALPHA = track.alpha;
  const wrap = (u) => ((u % L) + L) % L;
  const idx = (u) => Math.round(wrap(u)) % L;
  const S0 = K.station;
  const rel = (k) => wrap(k - S0); // arc length from the station
  const dLift0 = rel(K.lift_start), dLift1 = rel(K.lift_end), dDrop = rel(K.drop_start), dSplash = rel(K.splash);
  // The hidden run's two ends (in travel distance from the station).
  let dHid0 = null, dHid1 = null;
  for (let d = 0; d < L; d++) { if (MODE[idx(S0 + d)] === 2) { if (dHid0 == null) dHid0 = d; dHid1 = d; } }

  // Smoothed screen y along the track, for the slope terms.
  const ys = new Float32Array(L);
  for (let i = 0; i < L; i++) { let s = 0; for (let k = -10; k <= 10; k++) s += P[(i + k + L) % L][1]; ys[i] = s / 21; }
  const yAt = (u) => ys[idx(u)];

  // One cycle of the lead log's travel d (px from the station) against time, at 240 Hz.
  const dt = 1 / 240;
  const times = [0], dist = [0];
  let d = 0, v = 0, t = 0, splashT = null;
  const yTop = yAt(S0 + dDrop);
  let vTop = V_FLUME;
  while (d < L - 0.25 && t < 600) {
    const left = L - d;
    let target;
    if (d < dHid0 - 30) target = Math.min(V_POOL, v + A_START * dt);
    else if (d < dLift0 - 20) target = Math.min(V_HIDDEN, v + 120 * dt);           // hidden: speed is free
    else if (d < dLift1) target = v > V_LIFT ? Math.max(V_LIFT, v - 120 * dt) : Math.min(V_LIFT, v + 60 * dt);
    else if (d < dDrop) {
      const slope = (yAt(S0 + d + 4) - yAt(S0 + d - 4)) / 8;                    // screen dy per px of track
      target = v + (G_FLUME * slope - DRAG * (v - V_FLUME)) * dt;
      target = Math.max(V_FLUME_MIN, target);
      vTop = target;
    } else if (d < dSplash) {
      target = Math.sqrt(vTop * vTop + 2 * G_DROP * Math.max(0, yAt(S0 + d) - yTop));
    } else {
      if (splashT == null) splashT = t;
      target = Math.max(V_AFTER, v - A_SPLASH * dt);
      target = Math.min(target, Math.max(3, Math.sqrt(2 * A_STOP * left)));
    }
    v = target;
    d = Math.min(L, d + v * dt);
    t += dt;
    times.push(t); dist.push(d);
  }
  const RUN = t, CYCLE = DWELL + RUN, SPLASH_AT = DWELL + splashT;
  function travel(clock) {
    const ph = ((clock % CYCLE) + CYCLE) % CYCLE;
    if (ph < DWELL) return 0;
    const tt = ph - DWELL;
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= tt) lo = mid; else hi = mid; }
    const f = (tt - times[lo]) / Math.max(1e-6, times[hi] - times[lo]);
    return dist[lo] + f * (dist[hi] - dist[lo]);
  }
  function speedAt(clock) { return (travel(clock + 0.05) - travel(clock - 0.05)) / 0.1; }
  function at(u) {
    u = wrap(u);
    const i = Math.floor(u), f = u - i, a = P[i], b = P[(i + 1) % L];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  const tangent = (u) => { const a = at(u + 3), b = at(u - 3); const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [(a[0] - b[0]) / l, (a[1] - b[1]) / l]; };
  // 1 while any part of a log at this point is over the stretch behind the S tube (mode 1): the whole log is then
  // drawn under the tube's cut-out. The cut-out is exactly the tube's band, so the switch itself never shows (a
  // dissolve between the canvases, as on the coaster, left a see-through log straddling the tube).
  const behind = new Uint8Array(L);
  for (let i = 0; i < L; i++) for (let k = -SPACING / 2 - 4; k <= SPACING / 2 + 4; k++) if (MODE[(i + k + L) % L] === 1) { behind[i] = 1; break; }

  // Which view a log shows at each point of the track: chosen along the track with hysteresis, so stretches that run
  // near the threshold (the right side, the loop) don't sit in a long dissolve; a change dissolves over 2 * VIEW_FADE px.
  const endW = new Float32Array(L);
  {
    const raw = new Uint8Array(L);
    let on = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < L; i++) {
      const a = P[(i + WHEELBASE / 2) % L], b = P[(i - WHEELBASE / 2 + L) % L];
      const steep = Math.atan2(Math.abs(a[1] - b[1]), Math.abs(a[0] - b[0])) * 180 / Math.PI;
      if (!on && steep > VIEW_END[1]) on = 1; else if (on && steep < VIEW_END[0]) on = 0;
      raw[i] = on;
    }
    for (let i = 0; i < L; i++) { let s = 0; for (let k = -VIEW_FADE; k <= VIEW_FADE; k++) s += raw[(i + k + L) % L]; endW[i] = s / (2 * VIEW_FADE + 1); }
  }

  // The flow streaks: short white dashes carried along the open water, deterministic from the clock.
  // Sections (in arc length): the pool round the U, the drop chute below the tall tube, and the flume (sparse).
  const sections = [];
  {
    let start = null;
    const isWater = (i) => MODE[i] === 0 && KIND[i] !== 1 && ALPHA[i] > 0.99;
    for (let i = 0; i <= L; i++) {
      const w = i < L && isWater(i) && KIND[i] === KIND[start ?? i];
      if (w && start == null) start = i;
      if (!w && start != null) { sections.push([start, i - 1, KIND[start]]); start = isWater(i % L) ? i : null; }
    }
  }
  const FLOW = { 0: { speed: 22, gap: 26, half: 9, len: 7, alpha: 0.55 }, 2: { speed: 95, gap: 70, half: 4.5, len: 9, alpha: 0.42 }, 3: { speed: 240, gap: 30, half: 9, len: 16, alpha: 0.6 } };
  const streaks = [];
  for (const [a, b, kind] of sections) {
    const f = FLOW[kind];
    if (!f || b - a < 20) continue;
    const n = Math.max(1, Math.floor((b - a) / f.gap));
    for (let k = 0; k < n; k++) streaks.push({ a, b, f, s0: hash(a * 7 + k) * (b - a), lat: (hash(a * 13 + k * 3) * 2 - 1) * f.half, len: f.len * (0.7 + 0.6 * hash(k + a)) });
  }

  // Canvases over the flume only, interleaved with the painting's cut-outs.
  ctx.addPatch(url("plate_pool.webp"), plate.rect);
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const layer = () => {
    const c = document.createElement("canvas");
    c.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
    ctx.slots.rides.append(c);
    return c.getContext("2d");
  };
  const cutout = (name, meta) => {
    const im = new Image();
    im.src = url(`occ_${name}.webp`);
    im.alt = "";
    const [x, y, w, h] = meta.rect;
    im.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    ctx.slots.rides.append(im);
    return im;
  };
  const back = layer();
  cutout("s_tube", oS);
  const front = layer();
  const porchImg = cutout("porch", oPorch);
  const boxImg = cutout("box", oBox);
  cutout("disc", oDisc);
  // Depth for the crowd (rides/RIDERS.md "Depth"): the mill house porch and the box at the lift's foot stand on their
  // own lowest pixels; the disc and the S tube are high up, above every animal's head. Nothing on the walking network
  // reaches behind them today (the queue and exit are on the deck south of the base).
  const occluders = [
    { rect: oPorch.rect, mask: porchImg, sortY: 1339 },
    { rect: oBox.rect, mask: boxImg, sortY: 1193 },
  ];
  let density = 1;
  function resize(scale) {
    density = scale * Math.min(devicePixelRatio || 1, 2 / scale);
    for (const g of [back, front]) { g.canvas.width = Math.round(bw * density); g.canvas.height = Math.round(bh * density); }
  }
  resize(ctx.scale());

  const F = sheet.frames, SD = sheet.density;
  const logs = Array.from({ length: N_LOGS }, (_, k) => ({ index: k, offset: (k * CYCLE) / N_LOGS, kind: k % 3 }));
  // Park hours (base/park_hours.js): closed, every log finishes its trip and is put away in the mill house (the hidden
  // run, out of sight), so the flume stands empty. Open again, log 0 comes out first and each other log follows once
  // its quarter-cycle spacing behind log 0 comes round again.
  const modC = (v) => ((v % CYCLE) + CYCLE) % CYCLE;
  const PH = DWELL + times[Math.max(0, dist.findIndex((v) => v >= (dHid0 + dHid1) / 2))]; // phase in the mill house
  const sky = ctx.sky ?? getSky({ params: ctx.params });
  let tau0 = 0;
  const hours = logs.map((lg) => rideHours(sky, { period: CYCLE, rest: modC(PH - lg.offset), frozen: ctx.clock.frozen,
    release: lg.index ? () => { const ph = modC(tau0 + lg.offset); return ph >= PH && ph < PH + 0.4; } : null }));
  const logTimes = (t) => { tau0 = hours[0].run(t); return hours.map((h) => h.run(t)); };
  const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

  const CK = ((Number(ctx.params.get("px")) || 38) * (3840 / 3904)) / 30; // the crowd's scale (tests/park-crowd/crowd.js)
  const CF = crowdMeta.frames, CS = crowdMeta.scale;
  // A log: with riders === null its own painted riders; otherwise the empty log and these crowd looks in its seats,
  // cut off at the log's near rim.
  function sprite(g, name, x, y, rot, flip, alpha, riders = null) {
    if (alpha <= 0.004) return;
    const own = riders == null;
    const f = own ? F[name] : empty.frames[name];
    const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.drawImage(own ? atlas : atlasE, sx, sy, sw, sh, -ax / SD, -ay / SD, sw / SD, sh / SD);
    if (!own && riders.length) {
      const view = name.split("_")[0];
      const top = -ay / SD, hgt = sh / SD;
      const rim = top + RIM[view] * hgt;
      g.beginPath();
      g.rect(-sw / SD, rim - 80, (2 * sw) / SD, 80);
      g.clip();
      const seats = riders.slice(0, SEATS).map((look, i) => ({ look, i }));
      // End-on views: the seat furthest back (highest on screen) first.
      if (view !== "side") seats.reverse();
      for (const { look, i } of seats) {
        const cf = CF[`${look}/${view}_stand`] || CF[`${look}/front_stand`];
        if (!cf) continue;
        const k = (CK * RIDER) / CS;
        const [rx, ry, rw, rh] = cf.rect, [cax, cay] = cf.anchor;
        const feetX = view === "side" ? SEAT_X[i] : (i - 1) * 1.6;
        const feetY = rim + 0.42 * rh * k - (view === "side" ? 0 : SEAT_UP[i]);
        g.drawImage(crowdAtlas, rx, ry, rw, rh, feetX - cax * k, feetY - cay * k, rw * k, rh * k);
      }
    }
    g.restore();
  }

  function drawStreaks(g, clock) {
    g.save();
    g.strokeStyle = "#fbf8ef";
    g.lineCap = "round";
    for (const s of streaks) {
      const span = s.b - s.a;
      const u = s.a + ((s.s0 + s.f.speed * clock) % span + span) % span;
      const edge = Math.min(u - s.a, s.b - u);
      const a = s.f.alpha * Math.min(1, edge / 14);
      if (a <= 0.02) continue;
      const tg = tangent(u), nx = -tg[1], ny = tg[0];
      g.globalAlpha = a;
      g.lineWidth = s.f === FLOW[3] ? 1.6 : 1.2;
      g.beginPath();
      for (let k = 0; k <= 4; k++) {
        const p = at(u - (k / 4) * s.len);
        const q = [p[0] + nx * s.lat, p[1] + ny * s.lat];
        if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
      }
      g.stroke();
    }
    g.restore();
  }

  // The splash, in three passes: churned foam and a spreading foam ring on the water (under the log), two plumes of
  // spray rising either side of the impact (behind the log), and droplets thrown up and out (in front of it). All of
  // it is outlined like the painting's foam: white with a thin light-blue edge.
  const FOAM = "#fdfcf6", EDGE = "#6aaed6";
  function splashUnder(g, age) {
    if (age < 0 || age > SPLASH_LIFE) return;
    const c = at(K.splash), k = age / SPLASH_LIFE;
    g.save();
    g.globalAlpha = 0.55 * (1 - k);
    g.fillStyle = "#e6f5fb";
    g.beginPath();
    g.ellipse(c[0] - 8, c[1] + 3, 20 + 16 * Math.sqrt(k), 8 + 6 * Math.sqrt(k), 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.8 * (1 - k);
    g.strokeStyle = FOAM;
    g.lineWidth = 2 * (1 - k) + 0.7;
    g.beginPath();
    g.ellipse(c[0] - 8, c[1] + 3, 16 + 36 * Math.sqrt(k), (16 + 36 * Math.sqrt(k)) * 0.4, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  function splashPlumes(g, age) {
    const LIFE = 0.9;
    if (age < 0 || age > LIFE) return;
    const c = at(K.splash), k = age / LIFE;
    const h = 46 * Math.sin(Math.PI * Math.min(1, age / 0.45) * 0.5) * (1 - 0.55 * k);
    g.save();
    g.globalAlpha = 0.92 * Math.pow(1 - k, 1.6);
    g.fillStyle = FOAM;
    g.strokeStyle = EDGE;
    g.lineWidth = 0.8;
    for (const side of [-1, 1]) {
      const x0 = c[0] - 8 + side * 31, y0 = c[1] + 3;
      const lean = side * (10 + 22 * k);
      g.beginPath();
      g.moveTo(x0 - side * 13, y0);
      g.quadraticCurveTo(x0 - side * 4, y0 - h * 0.9, x0 + lean, y0 - h);
      g.quadraticCurveTo(x0 + side * 6 + lean * 0.3, y0 - h * 0.45, x0 + side * 14, y0);
      g.closePath();
      g.fill(); g.stroke();
    }
    g.restore();
  }
  function splashDroplets(g, age, seed) {
    if (age < 0 || age > SPLASH_LIFE) return;
    const c = at(K.splash), k = age / SPLASH_LIFE;
    g.save();
    g.fillStyle = FOAM;
    g.strokeStyle = EDGE;
    g.lineWidth = 0.7;
    for (let i = 0; i < 46; i++) {
      const h1 = hash(seed * 31 + i), h2 = hash(seed * 17 + i * 5), h3 = hash(seed * 7 + i * 11);
      const side = h1 < 0.5 ? -1 : 1;
      const ang = -Math.PI / 2 + side * (0.25 + 0.9 * Math.abs(h1 - 0.5) * 2);
      const sp = 90 + 140 * h2;
      const tt = age * (0.8 + 0.4 * h3);
      const x = c[0] - 8 + side * 24 + Math.cos(ang) * sp * tt;
      const y = c[1] - 2 + Math.sin(ang) * sp * tt + 0.5 * 320 * tt * tt;
      if (y > c[1] + 6) continue;
      const r = (1.1 + 2.2 * h3) * (1 - 0.5 * k);
      g.globalAlpha = Math.min(1, 1.8 * (1 - k));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    g.restore();
  }

  // A log's bow wave and wake: thin white arcs at the waterline, by speed.
  function drawWake(g, u, spd, a) {
    if (spd < 8 || a < 0.05) return;
    const tg = tangent(u), nx = -tg[1], ny = tg[0];
    const w = Math.min(1, spd / 120);
    g.save();
    g.strokeStyle = "#fbf8ef";
    g.lineCap = "round";
    g.lineWidth = 1.3;
    for (const side of [-1, 1]) {
      g.globalAlpha = a * (0.35 + 0.45 * w);
      g.beginPath();
      const p0 = at(u + SPACING * 0.45), p1 = at(u - SPACING * 0.1), p2 = at(u - SPACING * (0.55 + 0.4 * w));
      const o = 6 + 3 * w;
      g.moveTo(p0[0] + nx * side * 2, p0[1] + ny * side * 2);
      g.quadraticCurveTo(p1[0] + nx * side * o, p1[1] + ny * side * o, p2[0] + nx * side * (o + 4 * w), p2[1] + ny * side * (o + 4 * w));
      g.stroke();
    }
    g.restore();
  }

  // &riders=demo: without the crowd, fill the logs from the crowd's atlas on the same load schedule (one trip in five
  // empty), to check the seating; and a stand-in for ctx.riders while the crowd side is being built.
  const looksAll = [...new Set(Object.keys(CF).filter((k) => k.endsWith("/side_stand")).map((k) => k.split("/")[0]))];
  const demoRiders = ctx.params.get("riders") === "demo" ? (lg, t) => {
    const n = Math.floor((t + lg.offset - BOARD) / CYCLE); // the trip (load) this log is on
    if (n < 0) return [];
    if (hash(n * 7 + lg.index * 3) < 0.2) return [];
    return [0, 1, 2].map((i) => looksAll[Math.floor(hash(n * 31 + lg.index * 11 + i * 5) * looksAll.length)]);
  } : null;

  function draw(clock) {
    const taus = logTimes(clock);
    for (const g of [back, front]) {
      g.setTransform(density, 0, 0, density, -bx * density, -by * density);
      g.clearRect(bx, by, bw, bh);
      g.imageSmoothingQuality = "high";
    }
    drawStreaks(front, clock);
    const items = [], splashes = [];
    for (const lg of logs) {
      const c0 = taus[lg.index] + lg.offset;
      const u = S0 + travel(c0);
      const i = idx(u), a = ALPHA[i];
      // The splash belongs to the cycle it started in, so it carries on across the cycle's wrap.
      const cyc = Math.floor((c0 - SPLASH_AT) / CYCLE);
      splashes.push({ age: c0 - SPLASH_AT - cyc * CYCLE, seed: cyc * 13 + lg.kind });
      if (a <= 0.01) continue;
      const pf = at(u + WHEELBASE / 2), pr = at(u - WHEELBASE / 2);
      const vx = pf[0] - pr[0], vy = pf[1] - pr[1];
      const c = at(u);
      const riders = ctx.riders ? ctx.riders(ctx.name, `log${lg.index}`, hours[lg.index].master(taus[lg.index])) : demoRiders ? demoRiders(lg, taus[lg.index]) : null;
      items.push({ log: lg, u, a, b: behind[i], vx, vy, tilt: TILT[i], x: c[0], y: c[1], spd: speedAt(c0), kind: KIND[i], riders: riders ?? null });
    }
    for (const sp of splashes) { splashUnder(front, sp.age); splashPlumes(front, sp.age); }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      const wEnd = smooth(0, 1, endW[idx(it.u)]);
      const flip = it.vx < 0;
      const ang = flip ? Math.atan2(-it.vy, -it.vx) : Math.atan2(it.vy, it.vx);
      const rot = ang * it.tilt;
      const sideName = `side_${it.log.kind}`, endName = `${it.vy < 0 ? "back" : "front"}_${it.log.kind}`;
      // Float: the anchor (the hull's bottom) sits below the waterline by a share of the hull.
      const sinkSide = F[sideName].hull * SINK, sinkEnd = F[endName].hull * SINK * 0.5;
      const aSide = Math.min(1, 2 * (1 - wEnd)), aEnd = Math.min(1, 2 * wEnd);
      for (const [g, w] of [[back, it.b], [front, 1 - it.b]]) {
        if (w <= 0) continue;
        if (it.kind !== 1) drawWake(g, it.u, it.spd, it.a * w);
        const side = () => sprite(g, sideName, it.x - Math.sin(rot) * sinkSide, it.y + Math.cos(rot) * sinkSide, rot, flip, it.a * w * aSide, it.riders);
        const endOn = () => sprite(g, endName, it.x, it.y + sinkEnd, 0, false, it.a * w * aEnd, it.riders);
        if (wEnd < 0.5) { side(); endOn(); } else { endOn(); side(); }
      }
    }
    for (const sp of splashes) splashDroplets(front, sp.age, sp.seed);
  }

  window.__flume = { cycle: CYCLE, run: RUN, length: L, splashAt: SPLASH_AT, travel, at, draw, keys: K, sections, loads: (a, b) => loads(a, b) };
  // Load events (rides/RIDERS.md), closed form from the timetable. Log k reaches the station at n*CYCLE - offset_k;
  // its riders get off then, and the next ones board BOARD s later and stay until its next arrival. Logs already out
  // on the circuit at t = 0 get one load at 0, so the ride isn't empty for its first cycle.
  // Each log's events in its own ride time, mapped to the master clock by its park-hours clock.
  const loads = (t0, t1) => logs.flatMap((lg) => hours[lg.index].loads((a, b) => logLoads(lg, a, b))(t0, t1)).sort((a, b) => a.t - b.t);
  function logLoads(only, t0, t1) {
    const out = [];
    for (const lg of [only]) {
      const key = `log${lg.index}`;
      const ph0 = ((lg.offset % CYCLE) + CYCLE) % CYCLE;
      if (ph0 >= BOARD && t0 <= 0 && 0 < t1) out.push({ t: 0, key, seats: SEATS, until: CYCLE - ph0 });
      for (let n = Math.ceil((Math.max(t0, 0) + lg.offset - BOARD) / CYCLE); ; n++) {
        const arrive = n * CYCLE - lg.offset, t = arrive + BOARD;
        if (t >= t1) break;
        if (t >= t0 && t >= 0) out.push({ t, key, seats: SEATS, until: arrive + CYCLE });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  return {
    update(clock) { draw(clock); },
    resize,
    riders: { gate: GATE, queue: QUEUE, exit: EXIT, loads },
    occluders,
  };
}
