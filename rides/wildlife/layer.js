// Wildlife: sea birds over the beach and the surf, sea animals in the painted water (rides/wildlife/RESULTS.md).
//
// Calm and occasional. Always there: three gulls wheeling over the beach and the surf, a sea otter floating on its
// back, a school of fish as a flickering shadow under the surface. Now and then: a gull lands on a stair post on the
// rail and takes off again, a line of brown pelicans skims along the outer surf (one sometimes folds up and dives
// for a fish), a seal or sea lion pops its head up, fish leap, a pod of dolphins passes, a humpback blows and dives
// far out, two gulls cross high over the town. Every pose is a closed-form function of the page's clock, so a
// frozen &t= gives the same frame.
//
// Time of day (ctx.sky, else getSky() from base/sky.js; &hour= fixes it): through dusk the gulls fly in one by one
// to roost (the two stair posts, the sand) and sleep there hunkered down until dawn, none flying at night; pelicans
// fly in daylight only, every pass in the morning and the golden hour, about one in two at midday; fish leap and
// the pair crosses by day only; dolphins and the whale come about a third as often at night; the otter sleeps still
// on its back at night; the seal comes up at any hour. rides/sky grades everything for the night, so nothing here
// is darkened.
//
// Sprites: atlas.webp/json (tools/build_atlas.py, from the generated sheets in gen/). Birds draw in the front slot
// (over everything), each group in a small canvas that travels with it (a box over the birds' whole range would be
// most of the painting); sea life draws in one canvas over its stretch of water in the rides slot. Flying birds
// cast a faint shadow straight down, offset by their height (base/camera.js).
//
// Params: &wl=gulls,lander,pelicans,pair,otter,fish,seal,dolphins,whale (only these), &wlDensity= device px per
// park px (default the screen's, kept between 1.5 and 2.5), &wlBoxes=1 outlines the canvases.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
const ease = (k) => k * k * (3 - 2 * k);
const hash = (n, s = 0) => { const v = Math.sin(n * 127.1 + s * 311.7 + 0.17) * 43758.5453; return v - Math.floor(v); };

// The n-th occurrence of an event that starts every period (with a jitter) and how long ago it started.
const OCC = { n: 0, tau: 0 };
function occur(t, period, offset, jitter, seed) {
  let n = Math.floor((t - offset) / period);
  let s = offset + n * period + jitter * hash(n, seed);
  if (t < s) { n -= 1; s = offset + n * period + jitter * hash(n, seed); }
  OCC.n = n; OCC.tau = t - s;
  return OCC;
}

// Where things are, measured on the painting (park px; rides/wildlife/RESULTS.md has the views).
const SEA_BOX = [1440, 1840, 1620, 600];          // the sea canvas: open water right of the title, beyond the surf
const POST = [1975.5, 1389];                       // the cap of the stair post on the rail, where a gull lands
const POST_H = 76;                                 // its height over the sand (its foot is 67 px lower on screen)
const OTTER = [1700, 1945];                        // between the first two painted crest lines
const SEALS = [[1560, 1915], [2330, 2190], [2750, 2310]];
const SCHOOL = [2150, 2190];                       // between the second and third crest lines
const DOLPHIN_TRACK = [[2990, 2362], [1600, 2040]];
const WHALE = [2560, 2330];
const FLOCK = [[1960, 1800], [2900, 2120]];        // the flock's middle, on the ground (the surf): it drifts between these
// The pelicans' line (the ground under them): the outer surf from the bottom right to the left edge, nearer the
// beach on the left so the line passes above the title.
const PELICAN_PATH = [[4120, 2610], [3600, 2440], [3200, 2318], [2800, 2210], [2400, 2112], [2000, 1995],
  [1600, 1790], [1300, 1682], [1000, 1624], [600, 1550], [200, 1420], [-220, 1270]];
const PAIR_PATH = [[-120, 830], [900, 760], [1900, 700], [2900, 610], [3980, 540]];

import { getSky } from "../../base/sky.js";

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const { params, slots, dir, camera } = ctx;
  const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Reduced motion: one still moment with only resting animals (the gull on its post, the otter eating).
  const want = reduced ? new Set(["lander", "otter"]) : params.has("wl") ? new Set(params.get("wl").split(",")) : null;
  const on = (k) => !want || want.has(k);
  const [meta, atlas] = await Promise.all([
    fetch(new URL("atlas.json", dir)).then((r) => r.json()),
    loadImage(new URL("atlas.webp", dir).href),
  ]);
  // The time of day (base/sky.js): the visitor's clock by default, &hour= fixes it.
  const sky = ctx.sky ?? getSky({ params });
  const SK = { hour: 13, dark: 0, alt: 50, morning: false };
  function readSky() { sky.tick?.(); SK.hour = sky.hour; SK.dark = sky.dark ?? 0; SK.alt = sky.sun?.alt ?? 50; SK.morning = !!sky.sun?.morning; }
  readSky();
  const D = meta.density;
  const F = {};
  for (const [name, f] of Object.entries(meta.frames)) {
    const [sx, sy, sw, sh] = f.rect;
    const [ax, ay] = f.anchor;
    // r: the farthest corner from the anchor (bounds that hold under any rotation).
    F[name] = { sx, sy, sw, sh, ax, ay, w: sw / D, h: sh / D, r: Math.hypot(Math.max(ax, sw - ax), Math.max(ay, sh - ay)) / D };
  }
  const { ex, ez, pitch } = camera;
  const CP = Math.cos(pitch), SP = Math.sin(pitch);
  const C0 = camera.W / 2, C1 = camera.H / 2;
  // Ground (x, z) and height -> park px, without allocating: results in P.
  const P = [0, 0];
  const project = (gx, gz, h) => { P[0] = C0 + gx * ex[0] + gz * ez[0]; P[1] = C1 + gx * ex[1] + gz * ez[1] - h * CP; return P; };
  const ground = (px, py) => camera.toGround([px, py], 0);

  // ---- Small offscreen pieces, made once: a soft shadow, a fish's shadow, dark silhouettes of the dolphin.
  function blob(w, h, rgb, a0) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, `rgba(${rgb},${a0})`);
    gr.addColorStop(0.55, `rgba(${rgb},${a0 * 0.75})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.setTransform(1, 0, 0, h / w, 0, 0);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    return c;
  }
  const SHADOW = blob(64, 64, "38,44,72", 1);        // drawn squashed to the ground
  const FISH = blob(32, 12, "20,62,110", 1);
  const GLINT = blob(16, 8, "246,244,236", 1);
  const SHOAL = blob(64, 64, "18,72,128", 1);
  function silhouette(name, rgb) {
    const f = F[name];
    const c = document.createElement("canvas");
    c.width = f.sw; c.height = f.sh;
    const g = c.getContext("2d");
    g.drawImage(atlas, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = `rgb(${rgb})`;
    g.fillRect(0, 0, f.sw, f.sh);
    return c;
  }
  // What shows of a body under the surface: its shape in a darker water blue (drawn faint).
  const SIL = {};
  for (const name of Object.keys(F)) if (/^(otter|seal|lion|fish|dolphin|whale\/(back|hump|fluke)|pelican\/(sit|swallow|dive))/.test(name)) SIL[name] = silhouette(name, "26,78,128");

  // ---- Canvases. A box: a canvas of fixed size in park px; travelling boxes are re-centred on what they draw
  // only when it nears their edge, so the page restyles them rarely.
  const boxes = [];
  const outline = params.get("wlBoxes") === "1";
  function box(slot, w, h, fixed = null) {
    const c = document.createElement("canvas");
    c.style.cssText = `left:0;top:0;width:${w}px;height:${h}px;visibility:hidden` + (outline ? ";outline:1px solid #f0f" : "");
    slots[slot].append(c);
    const b = { c, g: c.getContext("2d"), w, h, x: fixed ? fixed[0] : 0, y: fixed ? fixed[1] : 0, fixed: !!fixed, d: 1, shown: false, lastT: NaN,
      x0: 0, y0: 0, x1: 0, y1: 0, place: true };
    if (fixed) c.style.transform = `translate(${b.x}px,${b.y}px)`;
    boxes.push(b);
    return b;
  }
  function show(b, yes) { if (b.shown !== yes) { b.shown = yes; b.c.style.visibility = yes ? "visible" : "hidden"; } }

  // A pen draws in park px into a box, or (measuring) only grows the box's bounds.
  let pen = null, measuring = false, FADE = 1;
  function grow(x, y, r) {
    if (x - r < pen.x0) pen.x0 = x - r;
    if (y - r < pen.y0) pen.y0 = y - r;
    if (x + r > pen.x1) pen.x1 = x + r;
    if (y + r > pen.y1) pen.y1 = y + r;
  }
  // A sprite with its anchor at (x, y): k scale, flip (mirror; sprites face right), rot (radians), alpha.
  // ky squashes it vertically about its anchor (a gull hunkered down asleep).
  function sprite(name, x, y, k = 1, flip = false, rot = 0, alpha = 1, ky = 1) {
    const f = F[name];
    if (!f || alpha <= 0.004) return;
    if (measuring) { grow(x, y, f.r * k); return; }
    const g = pen.g, s = k / D;
    g.globalAlpha = alpha * FADE;
    if (!flip && !rot) { g.drawImage(atlas, f.sx, f.sy, f.sw, f.sh, x - f.ax * s, y - f.ay * s * ky, f.sw * s, f.sh * s * ky); return; }
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.drawImage(atlas, f.sx, f.sy, f.sw, f.sh, -f.ax * s, -f.ay * s, f.sw * s, f.sh * s);
    g.restore();
  }
  // The same, drawn only above (or, below = true, only under) the water line through (x, wy) with slope m.
  function waterClip(x, wy, m, r, below) {
    const g = pen.g;
    g.save();
    g.beginPath();
    const y0 = wy - m * r, y1 = wy + m * r, far = below ? 4 * r : -4 * r;
    g.moveTo(x - r, y0); g.lineTo(x + r, y1); g.lineTo(x + r, y1 + far); g.lineTo(x - r, y0 + far);
    g.closePath();
    g.clip();
  }
  function cut(name, x, y, wy, m, k = 1, flip = false, rot = 0, alpha = 1, under = 0) {
    const f = F[name];
    if (measuring) { grow(x, y, f.r * k); return; }
    const r = f.r * k + 4;
    waterClip(x, wy, m, r, false);
    sprite(name, x, y, k, flip, rot, alpha);
    pen.g.restore();
    if (under > 0.004) {
      waterClip(x, wy, m, r, true);
      if (SIL[name]) silhouetteAt(SIL[name], f, x, y, k, flip, rot, under);
      pen.g.restore();
    }
  }
  function silhouetteAt(sil, f, x, y, k, flip, rot, alpha) {
    if (measuring) { grow(x, y, f.r * k); return; }
    const g = pen.g, s = k / D;
    g.globalAlpha = alpha * FADE;
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.drawImage(sil, 0, 0, sil.width, sil.height, -f.ax * s, -f.ay * s, f.sw * s, f.sh * s);
    g.restore();
  }
  // A soft shadow on the ground, w park px across.
  function shadow(x, y, w, alpha) {
    if (alpha <= 0.004) return;
    if (measuring) { grow(x, y, w * 0.6); return; }
    const g = pen.g;
    g.globalAlpha = alpha * FADE;
    g.drawImage(SHADOW, x - w / 2, y - w * SP * 0.32, w, w * SP * 0.64);
  }
  // A ring of ripples on the water, r park px across its long axis: the painting's foam colour over a thin blue line.
  const DASH = [3.2, 2.4], NODASH = [];
  function ring(x, y, r, alpha) {
    if (alpha <= 0.004 || r <= 0.5) return;
    if (measuring) { grow(x, y, r + 2); return; }
    const g = pen.g;
    g.globalAlpha = alpha * FADE;
    g.lineWidth = 1.05;
    g.setLineDash(DASH);
    g.lineDashOffset = r * 1.3;
    g.strokeStyle = "rgba(44,112,168,0.55)";
    g.beginPath(); g.ellipse(x, y + 0.7, r, r * SP, 0, 0, TAU); g.stroke();
    g.strokeStyle = "#f4efe3";
    g.beginPath(); g.ellipse(x, y, r, r * SP, 0, 0, TAU); g.stroke();
    g.setLineDash(NODASH);
  }
  // The swell under a floating animal: a slow bob (screen px) that runs towards the shore, as the painted ripples do.
  const swellPhase = (x, y, t) => TAU * (t / 8.5 + (y - 0.2857 * x) / 300);
  const bob = (x, y, t) => 0.75 * Math.sin(swellPhase(x, y, t));

  // ---- Flying birds: pick the view from the heading, the pose from the wing cycle.
  // Headings: a = atan2(vy / sin(pitch), vx) of the ground track's screen velocity is the bird's heading in the
  // camera's own ground frame (0 = right, +90 deg = towards us). Side view within 35 deg of across, three-quarter
  // front or back views beyond, mirrored for leftward headings; a short cross-fade at each boundary.
  const SIDE_LIM = Math.sin((35 * Math.PI) / 180), XF = 0.035;
  const W4 = [0, 0, 0, 0];
  function viewWeights(vx, vy) {
    const n = Math.hypot(vx, vy / SP) || 1;
    const c = vx / n, s = vy / SP / n;
    const side = 1 - smooth(SIDE_LIM - XF, SIDE_LIM + XF, Math.abs(s));
    const right = smooth(-XF * 2, XF * 2, c);
    W4[0] = side * right; W4[1] = side * (1 - right); W4[2] = (1 - side) * right; W4[3] = (1 - side) * (1 - right);
    return s >= 0;
  }
  // Sprite names in full, so drawing builds no strings.
  const GULL_POSE = { side: ["gull/side_up", "gull/side_glide", "gull/side_down", "gull/side_glide"], front: ["gull/front_up", "gull/front_mid", "gull/front_down", "gull/front_mid"], back: ["gull/back_up", "gull/back_mid", "gull/back_down", "gull/back_mid"] };
  const GULL_GLIDE = { side: "gull/side_glide", front: "gull/front_glide", back: "gull/back_glide" };
  // beat: wing-cycle phase in [0, 1) while flapping, or -1 gliding. tilt: radians, nose up > 0.
  // bank: circling, so a side-on glide is the banked pose (the camera sees the tops of the tilted wings).
  function gull(x, y, vx, vy, beat, tilt = 0, bank = false) {
    const towards = viewWeights(vx, vy);
    const turn = towards ? "front" : "back";
    for (let i = 0; i < 4; i++) {
      const w = W4[i];
      if (w < 0.01) continue;
      const v = i < 2 ? "side" : turn, flip = i % 2 === 1;
      const pose = beat < 0 ? (bank && v === "side" ? "gull/side_bank" : GULL_GLIDE[v]) : GULL_POSE[v][Math.floor(beat * 4) % 4];
      sprite(pose, x, y, 1, flip, v === "side" ? (flip ? tilt : -tilt) : 0, w);
    }
  }
  const PEL_POSE = ["pelican/side_up", "pelican/side_glide", "pelican/side_down", "pelican/side_glide"];
  // Flap bursts: in slot j of length every s, with probability p, nb beats of len s starting at a hashed moment.
  function flapBeat(t, every, p, beats, len, seed) {
    for (let back = 0; back < 2; back++) {
      const j = Math.floor(t / every) - back;
      if (hash(j, seed) > p) continue;
      const nb = beats[0] + Math.floor(hash(j, seed + 1) * (beats[1] - beats[0] + 1));
      const t0 = j * every + hash(j, seed + 2) * (every - nb * len) * 0.9;
      const u = (t - t0) / len;
      if (u >= 0 && u < nb) return u - Math.floor(u);
    }
    return -1;
  }

  // ---- Paths: a polyline (screen px of the ground under the flyer) smoothed and sampled every 2 px of length.
  function track(points, step = 2) {
    const pts = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
      for (let s = 0; s < 24; s++) {
        const u = s / 24, u2 = u * u, u3 = u2 * u;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    pts.push(points[n - 1]);
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = len.at(-1), m = Math.floor(L / step) + 1;
    const xy = new Float32Array(m * 2);
    for (let i = 0, j = 0; i < m; i++) {
      const s = i * step;
      while (j < len.length - 2 && len[j + 1] < s) j++;
      const k = clamp((s - len[j]) / (len[j + 1] - len[j] || 1), 0, 1);
      xy[i * 2] = lerp(pts[j][0], pts[j + 1][0], k);
      xy[i * 2 + 1] = lerp(pts[j][1], pts[j + 1][1], k);
    }
    const T = { L, step, xy, x: 0, y: 0, dx: 1, dy: 0 };
    // Position and unit direction at length s (clamped to the ends), in T.x, T.y, T.dx, T.dy.
    T.at = (s) => {
      const f = clamp(s / step, 0, m - 1.001), i = Math.floor(f), k = f - i;
      const ax = xy[i * 2], ay = xy[i * 2 + 1], bx = xy[i * 2 + 2], by = xy[i * 2 + 3];
      T.x = lerp(ax, bx, k); T.y = lerp(ay, by, k);
      const l = Math.hypot(bx - ax, by - ay) || 1;
      T.dx = (bx - ax) / l; T.dy = (by - ay) / l;
      return T;
    };
    return T;
  }

  // ======== Gulls: three wheeling over the beach and the surf, one that lands on the stair post (front slot, a small
  // canvas each). By day as below; through dusk they drift in one by one to roost (the stair posts, the sand) and
  // sleep there through the night, hunkered down; at dawn they take off again.
  // A bird's state at a moment, filled by the day functions: vis, perched (a pose on a perch) or flying.
  const bird = () => ({ vis: false, perched: false, pose: "", flip: false, x: 0, y: 0, sx: 0, sy: 0, h: 0, vx: 1, vy: 0, beat: -1, tilt: 0, bank: false, sh: 0 });
  const A = bird(), A2 = bird();
  function drawBird(o) {
    if (!o.vis) return;
    if (o.perched) { if (o.sh > 0) shadow(o.x, o.y + 0.5, 9, o.sh); sprite(o.pose, o.x, o.y, 1, o.flip); return; }
    if (o.sh > 0) shadow(o.sx, o.sy, 22 + o.h * 0.06, o.sh);
    if (o.pose) sprite(o.pose, o.x, o.y, 1, o.flip);
    else gull(o.x, o.y, o.vx, o.vy, o.beat, o.tilt, o.bank);
  }

  const GA = ground(...FLOCK[0]), GB = ground(...FLOCK[1]);
  const GULLS = [
    { R: 150, T: 19, ph: 0.0, off: [0, 0], h: 100 },
    { R: 112, T: 16, ph: 2.4, off: [55, -30], h: 82 },
    { R: 188, T: 23.5, ph: 4.3, off: [-45, 35], h: 120 },
  ];
  function gullDay(i, t, o) {
    const m = 0.5 - 0.5 * Math.cos((TAU * t) / 280);
    const cx = lerp(GA[0], GB[0], m), cz = lerp(GA[2], GB[2], m);
    const q = GULLS[i];
    const a = q.ph + (TAU * t) / q.T;
    const gx = cx + q.off[0] + q.R * Math.cos(a), gz = cz + q.off[1] + q.R * Math.sin(a);
    const h = q.h + 14 * Math.sin((TAU * t) / 31 + i) + 7 * Math.sin((TAU * t) / 9.7 + 2 * i);
    project(gx, gz, 0);
    o.vis = true; o.perched = false; o.pose = "";
    o.sx = P[0]; o.sy = P[1]; o.h = h; o.x = P[0]; o.y = P[1] - h * CP;
    // Ground-track velocity (d/da of the circle times da/dt) on screen.
    const w = TAU / q.T, dgx = -q.R * Math.sin(a) * w, dgz = q.R * Math.cos(a) * w;
    o.vx = dgx * ex[0] + dgz * ez[0]; o.vy = dgx * ex[1] + dgz * ez[1];
    o.beat = flapBeat(t + i * 3.1, 6, 0.7, [2, 4], 0.36, 11 + i);
    o.tilt = clamp((((14 * TAU) / 31) * Math.cos((TAU * t) / 31 + i)) / 60, -0.12, 0.12);
    o.bank = true;
    o.sh = 0.15 * (1 - h / 420);
    return o;
  }

  const LAND = { period: 84, offset: 9 };
  // Approach: from below the bottom edge, over the sea, curving in to the post (screen px of the bird, height).
  const AP = [[2660, 2760 - 150 * CP], [2470, 2150], [2120, 1560], [POST[0], POST[1]]];
  const AWAY = [[POST[0], POST[1]], [2050, 1290], [2700, 980], [4020, 690]];
  const bez = (Q, u, out) => {
    const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    out[0] = a * Q[0][0] + b * Q[1][0] + c * Q[2][0] + d * Q[3][0];
    out[1] = a * Q[0][1] + b * Q[1][1] + c * Q[2][1] + d * Q[3][1];
    return out;
  };
  const B1 = [0, 0], B2 = [0, 0];
  const T_IN = 13, T_SIT = 38, T_OUT = 16;
  function landerDay(t, o) {
    const tau = occur(t, LAND.period, LAND.offset, 6, 3).tau;
    o.vis = true; o.perched = false; o.pose = ""; o.bank = false; o.tilt = 0.06;
    if (tau < T_IN) {
      // Coming in: ease out along the curve, descending from 150 to the post's height; flaps now and then, the
      // landing pose for the last second.
      const u = 1 - (1 - tau / T_IN) ** 1.6;
      bez(AP, u, B1); bez(AP, Math.min(1, u + 0.01), B2);
      const h = lerp(150, POST_H, ease(Math.min(1, tau / T_IN)));
      o.x = B1[0]; o.y = B1[1]; o.h = h; o.sx = B1[0]; o.sy = B1[1] + h * CP;
      o.sh = h < 150 ? 0.14 * (1 - smooth(T_IN - 1.1, T_IN - 0.2, tau)) * smooth(1.5, 4, tau) : 0;
      o.vx = B2[0] - B1[0]; o.vy = B2[1] - B1[1];
      if (tau > T_IN - 1.0) { o.pose = "gull/land"; o.flip = o.vx < 0; }
      else o.beat = tau < 1.3 || (tau > 6.5 && tau < 7.6) ? ((tau * 2.8) % 1) : -1;
      return o;
    }
    const s = tau - T_IN;
    if (s < T_SIT) {
      // On the post: faces left (it came in leftwards), turns round twice, calls twice, then crouches.
      o.perched = true; o.flip = s < 11 || s > 26; o.x = POST[0]; o.y = POST[1]; o.sh = 0.22;
      o.pose = "gull/stand";
      if ((s > 6 && s < 7.2) || (s > 21 && s < 22.3)) o.pose = "gull/call";
      if (s > T_SIT - 0.5) o.pose = "gull/crouch";
      return o;
    }
    const w = s - T_SIT;
    if (w < T_OUT) {
      // Away over the park to the top right, climbing, flapping hard at first.
      const u = clamp(w / T_OUT, 0, 1) ** 1.25;
      bez(AWAY, u, B1); bez(AWAY, Math.min(1, u + 0.01), B2);
      const h = lerp(POST_H, 240, ease(Math.min(1, w / T_OUT)));
      o.h = h; o.sx = B1[0]; o.sy = B1[1] + h * CP;
      o.sh = h < 150 ? 0.13 * smooth(0.3, 1.2, w) * (1 - smooth(100, 150, h)) : 0;
      o.vx = B2[0] - B1[0]; o.vy = B2[1] - B1[1];
      o.x = B1[0]; o.y = B1[1];
      if (w < 0.45) { o.pose = "gull/takeoff"; o.flip = false; o.y -= w * 6; }
      else o.beat = w < 3.2 || (w > 8 && w < 9.1) ? ((w * 3) % 1) : -1;
      o.tilt = 0.1;
      return o;
    }
    o.vis = false;
    return o;
  }

  // Roosts, and how dark it must be before each bird goes there (sky.dark: 0 day .. 1 night; with the real clock
  // about 0.35 just after sunset, 0.65 at the sun 5 deg under): one by one, over half an hour or so.
  const TR = 7; // seconds of flight to or from the roost
  const ROOSTS = [
    { th: 0.36, x: 2028, y: 1400, h: 76, face: true, day: (t, o) => gullDay(0, t, o) },   // the other stair post
    { th: 0.5, x: 1262, y: 1558, h: 0, face: true, day: (t, o) => gullDay(1, t, o) },   // the sand, by the beach's gulls
    { th: 0.64, x: 1286, y: 1566, h: 0, face: true, day: (t, o) => gullDay(2, t, o) },
    { th: 0.56, x: POST[0], y: POST[1], h: POST_H, face: true, day: landerDay },        // the lander keeps its post
  ];
  for (const r of ROOSTS) { r.roost = null; r.flipT = -1e9; }
  function roostUpdate(t) {
    for (const r of ROOSTS) {
      const want = r.roost ? SK.dark > r.th - 0.03 : SK.dark > r.th + 0.03;
      if (r.roost === null) r.roost = want;
      else if (want !== r.roost) { r.roost = want; r.flipT = t; }
    }
  }
  function drawRoosting(r) {
    // Asleep in the dark: hunkered down, still, all facing the same way.
    const ky = lerp(1, 0.86, smooth(0.62, 0.85, SK.dark));
    shadow(r.x, r.y + 0.5, 9, r.h ? 0.22 : 0.18);
    sprite("gull/stand", r.x, r.y, 1, r.face, 0, 1, ky);
  }
  function drawRoostBird(r, t) {
    const u = clamp((t - r.flipT) / TR, 0, 1);
    if (u >= 1) {
      if (r.roost) { drawRoosting(r); return true; }
      r.day(t, A);
      drawBird(A);
      return A.vis;
    }
    // On the way: from where it would be by day to its roost (or back), eased, flapping, landing at the end.
    r.day(t, A); r.day(t + 0.05, A2);
    if (A.perched && Math.abs(A.x - r.x) < 2 && Math.abs(A.y - r.y) < 2) {
      if (r.roost) drawRoosting(r); else drawBird(A);
      return true;
    }
    if (!A.vis || A.perched) { A.x = A2.x = AP[0][0]; A.y = A2.y = AP[0][1]; A.h = A2.h = 150; A.sy = A2.sy = AP[0][1] + 150 * CP; A.sx = A2.sx = AP[0][0]; }
    const k = r.roost ? ease(u) : 1 - ease(u);
    const k2 = r.roost ? ease(Math.min(1, u + 0.05 / TR)) : 1 - ease(Math.min(1, u + 0.05 / TR));
    const x = lerp(A.x, r.x, k), y = lerp(A.y, r.y, k);
    const vx = lerp(A2.x, r.x, k2) - x, vy = lerp(A2.y, r.y, k2) - y;
    const h = lerp(A.h, r.h, k), sx = lerp(A.sx, r.x, k), sy = lerp(A.sy, r.y + r.h * CP, k);
    shadow(sx, sy, 22, 0.14 * (1 - smooth(0.8, 0.95, k)) * (h < 150 ? 1 : 0));
    if (r.roost && u > 0.87) sprite("gull/land", x, y, 1, vx < 0);
    else if (!r.roost && u < 0.08) sprite("gull/takeoff", x, y, 1, vx < 0);
    else gull(x, y, vx, vy, (t * 2.8) % 1, 0, false);
    return true;
  }
  const gullBoxes = ROOSTS.map(() => box("front", 170, 220));

  // ======== The brown pelicans' line along the outer surf; one may dive (front slot).
  const pelBox = box("front", 420, 240);
  const diveBox = box("front", 170, 180);
  const PEL = track(PELICAN_PATH);
  const PEL_RUN = { period: 125, offset: 4, speed: 92, gap: 64 };
  const PEL_LAT = [0, 8, -6, 10, -9], PEL_H = [19, 15, 22, 17, 24];
  const passDur = (n) => (PEL.L + PEL_RUN.gap * n + 80) / PEL_RUN.speed;
  // Pelican i's place on the path at pass time tau: arc length along the path in its direction of travel.
  function pelAt(tau, i, rtl) {
    const s = tau * PEL_RUN.speed - i * PEL_RUN.gap - 40;
    PEL.at(rtl ? s : PEL.L - s);
    if (!rtl) { PEL.dx = -PEL.dx; PEL.dy = -PEL.dy; }
    return s;
  }
  function pelican(x, y, dx, dy, beat, alpha = 1) {
    const flip = dx < 0;
    const rot = 0.4 * Math.atan2(flip ? -dy : dy, flip ? -dx : dx);
    sprite(beat < 0 ? "pelican/side_glide" : PEL_POSE[Math.floor(beat * 4) % 4], x, y, 1, flip, rot, alpha);
  }
  // Pelicans fly in daylight only, most often in the morning and the golden hour (every pass then; at midday about
  // one in two).
  function pelicanPass(n) {
    if (SK.alt < 1) return false;
    return hash(n, 10) < ((SK.morning && SK.alt < 30) || (!SK.morning && SK.alt < 16) ? 1 : 0.45);
  }
  function drawPelicans(t) {
    const { n, tau } = occur(t, PEL_RUN.period, PEL_RUN.offset, 14, 5);
    if (!pelicanPass(n)) return false;
    const count = hash(n, 6) < 0.5 ? 5 : 4, rtl = hash(n, 7) < 0.6;
    if (tau > passDur(count)) return false;
    const diver = hash(n, 8) < 0.65 ? count - 1 : -1;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < count; i++) {
        if (i === diver && tau > diveStart(rtl, i)) continue;
        const s = pelAt(tau, i, rtl);
        if (s < -60 || s > PEL.L + 60) continue;
        const gx = PEL.x - PEL.dy * PEL_LAT[i], gy = PEL.y + PEL.dx * PEL_LAT[i] * 0.5;
        const h = pelH(t, i);
        if (pass === 0) { shadow(gx, gy, 34, 0.12); continue; }
        pelican(gx, gy - h * CP, PEL.dx, PEL.dy, pelBeat(tau, i));
      }
    }
    return true;
  }
  const pelH = (t, i) => PEL_H[i] + 5 * Math.sin((TAU * t) / 4.6 + i * 0.9);
  // The leader flaps three slow beats every 6.5 s; the beat passes down the line.
  function pelBeat(tau, i) {
    const lt = tau - i * 0.38, j = Math.floor(lt / 6.5), u = (lt - j * 6.5 - 1.5 * hash(j, 9)) / 0.62;
    return u >= 0 && u < 3 ? u % 1 : -1;
  }
  // The dive: the last pelican breaks off where the line passes x ~2620 (or ~2060 going right), climbs out over
  // the sea, folds and plunges, sits on the water a while, swallows, and flies on after the others.
  const DIVE_X = { rtl: 2620, ltr: 2060 };
  const diveArc = { rtl: 0, ltr: 0 };
  for (const dirn of ["rtl", "ltr"]) {
    let bd = 1e9;
    for (let s = 0; s < PEL.L; s += 4) { PEL.at(s); const d = Math.abs(PEL.x - DIVE_X[dirn]); if (d < bd) { bd = d; diveArc[dirn] = s; } }
  }
  // Pass time when pelican i reaches its dive point (progress along its direction of travel).
  const diveStart = (rtl, i) => ((rtl ? diveArc.rtl : PEL.L - diveArc.ltr) + i * PEL_RUN.gap + 40) / PEL_RUN.speed;
  // Its timeline (s after leaving the line).
  const DV = { tip: 2.4, plunge: 2.8, hit: 3.18, gone: 3.32, up: 4.7, lift: 11.7, fly: 12.6, end: 40 };
  const DV_OUT = 95, DV_H = 66; // how far out to sea it dives (screen px down) and how high it climbs
  function drawDiver(t) {
    const { n, tau } = occur(t, PEL_RUN.period, PEL_RUN.offset, 14, 5);
    if (hash(n, 8) >= 0.65 || !pelicanPass(n)) return false;
    const count = hash(n, 6) < 0.5 ? 5 : 4, rtl = hash(n, 7) < 0.6, i = count - 1;
    const t0 = diveStart(rtl, i), d = tau - t0;
    if (d < 0 || d > DV.end) return false;
    // Where it leaves the line, and the dive spot further along and out to sea.
    const arc = diveArc[rtl ? "rtl" : "ltr"], fwd = rtl ? 1 : -1;
    PEL.at(arc);
    const dirx = PEL.dx * fwd, diry = PEL.dy * fwd;
    const bx = PEL.x - PEL.dy * PEL_LAT[i], by = PEL.y + PEL.dx * PEL_LAT[i] * 0.5;
    const run = DV.tip * PEL_RUN.speed * 0.8;
    const spotX = bx + dirx * run, spotY = by + diry * run + DV_OUT;
    const flip = dirx < 0;
    if (d < DV.tip) {
      // Out over the sea and up, gliding, then two beats.
      const u = d / DV.tip, e = ease(u);
      const gx = bx + dirx * run * u, gy = by + diry * run * u + DV_OUT * e;
      const h = lerp(pelH(t, i), DV_H, e);
      shadow(gx, gy, 34, 0.12);
      pelican(gx, gy - h * CP, dirx, diry + (DV_OUT / run) * 1.5 * u * (1 - u) * 4, u > 0.35 && u < 0.75 ? ((u - 0.35) / 0.2) % 1 : -1);
      return true;
    }
    if (d < DV.gone) {
      // Tip over, then plunge: the body's middle drops from its height to under the water, cut at the surface.
      shadow(spotX, spotY, 30, 0.12 * (1 - smooth(DV.hit - 0.1, DV.hit, d)));
      if (d < DV.plunge) {
        const u = (d - DV.tip) / (DV.plunge - DV.tip);
        sprite("pelican/dive_tip", spotX - dirx * 8 * (1 - u), spotY - (DV_H + 4 * Math.sin(Math.PI * u)) * CP, 1, flip);
      } else {
        const u = (d - DV.plunge) / (DV.gone - DV.plunge);
        const y = lerp(spotY - DV_H * CP, spotY + 16, u ** 1.5);
        cut(u < 0.35 ? "pelican/dive_plunge" : "pelican/dive_arrow", spotX, y, spotY + 0.5, 0, 1, flip, 0, 1, 0);
      }
    }
    // The splash and its rings, from the moment the beak hits the water.
    const since = d - DV.hit;
    if (since >= 0) {
      if (since < 1.0) sprite("splash/column", spotX, spotY + 1, 0.8 + 0.7 * smooth(0, 0.3, since), false, 0, 1 - smooth(0.3, 1.0, since));
      if (since < 1.5) sprite("splash/crown", spotX, spotY + 1, 0.9 + 0.5 * since, false, 0, 1 - smooth(0.35, 1.5, since));
      for (let r = 0; r < 2; r++) {
        const ts = since - r * 0.55;
        if (ts > 0 && ts < 3.2) ring(spotX, spotY, 7 + ts * 9, 0.75 * (1 - ts / 3.2));
      }
    }
    if (d < DV.up) return true;
    if (d < DV.lift) {
      // Up again, sitting on the water: bobbing, swallowing in the middle.
      const s = d - DV.up;
      const pose = s > 2.6 && s < 4.0 ? "pelican/swallow" : "pelican/sit";
      const wy = spotY + bob(spotX, spotY, t);
      if (s < 0.6) ring(spotX, spotY, 6 + s * 16, 0.6 * (1 - s / 0.6));
      cut(pose, spotX, wy + 3 + 4 * (1 - smooth(0, 0.4, s)), wy + 0.6, 0, 0.92, flip, 0, 1, 0.25);
      ring(spotX, wy + 0.5, 13, 0.32);
      return true;
    }
    if (d < DV.fly) {
      // Lifting off: wings up, feet patting the water.
      const u = (d - DV.lift) / (DV.fly - DV.lift);
      const x = spotX + dirx * 18 * u, y = spotY + diry * 18 * u;
      shadow(x, y, 30, 0.12 * u);
      if (u < 0.6) sprite("splash/drops", spotX + dirx * 8 * u, spotY + 1, 0.5, false, 0, 0.8 * (1 - u / 0.6));
      sprite("pelican/takeoff", x, y - 12 * ease(u) * CP, 1, flip);
      return true;
    }
    // After the others: back along the coast, flapping, climbing to the line's height, drifting back in to the surf.
    const f = d - DV.fly;
    PEL.at(arc + fwd * (run + 18 + f * PEL_RUN.speed * 1.12));
    const gx = PEL.x, gy = PEL.y + (DV_OUT + diry * 0) * (1 - smooth(0, 6, f));
    if (gx < -80 || gx > 3920) return false;
    const h = lerp(12, pelH(t, i), smooth(0, 3, f));
    shadow(gx, gy, 34, 0.12);
    const beat = f < 2.4 || (f % 6 > 4.5 && f % 6 < 5.7) ? ((f / 0.62) % 1) : -1;
    pelican(gx, gy - h * CP, PEL.dx * fwd, PEL.dy * fwd, beat);
    return true;
  }

  // ======== Two gulls crossing high over the town (front slot).
  const pairBox = box("front", 170, 120);
  const PAIR = track(PAIR_PATH);
  function drawPair(t) {
    if (SK.dark > 0.25) return false; // gulls are roosting
    const { n, tau } = occur(t, 96, 38, 18, 13);
    const ltr = hash(n, 14) < 0.5, speed = 125, dur = (PAIR.L + 160) / speed;
    if (tau > dur) return false;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 2; i++) {
        const s = tau * speed - i * 46 - 60;
        if (s < -60 || s > PAIR.L + 60) continue;
        PAIR.at(ltr ? s : PAIR.L - s);
        const dx = ltr ? PAIR.dx : -PAIR.dx, dy = ltr ? PAIR.dy : -PAIR.dy;
        const h = 250 + 18 * Math.sin(tau * 0.6 + i * 2);
        const x = PAIR.x + (i ? -dy * 22 : 0), y = PAIR.y + (i ? dx * 10 : 0) + 6 * Math.sin(tau * 0.45 + i);
        if (pass === 0) continue; // too high over the town for a shadow to belong to it
        gull(x, y, dx, dy, flapBeat(tau + i * 0.7, 3.2, 0.85, [3, 5], 0.33, 17 + i), 0.04);
      }
    }
    return true;
  }

  // ======== The sea (rides slot, one canvas): the fish school and its leaps, the otter, seals, dolphins, the whale.
  const seaBox = box("rides", SEA_BOX[2], SEA_BOX[3], SEA_BOX);
  const SCH = [];
  for (let i = 0; i < 26; i++) SCH.push({ u: (hash(i, 40) - 0.5) * 2, v: (hash(i, 41) - 0.5) * 2, f: 0.6 + hash(i, 42), ph: hash(i, 43) * TAU });
  const school = { x: 0, y: 0, dx: 1, dy: 0 };
  function schoolAt(t) {
    const a = (TAU * t) / 170, b = (TAU * t) / 113 + 0.7;
    school.x = SCHOOL[0] + 150 * Math.sin(a);
    school.y = SCHOOL[1] + 34 * Math.sin(b);
    const vx = 150 * Math.cos(a) / 170, vy = (34 * Math.cos(b)) / 113;
    const l = Math.hypot(vx, vy) || 1;
    school.dx = vx / l; school.dy = vy / l;
    return school;
  }
  function drawSchool(t) {
    const S = schoolAt(t);
    const g = pen.g;
    const ang = Math.atan2(S.dy, S.dx);
    if (measuring) { grow(S.x, S.y, 50); return; }
    // The shoal's shadow: a soft darker cloud that slowly changes shape, then the fish in it.
    g.globalAlpha = 0.16 + 0.04 * Math.sin(t * 0.9);
    const cw = 78 + 10 * Math.sin(t * 0.5), chh = (30 + 6 * Math.sin(t * 0.43 + 1)) * SP * 1.6;
    g.save();
    g.translate(S.x, S.y);
    g.rotate(Math.atan2(S.dy * SP, S.dx));
    g.drawImage(SHOAL, -cw / 2, -chh / 2, cw, chh);
    g.restore();
    for (let i = 0; i < SCH.length; i++) {
      const q = SCH[i];
      // A loose oval cloud along the heading that breathes; each fish wobbles, and now and then its side flashes.
      const breathe = 1 + 0.18 * Math.sin(t * 0.7 + q.ph);
      const u = q.u * 30 * breathe + 3 * Math.sin(t * q.f * 1.7 + q.ph), v = q.v * 12 * breathe + 2 * Math.sin(t * q.f + q.ph * 2);
      const x = S.x + S.dx * u - S.dy * v, y = S.y + (S.dy * u + S.dx * v) * SP;
      const wob = Math.sin(t * q.f * 3 + q.ph);
      g.globalAlpha = 0.2 + 0.12 * Math.sin(t * q.f * 2.3 + q.ph);
      g.save();
      g.translate(x, y);
      g.rotate(ang + 0.25 * wob);
      g.drawImage(FISH, -4.5, -1.4, 9, 2.8);
      const flash = Math.sin(t * q.f * 1.3 + q.ph * 3);
      if (flash > 0.93) {
        g.globalAlpha = 0.8 * (flash - 0.93) / 0.07;
        g.drawImage(GLINT, -2.2, -0.9, 4.4, 1.8);
      }
      g.restore();
    }
  }
  // Leaps: now and then one to three fish jump out of the school, with a little splash out and in.
  function drawLeaps(t) {
    if (SK.dark > 0.4) return; // by day only
    const { n, tau } = occur(t, 21, 3, 8, 20);
    const count = 1 + Math.floor(hash(n, 21) * 2.6);
    for (let j = 0; j < count; j++) {
      const lt = tau - j * (0.35 + 0.3 * hash(n * 7 + j, 22));
      if (lt < -0.1 || lt > 2.2) continue;
      const S = schoolAt(t - lt);
      const side = hash(n * 5 + j, 23) - 0.5;
      const x0 = S.x - S.dy * side * 30 + S.dx * (hash(n * 3 + j, 24) - 0.3) * 30;
      const y0 = S.y + S.dx * side * 30 * SP;
      const dirx = S.dx >= 0 ? 1 : -1, len = 22, dur = 0.7;
      const u = lt / dur;
      if (u >= 0 && u <= 1) {
        const x = x0 + dirx * len * u, y = y0 + S.dy * len * u * SP - 16 * CP * Math.sin(Math.PI * u);
        const pose = u < 0.36 ? "fish/up" : u < 0.64 ? "fish/level" : "fish/down";
        cut(pose, x, y, y0 + S.dy * len * u * SP + 1.2, 0, 0.5, dirx < 0, 0, 1, 0.25);
      }
      if (u >= 0 && u < 0.6) sprite("splash/crown", x0, y0 + 1, 0.34 + 0.2 * u, false, 0, 0.9 * (1 - u / 0.6));
      const ue = u - 1;
      const xe = x0 + dirx * len, ye = y0 + S.dy * len * SP;
      if (ue >= 0 && ue < 0.7) sprite("splash/crown", xe, ye + 1, 0.4 + 0.2 * ue, false, 0, 0.95 * (1 - ue / 0.7));
      if (ue >= 0) ring(xe, ye, 4 + ue * 9, 0.7 * (1 - ue / 1.6));
    }
  }
  // The otter: floats and drifts; eats, grooms, naps, now and then rolls over, dives and comes up a little away.
  const OT = { period: 100 };
  function otterSpot(k, out) {
    out[0] = OTTER[0] + (hash(k, 30) - 0.5) * 70;
    out[1] = OTTER[1] + (hash(k, 31) - 0.5) * 24;
    return out;
  }
  const O1 = [0, 0], O2 = [0, 0];
  // Pose weights over the 100 s cycle, cross-faded over 0.4 s: eat (82-26, wrapping), groom (26-38), nap (38-64),
  // roll over and swim (64-68); dive (68-70), under water (70-80), up again swimming (80-82).
  const OS = { x: 0, wy: 0, faceL: false, spin: 0 };
  function otterPose(name, alpha, sink = 2.4, rot = OS.spin) {
    if (alpha > 0.01) cut(name, OS.x, OS.wy + sink, OS.wy + 0.6, 0, 1, OS.faceL, rot, alpha, 0.2 * alpha);
  }
  const win = (s, a0, a1) => smooth(a0 - 0.2, a0 + 0.2, s) * (1 - smooth(a1 - 0.2, a1 + 0.2, s));
  function drawOtterDay(t) {
    const k = Math.floor(t / OT.period), s = t - k * OT.period;
    otterSpot(k, O1); otterSpot(k + 1, O2);
    const moved = smooth(70, 80, s);
    const x = lerp(O1[0], O2[0], moved) + 14 * Math.sin((TAU * t) / 61), y = lerp(O1[1], O2[1], moved) + 4 * Math.sin((TAU * t) / 47 + 1);
    const wy = y + bob(x, y, t);
    const spin = 0.1 * Math.sin((TAU * t) / 37);
    const faceL = hash(s >= 75 ? k + 1 : k, 32) < 0.5; // it turns only while it is under
    OS.x = x; OS.wy = wy; OS.faceL = faceL; OS.spin = spin;
    if (s < 68) {
      ring(x, wy + 1.2, 15, 0.3);
      otterPose("otter/shell", 1 - smooth(25.8, 26.2, s));
      otterPose("otter/groom", win(s, 26, 38));
      otterPose("otter/sleep", win(s, 38, 64));
      otterPose("otter/swim", smooth(63.8, 64.2, s), 2.4, 0);
      return true;
    }
    if (s < 70) {
      const u = (s - 68) / 2;
      cut("otter/dive", x, wy + 3 + 14 * u * u, wy + 0.6, 0, 1, faceL, 0, 1, 0.15);
      ring(x, wy + 1, 6 + u * 14, 0.6 * (1 - u * 0.3));
      if (u > 0.5) sprite("splash/drops", x, wy + 1, 0.45, false, 0, 0.8 * (1 - u));
      return true;
    }
    if (s < 80) {
      const u = (s - 70) / 10;
      if (u < 0.3) ring(x, wy + 1, 20 + u * 60, 0.5 * (1 - u / 0.3));
      return true;
    }
    // Up again: rises swimming, then turns onto its back to eat.
    const u = smooth(80, 80.8, s);
    if (s < 80.8) ring(x, wy + 1, 6 + (s - 80) * 16, 0.6);
    ring(x, wy + 1.2, 15, 0.3 * u);
    otterPose("otter/swim", 1 - smooth(81.8, 82.2, s), 2.4 + 8 * (1 - u), 0);
    otterPose("otter/shell", smooth(81.8, 82.2, s));
    return true;
  }
  // At night it sleeps on its back, still, where it is most of the day; the switch is a 2.5 s cross-fade.
  const ON = { night: null, flipT: -1e9 };
  function otterUpdate(t) {
    const want = ON.night ? SK.dark > 0.55 : SK.dark > 0.65;
    if (ON.night === null) ON.night = want;
    else if (want !== ON.night) { ON.night = want; ON.flipT = t; }
  }
  function drawOtterNight(t) {
    const x = OTTER[0] + 6 * Math.sin((TAU * t) / 140), y = OTTER[1] + 2 * Math.sin((TAU * t) / 97);
    const wy = y + 0.6 * bob(x, y, t);
    ring(x, wy + 1.2, 15, 0.25);
    cut("otter/sleep", x, wy + 2.4, wy + 0.6, 0, 1, false, 0, 1, 0.2);
  }
  function drawOtter(t) {
    const u = clamp((t - ON.flipT) / 2.5, 0, 1), w = ON.night ? ease(u) : 1 - ease(u);
    if (w < 1) { FADE = 1 - w; drawOtterDay(t); }
    if (w > 0) { FADE = w; drawOtterNight(t); }
    FADE = 1;
    return true;
  }
  // Seal and sea lion heads: up out of the water for a few seconds, look around, down again.
  function drawSeal(t) {
    const { n, tau } = occur(t, 50, 9, 14, 50);
    if (tau > 11.5) return false;
    const spot = SEALS[Math.floor(hash(n, 51) * SEALS.length)];
    const lion = hash(n, 52) < 0.3, faceL = hash(n, 53) < 0.5;
    const x = spot[0] + (hash(n, 54) - 0.5) * 40, y0 = spot[1] + (hash(n, 55) - 0.5) * 16;
    const wy = y0 + bob(x, y0, t);
    const rise = smooth(0, 1.1, tau) * (1 - smooth(8.8, 10.0, tau));
    let name;
    if (lion) name = tau > 3.4 && tau < 4.8 ? "lion/bark" : "lion/right";
    else name = tau < 3 ? "seal/front" : tau < 5.6 ? "seal/right" : tau < 7.0 ? "seal/up" : "seal/front";
    const f = F[name];
    const k = lion ? 0.66 : 0.6;
    if (rise > 0.003) cut(name, x, wy + 0.5 + (1 - rise) * f.h * k, wy + 0.4, 0, k, faceL && name !== "seal/front", 0, 1, 0.2);
    if (rise > 0.05) ring(x, wy + 0.3, f.w * k * 0.42, 0.55 * rise);
    for (let r = 0; r < 2; r++) {
      const ts = tau - (r ? 9.2 : 0.15);
      if (ts > 0 && ts < 2.4) ring(x, wy, 7 + ts * 10, 0.6 * (1 - ts / 2.4));
    }
    return true;
  }
  // Dolphins: a pod of two to four passes along the outer water, each arcing out every few seconds.
  const DT = track(DOLPHIN_TRACK, 2);
  const DOL = { period: 118, offset: 47, speed: 62, every: 2.7, arc: 1.15, len: 54, hgt: 16 };
  const DOL_OFF = [[0, 0, 0], [-58, 15, 0.85], [-104, -11, 1.6], [-150, 6, 0.4]];
  function drawDolphins(t) {
    const { n, tau } = occur(t, DOL.period, DOL.offset, 20, 60);
    if (SK.dark > 0.5 && hash(n, 64) > 0.3) return false; // fewer passes at night
    const count = 2 + Math.floor(hash(n, 61) * 2.99), rtl = hash(n, 62) < 0.55;
    if (tau > (DT.L + 230) / DOL.speed) return false;
    for (let i = 0; i < count; i++) {
      const along = DOL_OFF[i][0], lat = DOL_OFF[i][1], ph = DOL_OFF[i][2];
      const s = tau * DOL.speed + along - 30;
      if (s < 0 || s > DT.L) continue;
      DT.at(rtl ? s : DT.L - s);
      const dx = rtl ? DT.dx : -DT.dx, dy = rtl ? DT.dy : -DT.dy;
      const fade = smooth(0, 60, s) * (1 - smooth(DT.L - 60, DT.L, s));
      const gx = DT.x, gy = DT.y + lat + bob(DT.x, DT.y, t) * 0.5;
      const flip = dx < 0, m = dy / dx;
      // The body's angle along the track (sprites face right; mirrored ones turn the other way).
      const base = Math.atan2(flip ? -dy : dy, flip ? -dx : dx);
      // The arc: u in [0, 1] while out of the water; it travels on along the track meanwhile.
      const ct = tau + ph + 0.37 * i, j = Math.floor(ct / DOL.every), u = (ct - j * DOL.every) / DOL.arc;
      const out = hash(n * 13 + i * 7 + j, 63) < 0.88; // now and then one stays under
      const run = DOL.arc * DOL.speed;
      if (out && u >= 0 && u <= 1) {
        const ay = gy - DOL.hgt * CP * Math.sin(Math.PI * u);
        const pose = u < 0.34 ? "dolphin/rise" : u < 0.68 ? "dolphin/top" : "dolphin/dive";
        const tilt = base + lerp(-0.12, 0.12, u) * (flip ? -1 : 1);
        cut(pose, gx, ay, gy + 1, m, 1, flip, tilt, fade, 0.16 * fade);
        const back = u * run; // where it came out, behind along the track
        if (u < 0.3) sprite("splash/dolphin", gx - dx * back, gy - dy * back + 1, 0.55, false, 0, 0.85 * (1 - u / 0.3) * fade);
        if (u > 0.8) sprite("splash/dolphin", gx + dx * 12, gy + dy * 12 + 1, 0.7, false, 0, 0.9 * smooth(0.8, 0.93, u) * fade);
        continue;
      }
      // Under the surface: a faint dark shape, and the ring where it last went in.
      silhouetteAt(SIL["dolphin/swim"], F["dolphin/swim"], gx, gy + 2, 0.95, flip, base, 0.085 * fade);
      const ue = u - 1;
      if (out && ue > 0 && ue < 1.4) {
        const back = ue * run + 8;
        ring(gx - dx * back, gy - dy * back, 6 + ue * 10, 0.6 * (1 - ue / 1.4) * fade);
      }
    }
    return true;
  }
  const WS = { x: 0, wy: 0, faceL: false, tau: 0 };
  function whaleBack(name, a0, a1, k) {
    const f = F[name];
    const up = smooth(a0, a0 + 1.2, WS.tau) * (1 - smooth(a1 - 1.4, a1, WS.tau));
    if (up > 0.003) cut(name, WS.x, WS.wy + 1 + (1 - up) * f.h * k * 0.9, WS.wy + 0.8, 0, k, !WS.faceL, 0, 1, 0.12); // drawn facing left
    return up;
  }
  // The humpback: two breaths far out (a spout and its back), then the dive: its tail up and gone, a calm patch.
  function drawWhale(t) {
    const { n, tau } = occur(t, 172, 70, 30, 70);
    if (SK.dark > 0.5 && hash(n, 74) > 0.35) return false; // rarer at night
    if (tau > 30) return false;
    const x0 = WHALE[0] + (hash(n, 71) - 0.5) * 220, y0 = WHALE[1] + (hash(n, 72) - 0.5) * 30;
    const faceL = hash(n, 73) < 0.5, dirx = faceL ? -1 : 1;
    const x = x0 + dirx * tau * 1.6, wy = y0 + bob(x0, y0, t) * 0.6;
    WS.x = x; WS.wy = wy; WS.faceL = faceL; WS.tau = tau;
    // Spouts at 0 and 9 s, each rising for 0.6 s and drifting off over 3 s.
    for (let r = 0; r < 2; r++) {
      const s = tau - r * 9;
      if (s > 0 && s < 3.6) {
        const k = 1.05 * (0.45 + 0.55 * smooth(0, 0.6, s)) * (1 + 0.15 * smooth(0.6, 3.6, s));
        sprite("whale/spout", x + dirx * 26, wy - 9 - 4 * s, k, false, 0, (1 - smooth(1.0, 3.6, s)) * 0.95);
      }
    }
    const u1 = whaleBack("whale/back", 0.1, 6.5, 2.0);
    const u2 = whaleBack("whale/hump", 9.1, 14.2, 2.0);
    if (u1 > 0.1 || u2 > 0.1) ring(x, wy + 1, 58, 0.25 * Math.max(u1, u2));
    // The fluke: up at 14, gone by 18.
    const fs = tau - 14;
    if (fs > 0 && fs < 4.5) {
      const f = F["whale/fluke"], k = 1.15;
      const up = smooth(0, 1.4, fs) * (1 - smooth(2.6, 4.3, fs));
      cut("whale/fluke", x - dirx * 34, wy + 1 + (1 - up) * f.h * k, wy + 0.8, 0, k, faceL, 0, 1, 0.1);
      if (fs > 2.4) sprite("splash/dolphin", x - dirx * 34, wy + 1, 1.1, false, 0, 0.8 * smooth(2.4, 3.2, fs) * (1 - smooth(3.6, 4.5, fs)));
    }
    // The flat patch it leaves (a "footprint"), fading.
    const ps = tau - 16.5;
    if (ps > 0) sprite("foam/whale", x - dirx * 30, wy + 2, 1.5, false, 0, 0.55 * smooth(0, 1.2, ps) * (1 - smooth(5, 13.5, ps)));
    return true;
  }

  // ---- Frame.
  const groups = [
    { key: "gulls", box: gullBoxes[0], draw: (t) => drawRoostBird(ROOSTS[0], t) },
    { key: "gulls", box: gullBoxes[1], draw: (t) => drawRoostBird(ROOSTS[1], t) },
    { key: "gulls", box: gullBoxes[2], draw: (t) => drawRoostBird(ROOSTS[2], t) },
    { key: "lander", box: gullBoxes[3], draw: (t) => drawRoostBird(ROOSTS[3], t) },
    { key: "pelicans", box: pelBox, draw: drawPelicans },
    { key: "pelicans", box: diveBox, draw: drawDiver },
    { key: "pair", box: pairBox, draw: drawPair },
  ].filter((g) => on(g.key));
  const SEA_PARTS = [["fish", drawSchool], ["fish", drawLeaps], ["otter", drawOtter], ["seal", drawSeal], ["dolphins", drawDolphins], ["whale", drawWhale]].filter(([k]) => on(k));

  function begin(b) {
    const g = b.g, d = b.d;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, b.c.width, b.c.height);
    g.setTransform(d, 0, 0, d, -b.x * d, -b.y * d);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 1;
  }
  let clipped = 0;
  function frame(t) {
    readSky();
    roostUpdate(t);
    otterUpdate(t);
    for (let gi = 0; gi < groups.length; gi++) {
      const grp = groups[gi], b = grp.box;
      // Measure, re-centre the box if what it draws nears its edge, then draw.
      pen = b; measuring = true;
      b.x0 = b.y0 = Infinity; b.x1 = b.y1 = -Infinity;
      const live = grp.draw(t) !== false && b.x1 > b.x0;
      measuring = false;
      if (!live) { show(b, false); continue; }
      const m = 6;
      if (b.place || b.x0 < b.x + m || b.y0 < b.y + m || b.x1 > b.x + b.w - m || b.y1 > b.y + b.h - m) {
        b.x = Math.round((b.x0 + b.x1) / 2 - b.w / 2);
        b.y = Math.round((b.y0 + b.y1) / 2 - b.h / 2);
        b.place = false;
        b.c.style.transform = `translate(${b.x}px,${b.y}px)`;
        if (b.x1 - b.x0 > b.w || b.y1 - b.y0 > b.h) clipped++;
      }
      begin(b);
      grp.draw(t);
      show(b, true);
    }
    if (SEA_PARTS.length) {
      pen = seaBox;
      begin(seaBox);
      let any = false;
      for (let i = 0; i < SEA_PARTS.length; i++) if (SEA_PARTS[i][1](t) !== false) any = true;
      show(seaBox, any);
    }
    pen = null;
  }

  const fixedT = reduced ? 31 : null; // reduced motion: one calm moment (the gull on its post, the otter eating)
  let lastT = NaN, lastH = NaN, density = 0;
  function resize(scale) {
    const want = Number(params.get("wlDensity")) || clamp(scale * (devicePixelRatio || 1), 1.5, 2.5);
    if (Math.abs(want - density) < 1e-3) return;
    density = want;
    for (const b of boxes) { b.d = want; b.c.width = Math.ceil(b.w * want); b.c.height = Math.ceil(b.h * want); b.place = true; }
    lastT = NaN;
  }
  resize(ctx.scale());
  window.__wildlife = { frame, boxes, SK, ROOSTS, density: () => density, clipped: () => clipped, F, PEL, DT, occur, diveStart, DV };
  return {
    resize,
    update(t) {
      const tt = fixedT ?? t;
      readSky();
      if (tt === lastT && SK.hour === lastH) return; // a frozen &t= still follows the hour (the badge can scrub it)
      lastT = tt; lastH = SK.hour;
      frame(tt);
    },
  };
}
