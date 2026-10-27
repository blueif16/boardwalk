// The Giant Dipper's trains on the painted track.
//
// The track is the painting's own: track.json is its circuit, traced and snapped onto the painted red band
// (tools/make_track.py). Two 3-car trains run it half a cycle apart: a dwell at the station, a slow chain lift, then
// gravity (speed from the height lost since the crest, less friction, never below a crawl), brakes into the station.
// One cycle's timetable is integrated once at mount, so any clock time (and a frozen &t=) gives the same frame.
// Cars are placed by their front and rear wheel points on the track, so they bend round curves and pitch on hills;
// steep stretches (the turnarounds, where the track runs into or out of the picture) switch to back and front views.
// Where the painting has something in front of the track, its own pixels are laid back over the train
// (occ_*.webp, from tools/make_occluders.py): the Fireball's hub, the station shed, and the lattice along the run
// behind the structure. Stack, bottom to top: back canvas (cars on that run), lattice, front canvas, station, Fireball.
// A car going behind the lattice dissolves from the front canvas into the back one over BEHIND_FADE px of track.
const BOX = [1990, 900, 3240, 1262]; // park px: the canvas only covers the coaster
const DWELL = 5.5;       // s at the station
const V_LIFT = 52;       // park px/s on the chain
const A_DISPATCH = 70;   // px/s^2 out of the station
const G = 165;           // px/s^2 of gravity along the screen's y
const MU = 9;            // px^2/s^2 lost per px of track (friction and air)
const V_MIN = 58;        // the crawl over the east crest, which the painting draws higher than the lift
const BRAKE = 130;       // px of brakes before the station
const A_BRAKE = 260;     // px/s^2
const SPACING = 41, WHEELBASE = 27;
const LIFT = 3;          // px the car's wheel line sits above the band's centre
const OCC_LATTICE_ALPHA = 0.88; // the lattice over the return run: mostly solid, so the train reads as behind it
const BEHIND_FADE = 24;  // px of track over which a car moves from the front canvas to the back one
const VIEW_END = [68, 80]; // screen slope (deg) where the side view dissolves into the end-on view: only the near-
                           // vertical turnaround legs, where the track runs into or out of the picture
// Riders from the park's crowd (rides/RIDERS.md): each car is a key (t<train>c<car>, 2 seats); a train's riders get off
// as it arrives and the next ones sit down LOAD_AT s into the dwell, riding until its next arrival. Their cars are drawn
// cut at the rim (rims.json, tools/car_rims.py) with the crowd's animals sitting in them; without the crowd
// (ctx.riders null) the cars keep the riders painted on their sheet.
const LOAD_AT = 3.0, SEATS = 2;
const RIDER = 0.55;        // a rider's size against the crowd's
const SEAT = { side: [0.33, 0.61], side_0: [0.26, 0.52], back: [0.32, 0.68], front: [0.32, 0.68] }; // across the frame
const GATE = [2264, 1356], EXIT = [2245, 1446]; // the deck in front of the station, between the bench and the lamp
const QUEUE = [[2264, 1356], [2265, 1370], [2266, 1384], [2267, 1398], [2268, 1412], [2269, 1426]];

import { rideHours } from "../../base/park_hours.js";
import { getSky } from "../../base/sky.js";

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowdDir = new URL("../../tests/park-crowd/", ctx.dir);
  const [track, sheet, atlas, occF, occL, occS, rims, crowdMeta, crowdAtlas] = await Promise.all([
    fetch(url("track.json")).then((r) => r.json()),
    fetch(url("sprites.json")).then((r) => r.json()),
    loadImage(url("sprites.png")),
    fetch(url("occ_fireball.json")).then((r) => r.json()),
    fetch(url("occ_lattice.json")).then((r) => r.json()),
    fetch(url("occ_station.json")).then((r) => r.json()),
    fetch(url("rims.json")).then((r) => r.json()),
    fetch(new URL("atlas.json", crowdDir)).then((r) => r.json()),
    loadImage(new URL("atlas.png", crowdDir).href),
  ]);
  const P = track.points, ALPHA = track.alpha, L = track.keys.length;
  const S0 = track.keys.station, CREST = track.keys.lift_end;

  // Smoothed screen height along the track, for the physics (the hidden run is straight lines; smooth it).
  const ys = new Float32Array(L);
  for (let i = 0; i < L; i++) { let s = 0; for (let k = -12; k <= 12; k++) s += P[(i + k + L) % L][1]; ys[i] = s / 25; }
  const yAt = (u) => ys[((Math.round(u) % L) + L) % L];

  // One cycle of the front car's travel d (px from the station) against time, at 240 Hz.
  const dt = 1 / 240, liftLen = (CREST - S0 + L) % L, yCrest = yAt(CREST);
  const times = [0], dist = [0];
  let d = 0, v = 0, t = 0;
  while (d < L - 0.25 && t < 600) {
    const left = L - d;
    let target;
    if (d < liftLen) target = Math.min(V_LIFT, v + A_DISPATCH * dt);
    else {
      const e = V_LIFT * V_LIFT + 2 * G * (yAt(S0 + d) - yCrest) - MU * (d - liftLen);
      target = Math.sqrt(Math.max(V_MIN * V_MIN, e));
    }
    if (left < BRAKE) target = Math.min(target, Math.max(4, Math.sqrt(2 * A_BRAKE * left)));
    v = target;
    d = Math.min(L, d + v * dt);
    t += dt;
    times.push(t); dist.push(d);
  }
  const RUN = t, CYCLE = DWELL + RUN;
  // Park hours (base/park_hours.js): closed, train 0 comes in and waits in the station, emptied (1.5 s into its
  // dwell); train 1 stops in the brake run just behind it. Open again, train 0 leaves first and train 1 waits until it
  // is half a cycle behind again, so the two never meet in the station.
  const PARK = 3 * SPACING + 12;  // px behind the station where train 1 waits
  const P1 = DWELL + times[Math.max(0, dist.findIndex((v) => v >= L - PARK))];
  const mod = (v) => ((v % CYCLE) + CYCLE) % CYCLE;
  const sky = ctx.sky ?? getSky({ params: ctx.params });
  let tau0 = 0;
  const hours = [
    rideHours(sky, { period: CYCLE, rest: 1.5, frozen: ctx.clock.frozen }),
    rideHours(sky, { period: CYCLE, rest: mod(P1 - CYCLE / 2), frozen: ctx.clock.frozen,
      release: () => { const ph = mod(tau0 + CYCLE / 2); return ph >= P1 && ph < P1 + 0.4; } }),
  ];
  const rideTimes = (t) => { tau0 = hours[0].run(t); return [tau0, hours[1].run(t)]; };
  function travel(clock) {
    const ph = ((clock % CYCLE) + CYCLE) % CYCLE;
    if (ph < DWELL) return 0;
    const tt = ph - DWELL;
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= tt) lo = mid; else hi = mid; }
    const f = (tt - times[lo]) / Math.max(1e-6, times[hi] - times[lo]);
    return dist[lo] + f * (dist[hi] - dist[lo]);
  }
  function at(u) {
    u = ((u % L) + L) % L;
    const i = Math.floor(u), f = u - i, a = P[i], b = P[(i + 1) % L];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  const alphaAt = (u) => ALPHA[((Math.round(u) % L) + L) % L];
  // 1 where the track runs behind the lattice (mode 1), ramped over BEHIND_FADE px at both ends.
  const behind = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let s = 0;
    for (let k = -BEHIND_FADE / 2; k < BEHIND_FADE / 2; k++) s += track.mode[(i + k + L) % L] === 1 ? 1 : 0;
    behind[i] = s / BEHIND_FADE;
  }
  const behindAt = (u) => behind[((Math.round(u) % L) + L) % L];

  // Two canvases over the coaster only, interleaved with the painting's cut-outs.
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const layer = () => {
    const c = document.createElement("canvas");
    c.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
    ctx.slots.rides.append(c);
    return c.getContext("2d");
  };
  const cutout = (name, meta, alpha = 1) => {
    const im = new Image();
    im.src = url(`occ_${name}.webp`);
    im.alt = "";
    const [x, y, w, h] = meta.rect;
    im.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:${alpha}`;
    ctx.slots.rides.append(im);
    return im;
  };
  const back = layer();
  const latticeImg = cutout("lattice", occL, OCC_LATTICE_ALPHA);
  const front = layer();
  const stationImg = cutout("station", occS);
  const fireballImg = cutout("fireball", occF);
  // Depth for the crowd (rides/RIDERS.md "Depth"): the cut-outs it lays back hide animals behind them too. The
  // station shed stands on its own lowest pixel; the Fireball's hub is on the Fireball's A-frame, whose feet stand
  // about y 1340 on the deck; the lattice is raised track structure whose ground line is hidden, so it sorts on its
  // own lower edge. No walking place reaches behind any of them today (they matter for the open deck behind the
  // stalls, if it ever opens).
  const occluders = [
    { rect: occS.rect, mask: stationImg, sortY: 1245 },
    { rect: occF.rect, mask: fireballImg, sortY: 1340 },
    { rect: occL.rect, mask: latticeImg, sortY: 1199 },
  ];
  let density = 1;
  function resize(scale) {
    density = Math.min(2.5, Math.max(1.5, scale * (devicePixelRatio || 1))); // at least 1.5 px per park px, shrunk by the browser: crisp at monitor size
    for (const g of [back, front]) { g.canvas.width = Math.round(bw * density); g.canvas.height = Math.round(bh * density); }
  }
  resize(ctx.scale());

  const F = sheet.frames, SD = sheet.density;
  const trains = [{ offset: 0, cars: [0, 1, 2] }, { offset: CYCLE / 2, cars: [0, 2, 1] }];
  const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

  // A car: with riders === null as painted; otherwise cut at its rim, with these crowd looks sitting in it.
  const CF = crowdMeta.frames, RK = (((Number(ctx.params.get("px")) || 38) * (3840 / 3904)) / 30) * RIDER / crowdMeta.scale;
  function sprite(g, name, x, y, rot, flip, alpha, riders = null) {
    if (alpha <= 0.004) return;
    const f = F[name];
    const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    if (flip) g.scale(-1, 1);
    if (riders) {
      const view = name.split("_")[0], left = -ax / SD, top = -ay / SD, rim = top + rims.rim[name] / SD;
      const seat = SEAT[name] || SEAT[view];
      riders.slice(0, SEATS).forEach((look, i) => {
        const cf = CF[`${look}/${view === "back" ? "back" : "front"}_stand`] || CF[`${look}/front_stand`];
        if (!cf) return;
        const [rx, ry, rw, rh] = cf.rect, [cax, cay] = cf.anchor;
        const fx = left + seat[i] * (sw / SD), fy = rim + 0.45 * cay * RK;
        g.drawImage(crowdAtlas, rx, ry, rw, rh, fx - cax * RK, fy - cay * RK, rw * RK, rh * RK);
      });
      g.beginPath();
      g.rect(left - 2, rim, sw / SD + 4, sh / SD);
      g.clip();
    }
    g.drawImage(atlas, sx, sy, sw, sh, -ax / SD, -ay / SD, sw / SD, sh / SD);
    g.restore();
  }

  function draw(t) {
    const taus = rideTimes(t);
    for (const g of [back, front]) {
      g.setTransform(density, 0, 0, density, -bx * density, -by * density);
      g.clearRect(bx, by, bw, bh);
      g.imageSmoothingQuality = "high";
    }
    const cars = [];
    for (const [ti, tr] of trains.entries()) {
      const clock = taus[ti], lead = S0 + travel(clock + tr.offset);
      tr.cars.forEach((kind, k) => {
        const u = lead - k * SPACING;
        const a = alphaAt(u);
        if (a <= 0.01) return;
        const pf = at(u + WHEELBASE / 2), pr = at(u - WHEELBASE / 2);
        const vx = pf[0] - pr[0], vy = pf[1] - pr[1];
        const len = Math.hypot(vx, vy) || 1;
        const nx = vy / len, ny = -vx / len;          // a normal to the direction of travel ...
        const up = ny < 0 ? [nx, ny] : [-nx, -ny];     // ... the one that points up the screen
        const c = at(u);
        const riders = ctx.riders ? ctx.riders(ctx.name, `t${ti}c${k}`, hours[ti].master(clock)) : null;
        cars.push({ kind, a, b: behindAt(u), vx, vy, x: c[0] + up[0] * LIFT, y: c[1] + up[1] * LIFT, riders });
      });
    }
    cars.sort((p, q) => p.y - q.y);
    for (const c of cars) {
      const steep = Math.atan2(Math.abs(c.vy), Math.abs(c.vx)) * 180 / Math.PI;
      const wEnd = smooth(VIEW_END[0], VIEW_END[1], steep);
      const flip = c.vx < 0;
      const rot = flip ? Math.atan2(-c.vy, -c.vx) : Math.atan2(c.vy, c.vx);
      const end = `${c.vy < 0 ? "back" : "front"}_${c.kind}`;
      // An opaque dissolve between the side view and the end-on view: the dominant one at full strength underneath,
      // the other over it, each fading out only over its own half (no see-through ghost at the midpoint).
      const aSide = Math.min(1, 2 * (1 - wEnd)), aEnd = Math.min(1, 2 * wEnd);
      for (const [g, w] of [[back, c.b], [front, 1 - c.b]]) {
        if (w <= 0) continue;
        const side = () => sprite(g, `side_${c.kind}`, c.x, c.y, rot, flip, c.a * w * aSide, c.riders);
        const endOn = () => sprite(g, end, c.x, c.y, 0, false, c.a * w * aEnd, c.riders);
        if (wEnd < 0.5) { side(); endOn(); } else { endOn(); side(); }
      }
    }
  }

  // Load events (rides/RIDERS.md), closed form: train i arrives at n*CYCLE - offset_i and loads LOAD_AT s later. A train
  // already out on the circuit at t = 0 gets one load at 0, so the ride isn't empty for its first lap.
  // Each train's events in its own ride time, mapped to the master clock by its park-hours clock.
  const loads = (t0, t1) => [0, 1].flatMap((i) => hours[i].loads((a, b) => trainLoads(i, a, b))(t0, t1)).sort((a, b) => a.t - b.t);
  function trainLoads(only, t0, t1) {
    const out = [];
    trains.forEach((tr, i) => {
      if (i !== only) return;
      const keys = tr.cars.map((_, k) => `t${i}c${k}`);
      const ph0 = ((tr.offset % CYCLE) + CYCLE) % CYCLE;
      if (ph0 >= LOAD_AT && t0 <= 0 && 0 < t1) for (const key of keys) out.push({ t: 0, key, seats: SEATS, until: CYCLE - ph0 });
      for (let n = Math.ceil((Math.max(t0, 0) + tr.offset - LOAD_AT) / CYCLE); ; n++) {
        const t = n * CYCLE - tr.offset + LOAD_AT;
        if (t >= t1) break;
        if (t >= t0 && t >= 0) for (const key of keys) out.push({ t, key, seats: SEATS, until: t - LOAD_AT + CYCLE });
      }
    });
    return out.sort((a, b) => a.t - b.t);
  }

  window.__coaster = { cycle: CYCLE, run: RUN, length: L, station: S0, travel, at, draw, loads };
  return {
    update(clock) { draw(clock); },
    resize,
    riders: { gate: GATE, queue: QUEUE, exit: EXIT, loads },
    occluders,
  };
}
