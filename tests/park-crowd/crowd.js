// The animal crowd on the whole park: the characters test's sim and sprite batcher on park.json's frame and
// walk.json's network, with its own atlas (tests/characters/tools/build_atlas.py --park). &room= spreads groups out
// (1 = huddled as in the characters test). Everything is drawn in one WebGL call, sorted by feet; no cut-outs yet, because the lanes keep
// walkers in front of everything they pass.
import { createCamera } from "../../base/camera.js";
import { createClock } from "../../base/clock.js";
import { createCrowd } from "../characters/sim.js";
import { createRenderer } from "../characters/render.js";

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

// rides: the ride layers' riders blocks, each with its layer's name ({ name, gate, queue, exit, loads, more }).
// clock: the page's master clock, so the crowd and the rides share one time.
export async function mountCrowd(canvas, { params = new URLSearchParams(location.search), size = 38, count = 120, hour = 13, room = 1.5, rides: blocks = [], clock = createClock() } = {}) {
  const dir = new URL("./", import.meta.url);
  const chars = new URL("../characters/", import.meta.url);
  const [park, walk0, meta, atlas] = await Promise.all([
    fetch(new URL("park.json", dir)).then((r) => r.json()),
    fetch(new URL("walk.json", dir)).then((r) => r.json()),
    fetch(new URL("atlas.json", dir)).then((r) => r.json()),
    load(new URL("atlas.png", dir).href),
  ]);
  const camera = createCamera(park);
  const { walk, rides } = rideQueues(walk0, camera, blocks);
  // The canvas covers only the band animals can reach (the walking network, an animal's height above it), so it can
  // render at DENSITY device px per park px (shrunk by the browser, crisp at every size) for half a park's pixels.
  const ys = walk.nodes.map((n) => n.px[1]);
  const Y0 = Math.floor((Math.min(...ys) - 70) / 10) * 10, Y1 = Math.ceil((Math.max(...ys) + 20) / 10) * 10;
  canvas.style.top = `${Y0}px`;
  canvas.style.height = `${Y1 - Y0}px`;
  const r = createRenderer(canvas, atlas, meta, { W: camera.W, H: Y1 - Y0 });
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
    hour: () => Number(params.get("hour") ?? hour), looks, kids, pets, kidOf,
    spacing: K * (Number(params.get("room")) || room),
    rides, offset: WARM, rideBoost: Number(params.get("rideBoost")) || RIDE_BOOST,
  });
  crowd.advance(clock.now() + WARM);
  window.__crowd = { crowd, rides, walk };

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

  function draw() {
    const now = crowd.now;
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
      r.sprite(shadow, a.px, a.py + 0.5 - Y0, s, s * 0.9, false, a.h < -20 ? 0.75 : 1);
      list.push(a);
      if (a.pet) list.push({ leash: a, sortY: Math.max(a.py, a.owner.py ?? a.py) + 0.01 });
    }
    list.sort((a, b) => a.sortY - b.sortY);
    for (const it of list) {
      if (it.leash) {
        const d = it.leash, o = d.owner;
        if (o.hidden || o.px == null) continue;
        const hx = o.view === "side" ? (o.flip ? -4 : 4) : o.view === "front" ? 6 : -6;
        r.line(ink, o.px + hx * o.scale * K, o.py - o.bob - 10 * K - Y0, d.px, d.py - d.bob - 7 * K - Y0, 0.9 * K, 0.85);
        continue;
      }
      const f = frameOf(it);
      if (!f) continue;
      const k = K * it.scale;
      r.sprite(f, it.px, it.py - it.bob - Y0, k * (2 - it.squash), k * it.squash, it.flip);
    }
    return r.end();
  }

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
    stats: () => ({ ...crowd.stats(), quads: r.quads }),
  };
}
