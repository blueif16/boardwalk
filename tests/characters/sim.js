export const STEP = 1 / 30;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.pick = (list) => list[Math.floor(f() * list.length)];
  f.weighted = (table) => {
    let sum = 0;
    for (const k in table) sum += table[k];
    let r = f() * sum;
    for (const k in table) if ((r -= table[k]) <= 0) return k;
    return Object.keys(table)[0];
  };
  return f;
}

const PERIODS = [
  { until: 5.5, name: "night" }, { until: 10.5, name: "morning" }, { until: 16.5, name: "midday" },
  { until: 20, name: "golden" }, { until: 24, name: "night" },
];
const DENSITY = [[0, 0.08], [5.5, 0.08], [6.5, 0.28], [9, 0.32], [11, 0.95], [13, 1], [16, 1], [18, 0.85], [19.3, 0.7], [20.5, 0.4], [22, 0.25], [23.5, 0.1], [24, 0.08]];
const GROUPS = {
  morning: { single: 0.4, couple: 0.36, family: 0.24 },
  midday: { single: 0.2, couple: 0.3, family: 0.32, friends: 0.18 },
  golden: { single: 0.15, couple: 0.42, family: 0.23, friends: 0.2 },
  night: { single: 0.2, couple: 0.62, friends: 0.18 },
};
const ACTS = {
  morning: { rail: 2.2, bench: 1.2, stall: 1, beach: 1.6, stroll: 1.6, photo: 0.4, watch: 0.6, leave: 0.5 },
  midday: { queue: 3.2, stall: 2.6, rail: 1, bench: 0.6, beach: 2, photo: 1, watch: 1.2, stroll: 0.5, hangout: 0.8, leave: 0.25 },
  golden: { queue: 2.2, stall: 2, rail: 2.6, bench: 1, beach: 1, photo: 1.2, watch: 1, stroll: 0.6, hangout: 0.7, leave: 0.35 },
  night: { queue: 1.2, stall: 0.8, rail: 2.2, bench: 1.6, beach: 0.3, watch: 0.8, stroll: 1, hangout: 0.6, leave: 0.6 },
};
const ADULTS = ["bear", "bunny", "cat_orange", "dog_shiba", "cat_grey", "bunny_brown", "dog_cream"];

export const periodOf = (hour) => PERIODS.find((p) => hour < p.until).name;
export function density(hour) {
  for (let i = 0; i < DENSITY.length - 1; i++) {
    const [h0, d0] = DENSITY[i], [h1, d1] = DENSITY[i + 1];
    if (hour <= h1) return d0 + ((hour - h0) / (h1 - h0)) * (d1 - d0);
  }
  return DENSITY.at(-1)[1];
}

export function createCrowd({ walk, camera, max = 150, seed = 1, hour = () => 13, looks = ADULTS, kids = ["bear_cub"] }) {
  const R = rng(seed);
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
  const nodes = walk.nodes.map((n, i) => ({ ...n, i, x: n.g[0], z: n.g[2], adj: [] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of walk.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    const len = Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.h - b.h);
    const k = e.kind === "cross" ? 1.15 : 1;
    a.adj.push({ to: b.i, cost: len * k });
    b.adj.push({ to: a.i, cost: len * (e.dir ? 2.6 : k) });
  }
  const places = walk.places.map((p) => ({
    ...p,
    nodeIdx: byId.get(p.node).i,
    spots: p.slots.map((s, i) => ({ x: p.g[i][0], h: p.h ?? 0, z: p.g[i][2], px: s })),
    targetG: p.target ? ground(p.target) : null,
    used: 0,
    line: p.kind === "queue" ? [] : null,
    clock: 0,
  }));
  for (const p of places) if (p.kind === "hangout") p.cap = 2;
  const byKind = {};
  for (const p of places) (byKind[p.kind] ||= []).push(p);
  byKind.beach.forEach((p, i) => (p.mode = ["towel", "towel", "stand", "castle", "towel", "stand"][i % 6]));
  const exits = walk.exits.map((id) => byId.get(id).i);
  const deckExits = exits.filter((i) => nodes[i].h === 0);

  function ground(px, h = 0) {
    const g = camera.toGround(px, h);
    return { x: g[0], h, z: g[2] };
  }

  const pathCache = new Map();
  function path(from, to) {
    const key = from * 4096 + to;
    if (pathCache.has(key)) return pathCache.get(key);
    const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Int32Array(nodes.length).fill(-1), done = new Uint8Array(nodes.length);
    dist[from] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const { to: v, cost } of nodes[u].adj) if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = u; }
    }
    const out = [];
    for (let v = to; v >= 0; v = prev[v]) out.unshift(v);
    const res = out[0] === from ? out : [from, to];
    pathCache.set(key, res);
    return res;
  }

  function nearestNode(p) {
    let best = 0, d = Infinity;
    const sand = p.h < -20;
    for (const n of nodes) {
      if (n.kind === "place" || n.kind === "exit" || (n.h < -20) !== sand) continue;
      const dd = Math.hypot(n.x - p.x, n.z - p.z);
      if (dd < d) { d = dd; best = n.i; }
    }
    return best;
  }

  const agents = [], groups = [];
  let nextId = 1;

  function makeAgent(group, look, opts = {}) {
    const a = {
      id: nextId++, group, look, kid: !!opts.kid, pet: !!opts.pet, x: 0, h: 0, z: 0, tx: 0, th: 0, tz: 0,
      ox: opts.ox || 0, oz: opts.oz || 0, view: "front", flip: false, heading: 0, pose: "stand", phase: R(), moving: false,
      hidden: false, scale: opts.pet ? 1 : opts.kid ? 1 : R.range(0.94, 1.06), owner: opts.owner || null, glance: 0, wobble: R(),
    };
    agents.push(a);
    group.members.push(a);
    return a;
  }

  function makeGroup(kind, at) {
    const g = { id: nextId++, kind, members: [], route: [], seg: 0, s: 0, pos: { ...at }, dir: [1, 0], state: "idle", place: null, until: 0, pace: 18, lat: R.range(-7, 7), leaving: false, pauseAt: 0, spot: null };
    const look = () => R.pick(looks);
    if (kind === "jogger") { g.pace = R.range(40, 52); makeAgent(g, look()); }
    else if (kind === "single") { g.pace = R.range(16, 23); makeAgent(g, look()); }
    else if (kind === "couple") { g.pace = R.range(14, 19); makeAgent(g, look(), { ox: 0, oz: -5 }); makeAgent(g, look(), { ox: 0, oz: 5 }); }
    else if (kind === "friends") { g.pace = R.range(15, 20); makeAgent(g, look(), { oz: -7 }); makeAgent(g, look(), { oz: 7 }); makeAgent(g, look(), { ox: -8, oz: 0 }); }
    else if (kind === "family") {
      g.pace = R.range(13, 17);
      makeAgent(g, look(), { oz: -5 });
      if (R() < 0.6) makeAgent(g, look(), { oz: 5 });
      makeAgent(g, R.pick(kids), { kid: true, ox: 10, oz: R.range(-3, 3) });
      if (R() < 0.35) makeAgent(g, R.pick(kids), { kid: true, ox: 6, oz: R.range(6, 9) });
    } else if (kind === "dogwalker") {
      g.pace = R.range(15, 20);
      const owner = makeAgent(g, look(), { oz: -3 });
      makeAgent(g, "pet", { pet: true, owner, ox: 13, oz: 4 });
    }
    for (const a of g.members) { Object.assign(a, { x: at.x + a.ox, h: at.h, z: at.z + a.oz }); a.tx = a.x; a.th = a.h; a.tz = a.z; }
    groups.push(g);
    return g;
  }

  const hasKid = (g) => g.members.some((a) => a.kid);
  const people = (g) => g.members.filter((a) => !a.pet);

  function choosePlace(g) {
    const period = periodOf(hour());
    if (g.leaving || g.kind === "jogger") return { kind: "leave" };
    const table = { ...ACTS[period] };
    if (g.kind === "dogwalker") { delete table.queue; delete table.stall; delete table.bench; }
    if (hour() >= 22.5 || hour() < 11) delete table.queue;
    for (let tries = 0; tries < 8; tries++) {
      const kind = R.weighted(table);
      if (kind === "leave") return { kind: "leave" };
      if (kind === "stroll") {
        const near = nodes.filter((n) => n.kind === "lane" && n.px[0] > 0 && n.px[0] < camera.W && dist(n, g.pos) < 260 && dist(n, g.pos) > 60);
        if (near.length) return { kind: "stroll", node: R.pick(near).i };
        continue;
      }
      const list = byKind[kind];
      if (!list) continue;
      const free = list.filter((p) => fits(p, g));
      if (!free.length) { delete table[kind]; continue; }
      const here = g.pos;
      free.sort((a, b) => dist(a.spots[0], here) - dist(b.spots[0], here));
      const pool = R() < 0.75 ? free.slice(0, 2) : free.slice(0, Math.max(3, Math.ceil(free.length / 3)));
      return { kind, place: R.pick(pool) };
    }
    return { kind: "stroll", node: R.pick(nodes.filter((n) => n.kind === "lane")).i };
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  function fits(p, g) {
    const n = people(g).length;
    if (p.kind === "queue") return p.line.length + n <= p.spots.length;
    if (p.kind === "bench") return !p.used && n <= p.spots.length;
    if (p.kind === "stall") return p.used < p.spots.length;
    if (p.kind === "hangout") return p.used < p.cap;
    if (p.kind === "photo" || p.kind === "rail" || p.kind === "beach" || p.kind === "watch") return !p.used;
    return true;
  }

  function setRoute(g, targetNode, tail = []) {
    const start = nearestNode(g.pos);
    const ids = path(start, targetNode);
    const pts = [{ ...g.pos }];
    for (const i of ids) pts.push({ x: nodes[i].x, h: nodes[i].h, z: nodes[i].z, node: i });
    pts.push(...tail);
    g.route = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5 || p.h !== pts[i - 1].h);
    g.seg = 0;
    g.s = 0;
    g.state = "walk";
    g.pauseAt = R.range(4, 14);
  }

  function plan(g) {
    const c = choosePlace(g);
    g.plan = c;
    if (c.kind === "leave") {
      const pool = g.kind === "jogger" ? deckExits : g.pos.h < -20 ? exits.filter((i) => nodes[i].h < 0) : deckExits;
      let target = R.pick(pool);
      if (g.kind === "jogger") target = pool.reduce((b, i) => (dist(nodes[i], g.pos) > dist(nodes[b], g.pos) ? i : b), pool[0]);
      setRoute(g, target);
      return;
    }
    if (c.kind === "stroll") { setRoute(g, c.node); return; }
    const p = c.place;
    reserve(g, p);
    setRoute(g, p.nodeIdx);
  }

  function reserve(g, p) {
    g.place = p;
    if (p.kind === "queue") for (const a of people(g)) p.line.push(a);
    else if (p.kind === "stall") { g.spot = p.spots.findIndex((s) => !s.who); p.spots[g.spot].who = g; p.used++; }
    else p.used++;
  }

  function release(g) {
    const p = g.place;
    if (!p) return;
    if (p.kind === "queue") p.line = p.line.filter((a) => a.group !== g);
    else if (p.kind === "stall") { p.spots[g.spot].who = null; p.used--; }
    else p.used--;
    g.place = null;
  }

  function face(a, tx, tz) {
    const dx = tx - a.x, dz = tz - a.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) a.heading = Math.atan2(dz, dx);
  }

  function arrive(g) {
    const p = g.place, ppl = people(g);
    if (g.plan.kind === "leave" && exits.includes(g.route.at(-1).node)) { remove(g); return; }
    if (!p) { g.state = "act"; g.until = now + R.range(1.5, 5); g.what = "look"; return; }
    g.state = "act";
    const sea = Math.PI / 2;
    if (p.kind === "queue") { g.what = "queue"; g.until = Infinity; return; }
    if (p.kind === "stall") {
      const s = p.spots[g.spot];
      ppl.forEach((a, i) => { a.tx = s.x + (i ? (i % 2 ? -7 : 7) : 0); a.tz = s.z + (i ? 9 + (i > 2 ? 7 : 0) : 0); a.th = 0; a.want = { heading: -Math.PI / 2, pose: "stand" }; });
      g.what = "stall"; g.until = now + R.range(10, 20); return;
    }
    if (p.kind === "bench") {
      ppl.forEach((a, i) => { const s = p.spots[Math.min(i, p.spots.length - 1)]; a.tx = s.x + (i >= p.spots.length ? 9 : 0); a.tz = s.z + (i >= p.spots.length ? 8 : 0); a.th = 0; a.want = { heading: sea, pose: i < p.spots.length ? "sit" : "stand" }; });
      g.what = "bench"; g.until = now + R.range(40, 90); return;
    }
    if (p.kind === "rail" || (p.kind === "beach" && p.mode !== "castle")) {
      const s = p.spots[0];
      ppl.forEach((a, i) => { const k = i - (ppl.length - 1) / 2; a.tx = s.x + k * 10; a.tz = s.z - k * 1.5; a.th = s.h; a.want = { heading: sea, pose: p.kind === "beach" && p.mode === "towel" ? "sit" : "stand" }; });
      g.what = p.kind; g.until = now + (p.kind === "rail" ? R.range(30, 80) : R.range(70, 160)); return;
    }
    if (p.kind === "beach") {
      const s = p.spots[0];
      ppl.forEach((a, i) => {
        const ang = (i / ppl.length) * Math.PI * 2 + 0.6;
        a.tx = s.x + (a.kid ? 0 : Math.cos(ang) * 14); a.tz = s.z + (a.kid ? 0 : Math.sin(ang) * 10); a.th = s.h;
        a.want = { at: s, pose: a.kid ? "sit" : "stand" };
      });
      g.what = "castle"; g.until = now + R.range(60, 150); return;
    }
    if (p.kind === "photo" || p.kind === "watch") {
      const s = p.spots[0];
      ppl.forEach((a, i) => { const k = i - (ppl.length - 1) / 2; a.tx = s.x + k * 9; a.tz = s.z + Math.abs(k) * 5; a.th = 0; a.want = { at: p.targetG, pose: i === 0 && p.kind === "photo" ? "photo" : "stand" }; });
      g.what = p.kind; g.until = now + (p.kind === "photo" ? R.range(8, 16) : R.range(25, 55)); return;
    }
    if (p.kind === "hangout") {
      const s = p.spots[0], off = [[0, 0], [34, -14], [-32, 12]][(p.used - 1) % 3], cx = s.x + off[0], cz = s.z + off[1];
      ppl.forEach((a, i) => {
        const ang = ppl.length === 2 ? i * Math.PI : (i / ppl.length) * Math.PI * 2 + 0.3;
        a.tx = cx + Math.cos(ang) * 8; a.tz = cz + Math.sin(ang) * 6; a.th = 0;
        a.want = { at: { x: cx, z: cz }, pose: R() < 0.7 ? "eat" : "stand" };
      });
      g.what = "hangout"; g.until = now + R.range(30, 65); return;
    }
  }

  function finish(g) {
    const was = g.place;
    release(g);
    for (const a of g.members) a.want = null;
    if (was?.kind === "stall" && R() < 0.65 && !g.leaving) {
      const hs = byKind.hangout.filter((p) => fits(p, g) && dist(p.spots[0], g.pos) < 200).sort((a, b) => dist(a.spots[0], g.pos) - dist(b.spots[0], g.pos));
      if (hs.length) { g.plan = { kind: "hangout", place: hs[0] }; reserve(g, hs[0]); setRoute(g, hs[0].nodeIdx); return; }
      const ppl = people(g), cx = g.pos.x + R.range(-6, 6), cz = g.pos.z + 16;
      ppl.forEach((a, i) => {
        const ang = ppl.length === 1 ? Math.PI / 2 : ppl.length === 2 ? i * Math.PI : (i / ppl.length) * Math.PI * 2 + 0.3;
        a.tx = cx + Math.cos(ang) * 8; a.tz = cz + Math.sin(ang) * 6; a.th = g.pos.h;
        a.want = ppl.length === 1 ? { heading: Math.PI / 2, pose: "eat" } : { at: { x: cx, z: cz }, pose: R() < 0.7 ? "eat" : "stand" };
      });
      g.plan = { kind: "snack" }; g.state = "act"; g.what = "hangout"; g.until = now + R.range(15, 35); return;
    }
    plan(g);
  }

  function remove(g) {
    release(g);
    for (const a of g.members) agents.splice(agents.indexOf(a), 1);
    groups.splice(groups.indexOf(g), 1);
  }

  let now = 0;

  function stepQueues() {
    for (const p of byKind.queue || []) {
      p.clock += STEP;
      const line = p.line;
      line.forEach((a, i) => {
        const s = p.spots[Math.min(i, p.spots.length - 1)];
        if (a.group.state === "act") { a.tx = s.x; a.tz = s.z; a.th = 0; const nx = i ? p.spots[i - 1] : ground(p.gate); a.want = { at: nx, pose: "stand" }; }
      });
      if (p.clock < p.cycle) continue;
      p.clock = 0;
      let boarded = 0;
      while (line.length && boarded < p.board) {
        const g = line[0].group;
        if (g.state !== "act") break;
        const n = people(g).length;
        if (boarded && boarded + n > p.board) break;
        boarded += n;
        p.line = line.filter((a) => a.group !== g);
        line.splice(0, line.length, ...p.line);
        g.place = null;
        g.state = "ride";
        g.until = now + R.range(p.cycle * 1.2, p.cycle * 2.2);
        const gate = ground(p.gate);
        for (const a of g.members) { a.hidden = true; a.x = a.tx = gate.x; a.z = a.tz = gate.z; a.want = null; }
        g.pos = { ...gate, h: 0 };
      }
      p.line = line;
    }
  }

  function moveGroup(g, dt) {
    if (g.state === "pause") {
      if (now >= g.until) g.state = "walk";
      else return;
    }
    let left = g.pace * dt;
    while (left > 0 && g.seg < g.route.length - 1) {
      const a = g.route[g.seg], b = g.route[g.seg + 1];
      const len = Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z, (b.h - a.h) * 0.6));
      const step = Math.min(left, len - g.s);
      g.s += step;
      left -= step;
      if (g.s >= len - 1e-6) { g.seg++; g.s = 0; }
    }
    const a = g.route[g.seg], b = g.route[Math.min(g.seg + 1, g.route.length - 1)];
    const len = Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z, (b.h - a.h) * 0.6));
    const t = g.seg >= g.route.length - 1 ? 1 : g.s / len;
    g.pos = { x: a.x + (b.x - a.x) * t, h: a.h + (b.h - a.h) * t, z: a.z + (b.z - a.z) * t };
    const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz);
    if (dl > 0.5) {
      const k = Math.min(1, dt * 5);
      g.dir = [g.dir[0] + (dx / dl - g.dir[0]) * k, g.dir[1] + (dz / dl - g.dir[1]) * k];
      const n = Math.hypot(...g.dir) || 1;
      g.dir = [g.dir[0] / n, g.dir[1] / n];
    }
    const stair = Math.abs(b.h - a.h) > 1 && g.seg < g.route.length - 1;
    const [fx, fz] = g.dir, rx = -fz, rz = fx;
    g.members.forEach((m, i) => {
      if (m.want) return;
      const ox = stair ? -i * 7 : m.ox, oz = stair ? 0 : m.oz + g.lat;
      m.tx = g.pos.x + fx * ox + rx * oz;
      m.tz = g.pos.z + fz * ox + rz * oz;
      m.th = g.pos.h;
    });
    if (g.seg >= g.route.length - 1) { arrive(g); return; }
    g.pauseAt -= dt;
    if (g.pauseAt <= 0 && g.kind !== "jogger" && !stair && g.route.length > 2) {
      const kid = g.members.find((m) => m.kid);
      if (kid || R() < 0.6) {
        g.state = "pause";
        g.until = now + R.range(1.2, kid ? 4 : 3.2);
        if (kid) kid.glance = g.until;
      }
      g.pauseAt = R.range(5, 14) * (kid ? 0.6 : 1);
    }
  }

  function moveAgent(a, dt, g) {
    const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
    const max = (g.state === "walk" ? g.pace * 1.6 : 20) * dt + 0.01;
    if (d > max) { a.x += (dx / d) * max; a.z += (dz / d) * max; } else { a.x = a.tx; a.z = a.tz; }
    a.h += (a.th - a.h) * Math.min(1, dt * 12);
    const moved = Math.min(d, max);
    a.moving = moved > 0.05 * dt * 30 * 0.3 && (g.state === "walk" || d > 1.2);
    if (a.moving) {
      a.phase += moved / (a.pet ? 2.6 : a.kid ? 3.2 : 3.8) / 4;
      if (d > 0.3) a.heading = Math.atan2(dz, dx);
      a.pose = "walk";
    } else if (a.want) {
      if (a.want.heading != null) a.heading = a.want.heading;
      else if (a.want.at) face(a, a.want.at.x, a.want.at.z);
      a.pose = a.want.pose;
    } else {
      a.pose = a.pet ? ((now * 0.12 + a.wobble) % 1 < 0.35 ? "sniff" : "sit") : "stand";
    }
    if (a.kid && a.glance > now && !a.moving) a.heading = Math.atan2(a.wobble < 0.5 ? 1 : -1, 0.2);
    if (g.what === "watch" && !a.moving && a.want) {
      const c = (now * 0.09 + a.wobble * 5) % 1;
      if (c < 0.22) a.heading += Math.sin(c * 28) * 0.9;
    }
    if (g.what === "rail" && !a.moving) {
      const c = (now * 0.13 + a.wobble * 7) % 1;
      if (c < 0.18) a.heading = Math.PI / 2 + (a.wobble < 0.5 ? 1.2 : -1.9);
    }
    view(a);
  }

  function view(a) {
    const dx = Math.cos(a.heading), dz = Math.sin(a.heading);
    const hr = dx * cy - dz * sy, ht = dx * sy + dz * cy;
    const th = (Math.atan2(hr, ht) * 180) / Math.PI;
    a.theta = th;
    const cur = a.view === "front" ? 0 : a.view === "back" ? 180 : a.flip ? -90 : 90;
    let diff = Math.abs(((th - cur + 540) % 360) - 180);
    if (diff < 52) return;
    a.turned = now;
    const at = Math.abs(th);
    if (at <= 45) { a.view = "front"; a.flip = false; }
    else if (at >= 135) { a.view = "back"; a.flip = false; }
    else { a.view = "side"; a.flip = th < 0; }
  }

  function spawn(initial, forced) {
    const period = periodOf(hour());
    const kind = forced || R.weighted(GROUPS[period]);
    let at;
    if (initial) {
      const n = R.pick(nodes.filter((x) => x.kind !== "exit" && x.kind !== "place" && x.px[0] > 0 && x.px[0] < camera.W));
      at = { x: n.x, h: n.h, z: n.z };
    } else {
      const ex = kind === "jogger" ? R.pick(deckExits.filter((i) => nodes[i].kind === "lane")) : R() < 0.78 ? R.pick(deckExits) : R.pick(exits);
      at = { x: nodes[ex].x, h: nodes[ex].h, z: nodes[ex].z };
    }
    const g = makeGroup(kind, at);
    plan(g);
    if (initial && g.plan.place && R() < 0.75) {
      const target = g.route.at(-1);
      g.pos = { x: target.x, h: target.h, z: target.z };
      g.seg = g.route.length - 1;
      for (const m of g.members) { m.x = target.x + m.ox; m.z = target.z + m.oz; m.h = target.h; }
      arrive(g);
      if (g.until !== Infinity) g.until = now + R.range(0, g.until - now);
      for (const m of g.members) if (m.want) { m.x = m.tx; m.z = m.tz; m.h = m.th; }
    }
    return g;
  }

  let target = 0;
  const QUOTA = { jogger: { morning: 0.14, golden: 0.03 }, dogwalker: { morning: 0.12, golden: 0.04, midday: 0.02 } };
  const quota = (kind) => Math.round(target * (QUOTA[kind][periodOf(hour())] || 0) / (kind === "dogwalker" ? 2 : 1));
  function count() {
    let n = 0;
    const by = { jogger: 0, dogwalker: 0 };
    for (const g of groups) if (g.kind in by) by[g.kind]++; else n += g.members.length;
    return [n, by];
  }

  function step() {
    now += STEP;
    target = Math.round(max * density(hour()));
    stepQueues();
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.state === "walk" || g.state === "pause") moveGroup(g, STEP);
      else if (g.state === "act" && now >= g.until) finish(g);
      else if (g.state === "ride" && now >= g.until) {
        for (const a of g.members) a.hidden = false;
        finish(g);
      }
    }
    for (const g of groups) for (const a of g.members) {
      if (a.pet) {
        const o = a.owner;
        if (g.state === "walk" || g.state === "pause") {
          const [fx, fz] = g.dir;
          a.tx = o.x + fx * 13 + fz * 4; a.tz = o.z + fz * 13 - fx * 4; a.th = o.h;
        } else if (!a.want) { a.tx = o.x + 11; a.tz = o.z - 4; a.th = o.h; }
      }
      moveAgent(a, STEP, g);
    }
    if ((now * 30) % 15 < 1) {
      const [n, by] = count(), rest = target - quota("jogger") - quota("dogwalker") * 2;
      if (n < rest) spawn(false);
      else if (n > rest * 1.05) {
        const g = groups.find((x) => !x.leaving && x.state !== "ride" && !(x.kind in by));
        if (g) g.leaving = true;
      }
      for (const k in by) {
        if (by[k] < quota(k) && R() < 0.5) spawn(false, k);
        else if (by[k] > quota(k) * 1.2 + 1) { const g = groups.find((x) => x.kind === k && !x.leaving); if (g) g.leaving = true; }
      }
    }
  }

  function init() {
    target = Math.round(max * density(hour()));
    let guard = 0;
    while (count()[0] < target - quota("jogger") - quota("dogwalker") * 2 && guard++ < 5000) spawn(true);
    for (const k of ["jogger", "dogwalker"]) for (let i = 0; i < quota(k); i++) spawn(true, k);
  }

  init();

  return {
    agents, groups, places, byKind,
    get now() { return now; },
    get target() { return target; },
    advance(t) { let n = 0; while (now + STEP <= t && n < 3600) { step(); n++; } return n; },
    stats() {
      let walking = 0, still = 0, hidden = 0;
      for (const a of agents) { if (a.hidden) hidden++; else if (a.moving) walking++; else still++; }
      return { count: agents.length, target, groups: groups.length, walking, still, hidden };
    },
  };
}
