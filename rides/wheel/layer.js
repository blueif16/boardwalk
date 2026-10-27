// The Dream Wheel turning.
//
// The painted wheel is erased by a plate (plate.webp, tools/park_patch.py: the painting with the rim, spokes and
// cabins removed and the A-frame kept). Over it, bottom to top: one canvas with the wheel (wheel.webp, rotated about
// the hub and squashed to the painted wheel's upright ellipse) and the twelve cabins hanging straight down from its
// knobs; the front A-frame's legs (legs.webp, the plate's own pixels); a small canvas with the hub (hub.webp) over the
// legs' apex, as in the painting. Art and geometry: tools/build_wheel.py, wheel.json.
//
// The motion is a fixed cycle (closed form, so any clock time and a frozen &t= give the same frame): from rest, one
// slow turn plus one cabin (390 deg); then the loading stops: dwell, step one cabin (30 deg), dwell, step, dwell. At
// each stop the cabin at the bottom is serviced: its riders get out, new ones (or nobody) get in, and it rocks.
// Cabins sway as pendulums driven by their hanger's acceleration; that is simulated once at mount for the four cycles
// after which every cabin is back where it started, and looked up per frame.
//
// Depth for the crowd (rides/RIDERS.md "Depth"): `occluders(t)` gives the front legs (legs.webp) and the hub on the
// front A-frame's foot line, and the turning wheel and its twelve cabins (their own sprites, placed as drawn) on the
// wheel's plane halfway between the front and back feet. The A-frame is not face-on (its right feet stand 27 px
// lower than its left), so both use a sloped base (sortLine). The queue under the bottom cabin stands in front of the
// wheel and behind the front-right leg.
const BOX = [2452, 1176, 2708, 1484]; // park px: the canvas covers the wheel and its cabins
const OMEGA = 12;                     // deg/s, cruising
const RAMP = 3;                       // s to start or stop the turn
const STEP_T = 4;                     // s to move one cabin at a loading stop
const DWELL = 4.5;                    // s stopped at each loading stop
const RUN = 390 / OMEGA + RAMP;      // s for the 390 deg turn: each cosine ramp covers half its time at full speed
const CYCLE = RUN + 3 * DWELL + 2 * STEP_T;
const PER_CYCLE = 450;                // deg per cycle: after 4 cycles (1800 deg) every cabin is back in place
const FULL = 0.7;                     // chance that a serviced cabin leaves full
// Pendulum: hanger to centre of mass, gravity (park px, s), damping; the forcing is softened (heavy, damped cabins).
const SWAY_L = 22, SWAY_G = 180, SWAY_C = 0.7, SWAY_K = 0.45, SWAY_HZ = 30;
const KICK_AT = 2.6;                  // s into a stop when the new riders step in
const RAD = Math.PI / 180;
// Riders from the park's crowd (rides/RIDERS.md): each cabin is a key (cabin<k>, 2 seats), loaded when it is serviced
// at the bottom (new riders fade in 2.4-2.9 s into the stop) and riding until its next service, four cycles later
// (the old riders fade out 0.9-1.4 s into it). With the crowd the empty cabin is drawn with the crowd's animals in its
// window; without it (ctx.riders null) the cabins keep their own painted riders.
const LOAD_AT = 2.4, OUT_AT = 1.4, SEATS = 2;
const RIDER = 0.55;                   // a rider's size against the crowd's
const WINDOW = [13, 55, 82, 97];      // cabin frame px: the window opening, its sill at the bottom
const SEAT_X = [0.34, 0.68];          // across the cabin frame
const GATE = [2578, 1476], EXIT = [2600, 1488]; // the deck under the bottom cabin, between the A-frame's feet
const QUEUE = [[2578, 1476], [2563, 1478], [2548, 1480], [2533, 1482], [2518, 1484]];

import { rideHours } from "../../base/park_hours.js";
import { getSky } from "../../base/sky.js";

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
const hash = (n) => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

// Degrees turned since the cycle began, at time tau into it (0 <= tau < CYCLE); stop/into while stopped at a loading
// stop; last = the last loading stop that has begun (-1 during the turn).
function inCycle(tau) {
  if (tau < RUN) {
    const ramp = (t) => (OMEGA / 2) * (t - (RAMP / Math.PI) * Math.sin((Math.PI * t) / RAMP)); // cosine velocity ramp
    let deg;
    if (tau < RAMP) deg = ramp(tau);
    else if (tau < RUN - RAMP) deg = ramp(RAMP) + OMEGA * (tau - RAMP);
    else deg = 390 - ramp(RUN - tau);
    return { deg, last: -1 };
  }
  let t = tau - RUN, deg = 390;
  for (let j = 0; j < 3; j++) {
    if (t < DWELL || j === 2) return { deg, stop: j, into: t, last: j };
    t -= DWELL;
    if (t < STEP_T) return { deg: deg + 30 * (t / STEP_T - Math.sin((2 * Math.PI * t) / STEP_T) / (2 * Math.PI)), last: j };
    t -= STEP_T;
    deg += 30;
  }
}

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowdDir = new URL("../../tests/park-crowd/", ctx.dir);
  const [meta, plate, wheelImg, hubImg, cabinsImg, crowdMeta, crowdAtlas] = await Promise.all([
    fetch(url("wheel.json")).then((r) => r.json()),
    fetch(url("plate.json")).then((r) => r.json()),
    loadImage(url("wheel.webp")), loadImage(url("hub.webp")), loadImage(url("cabins.webp")),
    fetch(new URL("atlas.json", crowdDir)).then((r) => r.json()),
    loadImage(new URL("atlas.png", crowdDir).href),
  ]);
  // Park hours (base/park_hours.js): closed, the wheel turns on to its first loading stop and stays there, the cabin at
  // the bottom emptied (1.8 s into the stop: old riders out, nobody in).
  const hours = rideHours(ctx.sky ?? getSky({ params: ctx.params }), { period: CYCLE, rest: RUN + 1.8, frozen: ctx.clock.frozen });
  const [HX, HY] = meta.hub, [RA, RB] = meta.ring;
  const W = meta.wheel, SX = RA / W.knob_radius, SY = RB / W.knob_radius;
  const CF = meta.cabins.frames, CD = meta.cabins.density, COLOURS = meta.cabins.colours;
  // The sprite's knobs are 30 deg apart; cabin k hangs from the knob at 30k deg (0 = east, 90 = bottom, screen y down).
  const N = 12;
  const knob = (k) => k * 30;
  const where = (t) => { const n = Math.floor(t / CYCLE); return { n, ...inCycle(t - n * CYCLE) }; };

  // Wheel angle (deg, clockwise on screen) at clock time t: cabin 0 at the bottom when t = 0.
  const angle = (t) => { const w = where(t); return 90 + PER_CYCLE * w.n + w.deg; };
  // At loading stop j of cycle n, the cabin at the bottom: 30k + 450n + 390 + 30j = 0 (mod 360).
  const bottomCabin = (n, j) => (((-(3 * n + 1 + j)) % N) + N) % N;
  const leavesFull = (n, j) => (hash(n * 3 + j + 7919) < FULL ? 1 : 0);
  const initialFull = (k) => (hash(k + 104729) < FULL ? 1 : 0);
  // Services of cabin k, newest first, at or before (n, j); each cabin is serviced once every 4 cycles.
  function lastService(k, n, j) {
    for (let m = n; m >= n - 5; m--) for (let jj = m === n ? j : 2; jj >= 0; jj--) if (bottomCabin(m, jj) === k) return [m, jj];
    return null;
  }
  // Cabin k's riders at time t: 0 empty .. 1 full, swapped during its service stop.
  function riders(k, t) {
    const w = where(t);
    const s = w.last >= 0 ? lastService(k, w.n, w.last) : lastService(k, w.n - 1, 2);
    if (!s) return initialFull(k);
    const after = leavesFull(s[0], s[1]);
    if (s[0] === w.n && s[1] === w.stop) {
      const p = s[1] > 0 ? lastService(k, s[0], s[1] - 1) : lastService(k, s[0] - 1, 2);
      const before = p ? leavesFull(p[0], p[1]) : initialFull(k);
      return before * (1 - smooth(0.9, 1.4, w.into)) + after * smooth(2.4, 2.9, w.into);
    }
    return after;
  }

  // Sway: every cabin's pendulum over the 4-cycle period, sampled at SWAY_HZ. 30 s of warm-up first: the damping
  // forgets the start within a few seconds, so the table joins up with itself at the wrap.
  const PERIOD = 4 * CYCLE, S = Math.ceil(PERIOD * SWAY_HZ);
  const sway = Array.from({ length: N }, () => new Float32Array(S));
  const tSim = performance.now();
  {
    const sub = 4, dt = 1 / (SWAY_HZ * sub), WARM = 30 * SWAY_HZ, M = (S + WARM) * sub + 2;
    // The wheel angle on the substep grid (one extra step at each end for the second differences).
    const ang = new Float64Array(M), stopOf = new Int8Array(M), into = new Float32Array(M), nOf = new Int32Array(M);
    for (let m = 0; m < M; m++) {
      const t = (m - 1) * dt - WARM / SWAY_HZ, w = where(t);
      ang[m] = (90 + PER_CYCLE * w.n + w.deg) * RAD;
      stopOf[m] = w.stop ?? -1; into[m] = w.into ?? 0; nOf[m] = w.n;
    }
    const ps = new Float64Array(N), vs = new Float64Array(N);
    for (let m = 1; m < M - 1; m++) {
      const i = (m - 1) / sub - WARM;
      if (i >= 0 && Number.isInteger(i)) for (let k = 0; k < N; k++) sway[k][i] = ps[k];
      // Boarding rocks the cabin at the bottom: once, on the substep that crosses KICK_AT.
      const kick = stopOf[m] >= 0 && stopOf[m - 1] === stopOf[m] && into[m - 1] < KICK_AT && into[m] >= KICK_AT ? bottomCabin(nOf[m], stopOf[m]) : -1;
      for (let k = 0; k < N; k++) {
        const o = knob(k) * RAD, q0 = ang[m - 1] + o, q1 = ang[m] + o, q2 = ang[m + 1] + o;
        const ax = (SWAY_K * RA * (Math.cos(q2) - 2 * Math.cos(q1) + Math.cos(q0))) / (dt * dt);
        const ay = (SWAY_K * RB * (Math.sin(q2) - 2 * Math.sin(q1) + Math.sin(q0))) / (dt * dt);
        vs[k] += (-((SWAY_G - ay) * Math.sin(ps[k]) + ax * Math.cos(ps[k])) / SWAY_L - SWAY_C * vs[k]) * dt;
        if (k === kick) vs[k] += 0.16;
        ps[k] += vs[k] * dt;
      }
    }
  }
  const simMs = performance.now() - tSim;
  const swayAt = (k, t) => {
    const x = ((((t % PERIOD) + PERIOD) % PERIOD) * SWAY_HZ), i = Math.floor(x), f = x - i;
    return sway[k][i % S] * (1 - f) + sway[k][(i + 1) % S] * f;
  };
  // A cabin dips a little as riders step in, then settles.
  function bounce(k, t) {
    const w = where(t);
    if (w.stop == null || bottomCabin(w.n, w.stop) !== k || w.into < KICK_AT) return 0;
    const s = w.into - KICK_AT;
    return 1.4 * Math.sin((2 * Math.PI * s) / 0.55) * Math.exp(-s / 0.45);
  }

  // The plate under everything; then the wheel canvas, the front legs, the hub canvas.
  ctx.addPatch(url("plate.webp"), plate.rect);
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const canvasOver = (x, y, w, h) => {
    const c = document.createElement("canvas");
    c.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    ctx.slots.rides.append(c);
    return c.getContext("2d");
  };
  const g = canvasOver(bx, by, bw, bh);
  const legs = new Image();
  legs.src = url("legs.webp");
  legs.alt = "";
  const [lx, ly, lw, lh] = meta.legs.rect;
  legs.style.cssText = `left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px`;
  ctx.slots.rides.append(legs);
  const HR = 30, hb = [HX - HR, HY - HR, 2 * HR, 2 * HR];
  const gh = canvasOver(...hb);

  let density = 1;
  function resize(scale) {
    density = Math.min(2.5, Math.max(1.5, scale * (devicePixelRatio || 1))); // at least 1.5 px per park px, shrunk by the browser: crisp at monitor size
    g.canvas.width = Math.round(bw * density); g.canvas.height = Math.round(bh * density);
    gh.canvas.width = Math.round(hb[2] * density); gh.canvas.height = Math.round(hb[3] * density);
  }
  resize(ctx.scale());

  function spin(c2, img, size, a) {
    c2.save();
    c2.translate(HX, HY);
    c2.scale(SX, SY);
    c2.rotate(a * RAD);
    c2.drawImage(img, -size / 2, -size / 2, size, size);
    c2.restore();
  }
  // A cabin; with crowd riders, those looks sit in its window at riderAlpha (cut at the sill and the window's sides).
  const RF = crowdMeta.frames, RK = (((Number(ctx.params.get("px")) || 38) * (3840 / 3904)) / 30) * RIDER / crowdMeta.scale;
  function cabin(name, x, y, rot, alpha, riders = null, riderAlpha = 1) {
    if (alpha <= 0.004) return;
    const f = CF[name], [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    g.drawImage(cabinsImg, sx, sy, sw, sh, -ax / CD, -ay / CD, sw / CD, sh / CD);
    if (riders?.length && riderAlpha > 0.004) {
      const [wx0, wy0, wx1, wy1] = WINDOW.map((v, i) => (v - (i % 2 ? ay : ax)) / CD);
      g.beginPath();
      g.rect(wx0, wy0, wx1 - wx0, wy1 - wy0);
      g.clip();
      g.globalAlpha = alpha * riderAlpha;
      riders.slice(0, SEATS).forEach((look, i) => {
        const rf = RF[`${look}/front_stand`];
        if (!rf) return;
        const [rx, ry, rw, rh] = rf.rect, [rax, ray] = rf.anchor;
        const fx = (SEAT_X[i] * sw - ax) / CD, fy = wy1 + 0.3 * ray * RK;
        g.drawImage(crowdAtlas, rx, ry, rw, rh, fx - rax * RK, fy - ray * RK, rw * RK, rh * RK);
      });
    }
    g.restore();
  }
  // How much of cabin k's crowd riders shows at t: they fade out and in during its service stop.
  function swap(k, t) {
    const w = where(t);
    if (w.stop == null || bottomCabin(w.n, w.stop) !== k) return 1;
    return w.into < 2 ? 1 - smooth(0.9, OUT_AT, w.into) : smooth(LOAD_AT, LOAD_AT + 0.5, w.into);
  }

  function draw(t) {
    const a = angle(t);
    g.setTransform(density, 0, 0, density, -bx * density, -by * density);
    g.clearRect(bx, by, bw, bh);
    g.imageSmoothingQuality = "high";
    spin(g, wheelImg, W.size, a);
    const hang = [];
    for (let k = 0; k < N; k++) {
      const p = (knob(k) + a) * RAD;
      hang.push({ k, x: HX + RA * Math.cos(p), y: HY + RB * Math.sin(p) });
    }
    hang.sort((p, q) => p.y - q.y);
    for (const { k, x, y } of hang) {
      const col = COLOURS[k % COLOURS.length], rot = swayAt(k, t), dy = bounce(k, t);
      const who = ctx.riders ? ctx.riders(ctx.name, `cabin${k}`, hours.master(t)) : null;
      if (who) { cabin(`${col}_empty`, x, y + dy, rot, 1, who, swap(k, t)); continue; }
      // Full over empty, so the cabin itself never fades.
      cabin(`${col}_empty`, x, y + dy, rot, 1);
      cabin(`${col}_full`, x, y + dy, rot, riders(k, t));
    }
    gh.setTransform(density, 0, 0, density, -hb[0] * density, -hb[1] * density);
    gh.clearRect(hb[0], hb[1], hb[2], hb[3]);
    gh.imageSmoothingQuality = "high";
    spin(gh, hubImg, W.hub_size, a);
  }

  // Load events (rides/RIDERS.md), closed form: stop j of cycle n starts at n*CYCLE + RUN + j*(DWELL + STEP_T) and
  // services its bottom cabin, whose riders stay until its next service at the same stop four cycles later. At t = 0
  // every cabin gets riders until its first service.
  const stopAt = (n, j) => n * CYCLE + RUN + j * (DWELL + STEP_T);
  const firstService = Array.from({ length: N }, (_, k) => {
    for (let n = 0; n < 5; n++) for (let j = 0; j < 3; j++) if (bottomCabin(n, j) === k) return stopAt(n, j);
    return 4 * CYCLE;
  });
  function loads(t0, t1) {
    const out = [];
    if (t0 <= 0 && 0 < t1) for (let k = 0; k < N; k++) out.push({ t: 0, key: `cabin${k}`, seats: SEATS, until: firstService[k] + OUT_AT });
    for (let n = Math.max(0, Math.floor((t0 - RUN) / CYCLE) - 1); stopAt(n, 0) + LOAD_AT < t1; n++) {
      for (let j = 0; j < 3; j++) {
        const t = stopAt(n, j) + LOAD_AT;
        if (t >= t0 && t < t1) out.push({ t, key: `cabin${bottomCabin(n, j)}`, seats: SEATS, until: stopAt(n + 4, j) + OUT_AT });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // Depth (rides/RIDERS.md): foot lines measured on the plate (the middle of each foot): front (2512, 1460) and
  // (2625, 1487), back (2560, 1420) and (2668, 1461); the wheel turns halfway between.
  const FRONT_LINE = [2512, 1460, 2625, 1487], WHEEL_LINE = [2536, 1440, 2646, 1474];
  const mid = (l) => (l[1] + l[3]) / 2;
  const legsOcc = { rect: meta.legs.rect, mask: legs, sortY: mid(FRONT_LINE), sortLine: FRONT_LINE };
  const hubOcc = (a) => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return { rect: [-W.hub_size / 2, -W.hub_size / 2, W.hub_size, W.hub_size], matrix: [SX * c, SY * s, -SX * s, SY * c, HX, HY], mask: hubImg, sortY: mid(FRONT_LINE), sortLine: FRONT_LINE }; };
  function occluders(t) {
    t = hours.run(t);
    const a = angle(t), c = Math.cos(a * RAD), s = Math.sin(a * RAD);
    const out = [legsOcc, hubOcc(a), { rect: [-W.size / 2, -W.size / 2, W.size, W.size], matrix: [SX * c, SY * s, -SX * s, SY * c, HX, HY], mask: wheelImg, sortY: mid(WHEEL_LINE), sortLine: WHEEL_LINE }];
    for (let k = 0; k < N; k++) {
      const p = (knob(k) + a) * RAD, x = HX + RA * Math.cos(p), y = HY + RB * Math.sin(p) + bounce(k, t), r = swayAt(k, t);
      const f = CF[`${COLOURS[k % COLOURS.length]}_empty`], [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor;
      out.push({ rect: [-ax / CD, -ay / CD, sw / CD, sh / CD], matrix: [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y], mask: cabinsImg, crop: [sx, sy, sw, sh], sortY: mid(WHEEL_LINE), sortLine: WHEEL_LINE });
    }
    return out;
  }

  let cost = 0, frames = 0;
  window.__wheel = { occluders, cycle: CYCLE, run: RUN, angle, riders, swayAt, bottomCabin, where, draw, simMs, loads, cost: () => cost / Math.max(1, frames) };
  return {
    riders: { gate: GATE, queue: QUEUE, exit: EXIT, loads: hours.loads(loads) },
    occluders,
    update(t) {
      t = hours.run(t);
      const t0 = performance.now();
      draw(t);
      cost += performance.now() - t0;
      frames++;
    },
    resize,
  };
}
