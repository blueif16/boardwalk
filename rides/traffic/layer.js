// Small toy cars on Beach Street: eastbound from the west edge, round the turn at the river, westbound back off screen.
//
// The street is the painting's own (lanes.json, traced by tools/make_lanes.py). Cars are Meshy models of painted
// turnarounds rendered at the painting's camera from 32 headings (tools/render_cars.*, build_sprites.py); each frame a
// car shows the heading nearest its ground direction. The painting's own cars, which came out as blobs, are erased
// by patches (patch_*.webp, laid in the plate slot). Where something painted stands in front of the street (palms,
// the bowling pin, the flags, ride tops), its pixels are drawn over the cars (occ.webp, tools/make_occluders.py),
// sorted with the cars by where each meets the ground.
//
// Driving: a fixed-step simulation from SIM_START, so any clock time (and a frozen &t=) gives the same frame. Cars
// keep their distance (intelligent driver model), slow for the turn, give way at the crosswalks while a few animals
// cross, and some westbound cars pull nose-in into a stall on the north side, wait, back out when the lane is clear
// and drive on.
const DT = 1 / 30;
const SIM_START = -150;         // s of history before the clock's zero, so the street is already busy
const MAX_CARS = 7;             // on the street at once (parked ones not counted)
const SPAWN = [5, 12];          // s between arrivals at the west edge
const V0 = 72;                  // desired speed, park px/s (a car is about 74 px long)
const A = 38, B = 60;           // comfortable acceleration and braking, px/s^2
const S0 = 16, T = 1.3;         // standstill gap (px) and time headway (s)
const CAR_LEN = 74;
const A_LAT = 32;               // px/s^2 allowed sideways: the turn is taken at about 35 px/s
const PARK_P = 0.3;             // chance a westbound car takes a free stall it passes
const PARK_TIME = [35, 110];    // s parked
const V_SPUR = 20, V_BACK = 13; // into and out of a stall
const CROSS_PERIOD = [28, 60];  // s between crossings at one crosswalk
const WALK_V = 15;              // walkers, px/s
const ANIMAL = 38 * (3840 / 3904) / 30; // the crowd's size 38, as a scale on its atlas
const BOX = [0, 440, 3840, 1150]; // park px covered by this layer's canvas

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (n) => Math.floor(f() * n);
  return f;
}

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowdDir = new URL("../../tests/park-crowd/", ctx.dir);
  const [lanes, sheet, atlas, occ, occImg, patches, animals, animalImg] = await Promise.all([
    fetch(url("lanes.json")).then((r) => r.json()),
    fetch(url("sprites.json")).then((r) => r.json()),
    loadImage(url("sprites.webp")),
    fetch(url("occ.json")).then((r) => r.json()).catch(() => ({ pieces: [] })),
    loadImage(url("occ.webp")).catch(() => null),
    fetch(url("patches.json")).then((r) => r.json()).catch(() => []),
    fetch(new URL("atlas.json", crowdDir)).then((r) => r.json()),
    loadImage(new URL("atlas.png", crowdDir).href),
  ]);
  for (const p of patches) ctx.addPatch(url(p.file), p.rect);

  // --- Paths: screen points every 1 px, ground heading and a speed limit from curvature ---
  const cam = ctx.camera;
  const [exx, exy] = cam.ex, [ezx, ezy] = cam.ez, det = exx * ezy - ezx * exy;
  const groundHeading = (dx, dy) => Math.atan2((exx * dy - dx * exy) / det, (dx * ezy - ezx * dy) / det);
  function makePath(pts) {
    const n = pts.length, th = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 4)], b = pts[Math.min(n - 1, i + 4)];
      th[i] = groundHeading(b[0] - a[0], b[1] - a[1]);
    }
    return { pts, n, th };
  }
  const loop = makePath(lanes.loop);
  const L = loop.n;
  // Curvature speed limit, then a backward pass so cars brake before the turn, not in it.
  const vlim = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const a = loop.th[Math.max(0, i - 10)], b = loop.th[Math.min(L - 1, i + 10)];
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    const k = d / 20; // rad per screen px
    vlim[i] = k > 1e-4 ? Math.min(V0 * 1.2, Math.sqrt(A_LAT / k)) : V0 * 1.2;
  }
  for (let i = L - 2; i >= 0; i--) vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[i + 1] ** 2 + 2 * B * 0.8));
  const stalls = lanes.stalls.map((st) => ({ ...st, path: makePath(st.path), who: null }));
  const crosswalks = lanes.crosswalks.map((cw, i) => ({ ...cw, i, state: "idle", next: 0, start: 0, walkers: [], len: Math.hypot(cw.walk[1][0] - cw.walk[0][0], cw.walk[1][1] - cw.walk[0][1]) }));
  const at = (path, s) => {
    const i = Math.max(0, Math.min(path.n - 1, s)), i0 = Math.floor(i), f = i - i0, a = path.pts[i0], b = path.pts[Math.min(path.n - 1, i0 + 1)];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, path.th[Math.round(i)]];
  };

  const CARS = Object.keys(sheet.cars);
  const looks = [...new Set(Object.keys(animals.frames).filter((k) => k.endsWith("/front_walk0")).map((k) => k.split("/")[0]))].filter((l) => l !== "pet" && l !== "bear_cub");

  // --- The simulation ---
  let R, t, cars, nextSpawn, nextId;
  function reset() {
    R = rng(20261026);
    t = SIM_START;
    cars = [];
    nextId = 1;
    nextSpawn = t;
    for (const st of stalls) st.who = null;
    // Some stalls start occupied.
    for (const st of stalls) if (R() < 0.55) {
      const c = { id: nextId++, design: CARS[R.int(CARS.length)], mode: "parked", stall: st, s: st.path.n - 1, v: 0, until: t + R.range(10, 160), v0: V0 };
      st.who = c; cars.push(c);
    }
    for (const cw of crosswalks) { cw.state = "idle"; cw.next = t + R.range(5, 40); cw.walkers = []; }
  }
  reset();

  const onLoop = (c) => c.mode === "loop";
  function obstacleAhead(c) {
    // Nearest thing ahead on the loop: another car, a car turning into or backing out of a stall, or a crosswalk stop.
    let gap = Infinity, vLead = 0;
    for (const o of cars) {
      if (o === c) continue;
      let so = null;
      if (onLoop(o)) so = o.s;
      else if ((o.mode === "spur_in" && o.s < 45) || (o.mode === "spur_out" && o.s < 40) || o.mode === "merge") so = o.stall.branch;
      if (so == null) continue;
      const d = so - c.s - CAR_LEN;
      if (so > c.s && d < gap) { gap = d; vLead = onLoop(o) ? o.v : 0; }
    }
    for (const cw of crosswalks) {
      if (cw.state === "idle") continue;
      const d = cw.stop - c.s;
      if (d < -2) continue;
      // stop only if it can stop comfortably; a car already committed goes through
      if (cw.state === "pending" && c.v * c.v / (2 * B) > d + 6 && !c.waiting?.has(cw.i)) continue;
      (c.waiting ||= new Set()).add(cw.i);
      if (d + S0 < gap) { gap = Math.max(0.1, d + S0 - S0 * 0.6); vLead = 0; }
    }
    return [gap, vLead];
  }
  function idm(c, vdes, gap, vLead) {
    const ss = S0 + Math.max(0, c.v * T + (c.v * (c.v - vLead)) / (2 * Math.sqrt(A * B)));
    return A * (1 - (c.v / Math.max(1, vdes)) ** 4 - (gap < Infinity ? (ss / Math.max(0.1, gap)) ** 2 : 0));
  }

  function step() {
    // Arrivals at the west edge.
    if (t >= nextSpawn) {
      const n = cars.filter(onLoop).length;
      const clear = !cars.some((o) => onLoop(o) && o.s < CAR_LEN + 60);
      if (n < MAX_CARS && clear) {
        cars.push({ id: nextId++, design: CARS[R.int(CARS.length)], mode: "loop", s: 0, v: V0 * 0.8, v0: V0 * R.range(0.85, 1.12), parks: R() < PARK_P, parked: false });
        nextSpawn = t + R.range(...SPAWN);
      } else nextSpawn = t + 1;
    }
    // Crosswalks: pending (cars that can stop do) -> crossing once nobody is on the stripes -> idle.
    for (const cw of crosswalks) {
      if (cw.state === "idle" && t >= cw.next) { cw.state = "pending"; cw.since = t; }
      if (cw.state === "pending") {
        const busy = cars.some((o) => onLoop(o) && Math.abs(o.s - cw.s) < CAR_LEN * 0.75);
        if (!busy && t - cw.since > 1.2) {
          cw.state = "crossing"; cw.start = t;
          const k = 1 + Math.floor(R() * R() * 3);
          const south = R() < 0.6;
          cw.walkers = Array.from({ length: k }, (_, j) => ({ look: looks[R.int(looks.length)], delay: j * R.range(0.5, 1.2), off: (j % 2 ? 1 : -1) * j * 5, south }));
          cw.dur = cw.len / WALK_V + cw.walkers.at(-1).delay + 0.6;
        }
      }
      if (cw.state === "crossing" && t - cw.start > cw.dur) {
        cw.state = "idle"; cw.walkers = []; cw.next = t + R.range(...CROSS_PERIOD);
        for (const c of cars) c.waiting?.delete(cw.i);
      }
    }
    // Cars.
    for (const c of cars) {
      if (c.mode === "loop") {
        let vdes = Math.min(c.v0, vlim[Math.min(L - 1, Math.floor(c.s))]);
        // Heading for a stall: slow down to turn in at its branch point.
        if (c.parks && !c.parked && !c.target) {
          const st = stalls.find((x) => !x.who && x.branch > c.s + 90 && x.branch < c.s + 200);
          if (st) { c.target = st; st.who = c; }
        }
        if (c.target) {
          const d = c.target.branch - c.s;
          vdes = Math.min(vdes, Math.sqrt(V_SPUR ** 2 + 2 * B * 0.7 * Math.max(0, d)));
          if (d <= 0.5) { c.mode = "spur_in"; c.stall = c.target; c.target = null; c.s = 0; c.v = Math.min(c.v, V_SPUR); continue; }
        }
        const [gap, vLead] = obstacleAhead(c);
        c.v = Math.max(0, c.v + idm(c, vdes, gap, vLead) * DT);
        c.s += c.v * DT;
      } else if (c.mode === "spur_in") {
        const left = c.stall.path.n - 1 - c.s;
        c.v = Math.min(V_SPUR, Math.sqrt(2 * B * 0.6 * Math.max(0, left)));
        c.s = Math.min(c.stall.path.n - 1, c.s + Math.max(2, c.v) * DT);
        if (left < 0.5) { c.mode = "parked"; c.v = 0; c.parked = true; c.until = t + R.range(...PARK_TIME); }
      } else if (c.mode === "parked") {
        if (t >= c.until) {
          // Back out when nobody is coming along the lane within reach.
          const b = c.stall.branch;
          const clear = !cars.some((o) => onLoop(o) && o.s > b - 260 && o.s < b + 40) && !cars.some((o) => o !== c && (o.mode === "spur_out" || o.mode === "merge") && Math.abs(o.stall.branch - b) < 150);
          if (clear && cars.filter(onLoop).length < MAX_CARS) { c.mode = "spur_out"; c.v = 0; }
          else c.until = t + 1;
        }
      } else if (c.mode === "spur_out") {
        c.v = Math.min(V_BACK, c.v + 20 * DT);
        c.s -= c.v * DT;
        if (c.s <= 0) { c.mode = "merge"; c.s = 0; c.v = 0; c.until = t + 0.6; }
      } else if (c.mode === "merge") {
        if (t >= c.until) { c.stall.who = null; c.mode = "loop"; c.s = c.stall.branch; c.v = 4; c.parks = false; c.stall = null; }
      }
    }
    cars = cars.filter((c) => !(c.mode === "loop" && c.s >= L - 1));
    t += DT;
  }
  function advance(to) {
    if (to < t - DT) reset();
    let guard = 0;
    while (t < to && guard++ < 40000) step();
  }

  // --- Drawing: one canvas over the street, cars, walkers and the painting's cut-outs sorted by ground y ---
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
  ctx.slots.rides.append(canvas);
  const g = canvas.getContext("2d");
  let density = 1;
  function resize(scale) {
    density = scale * Math.min(devicePixelRatio || 1, 2 / scale);
    canvas.width = Math.round(bw * density); canvas.height = Math.round(bh * density);
  }
  resize(ctx.scale());

  const SD = sheet.density, NH = sheet.headings;
  const pieces = occ.pieces || [];
  function carFrame(c) {
    let x, y, th;
    if (c.mode === "loop") [x, y, th] = at(loop, c.s);
    else [x, y, th] = at(c.stall.path, c.s);
    let k = Math.round((th / (2 * Math.PI)) * NH) % NH; if (k < 0) k += NH;
    const f = sheet.cars[c.design][`h${k}`];
    return { f, x, y };
  }
  function walkerFrames(now) {
    const out = [];
    for (const cw of crosswalks) {
      if (cw.state !== "crossing") continue;
      const [p, q] = cw.walk;
      for (const w of cw.walkers) {
        const d = (now - cw.start - w.delay) * WALK_V;
        if (d < 0 || d > cw.len) continue;
        const u = w.south ? d / cw.len : 1 - d / cw.len;
        const x = p[0] + (q[0] - p[0]) * u + w.off, y = p[1] + (q[1] - p[1]) * u + w.off * 0.3;
        const ph = Math.floor((now - cw.start) * 4.6 + w.delay * 3) % 4;
        const pose = ["walk0", "stand", "walk1", "stand"][ph];
        const f = animals.frames[`${w.look}/${w.south ? "front" : "back"}_${pose}`];
        if (f) out.push({ f, x, y });
      }
    }
    return out;
  }
  // &probe=s,s:van,... places still cars at loop indices instead of the simulation (for checking every crossing).
  const probes = ctx.params.get("probe")?.split(",").filter(Boolean).map((v, i) => {
    const [sv, design] = v.split(":");
    return { mode: "loop", s: Number(sv), v: 0, design: design || CARS[i % CARS.length] };
  });

  function draw() {
    g.setTransform(density, 0, 0, density, -bx * density, -by * density);
    g.clearRect(bx, by, bw, bh);
    g.imageSmoothingQuality = "high";
    const list = [];
    const boxes = [];
    for (const c of probes || cars) {
      const { f, x, y } = carFrame(c);
      const [, , w, h] = f.rect, [ax, ay] = f.anchor;
      const x0 = x - ax / SD, y0 = y - ay / SD;
      list.push({ y, draw: () => g.drawImage(atlas, f.rect[0], f.rect[1], w, h, x0, y0, w / SD, h / SD) });
      boxes.push([x0, y0, x0 + w / SD, y0 + h / SD]);
    }
    const sc = ANIMAL / animals.scale;
    for (const { f, x, y } of probes ? [] : walkerFrames(t)) {
      const [sx, sy, w, h] = f.rect, [ax, ay] = f.anchor;
      const x0 = x - ax * sc, y0 = y - ay * sc;
      list.push({ y, draw: () => g.drawImage(animalImg, sx, sy, w, h, x0, y0, w * sc, h * sc) });
      boxes.push([x0, y0, x0 + w * sc, y0 + h * sc]);
    }
    if (occImg) for (const p of pieces) {
      const [px, py, pw, ph] = p.at;
      if (!boxes.some((b) => b[0] < px + pw && b[2] > px && b[1] < py + ph && b[3] > py)) continue; // nothing under it
      list.push({ y: p.sortY, draw: () => g.drawImage(occImg, p.rect[0], p.rect[1], p.rect[2], p.rect[3], px, py, pw, ph) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();
  }

  // window.__traffic.at = T holds the street at time T (headless frame strips); null follows the clock.
  const api = (window.__traffic = { advance, cars: () => cars, crosswalks, loop, vlim, time: () => t, draw, at: null });
  return {
    update(clock) { if (!probes) advance(api.at ?? clock); draw(); },
    resize,
  };
}
