// The park's lights: every light source from the inventory (lights.json, tools/build_lights.py) plus the lights that
// live layers declare, switched by behaviour.js and drawn over the base's night grade.
//
// Three canvases, all in park px:
//   pool    (base slot "pool", mix-blend-mode: color-dodge): light falling on things. Each channel holds s = 1 - 1/G,
//           so the page under it is multiplied by a gain G >= 1: the planks, a stall's goods, a flag, and any animal
//           or car standing in the pool are lit through their own colours. Low resolution (1 px per 2 park px);
//           redrawn only when a light's level changes.
//   steady  (slot "lights", plus-lighter): emitters that don't twinkle (windows, signs); redrawn on change.
//   live    (slot "lights", plus-lighter): globes and halos, bulb strings and their patterns; redrawn every frame
//           while any is on, never at midday.
// A live layer's own lights get a canvas of their own over the layer's rect in the "lights" slot. What of the layer
// stands in front of its lights is a visibility per light: its static occluders (the wheel's front legs, the coaster's
// lattice) are alpha masks sampled at each light's point, its moving ones (a cabin, a train) the layer reports itself.
import { level, isTV, tvFlicker, windowColour, hash } from "./behaviour.js";

const loadImage = (url) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error(url)); im.src = url; });
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
const rgba = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

// --- Sprites in the painting's hand: soft washes with a slightly uneven edge, no rays, no rings of a lens ---
function washSprite(size, seed, { plateau = 0.18, edge = 0.06, wobble = 0.07, power = 2.2 } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const im = g.createImageData(size, size);
  const k = [1, 2, 3].map((i) => [hash(seed * 7 + i) * 6.283, 2 + Math.floor(hash(seed * 13 + i) * 4)]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const th = Math.atan2(dy, dx);
    let R = 1 - wobble * (0.5 + 0.5 * k.reduce((s, [p, f]) => s + Math.sin(th * f + p) / 3, 0)); // an uneven outline
    const r = Math.hypot(dx, dy) / R;
    if (r >= 1) continue;
    let a = r < plateau ? 1 : Math.pow(1 - (r - plateau) / (1 - plateau), power);
    a += edge * Math.exp(-((r - 0.82) ** 2) / 0.004) * (1 - r); // a faint wash edge where the pigment pooled
    const n = 0.92 + 0.08 * hash(x * 73 + y * 151 + seed * 1e4); // paper grain
    im.data[(y * size + x) * 4 + 3] = Math.min(255, a * n * 255);
    im.data[(y * size + x) * 4] = im.data[(y * size + x) * 4 + 1] = im.data[(y * size + x) * 4 + 2] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

function tinted(sprite, colour, cache, id = "") {
  const key = id + colour;
  if (!cache.has(key)) {
    const c = document.createElement("canvas");
    c.width = sprite.width; c.height = sprite.height;
    const g = c.getContext("2d");
    g.drawImage(sprite, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
    cache.set(key, c);
  }
  return cache.get(key);
}

export async function mountLights(ctx, { inventories, parents, density = 1.5, skip = new Set() }) {
  // Several inventories (the centre, west and east pieces, the street lights), each with its own mask atlas; a
  // missing one is skipped, so pieces can land one by one.
  const invs = (await Promise.all(inventories.map(async (u) => {
    try {
      const inv = await fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
      const im = inv.atlas ? await loadImage(new URL(inv.atlas.file, u).href) : null;
      return { inv, im };
    } catch { return null; }
  }))).filter(Boolean);
  const cam = ctx.camera;

  // Each atlas as white with alpha = the mask, then a tinted copy per colour.
  const atlases = invs.map(({ im }) => {
    if (!im) return null;
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
    g.putImageData(d, 0, 0);
    return { c, tints: new Map() };
  });
  const spriteTints = new Map();
  const tintAtlas = (colour, ai = 0) => tinted(atlases[ai].c, colour, atlases[ai].tints, "atlas");
  const SPR = { halo: washSprite(128, 1), bloom: washSprite(64, 2, { plateau: 0.3, edge: 0, wobble: 0.04 }), dot: washSprite(24, 3, { plateau: 0.45, edge: 0, wobble: 0 }), pool: washSprite(128, 4, { plateau: 0.2, edge: 0, wobble: 0.1, power: 1.5 }) };
  // Colours are quantised to 16 levels a channel, so lights whose colour changes every frame reuse a few tints.
  const quant = (colour) => {
    if (colour[0] === "#") { const v = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)); return `rgb(${v.map((x) => Math.round(x / 17) * 17).join(",")})`; }
    const m = colour.match(/[\d.]+/g).map(Number); return `rgb(${m.slice(0, 3).map((x) => Math.round(x / 17) * 17).join(",")})`;
  };
  const tintSprite = (name, colour) => tinted(SPR[name], quant(colour), spriteTints, name);

  // Pieces may overlap at their seams: the first record of an id wins (the centre is listed first).
  const seen = new Set();
  const all = invs.flatMap(({ inv }, ai) => inv.lights.map((L) => ({ ...L, ai }))).filter((L) => !seen.has(L.id) && seen.add(L.id));
  // The extent of a set of lights (park px), so a canvas covers only where its lights are.
  function extent(list, pad) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    for (const L of list) {
      for (const p of [L.src, L.ground].filter(Boolean)) add(p[0], p[1], (L.halo ?? 0) * 1.6);
      if (L.pool) add(L.pool.c[0], L.pool.c[1], L.pool.r * 1.7);
      if (L.mask) { const [x, y, w, h] = L.mask.rect; add(x, y); add(x + w, y + h); }
      for (const p of L.poly ?? []) add(p[0], p[1]);
      for (const p of L.pts ?? []) add(p[0], p[1]);
      if (L.flood) add(L.flood.c[0], L.flood.c[1], Math.max(L.flood.rx, L.flood.ry));
    }
    if (x1 < x0) return [0, 0, 1, 1];
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    return [x0, y0, Math.min(3840, Math.ceil(x1 + pad)) - x0, Math.min(2560, Math.ceil(y1 + pad)) - y0];
  }

  // --- Canvases ---
  const surfaces = [];
  function canvasIn(parent, blend, dens, rect) {
    const [RX, RY, RW, RH] = rect;
    const c = document.createElement("canvas");
    c.className = "lights";
    c.style.cssText = `position:absolute;left:${RX}px;top:${RY}px;width:${RW}px;height:${RH}px;mix-blend-mode:${blend};pointer-events:none`;
    parent.append(c);
    const g = c.getContext("2d");
    const cv = {
      c, g, d: dens, rect, fixed: dens != null,
      fit(d) { if (!this.fixed) this.d = d; c.width = Math.max(1, Math.round(RW * this.d)); c.height = Math.max(1, Math.round(RH * this.d)); },
      reset(fill) { const d = this.d; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none"; if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); } else g.clearRect(0, 0, c.width, c.height); g.setTransform(d, 0, 0, d, -RX * d, -RY * d); },
    };
    cv.fit(dens ?? density);
    surfaces.push(cv);
    return cv;
  }
  const kept = all.filter((L) => !skip.has(L.layer));
  const poolRect = [0, 0, 3840, 2560]; // 1 px per 2 park px: the whole park, so live layers' pools fit too
  const steadyRect = extent(kept.filter((L) => L.kind === "window"), 30);
  const liveRect = extent(kept.filter((L) => ["lamp", "streetlight", "lantern", "bulbs", "window"].includes(L.kind)), 40);
  // Under the gain, a warm filter (multiply, <= 1) takes the blue of the night out of the lit area: light added to a
  // blue-graded plank alone turns it mauve, not amber (the bakeoff's "a light needs a multiply and an add").
  const filter = canvasIn(parents.pool, "multiply", 0.5, poolRect);
  const pool = canvasIn(parents.pool, "color-dodge", 0.5, poolRect);
  const steady = canvasIn(parents.lights, "normal", null, steadyRect);
  const live = canvasIn(parents.lights, "plus-lighter", null, liveRect);

  const lights = kept.map((L) => ({ ...L, x: (L.src || L.ground || (L.poly && L.poly[0]) || (L.pts && L.pts[0]) || [0])[0], lvl: 0, c: hex(L.colour || "#ffffff") }));
  const providers = [];

  // A ground circle of radius r (ground units) at (x, y): the transform that maps the unit square [-1, 1]^2 onto it.
  const [ex0, ex1] = cam.ex, [ez0, ez1] = cam.ez;
  function groundTransform(cv, x, y, r) { const d = cv.d; cv.g.setTransform(d * ex0 * r, d * ex1 * r, d * ez0 * r, d * ez1 * r, d * (x - cv.rect[0]), d * (y - cv.rect[1])); }
  const restore = (cv) => cv.g.setTransform(cv.d, 0, 0, cv.d, -cv.rect[0] * cv.d, -cv.rect[1] * cv.d);

  function drawMask(cv, L, colour, a) {
    if (a <= 0.003) return;
    const [ax, ay, aw, ah] = L.mask.atlas, [x, y, w, h] = L.mask.rect;
    cv.g.globalAlpha = Math.min(1, a);
    cv.g.drawImage(tintAtlas(colour, L.ai), ax, ay, aw, ah, x, y, w, h);
    cv.g.globalAlpha = 1;
  }
  function blob(cv, name, colour, x, y, r, a, sy = 1) {
    if (a <= 0.003) return;
    cv.g.globalAlpha = Math.min(1, a);
    cv.g.drawImage(tintSprite(name, colour), x - r, y - r * sy, 2 * r, 2 * r * sy);
    cv.g.globalAlpha = 1;
  }
  // The pool canvas: s per channel, so a warm light colour c at strength k gives gain 1 / (1 - k c).
  function poolAt(cv, x, y, r, c, k, warm = 1.1, tint = WARM) {
    groundTransform(cv, x, y, r);
    cv.g.globalAlpha = 1;
    cv.g.drawImage(tintSprite("pool", rgba(c.map((v) => Math.min(1, v * k)))), -1, -1, 2, 2);
    groundTransform(filter, x, y, r);
    filter.g.globalAlpha = Math.min(1, k * warm);
    filter.g.drawImage(tintSprite("pool", tint), -1, -1, 2, 2);
    filter.g.globalAlpha = 1;
    restore(cv); restore(filter);
  }
  const WARM = "#ffdc8a";

  // --- The frame ---
  let sky = null, lastKey = "", anyOn = false, cost = 0, frames = 0, redraws = 0, lastLevels = 0, lastLive = 0, liveDrawn = true, wasIdle = null;
  const part = {};
  const GAIN = { lamp: 0.85, streetlight: 0.5, spill: 0.75, door: 0.6, stall: 0.7, flood: 0.62 };

  function levels(t) {
    if (sky.dark <= 0.005) { for (const L of lights) L.lvl = 0; return "day"; }
    let key = "";
    for (const L of lights) {
      const v = level(L, sky, t);
      L.lvl = v;
      key += v > 0.999 ? "1" : v < 0.001 ? "0" : Math.round(v * 20).toString(36);
    }
    return key;
  }

  function drawPool() {
    const cv = pool, g = cv.g;
    cv.reset("#000");
    filter.reset("#fff");
    filter.g.globalCompositeOperation = "multiply";
    g.globalCompositeOperation = "lighter";
    for (const L of lights) {
      const v = L.lvl * sky.dark;
      if (v <= 0.002) continue;
      const pc = L.pool ? hex(L.pool.colour) : L.c;
      // A pool is two washes: a bright core round the foot and a wide faint spread that joins its neighbours.
      // Street LEDs are neutral white: a pale filter, so the asphalt goes grey-warm, not amber.
      // Street LEDs are near white, but a white gain over blue-graded asphalt only brightens the blue: their filter
      // takes the blue out first (a pale apricot), so the pool reads as a soft neutral-warm patch.
      if (L.pool) {
        const st = L.kind === "streetlight", k = (GAIN[L.kind] ?? 0.6) * v, tint = st ? "#ffd8a8" : WARM;
        poolAt(cv, L.pool.c[0], L.pool.c[1], L.pool.r * 0.7, pc, k * 0.8, st ? 1.2 : 0.7, tint);
        poolAt(cv, L.pool.c[0], L.pool.c[1], L.pool.r * 1.6, pc, k * 0.5, st ? 1.2 : 1.6, tint);
      }
      if (L.kind === "stall" && L.poly) {
        for (const [c2, style] of [[g, rgba(L.c.map((c) => c * GAIN.stall * v))], [filter.g, rgba(hex(WARM), Math.min(1, v))]]) {
          c2.filter = `blur(${1.6 * cv.d}px)`;
          c2.fillStyle = style;
          c2.beginPath(); L.poly.forEach(([x, y], i) => (i ? c2.lineTo(x, y) : c2.moveTo(x, y))); c2.closePath(); c2.fill();
          c2.filter = "none";
        }
      }
      if (L.kind === "flood") {
        const f = L.flood;
        g.globalAlpha = 1;
        g.drawImage(tintSprite("pool", rgba(L.c.map((c) => c * GAIN.flood * v))), f.c[0] - f.rx, f.c[1] - f.ry, 2 * f.rx, 2 * f.ry);
      }
      if (L.kind === "sign" && L.poly) {
        g.filter = `blur(${0.8 * cv.d}px)`;
        g.fillStyle = rgba(L.c.map((c) => c * 0.55 * v));
        g.beginPath(); L.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
        g.filter = "none";
      }
      if (L.kind === "door" && L.poly) {
        g.fillStyle = rgba(L.c.map((c) => c * 0.7 * v));
        g.beginPath(); L.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      }
    }
    // A lamp's own painted post stays out of its pool's warm filter (blue under a warm filter turns green) and gets
    // half the gain.
    for (const L of lights) {
      if (!L.post || L.lvl <= 0.002) continue;
      const [ax, ay, aw, ah] = L.post.atlas, [x, y, w, h] = L.post.rect;
      filter.g.globalCompositeOperation = "source-over";
      filter.g.drawImage(tintAtlas("#ffffff", L.ai), ax, ay, aw, ah, x, y, w, h);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.7;
      g.drawImage(tintAtlas("#000000", L.ai), ax, ay, aw, ah, x, y, w, h);
      g.globalAlpha = 1;
    }
    // Cap the gain at 5 (s <= 0.8): two pools overlapping never burn out.
    g.globalCompositeOperation = "darken";
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "rgb(204,204,204)";
    g.fillRect(0, 0, cv.c.width, cv.c.height);
    restore(cv);
  }

  function drawSteady(t) {
    const cv = steady, g = cv.g;
    cv.reset();
    // Lit windows are flat warm shapes painted over their panes (the glazing bars are ink, outside the mask, so they
    // stay); a TV is drawn in the live canvas instead, as it flickers.
    for (const L of lights) {
      const v = L.lvl;
      if (v <= 0.002) continue;
      if (L.kind === "window" && L.mask && !isTV(L)) {
        const a = v * Math.min(1, sky.dark * 1.4), [x, y, w, h] = L.mask.rect;
        blob(cv, "bloom", "#ffc870", x + w / 2, y + h / 2, Math.max(w, h) * 0.9, 0.16 * a);
        drawMask(cv, L, L.group === "stall" ? "#ffdc98" : windowColour(L), (L.group === "shop" ? 0.66 : 0.78) * a);
      }
    }
  }

  // Patterns for bulb strings: i is the bulb's index along its string.
  function pattern(L, i, n, t) {
    switch (L.pattern) {
      case "chase3": return ((i + Math.floor(t * 6)) % 3 === 0) ? 1 : 0.3;      // marquee chase, 6 steps/s
      case "alternate": return ((i + Math.floor(t * 1.6)) % 2 === 0) ? 1 : 0.45; // two-phase blink
      case "twinkle": return 0.85 + 0.15 * Math.sin(t * (1.3 + hash(i) * 1.7) + hash(i * 7) * 6.28);
      default: return 1;
    }
  }

  function drawLive(t) {
    const cv = live, g = cv.g;
    cv.reset();
    g.globalCompositeOperation = "lighter";
    const dark = sky.dark;
    for (const L of lights) {
      const v = L.lvl;
      if (v <= 0.002) continue;
      if (L.kind === "lamp") {
        const tw = 0.97 + 0.03 * Math.sin(t * 2.1 + L.seed * 40);
        // The painted globes themselves light up, then a close bloom round each and a wide wash round the head.
        drawMask(cv, L, "#ffcf6a", 0.8 * v * tw);
        for (const [gx, gy, gr] of L.globes) blob(cv, "bloom", "#ffe7b0", gx, gy, gr * 1.9, 0.5 * v * tw);
        blob(cv, "halo", "#ffc46a", L.src[0], L.src[1], L.halo * 1.6, (0.2 + 0.25 * dark) * v * tw);
      } else if (L.kind === "streetlight") {
        // An LED head on a slim pole: a short bright lens (a stroke along its underside), a small bloom, a faint
        // cone of light under it towards the pool.
        const [ax, ay, bx, by] = L.lens ?? [L.src[0] - 3, L.src[1], L.src[0] + 3, L.src[1]];
        g.globalAlpha = Math.min(1, v);
        g.strokeStyle = "#fffaf0"; g.lineWidth = 2.2; g.lineCap = "round";
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        g.globalAlpha = 1;
        blob(cv, "bloom", L.colour, L.src[0], L.src[1] + 1, 7, 0.55 * v);
        blob(cv, "halo", L.colour, L.src[0], L.src[1] + 4, L.halo ?? 20, (0.12 + 0.12 * dark) * v);
        if (L.ground) {
          const len = L.ground[1] - L.src[1];
          g.globalAlpha = Math.min(1, 0.07 * v * dark);
          g.drawImage(tintSprite("pool", L.colour), L.src[0] - len * 0.28, L.src[1], len * 0.56, len * 1.05);
          g.globalAlpha = 1;
        }
      } else if (L.kind === "lantern") {
        const fl = L.group === "photocell" ? 1 : 0.8 + 0.2 * hash(Math.floor(t * 8) + 17); // a street lamp doesn't flicker
        blob(cv, "dot", "#ffe3a8", L.src[0], L.src[1], L.core * 2, v * fl);
        blob(cv, "halo", "#ffb35c", L.src[0], L.src[1], L.halo, 0.35 * v * fl * (0.4 + 0.6 * dark));
      } else if (L.kind === "window" && isTV(L)) {
        drawMask(cv, L, "#a8c0ff", 0.7 * v * tvFlicker(L, t));
      } else if (L.kind === "bulbs") {
        const n = L.pts.length, dim = L.dim ?? 1;
        for (let i = 0; i < n; i++) {
          const [x, y] = L.pts[i];
          const a = v * dim * pattern(L, i, n, t);
          blob(cv, "dot", L.colour, x, y, 1.7, a);
          blob(cv, "bloom", L.colour, x, y, 5.5, a * (0.12 + 0.18 * dark));
        }
      }
    }
  }

  // --- Live layers' lights ---
  // provider: { name, rect: [x, y, w, h], group?, frame(t, out, sky), masks?: [{ el, rect, alpha? }] }
  // frame() pushes lights { x, y, kind: "bulb"|"led"|"head"|"tail"|"beam", colour, a, vis?, r?, dx?, dy?, len?, w? } in park px;
  // vis is the layer's own moving occlusion (a cabin, a train in front), masks its static occluders.
  function register(p) {
    const [x, y, w, h] = p.rect;
    const c = document.createElement("canvas");
    c.className = "lights";
    c.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;mix-blend-mode:plus-lighter;pointer-events:none`;
    c.width = Math.round(w * density); c.height = Math.round(h * density);
    parents.lights.append(c);
    const seed = hash(providers.length + 99) % 1;
    providers.push({ ...p, c, g: c.getContext("2d"), seed, list: [], drawn: true });
    // Light the layer throws on the ground joins the static pools, switched with the layer's group.
    (p.pools ?? []).forEach((q, i) => lights.push({ id: `${p.name}_pool${i}`, kind: "spill", group: p.group || "ride", seed: (seed + i * 0.137) % 1, x: q.c[0], lvl: 0, c: hex(q.colour), pool: q }));
    lastKey = "";
  }

  // A layer's static occluders (the wheel's front legs, the coaster's lattice) as alpha grids at 1 px per park px,
  // sampled at each light's point: occlusion of a point light is a lookup, not a composite.
  const grids = new Map();
  function grid(o) {
    if (!grids.has(o.el)) {
      const [, , w, h] = o.rect, c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(o.el, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      grids.set(o.el, { a, w: c.width, h: c.height });
    }
    return grids.get(o.el);
  }
  function hiddenBy(masks, x, y) {
    let vis = 1;
    for (const o of masks) {
      const [ox, oy, ow, oh] = o.rect, G = grid(o);
      const i = Math.floor(((x - ox) / ow) * G.w), j = Math.floor(((y - oy) / oh) * G.h);
      if (i < 0 || j < 0 || i >= G.w || j >= G.h) continue;
      vis *= 1 - (G.a[j * G.w + i] / 255) * (o.alpha ?? 1);
    }
    return vis;
  }

  function drawProvider(p, t) {
    const [x0, y0, w, h] = p.rect, g = p.g, d = p.c.width / w;
    const on = sky.dark > 0.005 ? level({ group: p.group || "ride", seed: p.seed, x: x0 + w / 2 }, sky, t) : 0;
    if (on <= 0.002 && !p.drawn) return; // idle: nothing on, nothing left on the canvas
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, p.c.width, p.c.height);
    p.drawn = on > 0.002;
    if (!p.drawn) return;
    g.setTransform(d, 0, 0, d, -x0 * d, -y0 * d);
    g.globalCompositeOperation = "lighter";
    p.list.length = 0;
    p.frame(t, p.list, { dark: sky.dark, on });
    const cv = { g, d }, masks = p.masks ?? [];
    for (const q of p.list) {
      let a = (q.a ?? 1) * on * (q.vis ?? 1);
      if (a <= 0.003) continue;
      if (masks.length && q.kind !== "beam") a *= hiddenBy(masks, q.x, q.y);
      if (q.kind === "beam") {
        // A headlight's light on the road: a soft wash ahead of the car, stretched along its heading.
        g.save();
        g.translate(q.x, q.y);
        g.rotate(Math.atan2(q.dy, q.dx));
        g.globalAlpha = Math.min(1, a * 0.32 * sky.dark);
        g.drawImage(tintSprite("pool", q.colour), 0, -q.w / 2, q.len, q.w);
        g.restore();
        g.globalAlpha = 1;
      } else {
        const r = q.r ?? 1.6;
        blob(cv, "dot", q.colour, q.x, q.y, r, a);
        blob(cv, "bloom", q.colour, q.x, q.y, r * 3.4, a * (0.14 + 0.2 * sky.dark) * (q.bloom ?? 1));
      }
    }
  }

  // Light gain at a park point (for a live layer that wants to light itself): 1 = no light.
  function at(x, y) {
    let s = [0, 0, 0];
    for (const L of lights) {
      if (!L.pool || L.lvl <= 0) continue;
      const [cx, cy] = L.pool.c, g0 = cam.toGround([x, y]), g1 = cam.toGround([cx, cy]);
      const r = Math.hypot(g0[0] - g1[0], g0[2] - g1[2]) / L.pool.r;
      if (r >= 1) continue;
      const k = (GAIN[L.kind] ?? 0.6) * L.lvl * sky.dark * Math.pow(1 - r, 2.2), c = hex(L.pool.colour);
      s = s.map((v, i) => Math.min(0.8, v + c[i] * k));
    }
    return s.map((v) => 1 / (1 - v));
  }

  return {
    lights, inventory: all, providers, register, at,
    // Every frame. Levels are worked out 10 times a second (the pool and steady canvases redraw only when one
    // changes); the twinkle canvas and the layers' lights redraw at most 30 times a second, and not at all by day.
    update(t, skyNow) {
      sky = skyNow;
      const now = performance.now(), t0 = now;
      if (now - lastLevels > 100 || frames === 0) {
        lastLevels = now;
        const key = levels(t);
        const idle = key === "day";
        if (idle !== wasIdle) { // by day every lights canvas is hidden: no blend passes for the compositor either
          for (const cv of surfaces) cv.c.style.visibility = idle ? "hidden" : "";
          for (const p of providers) p.c.style.visibility = idle ? "hidden" : "";
          wasIdle = idle;
        }
        if (key !== lastKey && !idle) { drawPool(); drawSteady(t); redraws++; }
        lastKey = key;
        anyOn = !idle && lights.some((L) => L.lvl > 0.002);
      }
      if (wasIdle) { frames++; return; }
      const t1 = performance.now();
      if (now - lastLive >= 32) {
        lastLive = now;
        if (anyOn) { drawLive(t); liveDrawn = true; } else if (liveDrawn || frames === 0) { live.reset(); liveDrawn = false; }
        for (const p of providers) { const a = performance.now(); drawProvider(p, t); part[p.name] = (part[p.name] ?? 0) + performance.now() - a; }
      }
      const t2 = performance.now();
      cost += t2 - t0; frames++; part.static = (part.static ?? 0) + t1 - t0; part.live = (part.live ?? 0) + t2 - t1;
    },
    // The window's scale changed: refit the screen-density canvases and redraw on the next frame.
    resize(d) {
      density = d;
      for (const cv of surfaces) if (!cv.fixed) cv.fit(d);
      for (const p of providers) { p.c.width = Math.round(p.rect[2] * d); p.c.height = Math.round(p.rect[3] * d); p.drawn = true; }
      lastKey = ""; frames = 0;
    },
    stats: () => ({ idle: !!wasIdle, lights: lights.length, on: lights.filter((L) => L.lvl > 0.5).length, ms: +(cost / Math.max(1, frames)).toFixed(2), redraws, part: Object.fromEntries(Object.entries(part).map(([k, v]) => [k, +(v / Math.max(1, frames)).toFixed(2)])) }),
  };
}
