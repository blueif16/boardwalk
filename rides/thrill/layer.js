// The thrill rides by the main entrance: the Double Shot drop tower and the Typhoon's looping arm.
//
// Both towers stay painted. The Double Shot's seat ring (ring_back.webp / ring_front.webp, split along the hole's top
// arc) slides up and down the painted column: back half, then the column itself (occ_dropcolumn.webp, the painting's
// own pixels), then the front half and its riders. The Typhoon's painted arm and pods are erased by a plate
// (plate_typhoon.webp, tools/park_patch.py) that leaves a plain tower; a beam (arm.webp) turns in front of it in the
// plane facing the camera, with a two-seat car (car.webp) on each end that spins on its own axis. The Typhoon's tower
// (occ_typhoontower.webp, cut from the plate) covers the drop ring's right tip, and the flower bush in front of the
// drop tower (occ_bush.webp) covers both. Art: tools/build_parts.py; cut-outs: tools/cut_occluders.py.
//
// Motion is closed form from the master clock (the Typhoon's arm and car angles are integrated once at mount into a
// table over its cycle), so any time and a frozen &t= give the same frame.
//
// Riders: the park's animals (rides/RIDERS.md). riders.loads(t0, t1) lists the load events; each frame asks
// ctx.riders(ctx.name, key, t) who is on board and falls back to its own picks when that returns null.

// ---- Double Shot: drop tower ----
const DS = {
  axis: 1054,        // park px: the tower's centre line
  yBot: 1078,        // hole centre at rest (loading), park px
  yTop: 962,         // hole centre at the top of the shot, just under the crown
  k: 0.118,          // park px per ring sprite px (the hole, 750 sprite px wide, clears the 80 px column)
  period: 46,        // s
  unload: 1.0, load: 3.5,
  ride: 18,          // s into the cycle when the ring starts to lift
  seats: 8,
};
// Ring sprite px: the hole's centre (where the column passes), and where the four visible riders sit (bottom of the
// sitting sprite on the seat's cushion), back to front.
const RING_C = [800, 529];
const RING_SEATS = [[236, 690], [1360, 690], [568, 745], [1038, 745]];

// Height along the travel, 0 (loading) .. 1 (top), at tau into the cycle.
function dropHeight(tau) {
  const r = tau - DS.ride;
  if (r < 0) return 0;
  if (r < 4) return 0.22 * smooth(0, 4, r);                     // hoisted to a third of the way
  if (r < 6.5) return 0.22 + 0.004 * Math.sin(2 * Math.PI * 9 * r) * smooth(4, 4.3, r);  // a held breath
  if (r < 7.4) { const u = (r - 6.5) / 0.9; return 0.22 + 0.78 * (1 - (1 - u) ** 3); }  // shot to the top
  const bounce = (s) => 0.42 + 0.58 * Math.exp(-s / 1.6) * Math.cos((2 * Math.PI * s) / 2.0);
  if (r < 14.4) return bounce(r - 7.4);                          // free fall and the air springs' bounces
  if (r < 22) return bounce(7) * (1 - smooth(14.4, 22, r));     // let down gently
  return 0;
}

// ---- Typhoon: looping arm ----
const TY = {
  pivot: [1154, 952], // park px: the axle, just under the tower's crown
  r: 212,             // park px from the axle to a car's centre (the bottom car rests on the tower's base)
  carW: 66,           // park px
  swingPeriod: 5.2, swings: 3, swingAmp: 1.6, // the pendulum build-up: three swings growing to 92 degrees
  vmax: 1.9,          // rad/s at full speed: a loop about every 3.3 s, as filmed on the real ride
  spin: [1.5, -1.15], // rad/s, each car's own spin at full speed
};
const CP = Math.cos((28.7 * Math.PI) / 180); // the arm turns in the plane facing the camera: vertical lengths * 0.877
// Car sprite px: the two seats (feet of a standing rider, hidden below the lap bar) and the lap bar's top edge.
const CAR_SEATS = [[262, 470], [588, 470]];
const LAP_Y = 188;

const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
const hash = (n) => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

// The Typhoon's cycle: load car 0 at the bottom, half a turn, load car 1, swing up like a pendulum, loop, slow,
// loop the other way, and stop with car 0 at the bottom. The final hold is sized so the arm lands there exactly; the
// cars' own spin is corrected over the last stop the same way, so both are upright at every loading stop.
function typhoonTable() {
  const HZ = 240, dt = 1 / HZ;
  const seg = { l1: 7, half: 3.5, l2: 7, swing: TY.swingPeriod * TY.swings, blend: 2, r1: 14, slow: 3, rev: 3, hold: 6, stop: 5 };
  const t0 = { half: seg.l1 }; t0.l2 = t0.half + seg.half; t0.swing = t0.l2 + seg.l2; t0.loop = t0.swing + seg.swing;
  // Arm angle before the second hold, by integration of the loop's speed.
  const v0 = (TY.swingAmp * 2 * Math.PI) / TY.swingPeriod;
  const vLoop = (s) => s < seg.blend ? v0 + (TY.vmax - v0) * smooth(0, seg.blend, s)
    : s < seg.blend + seg.r1 ? TY.vmax
    : s < seg.blend + seg.r1 + seg.slow ? TY.vmax * (1 - smooth(0, seg.slow, s - seg.blend - seg.r1))
    : -TY.vmax * smooth(0, seg.rev, s - seg.blend - seg.r1 - seg.slow);
  const loopA = seg.blend + seg.r1 + seg.slow + seg.rev;
  let th = Math.PI;
  for (let s = 0; s < loopA; s += dt) th += vLoop(s + dt / 2) * dt;
  // Hold at -vmax for D, then stop over seg.stop (covering vmax * stop / 2): land on a multiple of 2 pi.
  const before = th - TY.vmax * (seg.hold + seg.stop / 2);
  const m = Math.floor(before / (2 * Math.PI));
  const D = seg.hold + (before - 2 * Math.PI * m) / TY.vmax;
  const total = t0.loop + loopA + D + seg.stop;
  const n = Math.ceil(total * 60) + 1;
  const theta = new Float64Array(n), psi = [new Float64Array(n), new Float64Array(n)];
  const vAt = (s) => (s < loopA ? vLoop(s) : s < loopA + D ? -TY.vmax : -TY.vmax * (1 - smooth(0, seg.stop, s - loopA - D)));
  const spinEnv = (s) => smooth(0, 3, s) * (1 - smooth(loopA + D, loopA + D + seg.stop, s));
  let a = Math.PI, c = [0, 0], k = 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / 60;
    // Integrate the loop phase up to t (sub-steps at HZ).
    if (t > t0.loop) {
      while (k * dt < t - t0.loop) {
        const s = k * dt + dt / 2;
        a += vAt(s) * dt;
        const e = spinEnv(s);
        for (let j = 0; j < 2; j++) c[j] += e * TY.spin[j] * (1 + 0.3 * Math.sin(0.7 * s + j * 2)) * dt;
        k++;
      }
    }
    let ang;
    if (t < t0.half) ang = 0;
    else if (t < t0.l2) ang = Math.PI * smooth(t0.half, t0.l2, t);
    else if (t < t0.swing) ang = Math.PI;
    else if (t < t0.loop) { const s = t - t0.swing; ang = Math.PI + TY.swingAmp * smooth(0, seg.swing, s) * Math.sin((2 * Math.PI * s) / TY.swingPeriod); }
    else ang = a;
    theta[i] = ang;
    psi[0][i] = c[0]; psi[1][i] = c[1];
    out.push(t);
  }
  // Land the arm exactly on 2 pi m and each car upright: spread the small remainders over the final stop.
  const tStop = t0.loop + loopA + D;
  const armErr = 2 * Math.PI * m - theta[n - 1];
  const carErr = [0, 1].map((j) => 2 * Math.PI * Math.round(psi[j][n - 1] / (2 * Math.PI)) - psi[j][n - 1]);
  const carFix = [0, 1].map((j) => 2 * Math.PI * Math.round(psi[j][n - 1] / (2 * Math.PI)));
  for (let i = 0; i < n; i++) {
    const w = smooth(tStop, total, i / 60);
    theta[i] += armErr * w;
    for (let j = 0; j < 2; j++) psi[j][i] += carErr[j] * w;
  }
  return { theta, psi, total, D, armErr, carErr, carFix, t0, loads: [3.0, t0.l2 + 3.0], unloads: [0.5, t0.l2 + 0.5] };
}

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowdDir = new URL("../../tests/park-crowd/", ctx.dir);
  const [parts, occ, plate, atlasMeta, ringBack, ringFront, armImg, carImg, atlas, ...occImgs] = await Promise.all([
    fetch(url("parts.json")).then((r) => r.json()),
    fetch(url("occluders.json")).then((r) => r.json()),
    fetch(url("plate_typhoon.json")).then((r) => r.json()),
    fetch(new URL("atlas.json", crowdDir)).then((r) => r.json()),
    loadImage(url("ring_back.webp")), loadImage(url("ring_front.webp")),
    loadImage(url("arm.webp")), loadImage(url("car.webp")),
    loadImage(new URL("atlas.png", crowdDir).href),
    loadImage(url("occ_dropcolumn.webp")), loadImage(url("occ_typhoontower.webp")), loadImage(url("occ_bush.webp")),
  ]);
  const [occColumn, occTower, occBush] = occImgs;
  ctx.addPatch(url("plate_typhoon.webp"), plate.rect);

  const T = typhoonTable();
  const sample = (arr, tau) => { const x = tau * 60, i = Math.min(arr.length - 2, Math.floor(x)), f = x - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
  const cyc = (t, P) => { const n = Math.floor(t / P); return { n, tau: t - n * P }; };

  // Riders: the crowd's animals, or our own picks when the crowd is not running.
  const UNIT = 3840 / 3904;
  const K = ((Number(ctx.params.get("px")) || 38) * UNIT) / 30;   // the crowd's size, park px per 30 stage units
  const AQ = K / (atlasMeta.scale || 4);                           // park px per atlas px
  const LOOKS = [...new Set(Object.keys(atlasMeta.frames).filter((k) => k.endsWith("/front_stand")).map((k) => k.split("/")[0]))]
    .filter((l) => l !== "pet" && l !== "bear_cub");
  const own = (key, n, seats) => {
    const h0 = hash(n * 131 + key.length * 7 + key.charCodeAt(key.length - 1));
    const count = seats > 2 ? Math.round(seats * (0.55 + 0.45 * h0)) : h0 < 0.1 ? 0 : h0 < 0.3 ? 1 : 2;
    return Array.from({ length: count }, (_, i) => LOOKS[Math.floor(hash(n * 977 + i * 31 + key.length) * LOOKS.length)]);
  };
  // Who is on `key` at t, and how visible (fading in as they board, out as they get off).
  function onBoard(key, t, P, loadAt, unloadAt, seats) {
    const { n, tau } = cyc(t, P);
    // The newest load at or before t: this cycle's if past it, else the last cycle's.
    const m = tau >= loadAt ? n : n - 1;
    const tl = m * P + loadAt, tu = (m + 1) * P + unloadAt;
    if (t >= tu + 0.5 || m < 0) return { looks: [], alpha: 0 };
    const crowd = ctx.riders ? ctx.riders(ctx.name, key, t) : null;
    const looks = crowd ?? own(key, m, seats);
    return { looks, alpha: smooth(tl, tl + 0.5, t) * (1 - smooth(tu, tu + 0.5, t)) };
  }

  // One canvas over both rides.
  const BOX = [895, 725, 1415, 1240];
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const c = document.createElement("canvas");
  c.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
  ctx.slots.rides.append(c);
  const g = c.getContext("2d");
  let density = 1;
  function resize(scale) {
    density = scale * Math.min(devicePixelRatio || 1, 2 / scale);
    c.width = Math.round(bw * density); c.height = Math.round(bh * density);
  }
  resize(ctx.scale());

  const occDraw = (img, name) => { const [x, y, w, h] = occ[name].rect; g.drawImage(img, x, y, w, h); };
  function rider(look, pose, x, y, alpha, scale = 1) {
    const f = atlasMeta.frames[`${look}/${pose}`] || atlasMeta.frames[`${look}/front_stand`];
    if (!f || alpha <= 0.004) return;
    const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor, q = AQ * scale;
    g.globalAlpha = alpha;
    g.drawImage(atlas, sx, sy, sw, sh, x - ax * q, y - ay * q, sw * q, sh * q);
    g.globalAlpha = 1;
  }

  function drawDrop(t) {
    const { tau } = cyc(t, DS.period);
    const y = DS.yBot + (DS.yTop - DS.yBot) * dropHeight(tau);
    const k = DS.k, [rw, rh] = parts.ring.size;
    const x0 = DS.axis - RING_C[0] * k, y0 = y - RING_C[1] * k;
    g.drawImage(ringBack, x0, y0, rw * k, rh * k);
    occDraw(occColumn, "dropcolumn");
    g.drawImage(ringFront, x0, y0, rw * k, rh * k);
    const on = onBoard("doubleshot:ring", t, DS.period, DS.load, DS.unload, DS.seats);
    on.looks.slice(0, RING_SEATS.length).forEach((look, i) => {
      const [sx, sy] = RING_SEATS[i];
      rider(look, "front_act", x0 + sx * k, y0 + sy * k, on.alpha, 0.92);
    });
    return y;
  }

  function drawTyphoon(t) {
    const { tau } = cyc(t, T.total);
    const th = sample(T.theta, tau);
    const [px, py] = TY.pivot;
    const A = parts.arm, ka = TY.r / (A.hub[0] - A.ends[0][0]);
    const C = parts.car, kc = TY.carW / C.size[0];
    g.save();
    g.translate(px, py);
    g.scale(1, CP);
    // The beam: its left end is car 0, at angle th from straight down.
    g.save();
    g.rotate(-Math.PI / 2 - th);
    g.drawImage(armImg, -A.hub[0] * ka, -A.hub[1] * ka, A.size[0] * ka, A.size[1] * ka);
    g.restore();
    for (let j = 0; j < 2; j++) {
      const a = th + j * Math.PI, cx = TY.r * Math.sin(a), cy = TY.r * Math.cos(a);
      const loadAt = T.loads[j], unloadAt = T.unloads[j];
      const on = onBoard(`typhoon:car${j}`, t, T.total, loadAt, unloadAt, 2);
      g.save();
      g.translate(cx, cy);
      g.rotate(sample(T.psi[j], tau));
      g.drawImage(carImg, -C.pivot[0] * kc, -C.pivot[1] * kc, C.size[0] * kc, C.size[1] * kc);
      // Riders between the seat backs and the lap bar; the car's front (bar and tub) is drawn again over them.
      g.translate(-C.pivot[0] * kc, -C.pivot[1] * kc);
      const seatsOrder = on.looks.length === 1 ? [hash(Math.floor(t / T.total) + j) < 0.5 ? 0 : 1] : [0, 1];
      on.looks.slice(0, 2).forEach((look, i) => {
        const [sx, sy] = CAR_SEATS[seatsOrder[i] ?? i];
        rider(look, "front_stand", sx * kc, sy * kc, on.alpha, 0.95);
      });
      g.beginPath();
      g.rect(0, LAP_Y * kc, C.size[0] * kc, (C.size[1] - LAP_Y) * kc);
      g.clip();
      g.drawImage(carImg, 0, 0, C.size[0] * kc, C.size[1] * kc);
      g.restore();
    }
    g.restore();
    return th;
  }

  function draw(t) {
    g.setTransform(density, 0, 0, density, -bx * density, -by * density);
    g.clearRect(bx, by, bw, bh);
    g.imageSmoothingQuality = "high";
    drawDrop(t);
    occDraw(occTower, "typhoontower");
    drawTyphoon(t);
    occDraw(occBush, "bush");
  }

  // The crowd's side (rides/RIDERS.md): the Double Shot first, the Typhoon in `more`.
  const loadsOf = (key, P, at, until, seats) => (t0, t1) => {
    const out = [];
    for (let n = Math.max(0, Math.floor((t0 - at) / P)); n * P + at < t1; n++) {
      const t = n * P + at;
      if (t >= t0) out.push({ t, key, seats, until: (n + 1) * P + until });
    }
    return out;
  };
  const dsLoads = loadsOf("doubleshot:ring", DS.period, DS.load, DS.unload, DS.seats);
  const tyLoads = [0, 1].map((j) => loadsOf(`typhoon:car${j}`, T.total, T.loads[j], T.unloads[j], 2));
  const riders = {
    gate: [1096, 1213],
    queue: [[1096, 1213], [1080, 1229], [1062, 1232], [1044, 1232], [1026, 1231], [1008, 1230]],
    exit: [1122, 1246],
    loads(t0, t1) {
      return [...dsLoads(t0, t1), ...tyLoads[0](t0, t1), ...tyLoads[1](t0, t1)].sort((a, b) => a.t - b.t);
    },
    more: [{
      gate: [1196, 1198],
      queue: [[1196, 1198], [1214, 1190], [1232, 1183], [1250, 1176], [1268, 1170], [1286, 1165]],
      exit: [1108, 1222],
      keys: ["typhoon:car0", "typhoon:car1"],
    }],
    keys: ["doubleshot:ring"],
  };

  window.__thrill = { draw, dropHeight: (t) => dropHeight(cyc(t, DS.period).tau), theta: (t) => sample(T.theta, cyc(t, T.total).tau), psi: (j, t) => sample(T.psi[j], cyc(t, T.total).tau), table: T, riders };

  return {
    riders,
    resize,
    update(t) { draw(t); },
  };
}
