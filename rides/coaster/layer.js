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

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const [track, sheet, atlas, occF, occL, occS] = await Promise.all([
    fetch(url("track.json")).then((r) => r.json()),
    fetch(url("sprites.json")).then((r) => r.json()),
    loadImage(url("sprites.png")),
    fetch(url("occ_fireball.json")).then((r) => r.json()),
    fetch(url("occ_lattice.json")).then((r) => r.json()),
    fetch(url("occ_station.json")).then((r) => r.json()),
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
  };
  const back = layer();
  cutout("lattice", occL, OCC_LATTICE_ALPHA);
  const front = layer();
  cutout("station", occS);
  cutout("fireball", occF);
  let density = 1;
  function resize(scale) {
    density = scale * Math.min(devicePixelRatio || 1, 2 / scale);
    for (const g of [back, front]) { g.canvas.width = Math.round(bw * density); g.canvas.height = Math.round(bh * density); }
  }
  resize(ctx.scale());

  const F = sheet.frames, SD = sheet.density;
  const trains = [{ offset: 0, cars: [0, 1, 2] }, { offset: CYCLE / 2, cars: [0, 2, 1] }];
  const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

  function sprite(g, name, x, y, rot, flip, alpha) {
    if (alpha <= 0.004) return;
    const f = F[name];
    const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.drawImage(atlas, sx, sy, sw, sh, -ax / SD, -ay / SD, sw / SD, sh / SD);
    g.restore();
  }

  function draw(clock) {
    for (const g of [back, front]) {
      g.setTransform(density, 0, 0, density, -bx * density, -by * density);
      g.clearRect(bx, by, bw, bh);
      g.imageSmoothingQuality = "high";
    }
    const cars = [];
    for (const tr of trains) {
      const lead = S0 + travel(clock + tr.offset);
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
        cars.push({ kind, a, b: behindAt(u), vx, vy, x: c[0] + up[0] * LIFT, y: c[1] + up[1] * LIFT });
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
        const side = () => sprite(g, `side_${c.kind}`, c.x, c.y, rot, flip, c.a * w * aSide);
        const endOn = () => sprite(g, end, c.x, c.y, 0, false, c.a * w * aEnd);
        if (wEnd < 0.5) { side(); endOn(); } else { endOn(); side(); }
      }
    }
  }

  window.__coaster = { cycle: CYCLE, run: RUN, length: L, station: S0, travel, at, draw };
  return {
    update(clock) { draw(clock); },
    resize,
  };
}
