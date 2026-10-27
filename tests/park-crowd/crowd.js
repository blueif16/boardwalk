// The animal crowd on the whole park: the characters test's sim and sprite batcher on park.json's frame and
// walk.json's network, with its own atlas (tests/characters/tools/build_atlas.py --park). &room= spreads groups out
// (1 = huddled as in the characters test). Everything is drawn in one WebGL call, sorted by feet.
// Depth (DEPTH.md): the rides' occluders (rides/RIDERS.md "Depth") and the painting's own cut-outs (occ.json,
// tools/occluders.py) hide the parts of animals standing behind them, in the same draw call. &occ=0 turns that off,
// &occ=rides keeps only the rides' occluders.
import { createCamera } from "../../base/camera.js";
import { createClock } from "../../base/clock.js";
import { createCrowd } from "../characters/sim.js";
import { createRenderer } from "../characters/render.js";
import { createOcclusion } from "./occlusion.js";
import { getSky } from "../../base/sky.js";
import { parkOpen } from "../../base/park_hours.js";

const WARM = 25;
const WALK = ["walk0", "stand", "walk1", "stand"];
const UNIT = 3840 / 3904; // park px per Dipper-stage unit, the unit the size number is given in
// Kid looks and the adult species they belong to, so most families are one species. Pets are every look named pet*.
const KID_OF = { bear: "bear_cub", bunny: "bunny_kid", panda: "panda_kid", fox: "fox_kid", pig: "piglet", cat_orange: "kitten", lion: "lion_cub" };
const KIDS = Object.values(KID_OF);
const species = (look) => look.split("~")[0];
const load = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

// Ride queues (rides/RIDERS.md): every riders block (and each entry of its `more`) becomes a queue place in the walking
// graph, its tail linked to the nearest promenade lanes. Boarding follows the ride's load events on the page's clock.
const QUEUE_GAP = 15;      // park px between default queue slots
const DENSITY = 1.5;       // device px per park px for the crowd's canvas
const RIDE_BOOST = 3;      // how much more often a group picks a ride queue than the sim's tables say (&rideBoost=)
// The crowd by the hour (share of `count`): the sim's day, then the park's night: 0.45 at closing (22:45), a quarter by
// 23:15, about 5 of 120 at 3:00 (a couple at the rail, a night walker), back up with the morning joggers.
const BY_HOUR = [[0, 0.09], [3, 0.04], [5.5, 0.06], [6.5, 0.25], [9, 0.32], [10.5, 0.7], [11, 0.95], [13, 1], [16, 1], [18, 0.85],
  [19.3, 0.72], [20.5, 0.6], [22, 0.52], [22.75, 0.45], [23.25, 0.25], [24, 0.09]];
function rideQueues(walk, camera, blocks) {
  const g = (px) => camera.toGround(px, 0).map((v) => Math.round(v * 10) / 10);
  const lanes = walk.nodes.filter((n) => n.kind === "lane" && n.h === 0);
  const near = (px, k) => [...lanes].sort((a, b) => Math.hypot(a.px[0] - px[0], a.px[1] - px[1]) - Math.hypot(b.px[0] - px[0], b.px[1] - px[1])).slice(0, k);
  const out = { ...walk, nodes: [...walk.nodes], edges: [...walk.edges], places: [...walk.places] };
  const rides = [];
  for (const b of blocks) {
    // The most riders one load takes (events at the same t are one batch), from a minute of schedule after the start.
    const parts = [{ gate: b.gate, queue: b.queue, exit: b.exit, keys: null }, ...(b.more || [])];
    const entries = parts.map((part, j) => {
      let slots = part.queue?.length ? part.queue : null;
      if (!slots) {
        const lane = near(part.gate, 1)[0].px, dx = lane[0] - part.gate[0], dy = lane[1] - part.gate[1], d = Math.hypot(dx, dy) || 1;
        const n = Math.max(2, Math.min(8, Math.floor((d - 10) / QUEUE_GAP) + 1));
        slots = Array.from({ length: n }, (_, i) => [part.gate[0] + (dx / d) * QUEUE_GAP * i, part.gate[1] + (dy / d) * QUEUE_GAP * i]);
      }
      const id = `ride_${b.name}_${j}`, node = `p_${id}`, tail = slots.at(-1);
      out.nodes.push({ id: node, px: tail, h: 0, g: g(tail), kind: "place" });
      for (const l of near(tail, 2)) out.edges.push({ a: l.id, b: node, kind: "deck", dir: 0 });
      out.places.push({ id, kind: "queue", node, gate: part.gate, slots, g: slots.map(g), ride: b.name, maxSeats: 0 });
      return { place: id, keys: part.keys ?? null, exit: part.exit ?? part.gate };
    });
    const ride = { name: b.name, loads: b.loads, entries };
    const entryOf = (ev) => entries.find((e) => e.keys?.includes(ev.key)) ?? entries.find((e) => !e.keys);
    const byBatch = new Map();
    for (const ev of b.loads(1, 400)) {
      const e = entryOf(ev);
      if (!e) continue;
      const k = `${e.place}|${ev.t}`;
      byBatch.set(k, (byBatch.get(k) || 0) + Math.max(0, ev.seats | 0));
    }
    for (const [k, n] of byBatch) {
      const place = out.places.find((p) => p.id === k.split("|")[0]);
      place.maxSeats = Math.max(place.maxSeats, n);
    }
    rides.push(ride);
  }
  return { walk: out, rides };
}

// The painting's own cut-outs for the crowd (occ.json + occ.webp, tools/make_occluders.py): things on the deck that
// animals pass behind, as occluders with a mask cropped from the sheet. Missing files: none.
async function paintedOccluders(dir) {
  try {
    const meta = await fetch(new URL("occ.json", dir)).then((r) => (r.ok ? r.json() : null));
    if (!meta) return { pieces: [], list: [] };
    const sheet = await load(new URL(meta.sheet || "occ.webp", dir).href);
    const list = meta.pieces.map((p) => ({ rect: p.at, sortY: p.sortY, ...(p.line ? { sortLine: p.line } : {}), mask: sheet, crop: p.rect }));
    return { pieces: meta.pieces, list };
  } catch (err) {
    console.error("crowd cut-outs failed", err);
    return { pieces: [], list: [] };
  }
}

// Lanes and places clear the solid things on the deck (DEPTH.md). make_walk.mjs runs the lanes a few px in front of
// eyeballed front edges, but a group walks up to SPREAD px behind its lane line (lateral offset plus a member's), and
// a stall's real front edge slopes. With the depth order on, an animal whose feet end up behind a stall's base would
// vanish into it, so every promenade lane node (and every stall, hangout, watch and photo slot) closer than its margin
// to the base of a wide cut-out (a stall, kiosk or ride front; not lamps, posts or the rail, which animals may walk
// behind) moves forward to clear it, never past the rail.
const SPREAD = 9, CLEAR = 3, WIDE = 24;
function clearOfCutouts(walk, camera, pieces) {
  if (!pieces.length || !walk.rail) return walk;
  const rail = walk.rail, xEnd = rail.at(-1)[0];
  const railAt = (x) => { for (let i = 0; i < rail.length - 1; i++) if (x <= rail[i + 1][0]) return rail[i][1] + ((x - rail[i][0]) / (rail[i + 1][0] - rail[i][0])) * (rail[i + 1][1] - rail[i][1]); return rail.at(-1)[1]; };
  const baseAt = (p, x) => { const l = p.line; if (!l) return p.sortY; const u = l[2] === l[0] ? 0 : Math.min(1, Math.max(0, (x - l[0]) / (l[2] - l[0]))); return l[1] + (l[3] - l[1]) * u; };
  const things = pieces.filter((p) => { const cx = p.at[0] + p.at[2] / 2; return p.at[2] >= WIDE && cx <= xEnd && baseAt(p, cx) < railAt(cx) - 6; });
  const need = (x, y, margin) => {
    let m = y;
    for (const p of things) {
      if (x < p.at[0] - 12 || x > p.at[0] + p.at[2] + 12) continue;
      const b = baseAt(p, x);
      if (b > y - 40) m = Math.max(m, b + margin);
    }
    return m;
  };
  const g = (px, h = 0) => camera.toGround(px, h).map((v) => Math.round(v * 10) / 10);
  let moved = 0;
  const nodes = walk.nodes.map((n) => {
    if (n.kind !== "lane" || n.h !== 0 || !/^[sn]\d/.test(n.id) || n.px[0] > xEnd) return n;
    const y = Math.min(need(n.px[0], n.px[1], SPREAD + CLEAR), railAt(n.px[0]) + (n.id[0] === "s" ? 8 : 6));
    if (y <= n.px[1] + 0.05) return n;
    moved++;
    return { ...n, px: [n.px[0], y], g: g([n.px[0], y]) };
  });
  // The south lane stays at least 3 px in front of the north one.
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  for (const [id, i] of byId) {
    if (id[0] !== "n" || !byId.has(`s${id.slice(1)}`)) continue;
    const j = byId.get(`s${id.slice(1)}`), nn = nodes[i], sn = nodes[j];
    if (sn.px[1] < nn.px[1] + 3) nodes[j] = { ...sn, px: [sn.px[0], nn.px[1] + 3], g: g([sn.px[0], nn.px[1] + 3]) };
  }
  const MARGIN = { stall: CLEAR, hangout: SPREAD, watch: 6, photo: 6 };
  const places = walk.places.map((p) => {
    if (!(p.kind in MARGIN) || (p.h ?? 0) !== 0) return p;
    const slots = p.slots.map(([x, y]) => [x, Math.max(y, Math.min(need(x, y, MARGIN[p.kind]), railAt(x) - 2))]);
    if (slots.every((s, k) => s[1] === p.slots[k][1])) return p;
    moved++;
    return { ...p, slots, g: slots.map((s) => g(s)) };
  });
  return { ...walk, nodes, places, cleared: moved };
}

// rides: the ride layers' riders blocks, each with its layer's name ({ name, gate, queue, exit, loads, more }).
// occluders: the ride layers' occluders (rides/RIDERS.md "Depth"), each an array or a function of clock time.
// clock: the page's master clock, so the crowd and the rides share one time.
// hour: a function returning the hour of the day (or a number); by default the page's sky (base/sky.js: the visitor's
// clock, &hour=, the badge's scrub and play), followed live. The park's hours (base/park_hours.js) close the ride
// queues and stalls from 22:45 to 10:30.
export async function mountCrowd(canvas, { params = new URLSearchParams(location.search), size = 38, count = 120, hour = null, sky = null, room = 1.5, rides: blocks = [], occluders = [], clock = createClock() } = {}) {
  const skyNow = typeof hour === "function" || typeof hour === "number" ? null : sky ?? getSky({ params });
  const hourNow = typeof hour === "function" ? hour : typeof hour === "number" ? () => hour : () => { skyNow.tick?.(); return skyNow.hour; };
  const dir = new URL("./", import.meta.url);
  const chars = new URL("../characters/", import.meta.url);
  const [park, walk0, meta, atlas] = await Promise.all([
    fetch(new URL("park.json", dir)).then((r) => r.json()),
    fetch(new URL("walk.json", dir)).then((r) => r.json()),
    fetch(new URL("atlas.json", dir)).then((r) => r.json()),
    load(new URL("atlas.png", dir).href),
  ]);
  const camera = createCamera(park);
  const painted = await paintedOccluders(dir);
  const { walk, rides } = rideQueues(clearOfCutouts(walk0, camera, painted.pieces), camera, blocks);
  // The canvas covers only the band animals can reach (the walking network, an animal's height above it), so it can
  // render at DENSITY device px per park px (shrunk by the browser, crisp at every size) for half a park's pixels.
  const ys = walk.nodes.map((n) => n.px[1]);
  const Y0 = Math.floor((Math.min(...ys) - 70) / 10) * 10, Y1 = Math.ceil((Math.max(...ys) + 20) / 10) * 10;
  canvas.style.top = `${Y0}px`;
  canvas.style.height = `${Y1 - Y0}px`;
  const r = createRenderer(canvas, atlas, meta, { W: camera.W, H: Y1 - Y0 });
  // What stands in front of animals: the rides' occluders and the painting's cut-outs, packed once into the
  // renderer's mask texture; each frame only their table (a few KB) is sent.
  const occMode = params.get("occ");
  const occl = occMode === "0" ? null : await createOcclusion([{ name: "painted", occluders: occMode === "rides" ? [] : painted.list }, ...occluders], { Y0, H: Y1 - Y0, onMasks: (b, w, h) => r.masks(b, w, h) })
    .catch((err) => { console.error("crowd occlusion failed", err); return null; });
  // Every adult in the atlas walks; kids and pets come from their own lists.
  const all = [...new Set(Object.keys(r.frames).filter((k) => k.endsWith("/front_stand")).map((k) => k.split("/")[0]))];
  const pets = all.filter((l) => l.startsWith("pet"));
  const kids = all.filter((l) => KIDS.includes(species(l)));
  const looks = all.filter((l) => !pets.includes(l) && !kids.includes(l));
  const kidOf = {};
  for (const l of looks) {
    const k = kids.filter((x) => species(x) === KID_OF[species(l)]);
    if (k.length) kidOf[l] = k;
  }
  const K = ((Number(params.get("px")) || size) * UNIT) / 30;
  const crowd = createCrowd({
    walk, camera, max: Number(params.get("n")) || count, seed: Number(params.get("seed")) || 1,
    hour: hourNow, looks, kids, pets, kidOf, densityTable: BY_HOUR, open: parkOpen,
    spacing: K * (Number(params.get("room")) || room),
    rides, offset: WARM, rideBoost: Number(params.get("rideBoost")) || RIDE_BOOST,
  });
  crowd.advance(clock.now() + WARM);
  window.__crowd = { crowd, rides, walk, Y0 };

  const shadow = r.frames.shadow, ink = r.frames.ink;
  const list = [];

  function frameOf(a) {
    let pose = a.pose, view = a.view;
    if (pose === "walk") pose = WALK[Math.floor(a.phase * 4) % 4];
    else if (pose === "sit") { pose = "act"; if (!a.pet) view = "front"; }
    else if (pose === "eat") pose = view === "side" ? "act" : "stand";
    else if (pose === "photo") pose = view === "back" ? "act" : "stand";
    else if (pose === "sniff") pose = "act";
    return r.frames[`${a.look}/${view}_${pose}`] || r.frames[`${a.look}/${view}_stand`];
  }

  let occOn = true;
  function draw(t = clock.now()) {
    const now = crowd.now;
    if (occl) r.occluders(occOn ? occl.at(t) : []);
    r.begin();
    list.length = 0;
    for (const a of crowd.agents) {
      if (a.hidden) continue;
      const p = camera.toPixel([a.x, a.h, a.z]);
      a.px = p[0];
      a.py = p[1];
      a.sortY = p[1];
      const walking = a.pose === "walk";
      const hop = walking ? 0.5 - 0.5 * Math.cos(4 * Math.PI * (a.phase - 0.125)) : 0;
      const turn = now - (a.turned ?? -9);
      a.bob = (hop * (a.group.kind === "jogger" ? 2.6 : a.pet ? 1 : 1.3) + (turn < 0.2 ? 2 * Math.sin((turn / 0.2) * Math.PI) : 0)) * K;
      a.squash = walking ? 1 - 0.05 * (1 - hop) : 1;
      const s = K * (a.pet ? 0.5 : a.kid ? 0.62 : 0.78) * a.scale * (1 - 0.12 * hop);
      a.foot ||= [0, 0];
      a.foot[0] = a.px; a.foot[1] = a.py - Y0;
      r.sprite(shadow, a.px, a.py + 0.5 - Y0, s, s * 0.9, false, a.h < -20 ? 0.75 : 1, a.foot);
      list.push(a);
      if (a.pet) list.push({ leash: a, sortY: Math.max(a.py, a.owner.py ?? a.py) + 0.01 });
    }
    list.sort((a, b) => a.sortY - b.sortY);
    for (const it of list) {
      if (it.leash) {
        const d = it.leash, o = d.owner;
        if (o.hidden || o.px == null) continue;
        const hx = o.view === "side" ? (o.flip ? -4 : 4) : o.view === "front" ? 6 : -6;
        r.line(ink, o.px + hx * o.scale * K, o.py - o.bob - 10 * K - Y0, d.px, d.py - d.bob - 7 * K - Y0, 0.9 * K, 0.85, [d.px, it.sortY - Y0]);
        continue;
      }
      const f = frameOf(it);
      if (!f) continue;
      const k = K * it.scale;
      it.behind = r.sprite(f, it.px, it.py - it.bob - Y0, k * (2 - it.squash), k * it.squash, it.flip, 1, it.foot);
      if (it.behind) it.behindOf = r.picked.filter((i) => i >= 0);
    }
    return r.end();
  }

  // Checks (tools/depth_probe.mjs): the crowd at clock time t (forward only), drawn with t's occluders; which
  // animals had an occluder over them.
  window.__crowd.occlusion = occl;
  window.__crowd.setOcclusion = (on) => { occOn = !!on; draw(); };
  window.__crowd.probe = (t) => {
    crowd.advance(t + WARM);
    const items = occl ? occl.at(t) : [];
    draw(t);
    return crowd.agents.filter((a) => !a.hidden && a.behind).map((a) => ({ x: Math.round(a.px), y: Math.round(a.py), walk: a.group.state === "walk", what: a.group.what, by: a.behindOf.map((i) => items[i]?.from), items: a.behindOf.map((i) => items[i] && { from: items[i].from, box: items[i].box.map((v, k) => Math.round(k % 2 ? v + Y0 : v)), base: Math.round((items[i].line ? (items[i].line[1] + items[i].line[3]) / 2 : items[i].sortY) + Y0) }) }));
  };

  return {
    crowd,
    // s: CSS px per park px. At the screen's own density (0.67 px per park px on a 2560 window) the canvas sits at a
    // fractional offset in the scaled world and is resampled soft; at DENSITY and shrunk by the browser the sprites
    // are as crisp as the rides (Laplacian variance on them 4.6k -> 19.7k at 2560 x 1440). &crowdDensity= overrides.
    resize(s) { r.resize(s, (Number(params.get("crowdDensity")) || DENSITY) / s); },
    // Who rides a ride's vehicle key at clock time t (rides/RIDERS.md): their looks, [] for empty seats.
    riders: (name, key, t) => crowd.riders(name, key, t),
    update() {
      crowd.advance(clock.now() + WARM);
      draw();
    },
    stats: () => ({ ...crowd.stats(), quads: r.quads, occluded: r.occluded, ...(occl ? occl.stats() : {}) }),
  };
}
