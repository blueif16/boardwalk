import { drawWalk } from "./debug.js";
import { createCrowd } from "./sim.js";
import { createRenderer } from "./render.js";

const WARM = 25;
const WALK = ["walk0", "stand", "walk1", "stand"];

export async function mount({ camera, time, clock, slots, world, bench, dir, params }) {
  const [walk, meta, image] = await Promise.all([
    fetch(new URL("walk.json", dir)).then((r) => r.json()),
    fetch(new URL("atlas.json", dir)).then((r) => r.json()),
    new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = new URL("atlas.png", dir).href; }),
  ]);
  if (params.has("walk")) {
    const dbg = document.createElement("canvas");
    slots.debug.append(dbg);
    drawWalk(dbg, walk, camera, { labels: params.get("walk") !== "plain" });
  }

  const canvas = document.createElement("canvas");
  slots.characters.append(canvas);
  const r = createRenderer(canvas, image, meta, { W: camera.W, H: camera.H });
  // Up to 2.5 canvas px per stage px, the 4K stage's own density.
  const fit = () => { const s = Number(world.dataset.scale) || 1; r.resize(s, Math.min(devicePixelRatio || 1, 2.5 / s)); };
  addEventListener("resize", fit);
  fit();

  const set = params.get("sprites") || "shyfai";
  const shyfai = ["bear", "bunny", "cat_orange", "dog_shiba", "cat_grey", "bunny_brown", "dog_cream"].filter((l) => r.frames[`${l}/front_stand`]);
  const eight = new Set(Object.keys(r.frames).filter((k) => k.endsWith("/h0_stand")).map((k) => k.split("/")[0]));
  const only3d = eight.has(set);
  const crowd = createCrowd({
    walk, camera, max: Number(params.get("n")) || 150, seed: Number(params.get("seed")) || 1, hour: () => time.look.hour,
    looks: only3d ? [set] : set === "mix" ? [...shyfai, ...eight] : shyfai, kids: only3d ? [set] : ["bear_cub"],
  });
  crowd.advance(clock.now() + WARM);

  const shadow = r.frames.shadow, ink = r.frames.ink;
  const K = (Number(params.get("px")) || 30) / 30;
  const occluders = params.get("occ") === "0" ? [] : Object.values(r.frames).filter((f) => f.at).map((f) => ({ occ: f, sortY: f.sortY }));
  const list = [];
  const timing = { sim: 0, draw: 0, finish: 0, frames: 0 };
  const finish = params.has("finish");

  function frameOf(a) {
    if (eight.has(a.look)) {
      const th = a.theta ?? 0;
      if (a.h8 == null || Math.abs(((th - a.h8 * 45 + 540) % 360) - 180) > 30) a.h8 = ((Math.round(th / 45) % 8) + 8) % 8;
      const p = a.pose === "walk" ? `walk${Math.floor(a.phase * 4) % 4}` : "stand";
      return r.frames[`${a.look}/h${a.h8}_${p}`];
    }
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
      a.bob = hop * (a.group.kind === "jogger" ? 2.6 : a.pet ? 1 : 1.3) + (turn < 0.2 ? 2 * Math.sin((turn / 0.2) * Math.PI) : 0);
      a.squash = walking ? 1 - 0.05 * (1 - hop) : 1;
      a.bob *= K;
      const s = K * (a.pet ? 0.5 : a.kid ? 0.62 : 0.78) * a.scale * (1 - 0.12 * hop);
      r.sprite(shadow, a.px, a.py + 0.5, s, s * 0.9, false, a.h < -20 ? 0.75 : 1);
      list.push(a);
      if (a.pet) list.push({ leash: a, sortY: Math.max(a.py, a.owner.py ?? a.py) + 0.01 });
    }
    for (const o of occluders) list.push(o);
    list.sort((a, b) => a.sortY - b.sortY);
    for (const it of list) {
      if (it.occ) { r.sprite(it.occ, it.occ.at[0], it.occ.at[1]); continue; }
      if (it.leash) {
        const d = it.leash, o = d.owner;
        if (o.hidden || o.px == null) continue;
        const hx = o.view === "side" ? (o.flip ? -4 : 4) : o.view === "front" ? 6 : -6;
        r.line(ink, o.px + hx * o.scale * K, o.py - o.bob - 10 * K, d.px, d.py - d.bob - 7 * K, 0.9, 0.85);
        continue;
      }
      const f = frameOf(it);
      if (!f) continue;
      const k = K * it.scale * (it.kid && eight.has(it.look) ? 0.74 : 1);
      r.sprite(f, it.px, it.py - it.bob, k * (2 - it.squash), k * it.squash, eight.has(it.look) ? false : it.flip);
    }
    return r.end();
  }

  window.__chars = { crowd, timing, stats: () => ({ ...crowd.stats(), quads: r.quads, simMs: +(timing.sim / Math.max(1, timing.frames)).toFixed(3), drawMs: +(timing.draw / Math.max(1, timing.frames)).toFixed(3), finishMs: +(timing.finish / Math.max(1, timing.frames)).toFixed(3) }) };

  return {
    update(dt, t) {
      const t0 = performance.now();
      crowd.advance(t + WARM);
      const t1 = performance.now();
      const calls = draw();
      const t2 = performance.now();
      if (finish) r.gl.finish();
      timing.finish += performance.now() - t2;
      timing.sim += t1 - t0;
      timing.draw += t2 - t1;
      timing.frames++;
      bench?.report("characters", calls);
    },
  };
}
