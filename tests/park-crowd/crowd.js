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

export async function mountCrowd(canvas, { params = new URLSearchParams(location.search), size = 38, count = 120, hour = 13, room = 1.5 } = {}) {
  const dir = new URL("./", import.meta.url);
  const chars = new URL("../characters/", import.meta.url);
  const [park, walk, meta, atlas] = await Promise.all([
    fetch(new URL("park.json", dir)).then((r) => r.json()),
    fetch(new URL("walk.json", dir)).then((r) => r.json()),
    fetch(new URL("atlas.json", dir)).then((r) => r.json()),
    load(new URL("atlas.png", dir).href),
  ]);
  const camera = createCamera(park);
  const clock = createClock();
  const r = createRenderer(canvas, atlas, meta, { W: camera.W, H: camera.H });
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
  });
  crowd.advance(clock.now() + WARM);

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
      r.sprite(shadow, a.px, a.py + 0.5, s, s * 0.9, false, a.h < -20 ? 0.75 : 1);
      list.push(a);
      if (a.pet) list.push({ leash: a, sortY: Math.max(a.py, a.owner.py ?? a.py) + 0.01 });
    }
    list.sort((a, b) => a.sortY - b.sortY);
    for (const it of list) {
      if (it.leash) {
        const d = it.leash, o = d.owner;
        if (o.hidden || o.px == null) continue;
        const hx = o.view === "side" ? (o.flip ? -4 : 4) : o.view === "front" ? 6 : -6;
        r.line(ink, o.px + hx * o.scale * K, o.py - o.bob - 10 * K, d.px, d.py - d.bob - 7 * K, 0.9 * K, 0.85);
        continue;
      }
      const f = frameOf(it);
      if (!f) continue;
      const k = K * it.scale;
      r.sprite(f, it.px, it.py - it.bob, k * (2 - it.squash), k * it.squash, it.flip);
    }
    return r.end();
  }

  return {
    crowd,
    // s: CSS px per park px. The canvas gets up to 1.25 device px per park px; more adds nothing at this size.
    resize(s) { r.resize(s, Math.min(devicePixelRatio || 1, 1.25 / s)); },
    update() {
      crowd.advance(clock.now() + WARM);
      draw();
    },
    stats: () => ({ ...crowd.stats(), quads: r.quads }),
  };
}
