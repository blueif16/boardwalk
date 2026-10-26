const FONT = "https://cdn.jsdelivr.net/npm/@fontsource/fredoka@5.1.0/files/fredoka-latin-600-normal.woff2";
const CSS = `
@font-face { font-family: "Fredoka"; font-weight: 600; src: url("${FONT}") format("woff2"); font-display: swap; }
.hv-sign { position: absolute; width: 0; height: 0; pointer-events: none; }
.hv-board { position: absolute; left: 0; bottom: 0; transform-origin: 50% 100%; white-space: nowrap; text-align: center;
  font: 600 15px/1.15 "Fredoka", ui-rounded, "Nunito", system-ui, sans-serif; color: #2c201b; background: #fff8ec;
  border: 2px solid #604e43; border-radius: 11px; padding: 4px 11px 5px; box-shadow: 0 2px 0 #604e43, 0 5px 10px rgba(44, 32, 27, .18); }
.hv-board::after { content: ""; position: absolute; left: 50%; bottom: -7px; width: 10px; height: 10px; margin-left: -6px; background: #fff8ec;
  border: 2px solid #604e43; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.hv-board small { display: block; font-size: 10.5px; font-weight: 600; color: #8a6f5f; letter-spacing: .02em; }
.hv-board i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
`;
const TAG = { stall: "#ec8167", lamp: "#85adcd", palm: "#7d9459", bench: "#bc8666", flag: "#f2b275" };
const FEEL = {
  stall: { hop: 5, squash: 1 },
  lamp: { hop: 4, squash: 0.8 },
  palm: { hop: 3, squash: 0.6 },
  bench: { hop: 4, squash: 1 },
  flag: { hop: 2, squash: 0.45 },
};
const SY = [[0, 1], [0.06, 0.9], [0.16, 1.07], [0.3, 1], [0.4, 0.93], [0.52, 1.03], [0.66, 0.99], [0.8, 1]];
const BOUNCE = 0.8, FLUTTER = 1.8, HOLD = 2.6;

const smooth = (u) => u * u * (3 - 2 * u);
function squashAt(t) {
  if (t <= 0 || t >= SY[SY.length - 1][0]) return 1;
  let i = 0;
  while (SY[i + 1][0] < t) i++;
  const [t0, a] = SY[i], [t1, b] = SY[i + 1];
  return a + (b - a) * smooth((t - t0) / (t1 - t0));
}
function pose(kind, t) {
  if (t < 0 || t >= BOUNCE) return null;
  const f = FEEL[kind];
  const sy = 1 + (squashAt(t) - 1) * f.squash;
  const u = (t - 0.1) / 0.3;
  const dy = u > 0 && u < 1 ? -f.hop * Math.sin(Math.PI * u) : 0;
  return { sx: 1 + (1 - sy) * 0.7, sy, dy };
}

const loadImage = (url) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = url; });
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

function insidePoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function split(sprite, ox, oy, poly) {
  const w = sprite.width, h = sprite.height;
  const src = canvasOf(w, h).getContext("2d", { willReadFrequently: true });
  src.drawImage(sprite, 0, 0);
  const all = src.getImageData(0, 0, w, h);
  const part = new ImageData(w, h), rest = new ImageData(new Uint8ClampedArray(all.data), w, h);
  const top = new Int16Array(w).fill(-1), bottom = new Int16Array(w).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    if (all.data[k + 3] < 255 || !insidePoly(poly, ox + x + 0.5, oy + y + 0.5)) continue;
    part.data.set(all.data.subarray(k, k + 4), k);
    rest.data[k + 3] = 0;
    if (top[x] < 0) top[x] = y;
    bottom[x] = y;
  }
  const a = canvasOf(w, h), b = canvasOf(w, h);
  a.getContext("2d").putImageData(part, 0, 0);
  b.getContext("2d").putImageData(rest, 0, 0);
  return { part: a, rest: b, top, bottom };
}

export async function mount({ stage, clock, slots, world, bench, dir, params }) {
  const [W, H] = stage.size;
  const data = await (await fetch(new URL("data.json", dir))).json();
  if (!document.getElementById("hv-style")) {
    const st = document.createElement("style");
    st.id = "hv-style";
    st.textContent = CSS;
    document.head.append(st);
  }

  const hitImg = await createImageBitmap(await (await fetch(new URL("hit.png", dir))).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const hc = canvasOf(W, H).getContext("2d", { willReadFrequently: true });
  hc.drawImage(hitImg, 0, 0);
  const rgba = hc.getImageData(0, 0, W, H).data;
  const hit = new Uint8Array(W * H);
  for (let i = 0; i < hit.length; i++) hit[i] = rgba[i * 4];

  const items = await Promise.all(data.items.map(async (d) => {
    const [sprite, patch] = await Promise.all([loadImage(new URL(`sprites/${d.id}.png`, dir)), loadImage(new URL(`patches/${d.id}.png`, dir))]);
    const xs = d.foot.map((p) => p[0]);
    const it = { ...d, sprite, patch, ox: d.sprite[0], oy: d.sprite[1], fx: (Math.min(...xs) + Math.max(...xs)) / 2, fy: d.depth, t0: -1e9 };
    if (d.awning) it.awn = split(sprite, it.ox, it.oy, d.awning);
    if (d.cloth) {
      it.cl = split(sprite, it.ox, it.oy, d.cloth.poly);
      it.clW = Math.max(...d.cloth.poly.map((p) => p[0])) - d.cloth.pole;
    }
    return it;
  }));
  const byDepth = [...items].sort((a, b) => a.depth - b.depth);

  const patchCanvas = canvasOf(W, H);
  const front = canvasOf(W, H);
  for (const c of [patchCanvas, front]) c.style.pointerEvents = "none";
  slots.water.append(patchCanvas);
  slots.front.append(front);
  const pg = patchCanvas.getContext("2d");
  const g = front.getContext("2d");

  const signLayer = document.createElement("div");
  signLayer.style.pointerEvents = "none";
  slots.lights.append(signLayer);
  const sign = { el: null, item: null, t0: 0, until: 0, out: -1 };

  function footY(it, x) {
    const f = it.foot;
    if (x <= f[0][0]) return f[0][1];
    for (let i = 1; i < f.length; i++) if (x <= f[i][0]) return f[i - 1][1] + ((f[i][1] - f[i - 1][1]) * (x - f[i - 1][0])) / (f[i][0] - f[i - 1][0]);
    return f[f.length - 1][1];
  }

  function hitAt(x, y, radius = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < H && hit[yi * W + xi]) return items[hit[yi * W + xi] - 1];
    let best = null, bd = Infinity;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
      const d = dx * dx + dy * dy, px = xi + dx, py = yi + dy;
      if (d > r * r || d >= bd || px < 0 || py < 0 || px >= W || py >= H) continue;
      const id = hit[py * W + px];
      if (id) { best = items[id - 1]; bd = d; }
    }
    return best;
  }

  function scaleOfWorld() { return world.getBoundingClientRect().width / W; }
  function toStage(e) {
    const r = world.getBoundingClientRect(), s = r.width / W;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s, s];
  }

  function showSign(it, now) {
    if (sign.item !== it) {
      sign.el?.remove();
      const el = document.createElement("div");
      el.className = "hv-sign";
      const board = document.createElement("div");
      board.className = "hv-board";
      board.innerHTML = `<i style="background:${TAG[it.kind]}"></i>${it.name}${it.caption ? `<small>${it.caption}</small>` : ""}`;
      el.append(board);
      signLayer.append(el);
      Object.assign(sign, { el, board, item: it, t0: now, out: -1 });
    }
    sign.until = now + HOLD;
    sign.out = -1;
  }

  function poke(it, now = clock.now()) {
    if (now - it.t0 > 0.35) it.t0 = now;
    showSign(it, now);
  }

  for (const spec of (params.get("poke") || "").split(",").filter(Boolean)) {
    const [id, ago] = spec.split("@");
    const it = items.find((i) => i.id === id);
    if (it) { const now = clock.now(); it.t0 = now - Number(ago || 0); showSign(it, now); sign.t0 = now - Number(ago || 0) - 0.3; sign.until = Infinity; }
  }

  let hover = null;
  world.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const [x, y] = toStage(e);
    const it = hitAt(x, y);
    world.style.cursor = it ? "pointer" : "";
    if (it !== hover) { hover = it; if (it) poke(it); }
    else if (it) sign.until = clock.now() + HOLD;
  });
  world.addEventListener("pointerleave", () => { hover = null; world.style.cursor = ""; });
  const downs = new Map();
  world.addEventListener("pointerdown", (e) => downs.set(e.pointerId, [e.clientX, e.clientY]));
  world.addEventListener("pointerup", (e) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 12) return;
    const [x, y, s] = toStage(e);
    const it = hitAt(x, y, e.pointerType === "mouse" ? 0 : 16 / s);
    if (it) poke(it, clock.now());
    else if (sign.item) sign.until = Math.min(sign.until, clock.now());
  });

  const walkers = params.has("walkers") ? [
    { y: 600, x0: 400, x1: 660, speed: 22, color: "#f2b275" },
    { y: 566, x0: 380, x1: 560, speed: 17, color: "#85adcd" },
    { y: 772, x0: 990, x1: 1240, speed: 24, color: "#f9f4ea" },
    { y: 814, x0: 1150, x1: 1320, speed: 20, color: "#ec8167" },
    { y: 572, x0: 1080, x1: 1240, speed: 18, color: "#b4b7b8" },
  ] : [];

  function drawWalker(w, t) {
    const span = w.x1 - w.x0, p = (t * w.speed) % (2 * span);
    const x = w.x0 + (p < span ? p : 2 * span - p), dir = p < span ? 1 : -1;
    const bob = Math.abs(Math.sin(t * 9 + w.x0)) * 2.5, y = w.y;
    g.fillStyle = "rgba(96, 78, 67, .28)";
    g.beginPath(); g.ellipse(x, y, 7, 2.6, 0, 0, Math.PI * 2); g.fill();
    g.save();
    g.translate(x, y - bob);
    g.scale(dir, 1);
    g.lineWidth = 1.2;
    g.strokeStyle = "#2c201b";
    g.fillStyle = w.color;
    for (const [ex, a] of [[-3, -0.2], [2, 0.15]]) { g.beginPath(); g.ellipse(ex, -27, 2.2, 6, a, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.beginPath(); g.ellipse(0, -8, 6, 8, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, -19, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#2c201b";
    g.beginPath(); g.arc(3, -20, 0.9, 0, Math.PI * 2); g.fill();
    g.restore();
    return x;
  }

  let draws = 0;
  function drawItem(it, t) {
    const ps = pose(it.kind, t - it.t0);
    const ft = t - it.t0;
    g.save();
    if (ps) g.transform(ps.sx, 0, 0, ps.sy, it.fx - ps.sx * it.fx, it.fy - ps.sy * it.fy + ps.dy);
    const fl = ft >= 0 && ft < FLUTTER ? Math.exp(-2.2 * ft) * smooth(Math.min(1, ft / 0.1)) : 0;
    if (it.cl && fl > 0) {
      g.drawImage(it.cl.rest, it.ox, it.oy);
      const { part, top, bottom } = it.cl;
      for (let x = 0; x < part.width; x += 2) {
        if (top[x] < 0) continue;
        const along = Math.max(0, it.ox + x - it.cloth.pole) / it.clW;
        const dy = 4 * fl * along * Math.sin(along * 7 - ft * 14);
        g.drawImage(part, x, top[x], 2, bottom[x] - top[x] + 1, it.ox + x, it.oy + top[x] + dy, 2, bottom[x] - top[x] + 1);
        draws++;
      }
    } else {
      g.drawImage(it.sprite, it.ox, it.oy);
    }
    draws++;
    if (it.awn && fl > 0) {
      const { part, top, bottom } = it.awn;
      for (let x = 0; x < part.width; x += 2) {
        if (top[x] < 0) continue;
        const h = bottom[x] - top[x] + 1;
        const a = 3.2 * fl * (0.5 + 0.5 * Math.sin((it.ox + x) * 0.21 - ft * 15));
        g.drawImage(part, x, top[x], 2, h, it.ox + x, it.oy + top[x], 2, h + a);
        draws++;
      }
    }
    g.restore();
  }

  const PAD = 14;
  const grow = (r, it) => {
    const [x, y, w, h] = it.bbox;
    return r ? [Math.min(r[0], x - PAD), Math.min(r[1], y - PAD), Math.max(r[2], x + w + PAD), Math.max(r[3], y + h + PAD)] : [x - PAD, y - PAD, x + w + PAD, y + h + PAD];
  };
  let last = [...items];
  return {
    update(dt, t) {
      draws = 0;
      const moving = items.filter((it) => t - it.t0 >= 0 && t - it.t0 < FLUTTER);
      let dirty = walkers.length ? [0, 0, W, H] : null;
      for (const it of moving.concat(last)) dirty = grow(dirty, it);
      last = moving;
      if (dirty) {
        const [x0, y0, x1, y1] = dirty.map(Math.round), box = [x0, y0, x1 - x0, y1 - y0];
        const touches = (it) => it.bbox[0] < x1 && it.bbox[0] + it.bbox[2] > x0 && it.bbox[1] < y1 && it.bbox[1] + it.bbox[3] > y0;
        for (const c of [pg, g]) { c.save(); c.beginPath(); c.rect(...box); c.clip(); c.clearRect(...box); }
        for (const it of moving) { pg.drawImage(it.patch, it.ox, it.oy); draws++; }
        for (const it of byDepth) if (touches(it)) drawItem(it, t);
        for (const w of walkers) {
          const x = drawWalker(w, t);
          draws++;
          for (const it of byDepth) {
            const [bx, by, bw, bh] = it.bbox;
            if (x + 8 > bx && x - 8 < bx + bw && w.y - 34 < by + bh && w.y > by && w.y < footY(it, x)) drawItem(it, t);
          }
        }
        pg.restore();
        g.restore();
      }

      if (sign.el) {
        const st = t - sign.t0;
        if (t > sign.until && sign.out < 0) sign.out = t;
        const k = Math.min(3.5, Math.max(1, 1 / scaleOfWorld()));
        const pop = st < 0 ? 0 : 1 - Math.exp(-7 * st) * Math.cos(13 * st);
        const fade = sign.out < 0 ? 1 : Math.max(0, 1 - (t - sign.out) / 0.18);
        const bobY = Math.sin(st * 2.4) * 1.2;
        const [bx, by, bw] = sign.item.bbox, bwPx = sign.board.offsetWidth * k, bhPx = sign.board.offsetHeight * k;
        sign.el.style.left = `${Math.min(W - bwPx / 2 - 4, Math.max(bwPx / 2 + 4, bx + bw / 2))}px`;
        sign.el.style.top = `${Math.max(by - 4, bhPx + 12)}px`;
        sign.board.style.transform = `translate(-50%, ${bobY - 6 * (1 - fade)}px) scale(${(k * (0.55 + 0.45 * pop) * (0.85 + 0.15 * fade)).toFixed(4)})`;
        sign.board.style.opacity = String(Math.min(1, st / 0.08) * fade);
        if (fade <= 0) { sign.el.remove(); sign.el = null; sign.item = null; }
      }
      bench?.report("hover", draws);
    },
    items,
    hitAt,
    poke,
  };
}
