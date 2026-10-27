// The hidden corgi: a find-the-corgi game on the park page.
//
// One corgi hides at a time, in one of SPOTS: places the crowd never goes, each a small scene with its own motion
// (peeking out of the dark under the trestle, paddling round a rooftop pool, digging by the palms...). Something small
// moving where the painting is still is the clue. Click it: it hops, a heart pops up, it runs off (leaving paw prints
// that fade) and hides somewhere else on screen. The "?" badge top right asks "Can you find the corgi?"; once found it
// shows the corgi and counts the hiding spots found (kept in this browser). Unfound for a while, it barks: a "woof!"
// bubble over it, now and then, or at once from the badge's hint button.
//
// Art: tools/build.py (corgi.webp: the crowd's corgi sheet at 4 px per park px; pin.webp: the bowling pin it hides
// behind). Every scene is closed form on the page clock, so &t= freezes it. At night (base/sky.js) it sleeps curled up
// wherever it hid, z's rising, never in the pool, and the hint bubble says "zzz..." instead of barking. Params: &corgi=<spot id> starts there;
// &corgiFound=<clock s> and &corgiWoof=<clock s> play the find or the bark at that time; &corgiCard opens the card
// (for screenshots).
import { getSky } from "../../base/sky.js";

const KEY = "boardwalk.corgi.found";
const CELEBRATE = 1.2, EXIT = 0.9, NEXT = 5;  // s: hops and heart, then the exit, then the next spot
const FIRST_WOOF = 45, WOOF_EVERY = 60, WOOF = 1.8;
const DASH = 70;                                // park px/s running off
const INK = "#362223", SAND = "#b98a55", WATER = "#ffffff";
const POOL = [[1858, 656], [1902, 619], [1947, 617], [1986, 632], [1966, 652], [1925, 664], [1872, 662]];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
const bump = (x, a, b) => (x > a && x < b ? Math.sin((Math.PI * (x - a)) / (b - a)) : 0);
const step = (t, fps) => (Math.floor(t * fps) % 2 ? "walk1" : "walk0");
const load = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

// Each scene maps local time tau (s since the corgi hid here) to a pose: frame f, feet x/y (park px), flip (side
// views face right; flip faces left), shade (0-1, in the dark), clip (a waterline y: only what is above shows),
// sx/sy squash, alpha, and fx(g, tau) for the scene's own marks (ripples, sand, zzz, drops).
const SPOTS = [
  { id: "trestle", box: [3470, 830, 140, 75], show: [3541, 888], rest: [3543, 885], exit: "retreat", scene: peekArch },
  { id: "pool", box: [1850, 590, 150, 85], exit: "dive", scene: swim, day: true },
  { id: "palms", box: [3440, 690, 140, 70], rest: [3492, 742], exit: "dash", dir: 1, scene: dig },
  { id: "pin", box: [236, 690, 140, 85], show: [306, 752], rest: [306, 752], exit: "hide", scene: peekPin },
  { id: "palm", box: [1840, 840, 120, 65], rest: [1933, 889], exit: "dash", dir: -1, scene: nap },
  { id: "river", box: [3590, 520, 110, 115], rest: [3628, 572], exit: "upstream", scene: splash },
  { id: "verge", box: [1610, 930, 140, 65], rest: [1655, 980], exit: "dash", dir: 1, scene: spin },
];

// At night: asleep at the spot's rest point, back to us, breathing, z's rising.
function sleep(spot, tau) {
  const [x, y] = spot.rest, b = Math.sin((2 * Math.PI * tau) / 3.8);
  return { f: "back_act", x, y, sy: 1 + 0.03 * b, sx: 1 - 0.015 * b, fx: (g) => zzz(g, tau, x, y) };
}

function peekArch(tau) {
  const t = tau % 16, deep = [3546, 881], out = [3541, 888];
  if (t < 4) return { f: "front_act", x: deep[0], y: deep[1], shade: 0.72 };
  if (t < 5.2) { const k = ease((t - 4) / 1.2); return { f: `front_${step(t, 6)}`, x: lerp(deep[0], out[0], k), y: lerp(deep[1], out[1], k), shade: 0.72 * (1 - k) }; }
  if (t < 9.5) {
    const f = t < 6.4 || t >= 8.4 ? "front_act" : "side_stand";
    return { f, x: out[0], y: out[1], flip: t >= 7.4 && t < 8.4 };
  }
  if (t < 10.7) { const k = ease((t - 9.5) / 1.2); return { f: `back_${step(t, 6)}`, x: lerp(out[0], deep[0], k), y: lerp(out[1], deep[1], k), shade: 0.72 * k }; }
  return { f: "back_act", x: deep[0], y: deep[1], shade: 0.72 };
}

// Paddling laps of the rooftop pool: a lap, then a float at the east end; only the head and shoulders show.
function swim(tau) {
  const t = tau % 26, C = [1925, 641], rx = 32, ry = 8.5;
  const th = t < 20 ? (2 * Math.PI * t) / 20 : 0;
  const x = C[0] + rx * Math.cos(th), y = C[1] + ry * Math.sin(th) + 0.5 * Math.sin(tau * 5);
  const dx = -rx * Math.sin(th), dy = ry * Math.cos(th);
  let f = "front_stand", flip = false;
  if (t < 20) {
    if (Math.abs(dy) * 2 > Math.abs(dx)) f = dy > 0 ? "front_walk0" : "back_walk0";
    else { f = `side_${step(t, 3)}`; flip = dx < 0; }
  }
  return { f, x, y: y + 7, flip, clip: y, water: true, fx: (g) => wake(g, tau, t < 20) };
}

function wake(g, tau, moving) {
  g.save();
  g.beginPath();
  POOL.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.clip();
  g.strokeStyle = WATER;
  g.lineWidth = 0.8;
  for (let j = 0; j < 6; j++) {
    const born = Math.floor(tau / 0.6) * 0.6 - j * 0.6, age = tau - born;
    if (born < 0 || (!moving && j > 1 && age > 1.2)) continue;
    const p = swim.at(born), r = 3 + age * 5;
    g.globalAlpha = clamp(0.95 * (1 - age / 3.4));
    g.beginPath();
    g.ellipse(p[0], p[1], r, r * 0.32, 0, 0, 2 * Math.PI);
    g.stroke();
  }
  g.restore();
}
swim.at = (tau) => { const t = tau % 26, th = t < 20 ? (2 * Math.PI * t) / 20 : 0; return [1925 + 32 * Math.cos(th), 641 + 8.5 * Math.sin(th)]; };

// Digging beside the palms, nose down and sand flying, then a look round.
function dig(tau) {
  const t = tau % 12, x = 3492, y = 742;
  const hole = (g) => { g.fillStyle = "rgba(110, 72, 45, 0.45)"; g.beginPath(); g.ellipse(x - 11, y + 0.5, 5, 1.9, 0, 0, 2 * Math.PI); g.fill(); };
  if (t < 5.5) return { f: "side_act", x: x + 0.5 * Math.sin(tau * 30), y, flip: true, under: hole, fx: (g) => sand(g, tau, x + 7, y - 4) };
  if (t < 7.5 || t >= 10.5) return { f: "side_stand", x, y, flip: true, under: hole };
  return { f: "front_act", x, y, under: hole };
}

function sand(g, tau, x0, y0) {
  g.fillStyle = SAND;
  for (let i = 0; i < 8; i++) {
    const k = (tau * 1.7 + i / 8) % 1;
    g.globalAlpha = 1 - k;
    g.beginPath();
    g.arc(x0 + k * 13 + (i % 3) * 1.5, y0 - Math.sin(k * Math.PI) * 8 + k * 4, 1.15, 0, 2 * Math.PI);
    g.fill();
  }
  g.globalAlpha = 1;
}

// Behind the Boardwalk Bowl's giant pin: hidden, then the head out, then out on the roof for a sit.
function peekPin(tau) {
  const t = tau % 15, y = 752, hid = 266, peek = 284, out = 306;
  const walk = (a, b, t0, t1) => ({ f: `side_${step(t, 6)}`, x: lerp(a, b, ease((t - t0) / (t1 - t0))), y, flip: b < a });
  if (t < 4 || t >= 12.8) return { f: "side_stand", x: hid, y };
  if (t < 4.8) return walk(hid, peek, 4, 4.8);
  if (t < 7.5) return { f: "side_stand", x: peek, y: y - 0.6 * bump(t % 1.3, 0, 0.4) };
  if (t < 8.4) return walk(peek, out, 7.5, 8.4);
  if (t < 11) return { f: "front_act", x: out, y };
  if (t < 11.6) return { f: "side_stand", x: out, y, flip: true };
  return walk(out, hid, 11.6, 12.8);
}

// Asleep in a palm's shade on the parking lot's island, back to us; wakes for a look round now and then.
function nap(tau) {
  const t = tau % 24, x = 1933, y = 889;
  if (t < 18 || t >= 22) {
    const b = Math.sin((2 * Math.PI * tau) / 3.4);
    return { f: "back_act", x, y, sy: 1 + 0.03 * b, sx: 1 - 0.015 * b, fx: t < 18 ? (g) => zzz(g, tau, x, y) : null };
  }
  if (t < 19) return { f: "front_act", x, y };
  return { f: t < 20 || t >= 21 ? "front_act" : "side_stand", x, y, flip: t >= 20.5 };
}

function zzz(g, tau, x, y) {
  g.fillStyle = INK;
  for (let i = 0; i < 3; i++) {
    const k = (tau / 3.6 + i / 3) % 1;
    g.globalAlpha = 0.85 * Math.sin(k * Math.PI);
    g.font = `700 ${5 + k * 4}px Gaegu, cursive`;
    g.fillText("z", x + 6 + k * 8, y - 22 - k * 12);
  }
  g.globalAlpha = 1;
}

// Trotting the river's sand bar by the bridge pier, sniffing the water, shaking off.
function splash(tau) {
  const t = tau % 16, A = [3628, 572], B = [3655, 612];
  const at = (k) => [lerp(A[0], B[0], k), lerp(A[1], B[1], k)];
  if (t < 5) { const [x, y] = at(ease(t / 5)); return { f: `front_${step(t, 5)}`, x, y }; }
  if (t < 7) return { f: "side_act", x: B[0], y: B[1], flip: true, fx: (g) => drops(g, tau, B[0] - 9, B[1] - 2, 1) };
  if (t < 8) return { f: "front_stand", x: B[0] + 0.8 * Math.sin(tau * 100), y: B[1], fx: (g) => drops(g, tau, B[0], B[1] - 10, 2) };
  if (t < 13) { const [x, y] = at(1 - ease((t - 8) / 5)); return { f: `back_${step(t, 5)}`, x, y }; }
  return { f: t < 14.5 ? "front_act" : "side_stand", x: A[0], y: A[1], flip: true };
}

function drops(g, tau, x0, y0, kind) {
  g.fillStyle = "rgba(235, 248, 255, 0.95)";
  for (let i = 0; i < 7; i++) {
    const k = (tau * 2.2 + i / 7) % 1, a = kind === 2 ? (i / 7) * 2 * Math.PI : Math.PI + (i - 3) * 0.25;
    g.globalAlpha = 1 - k;
    g.beginPath();
    g.arc(x0 + Math.cos(a) * k * 9, y0 + Math.sin(a) * k * 4 - Math.sin(k * Math.PI) * 5, 0.95, 0, 2 * Math.PI);
    g.fill();
  }
  g.globalAlpha = 1;
}

// Chasing its tail on the grass strip, then a sit and a sniff.
function spin(tau) {
  const t = tau % 11, x = 1655, y = 980;
  const turn = (rate) => {
    const i = Math.floor(t / rate) % 4, a = (t / rate / 4) * 2 * Math.PI;
    const views = [["side_stand", false], ["front_stand", false], ["side_stand", true], ["back_stand", false]];
    return { f: views[i][0], flip: views[i][1], x: x + 2 * Math.cos(a), y: y + 0.8 * Math.sin(a) - 1.5 * Math.abs(Math.sin((t * Math.PI) / (rate * 2))) };
  };
  if (t < 3) return turn(0.11);
  if (t < 6.5) return { f: "front_act", x, y, sy: 1 + 0.02 * Math.sin(tau * 12) };
  if (t < 8) return turn(0.09);
  return { f: "side_act", x: x + (t > 9.5 ? 2 : 0), y, flip: Math.floor(tau / 11) % 2 === 1 };
}

export async function mount(ctx) {
  const { slots, params, W, H } = ctx;
  const sky = ctx.sky ?? getSky();
  const isNight = () => sky.dark > 0.6;
  const meta = await fetch(new URL("corgi.json", ctx.dir)).then((r) => r.json());
  const [img, pinImg] = await Promise.all([load(new URL("corgi.webp", ctx.dir)), load(new URL("pin.webp", ctx.dir))]);
  const D = meta.density, F = meta.frames;
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(...Object.values(F).map((f) => f.rect[2]));
  scratch.height = Math.max(...Object.values(F).map((f) => f.rect[3]));
  const sg = scratch.getContext("2d");

  const canvas = document.createElement("canvas");
  slots.rides.append(canvas);
  const g = canvas.getContext("2d");
  const hit = document.createElement("button");
  hit.className = "corgi-hit";
  hit.tabIndex = -1;
  hit.setAttribute("aria-label", "the hidden corgi");
  slots.front.append(hit);
  const woof = document.createElement("div");
  woof.className = "corgi-woof";
  woof.textContent = "woof!";
  woof.hidden = true;
  slots.front.append(woof);
  const ui = makeUI(img, F);

  let found = [];
  try { found = JSON.parse(localStorage.getItem(KEY) || "[]").filter((id) => SPOTS.some((s) => s.id === id)); } catch { found = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(found)); } catch { /* private window */ } };

  let scale = ctx.scale(), d = 1;
  const visible = (s) => {
    const tx = (innerWidth - W * scale) / 2, ty = (innerHeight - H * scale) / 2, m = 30;
    const [x, y] = s.show ?? [s.box[0] + s.box[2] / 2, s.box[1] + s.box[3] / 2];
    return x * scale + tx > m && x * scale + tx < innerWidth - m && y * scale + ty > m && y * scale + ty < innerHeight - m;
  };
  const pickNext = (not) => {
    const pool = SPOTS.filter((s) => s !== not && visible(s) && !(s.day && isNight()));
    const fresh = pool.filter((s) => !found.includes(s.id));
    const from = fresh.length ? fresh : pool.length ? pool : SPOTS.filter((s) => s !== not);
    return from[Math.floor(Math.random() * from.length)];
  };

  let spot = SPOTS.find((s) => s.id === params.get("corgi")) ?? pickNext(null);
  let start = 0, foundAt = params.has("corgiFound") ? Number(params.get("corgiFound")) : null;
  let woofAt = params.has("corgiWoof") ? Number(params.get("corgiWoof")) : null, lastWoof = -Infinity;
  let now = 0, at = null;
  const place = () => {
    const [x, y, w, h] = spot.box;
    canvas.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
  };
  const resize = (s) => {
    scale = s;
    d = clamp(s * (devicePixelRatio || 1), 1, 3);
    woof.style.fontSize = `${16 / s}px`;
    place();
  };
  resize(scale);

  const bark = () => { if (foundAt == null) woofAt = now; };
  ui.onHint = bark;
  ui.render(found.length, SPOTS.length);
  if (params.has("corgiCard")) ui.open(true);
  hit.addEventListener("click", (e) => {
    e.stopPropagation();
    if (foundAt != null) return;
    foundAt = now;
    at = null;
    woofAt = null;
    if (!found.includes(spot.id)) { found.push(spot.id); save(); }
    ui.render(found.length, SPOTS.length, true);
  });

  function frameOf(name) { return F[name] ?? F.front_stand; }

  function drawCorgi(p) {
    const fr = frameOf(p.f), [sx0, sy0, fw, fh] = fr.rect, [ax, ay] = fr.anchor, s = 1 / D;
    let src = img, ox = sx0, oy = sy0;
    if (p.shade > 0.01) {
      sg.globalCompositeOperation = "copy";
      sg.drawImage(img, sx0, sy0, fw, fh, 0, 0, fw, fh);
      sg.globalCompositeOperation = "source-atop";
      sg.fillStyle = `rgba(24, 20, 34, ${p.shade})`;
      sg.fillRect(0, 0, fw, fh);
      src = scratch; ox = 0; oy = 0;
    }
    g.save();
    g.globalAlpha = p.alpha ?? 1;
    if (p.clip != null) { g.beginPath(); g.rect(spot.box[0], spot.box[1], spot.box[2], p.clip - spot.box[1]); g.clip(); }
    if (!p.water && !(p.shade > 0.3)) {
      g.fillStyle = "rgba(44, 32, 27, 0.22)";
      g.beginPath();
      g.ellipse(p.x, p.y, 6.5, 2, 0, 0, 2 * Math.PI);
      g.fill();
    }
    g.translate(p.x, p.y);
    g.scale((p.flip ? -1 : 1) * (p.sx ?? 1), p.sy ?? 1);
    g.drawImage(src, ox, oy, fw, fh, -ax * s, -ay * s, fw * s, fh * s);
    g.restore();
  }

  // Found: it stops what it was doing (base: its pose when found), two hops where it can be seen, a heart and
  // sparkles, then this spot's way out.
  function foundPose(tf, base) {
    if (tf < CELEBRATE) {
      const hop = 9 * bump(tf, 0.12, 0.52) + 4 * bump(tf, 0.6, 0.9);
      const squash = 1 - 0.16 * (bump(tf, 0, 0.14) + bump(tf, 0.5, 0.62));
      if (base.water) return { ...base, y: base.y - hop * 0.6, f: "front_stand", flip: false, fx: null };
      return { f: tf < 0.95 ? "front_stand" : "front_act", x: at[0], y: at[1] - hop, sx: 2 - squash, sy: squash };
    }
    const k = clamp((tf - CELEBRATE) / EXIT), fade = 1 - ease((k - 0.6) / 0.4);
    switch (spot.exit) {
      case "dash": return { f: `side_${step(tf, 12)}`, x: at[0] + spot.dir * DASH * (tf - CELEBRATE), y: at[1], flip: spot.dir < 0, alpha: fade };
      case "retreat": return { f: `back_${step(tf, 8)}`, x: lerp(at[0], 3547, k), y: lerp(at[1], 880, k), shade: k, alpha: 1 - ease((k - 0.7) / 0.3) };
      case "dive": return { ...base, f: "front_stand", flip: false, y: base.y + 14 * ease(k), alpha: fade, fx: null };
      case "hide": return { f: `side_${step(tf, 10)}`, x: lerp(at[0], 266, ease(k)), y: at[1], flip: true };
      case "upstream": return { f: `back_${step(tf, 10)}`, x: at[0] - 30 * k, y: at[1] - 36 * k, alpha: fade };
    }
    return base;
  }

  function heart(tf, x, y) {
    if (tf < 0.15 || tf > 1.9) return;
    const k = (tf - 0.15) / 1.75, s = Math.min(1, k * 6) * 6.5, cy = y - 27 - 18 * ease(k);
    g.save();
    g.globalAlpha = 1 - ease((k - 0.6) / 0.4);
    g.translate(x, cy);
    g.scale(s / 10, s / 10);
    g.beginPath();
    g.moveTo(0, 3);
    g.bezierCurveTo(-1, 1, -10, -2, -6, -8);
    g.bezierCurveTo(-3, -11, 0, -8, 0, -6);
    g.bezierCurveTo(0, -8, 3, -11, 6, -8);
    g.bezierCurveTo(10, -2, 1, 1, 0, 3);
    g.fillStyle = "#e8826f";
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = INK;
    g.stroke();
    g.restore();
    if (tf < 0.75) {
      g.fillStyle = "#f4c95d";
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.62, r = 8 + 14 * ease((tf - 0.1) / 0.65);
        g.globalAlpha = 1 - ease((tf - 0.35) / 0.4);
        star(x + Math.cos(a) * r, y - 14 + Math.sin(a) * r * 0.8, 2.2);
      }
      g.globalAlpha = 1;
    }
  }
  function star(x, y, r) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, q = i % 2 ? r * 0.35 : r;
      g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    g.fill();
  }

  function pawPrints(tf) {
    if (spot.exit !== "dash" || tf < CELEBRATE) return;
    const every = 0.08, n = Math.floor(Math.min(tf - CELEBRATE, EXIT) / every);
    g.fillStyle = INK;
    for (let i = 0; i <= n; i++) {
      const tt = i * every, age = tf - CELEBRATE - tt;
      g.globalAlpha = clamp(0.5 * (1 - age / 3.2));
      const x = at[0] + spot.dir * DASH * tt, y = at[1] + (i % 2 ? 1.6 : -0.6);
      g.beginPath();
      g.ellipse(x, y, 1.5, 0.85, 0, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  return {
    resize,
    update(t) {
      now = t;
      sky.tick();
      const night = isNight(), scene = (tau) => (night ? sleep(spot, tau) : spot.scene(tau));
      if (night && spot.day && foundAt == null) { spot = pickNext(spot); start = t; place(); }
      if (foundAt == null && woofAt == null && document.visibilityState === "visible" && t - start > FIRST_WOOF && t - lastWoof > WOOF_EVERY) woofAt = t;
      const tau = t - start;
      let p = scene(tau);
      const tf = foundAt == null ? null : t - foundAt;
      if (tf != null) {
        if (tf > NEXT) {
          spot = pickNext(spot);
          start = t;
          foundAt = null;
          lastWoof = t;
          place();
          return;
        }
        const base = scene(Math.max(0, foundAt - start));
        at ??= spot.show ?? [base.x, base.y];
        p = foundPose(Math.max(0, tf), base);
      }
      const top = p.water ? p.clip - 10 : p.y - 21; // the top of its head
      if (woofAt != null) {
        const tb = t - woofAt;
        if (tb > WOOF) { woofAt = null; lastWoof = t; woof.hidden = true; }
        else {
          if (!night) p = { ...p, y: p.y - 2 * (bump(tb, 0.05, 0.22) + bump(tb, 0.32, 0.5)) };
          woof.textContent = night ? "zzz..." : "woof!";
          woof.hidden = false;
          woof.style.left = `${p.x}px`;
          woof.style.top = `${top - 4}px`;
        }
      } else if (!woof.hidden) woof.hidden = true;

      g.setTransform(d, 0, 0, d, -spot.box[0] * d, -spot.box[1] * d);
      g.clearRect(spot.box[0], spot.box[1], spot.box[2], spot.box[3]);
      p.under?.(g);
      if (tf != null && tf >= CELEBRATE) pawPrints(tf);
      if (tf == null || tf >= CELEBRATE) p.fx?.(g, tau);
      if ((p.alpha ?? 1) > 0.01) drawCorgi(p);
      if (spot.id === "pin") { const [x, y, w, h] = meta.pin.rect; g.drawImage(pinImg, x, y, w, h); }
      if (tf != null) heart(tf, p.x, top + 21);

      // The hit area follows the corgi, at least 30 CSS px square.
      const side = Math.max(28, 30 / scale), cy = top + 10;
      hit.style.cssText = `left:${p.x - side / 2}px;top:${cy - side / 2}px;width:${side}px;height:${side}px`;
      hit.hidden = tf != null;
    },
  };
}

// The badge top right and its card: "Can you find the corgi?", the hiding spots found as paws, a hint button. (The paw
// is a CSS mask, not inline SVG: scripts/capture.mjs clips to the page's first <svg>.)
const PAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><ellipse cx="12" cy="16" rx="5.2" ry="4.4"/><ellipse cx="5.6" cy="10.4" rx="2.1" ry="2.7"/><ellipse cx="9.6" cy="6.6" rx="2.1" ry="2.8"/><ellipse cx="14.4" cy="6.6" rx="2.1" ry="2.8"/><ellipse cx="18.4" cy="10.4" rx="2.1" ry="2.7"/></svg>`;
function makeUI(img, F) {
  const style = document.createElement("style");
  style.textContent = `
    .corgi-hit { position: absolute; pointer-events: auto; padding: 0; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .corgi-hit:focus { outline: none; }
    .corgi-woof { position: absolute; transform: translate(-50%, -100%); padding: 0.1em 0.45em 0.2em; font: 700 1em/1 Gaegu, "Comic Sans MS", cursive; color: ${INK};
      background: #fff8ec; border: 0.12em solid ${INK}; border-radius: 0.8em; white-space: nowrap; animation: corgi-pop 0.25s ease-out; }
    .corgi-woof::after { content: ""; position: absolute; left: 50%; bottom: -0.42em; width: 0.5em; height: 0.5em; background: #fff8ec;
      border: solid ${INK}; border-width: 0 0.12em 0.12em 0; transform: translateX(-50%) rotate(45deg); }
    .corgi-woof[hidden] { display: none; }
    .corgi-ui { position: fixed; top: 14px; right: 14px; z-index: 3; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font: 700 18px/1.15 Gaegu, "Comic Sans MS", cursive; color: ${INK}; }
    .corgi-badge { width: 46px; height: 46px; padding: 0; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
      background: #fff8ec; color: #d9685a; border: 2.5px solid ${INK}; box-shadow: 0 3px 0 ${INK}; font: 700 30px/1 Gaegu, "Comic Sans MS", cursive;
      transition: transform 0.15s; -webkit-tap-highlight-color: transparent; }
    .corgi-badge:hover { transform: translateY(-1px) rotate(-6deg); }
    .corgi-badge:active { transform: translateY(2px); box-shadow: 0 1px 0 ${INK}; }
    .corgi-badge:focus-visible { outline: 2px solid #fff8ec; outline-offset: 3px; }
    .corgi-badge canvas { width: 36px; height: 36px; }
    .corgi-badge.bump { animation: corgi-bump 0.6s ease-out; }
    .corgi-count { position: absolute; right: -4px; bottom: -6px; min-width: 22px; padding: 1px 4px; border-radius: 9px; background: #f4c95d;
      border: 2px solid ${INK}; font-size: 13px; text-align: center; }
    .corgi-card { width: 232px; padding: 12px 14px 12px; background: #fff8ec; border: 2.5px solid ${INK}; border-radius: 14px;
      box-shadow: 0 3px 0 ${INK}, 0 8px 22px rgb(54 34 35 / 0.18); animation: corgi-pop 0.2s ease-out; transform-origin: top right; }
    .corgi-card[hidden] { display: none; }
    .corgi-card p { margin: 0; }
    .corgi-card .q { font-size: 22px; }
    .corgi-card .sub { margin-top: 4px; font-size: 16px; color: #6b5450; }
    .corgi-paws { --paw: url("data:image/svg+xml,${encodeURIComponent(PAW)}"); display: flex; gap: 5px; margin: 10px 0 8px; color: #d9c6ae; }
    .corgi-paws span { width: 22px; height: 22px; background: currentColor; -webkit-mask: var(--paw) center / contain no-repeat; mask: var(--paw) center / contain no-repeat; }
    .corgi-paws .on { color: #d9685a; }
    .corgi-hint { padding: 3px 10px 4px; border-radius: 10px; border: 2px solid ${INK}; background: #f4c95d; color: ${INK}; cursor: pointer;
      font: 700 16px/1 Gaegu, "Comic Sans MS", cursive; box-shadow: 0 2px 0 ${INK}; }
    .corgi-hint:active { transform: translateY(1px); box-shadow: 0 1px 0 ${INK}; }
    @keyframes corgi-pop { from { transform: scale(0.6); opacity: 0; } }
    .corgi-woof { animation-name: corgi-pop-woof; }
    @keyframes corgi-pop-woof { from { transform: translate(-50%, -100%) scale(0.5); opacity: 0; } }
    @keyframes corgi-bump { 30% { transform: scale(1.25) rotate(8deg); } 60% { transform: scale(0.95) rotate(-4deg); } }
  `;
  document.head.append(style);
  const root = document.createElement("div");
  root.className = "corgi-ui";
  root.innerHTML = `<button class="corgi-badge" aria-expanded="false" aria-controls="corgi-card" aria-label="Find the hidden corgi">?</button>
    <div class="corgi-card" id="corgi-card" role="dialog" aria-label="Find the corgi" hidden>
      <p class="q"></p><p class="sub"></p><div class="corgi-paws"></div><button class="corgi-hint">Need a hint?</button>
    </div>`;
  document.body.append(root);
  const badge = root.querySelector(".corgi-badge"), card = root.querySelector(".corgi-card");
  const face = document.createElement("canvas");
  face.width = face.height = 72;
  img.decode?.().catch(() => {}).finally(() => {
    const [x, y, w] = F.front_stand.rect;
    face.getContext("2d").drawImage(img, x, y, w, w * 0.86, 4, 6, 64, 64 * 0.86);
  });
  const ui = {
    onHint: null,
    render(n, total, justFound = false) {
      badge.replaceChildren(n ? face : "?");
      if (n) { const c = document.createElement("span"); c.className = "corgi-count"; c.textContent = `${n}/${total}`; badge.append(c); }
      badge.style.position = "relative";
      badge.setAttribute("aria-label", n ? `The corgi: ${n} of ${total} hiding spots found` : "Find the hidden corgi");
      card.querySelector(".q").textContent = n === total ? "Every spot found!" : n ? "You found it!" : "Can you find the corgi?";
      card.querySelector(".sub").textContent = n === total
        ? `You know all ${total} of its hiding spots. It's still out there.`
        : n ? `It has ${total} hiding spots. You've found ${n}. It's hiding again...` : "It's hiding somewhere in the park.";
      const paws = card.querySelector(".corgi-paws");
      paws.innerHTML = Array.from({ length: total }, (_, i) => `<span class="${i < n ? "on" : ""}"></span>`).join("");
      paws.setAttribute("aria-label", `${n} of ${total} hiding spots found`);
      if (justFound) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
    },
  };
  const open = (ui.open = (yes) => { card.hidden = !yes; badge.setAttribute("aria-expanded", String(yes)); });
  badge.addEventListener("click", (e) => { e.stopPropagation(); open(card.hidden); });
  card.addEventListener("click", (e) => e.stopPropagation());
  card.querySelector(".corgi-hint").addEventListener("click", () => { open(false); ui.onHint?.(); });
  addEventListener("click", () => open(false));
  addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
  return ui;
}
