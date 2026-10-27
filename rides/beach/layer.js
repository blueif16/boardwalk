// The beach on a summer day: a resident population that has set up camp on the sand below the promenade, drawn in
// one WebGL canvas in the rides slot (the crowd's canvas stays above it). Umbrellas, towels, chairs, a lifeguard
// tower, a volleyball game, sandcastle kids, sunbathers who turn over, sit up and go for a swim, swimmers bobbing with
// the waves, a body-boarder riding one in, waders running from the foam (in step with rides/sea's swash), a dog
// playing fetch, a kite, walkers on the wet sand and a few gulls. Every pose is a closed-form function of the master
// clock, so a frozen &t= gives the same frame. Set-up: scene.json (measured on the painting), lines.json (the painted
// shoreline), atlas.webp/json (tools/build.py). See RESULTS.md.
//
// The day: the hour comes from base/sky.js (ctx.sky, else getSky(); &hour= fixes it). Camps arrive through the morning
// and pack up around sunset (umbrellas closing), each at its own time; the game, the lifeguard, swimmers and kids keep
// beach hours; early walkers, a jogger and a dog walker at dawn; a couple watching the sunset; at night an almost empty
// beach, a couple strolling at the waterline and a small bonfire (its glow in the lights slot when the page has one).
//
// Params: &beachDensity= device px per park px (default: the screen's, kept between 1.5 and 2.5), &beachFps= frames a
// second (default 30; 0 for every screen frame), &swash= as the sea.
import { getSky } from "../../base/sky.js";

const K = (38 * 3840) / 3904 / 30; // the crowd's size factor (tests/park-crowd/crowd.js): park px per stage unit
const TAU = Math.PI * 2;
const WALK = ["walk0", "stand", "walk1", "stand"];
// rides/sea/layer.js: seconds per wave, park px along the shore per wave, the shore's slope, and the top of its
// canvas (the shader measures positions from there).
const SEA_T = 8.5, SEA_L = 1400, SEA_SLOPE = 0.2857, SEA_Y0 = 1187;

function rng(seed) {
  let a = seed >>> 0 || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  return f;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
// The sea's swash in closed form (rides/sea's shader): the wave's phase at a point, and the foam's run-up (in units
// of the wave's reach, up the sand) for a phase f in [0, 1): a quick uprush, a slow backwash, a short rest.
function hash1(n) { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
function vnoise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
const SL = Math.hypot(1, SEA_SLOPE), SHORE = [1 / SL, SEA_SLOPE / SL];
const shoreU = (x, y) => x * SHORE[0] + (y - SEA_Y0) * SHORE[1];
function wavePhase(x, y, t) { const u = shoreU(x, y); return t / SEA_T - u / SEA_L + 0.45 * vnoise(u / 610); }
function swash(f) {
  if (f < 0.28) { const k = f / 0.28; return -0.3 + 1.3 * (1 - (1 - k) * (1 - k)); }
  return 1 - 1.3 * smooth(clamp((f - 0.28) / 0.6, 0, 1));
}
// When the k-th wave's uprush starts at a point (its phase crosses k).
function uprushTime(x, y, k) { const u = shoreU(x, y); return (k + u / SEA_L - 0.45 * vnoise(u / 610)) * SEA_T; }

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec4 aCol;
uniform vec2 uSize;
out vec2 vUv; out vec4 vCol;
void main() { vUv = aUv; vCol = aCol; gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv; in vec4 vCol;
out vec4 color;
void main() { color = texture(uTex, vUv) * vCol; }`;

// One sprite batch: quads with four corners, a uv rect and a colour, drawn in one call.
function createBatch(canvas, image, max = 3000) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const F = 8; // floats per vertex: position, uv, premultiplied colour
  const data = new Float32Array(max * 4 * F);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  const idx = new Uint16Array(max * 6);
  for (let q = 0, i = 0; q < max; q++, i += 6) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], i);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  for (const [name, size, off] of [["aPos", 2, 0], ["aUv", 2, 2], ["aCol", 4, 4]]) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, F * 4, off * 4);
  }
  gl.bindVertexArray(null);
  const uSize = gl.getUniformLocation(prog, "uSize");
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  let n = 0;
  function vert(o, x, y, u, v, r, g, b, a) {
    data[o] = x; data[o + 1] = y; data[o + 2] = u; data[o + 3] = v;
    data[o + 4] = r * a; data[o + 5] = g * a; data[o + 6] = b * a; data[o + 7] = a;
  }
  return {
    // Corners top-left, top-right, bottom-right, bottom-left; uv (u0, v0) at top-left and (u1, v1) at bottom-right.
    quad(x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, r, g, b, a) {
      if (n >= max) return;
      const o = n * 4 * F;
      vert(o, x0, y0, u0, v0, r, g, b, a);
      vert(o + F, x1, y1, u1, v0, r, g, b, a);
      vert(o + 2 * F, x2, y2, u1, v1, r, g, b, a);
      vert(o + 3 * F, x3, y3, u0, v1, r, g, b, a);
      n++;
    },
    begin() { n = 0; },
    end(w, h) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!n) return 0;
      gl.useProgram(prog);
      gl.uniform2f(uSize, w, h);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 4 * F);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
      return n;
    },
    get quads() { return n; },
  };
}

const load = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const { camera, params, slots } = ctx;
  const dir = ctx.dir ?? new URL("./", import.meta.url);
  const at = (p) => new URL(p, dir).href;
  const [scene, lines, meta, walk, image] = await Promise.all([
    fetch(at("scene.json")).then((r) => r.json()),
    fetch(at("lines.json")).then((r) => r.json()),
    fetch(at("atlas.json")).then((r) => r.json()),
    fetch(new URL("../../tests/park-crowd/walk.json", dir)).then((r) => r.json()).catch(() => null),
    load(at("atlas.webp")),
  ]);
  const [RX, RY, RW, RH] = scene.rect;
  const sky = ctx.sky ?? getSky({ params });
  // The hour and the sun this frame; presence over the day: 0 outside from..to, ramping in and out over `ramp` hours.
  const day = { h: 13, rise: 6.5, set: 19, dark: 0 };
  const inHours = (from, to, ramp = 0.15) => clamp(Math.min((day.h - from) / ramp, (to - day.h) / ramp), 0, 1);
  let A = 1; // the alpha of the system being placed (its presence now)

  // Frames: w, h, ax, ay in park px (characters at the crowd's size), uv in the atlas.
  const [AW, AH] = meta.size;
  const FR = {};
  for (const [name, f] of Object.entries(meta.frames)) {
    const [x, y, w, h] = f.rect, unit = (name.includes("/") ? K : 1) / f.scale;
    FR[name] = { name, u0: x / AW, v0: y / AH, u1: (x + w) / AW, v1: (y + h) / AH, w: w * unit, h: h * unit, ax: f.anchor[0] * unit, ay: f.anchor[1] * unit, rect: f.rect };
  }
  const fr = (look, pose) => FR[`${look}/${pose}`] || FR[`${look}/front_stand`];
  const has = (look, pose) => !!FR[`${look}/${pose}`];

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `left:${RX}px;top:${RY}px;width:${RW}px;height:${RH}px`;
  slots.rides.append(canvas);
  const batch = createBatch(canvas, image);

  const line = (arr, x) => {
    const i = clamp((x - lines.x0) / lines.dx, 0, arr.length - 1.001), i0 = Math.floor(i);
    return lerp(arr[i0], arr[i0 + 1], i - i0);
  };
  const seaY = (x) => line(lines.sea, x);
  const G = (x, y) => camera.toGround([x, y], 0);
  const P = (g, h = 0) => camera.toPixel([g[0], h, g[2]]);
  // The shore's normal at x, pointing up the sand (the direction the sea's foam runs).
  const shoreN = (x) => { const s = (seaY(x + 30) - seaY(x - 30)) / 60, l = Math.hypot(1, s); return [s / l, -1 / l]; };

  // ---- drawing: three passes. Ground (in order): towels, rope lines, shadows, ripples. Items (sorted by the y
  // where each meets the sand): figures and upright props. Air (in order): the kite and flying gulls. ----
  const pool = [], items = [];
  let nItems = 0;
  function item(y) {
    let r = pool[nItems];
    if (!r) r = pool[nItems] = { y: 0, f: null, x: 0, py: 0, s: 1, flip: false, a: 1, clip: Infinity, rot: 0, quad: null, cutTop: 0 };
    nItems++;
    r.y = y; r.quad = null; r.cutTop = 0; r.sx = 1; r.a = A;
    return r;
  }
  const byY = (a, b) => a.y - b.y;
  function sprite(f, x, y, s = 1, flip = false, a = 1, clip = Infinity, rot = 0, sx = 1) {
    if (!f || a <= 0) return;
    const w = f.w * s * sx, h = f.h * s;
    const ax = (flip ? f.w - f.ax : f.ax) * s * sx, ay = f.ay * s;
    const ox = x - RX, oy = y - RY;
    const x0 = ox - ax, y0 = oy - ay, x1 = x0 + w;
    let y1 = y0 + h, v1 = f.v1;
    const u0 = flip ? f.u1 : f.u0, u1 = flip ? f.u0 : f.u1;
    if (clip < Infinity) {
      const cy = clip - RY;
      if (cy <= y0) return;
      if (cy < y1) { v1 = f.v0 + ((f.v1 - f.v0) * (cy - y0)) / h; y1 = cy; }
    }
    if (rot) {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const rx = (px, py) => ox + (px - ox) * c - (py - oy) * sn, ry = (px, py) => oy + (px - ox) * sn + (py - oy) * c;
      batch.quad(rx(x0, y0), ry(x0, y0), rx(x1, y0), ry(x1, y0), rx(x1, y1), ry(x1, y1), rx(x0, y1), ry(x0, y1), u0, f.v0, u1, v1, 1, 1, 1, a);
      return;
    }
    batch.quad(x0, y0, x1, y0, x1, y1, x0, y1, u0, f.v0, u1, v1, 1, 1, 1, a);
  }
  // Queue a sprite for the sorted pass. sortY: the y where it stands on the sand (default: its anchor).
  function put(f, x, y, s = 1, flip = false, a = 1, clip = Infinity, rot = 0, sortY = y) {
    const r = item(sortY);
    r.f = f; r.x = x; r.py = y; r.s = s; r.flip = flip; r.a = a * A; r.clip = clip; r.rot = rot; r.sx = 1;
    return r;
  }
  const WHITE = FR.white, wu = (WHITE.u0 + WHITE.u1) / 2, wv = (WHITE.v0 + WHITE.v1) / 2;
  function segment(xa, ya, xb, yb, width, r, g, b, a) {
    const dx = xb - xa, dy = yb - ya, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * width * 0.5, ny = (dx / l) * width * 0.5;
    batch.quad(xa + nx - RX, ya + ny - RY, xb + nx - RX, yb + ny - RY, xb - nx - RX, yb - ny - RY, xa - nx - RX, ya - ny - RY, wu, wv, wu, wv, r, g, b, a * A);
  }
  // A flat thing on the sand (a towel): its top-down texture laid on the ground plane, centred at (x, y), ground
  // size lx by lz, its long side turned rot radians from the ground's x axis (the promenade's direction).
  function groundQuad(f, x, y, lx, lz, rot, a = 1) {
    const g = G(x, y), c = Math.cos(rot), s = Math.sin(rot);
    const ux = (c * lx) / 2, uz = (s * lx) / 2, vx = (-s * lz) / 2, vz = (c * lz) / 2;
    const p0 = P([g[0] - ux - vx, 0, g[2] - uz - vz]), p1 = P([g[0] + ux - vx, 0, g[2] + uz - vz]);
    const p2 = P([g[0] + ux + vx, 0, g[2] + uz + vz]), p3 = P([g[0] - ux + vx, 0, g[2] - uz + vz]);
    batch.quad(p0[0] - RX, p0[1] - RY, p1[0] - RX, p1[1] - RY, p2[0] - RX, p2[1] - RY, p3[0] - RX, p3[1] - RY, f.u0, f.v0, f.u1, f.v1, 1, 1, 1, a * A);
  }
  // The screen angle of the ground's x axis turned by rot (lying figures follow their towel).
  const screenAngle = (rot) => { const d = camera.project([Math.cos(rot), 0, Math.sin(rot)]); return Math.atan2(d[1], d[0]); };
  const SHADOW = FR.shadow, RIPPLE = FR.ripple, SPLASH = FR.splash;
  const shadow = (x, y, w, a = 1) => sprite(SHADOW, x, y, w / SHADOW.w, false, a * A);
  // Contact shadows of the figures, gathered as (x, y, width) while they are placed, drawn before them.
  const shadows = [];
  const contact = (x, y, w) => { shadows.push(x, y, w, A); };
  // Ripples round the swimmers, drawn with the shadows (under every figure).
  const ripples = [];
  // A figure in the water: its feet sunk `sink` px below the surface at (x, y) and clipped there, a ripple round it.
  function inWater(f, x, y, sink, ripple = 1, flip = false) {
    put(f, x, y + sink, 1, flip, 1, y + 0.6, 0, y);
    if (ripple > 0) ripples.push(x, y + 0.5, (f.w * 0.9 * (0.6 + 0.4 * Math.min(1, ripple))) / RIPPLE.w, 0.9 * Math.min(1, ripple) * A);
  }
  // The crowd's four-step walk for a distance walked (park px); running uses the beach sheet's run frame.
  function walkFrame(look, view, dist, running = false) {
    const k = Math.floor(dist / (running ? 9 : 6.5)) % 4;
    if (running && has(look, "run")) return k % 2 === 0 ? fr(look, "run") : fr(look, `side_${k === 1 ? "walk0" : "walk1"}`);
    return fr(look, `${view}_${WALK[k]}`);
  }
  const hop = (dist, stride) => 0.5 - 0.5 * Math.cos((TAU * dist) / stride);
  // View and mirror for a move by (dx, dy) on screen.
  const facing = (dx, dy) => (Math.abs(dx) > Math.abs(dy) * 1.1 ? ["side", dx < 0] : [dy > 0 ? "front" : "back", false]);
  // A looped timeline of segments { t0, t1, ... } starting at 0; seg(t) -> [segment, seconds into it].
  function looped(segs) {
    const span = segs.at(-1).t1;
    let last = 0;
    return (t) => {
      const u = ((t % span) + span) % span;
      if (segs[last].t0 > u || segs[last].t1 <= u) last = 0;
      while (last < segs.length - 1 && segs[last].t1 <= u) last++;
      return [segs[last], u - segs[last].t0];
    };
  }

  const systems = [];
  const occluders = [];
  // An upright prop the crowd may pass behind (rides/RIDERS.md "Depth"): its footprint in park px, the y of its base,
  // and its alpha as the mask, cropped from the atlas.
  function occluder(f, x, y, s = 1, st = null) {
    occluders.push({ rect: [x - f.ax * s, y - f.ay * s, f.w * s, f.h * s], sortY: y, mask: image, crop: f.rect, name: f.name, st });
  }
  // Only what stands on the sand now (camps come and go with the hour); the same objects every frame.
  const standing = [];
  const occludersNow = () => { standing.length = 0; for (const o of occluders) if (!o.st || o.st.vis > 0.5) standing.push(o); return standing; };

  // ---- the camps' things: towels, umbrellas, chairs, bags, boards ----
  // Each camp's day: it arrives in the morning (a few at sunrise) and packs up around sunset, the umbrella closing
  // first; seeded per camp, so camps come and go one by one.
  const OPEN = { vis: 1, open: 1, packing: false };
  const towels = [], statics = [];
  scene.camps.forEach((c, i) => {
    const st = (c.state = { vis: 0, open: 0, packing: false });
    const early = !!c.early;
    c.when = () => {
      const arrive = early ? day.rise - 0.2 + (i % 3) * 0.1 : 8.6 + ((i * 0.37 + 0.13) % 1) * 2.6;
      const leave = day.set - 1.3 + ((i * 0.61 + 0.29) % 1) * 1.5;
      st.vis = inHours(arrive, leave, 0.12);
      st.open = Math.min(smooth(clamp((day.h - arrive - 0.08) / 0.15, 0, 1)), 1 - smooth(clamp((day.h - (leave - 0.4)) / 0.25, 0, 1)));
      st.packing = day.h > leave - 0.45;
      return st.vis;
    };
    for (const [name, x, y, deg] of c.towels || []) towels.push({ f: FR[name], x, y, rot: (deg * Math.PI) / 180, st });
    if (c.umbrella) {
      const [name, x, y] = c.umbrella;
      statics.push({ f: FR[name], x, y, shade: true, st });
      occluder(FR[name], x, y, 1, st);
    }
    for (const [name, x, y] of c.chairs || []) { statics.push({ f: FR[name], x, y, st }); occluder(FR[name], x, y, 1, st); }
    for (const [name, x, y] of c.things || []) {
      statics.push({ f: FR[name], x, y, small: true, st });
      if (name.startsWith("surf")) occluder(FR[name], x, y, 1, st);
    }
  });
  // The crowd's towels are out in beach hours.
  const crowdDay = { vis: 1, open: 1, packing: false };
  // The crowd's own beach spots (tests/park-crowd/walk.json): a towel where its visitors sit, a little castle where
  // its kids dig. Modes as tests/characters/sim.js gives them (by order), unless walk.json names them.
  const MODES = ["towel", "towel", "stand", "castle", "towel", "stand"];
  const TOWELS = ["towel_red", "towel_teal", "towel_sun", "towel_dots", "towel_mint", "towel_wave", "towel_peach", "towel_rainbow"];
  if (walk) {
    walk.places.filter((p) => p.kind === "beach").forEach((p, i) => {
      const mode = p.mode ?? MODES[i % 6], [x, y] = p.slots[0], R = rng(i * 31 + 7);
      if (mode === "towel") towels.push({ f: FR[TOWELS[(i * 5) % TOWELS.length]], x, y: y - 3, rot: R.range(-0.12, 0.12), st: crowdDay });
      else if (mode === "castle") statics.push({ f: FR.castle_small, x: x + 16, y: y - 4, st: OPEN });
    });
  }
  systems.push({
    vis() { for (const c of scene.camps) c.when(); crowdDay.vis = inHours(8.3, day.set + 0.4, 0.3); return 1; },
    ground() {
      for (const t of towels) if (t.st.vis > 0) groundQuad(t.f, t.x, t.y, 58, 28, t.rot, t.st.vis);
      for (const s of statics) {
        if (s.st.vis <= 0) continue;
        if (s.shade) shadow(s.x + 5, s.y + 5, s.f.w * (0.35 + 0.6 * s.st.open), 0.8 * s.st.vis);
        else shadow(s.x + 1, s.y, s.f.w * (s.small ? 0.95 : 0.85), 0.6 * s.st.vis);
      }
    },
    // A closing umbrella narrows round its pole.
    items() { for (const s of statics) if (s.st.vis > 0) put(s.f, s.x, s.y, 1, false, s.st.vis).sx = s.shade ? 0.3 + 0.7 * s.st.open : 1; },
  });

  // ---- camp residents: sunbathers, readers, chair sitters, and some who go for a swim ----
  for (const c of scene.camps) for (const p of c.people || []) systems.push(resident(p, c));
  function resident(p, camp) {
    const R = rng(p.seed * 7919 + 13), look = p.look;
    const towel = p.towel != null ? camp.towels[p.towel] : null, chair = p.chair != null ? camp.chairs[p.chair] : null;
    const home = towel ? [towel[1], towel[2]] : [chair[1], chair[2]];
    const ang = screenAngle(towel ? (towel[3] * Math.PI) / 180 : 0);
    const headRight = R() < 0.5;
    const segs = [];
    let t = 0;
    const add = (dur, pose, extra) => { segs.push({ t0: t, t1: t + dur, pose, ...extra }); t += dur; };
    // A swim: walk down to the water below the camp, wade in, swim a while, come back and sit.
    function swim() {
      const ex = home[0] + R.range(-30, 50), ey = seaY(ex) + 3;
      const sx = ex + R.range(-25, 25), sy = ey + R.range(40, 60);
      const d1 = Math.hypot(ex - home[0], ey - home[1]);
      add(1.2, "stand");
      add(d1 / 21, "walk", { a: home, b: [ex, ey] });
      add(6, "wade", { a: [ex, ey], b: [sx, sy] });
      add(R.range(40, 75), "swim", { a: [sx, sy] });
      add(6, "wade", { a: [sx, sy], b: [ex, ey] });
      add(d1 / 19, "walk", { a: [ex, ey], b: home });
      add(1, "stand");
      add(R.range(12, 20), "sit");
    }
    while (t < 1800) {
      if (p.script === "chair") {
        add(R.range(30, 70), "sit");
        if (R() < 0.35 && has(look, "wave")) add(2.4, "wave");
        add(R.range(8, 20), "sit");
      } else if (p.script === "reader") {
        add(R.range(50, 100), "lie_read");
        add(0.45, "turn", { from: "lie_read", to: "lie_nap" });
        add(R.range(25, 50), "lie_nap");
        add(R.range(10, 18), "sit_lean");
        if (R() < 0.5) add(R.range(5, 8), "sunscreen");
      } else {
        add(R.range(45, 95), "lie_back");
        add(0.45, "turn", { from: "lie_back", to: "lie_nap" });
        add(R.range(30, 60), R() < 0.4 ? "lie_read" : "lie_nap");
        add(R.range(10, 20), "sit_lean");
        add(R.range(5, 9), "sunscreen");
        if (p.script === "swimmer") swim();
        else add(R.range(5, 12), "sit_lean");
      }
    }
    const seg = looped(segs), phase = R.range(0, t);
    const lying = (pose, lift = 0) => {
      contact(home[0], home[1] + 2, 34);
      put(fr(look, pose), home[0], home[1] + 2 - lift, 1, headRight, 1, Infinity, ang, home[1] + 1);
    };
    return {
      vis: () => camp.state.vis,
      items(tt) {
        if (camp.state.packing) { contact(home[0], home[1] + 3, 20); put(fr(look, "front_stand"), home[0] + (chair ? 10 : 0), home[1] + 3); return; }
        const [s, k] = seg(tt + phase);
        switch (s.pose) {
          case "lie_back": case "lie_nap": case "lie_read": return lying(s.pose);
          case "turn": { const q = k / (s.t1 - s.t0); return lying(q < 0.5 ? s.from : s.to, 3.5 * Math.sin(q * Math.PI)); }
          case "sit": case "sit_lean": case "sunscreen": case "wave": {
            const f = s.pose === "sit" ? fr(look, "front_act") : fr(look, s.pose);
            const rub = s.pose === "sunscreen" ? 0.35 * Math.sin(tt * 9) : 0;
            const y = chair ? home[1] - 6 : home[1] + 3;
            if (!chair) contact(home[0], home[1] + 3, 24);
            put(f, home[0], y + rub, 1, false, 1, Infinity, 0, home[1] + (chair ? 0.5 : 1));
            return;
          }
          case "stand": contact(home[0], home[1] + 3, 20); put(fr(look, "front_stand"), home[0], home[1] + 3); return;
          case "walk": {
            const q = k / (s.t1 - s.t0), x = lerp(s.a[0], s.b[0], q), y = lerp(s.a[1], s.b[1], q);
            const dist = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) * q;
            const [view, flip] = facing(s.b[0] - s.a[0], s.b[1] - s.a[1]);
            contact(x, y, 20);
            put(walkFrame(look, view, dist), x, y - 1.3 * hop(dist, 13), 1, flip);
            return;
          }
          case "wade": {
            const q = smooth(k / (s.t1 - s.t0)), x = lerp(s.a[0], s.b[0], q), y = lerp(s.a[1], s.b[1], q);
            const sink = clamp((y - seaY(x)) * 0.45, 0, 21);
            const [view, flip] = facing(s.b[0] - s.a[0], s.b[1] - s.a[1]);
            inWater(walkFrame(look, view, Math.hypot(x - s.a[0], y - s.a[1])), x, y, sink, sink / 10, flip);
            return;
          }
          case "swim": {
            const x = s.a[0] + 6 * Math.sin(k / 9 + p.seed), y = s.a[1] + 2 * Math.sin(k / 13);
            const bob = 1.6 * Math.sin(TAU * (wavePhase(x, y, tt) + 0.2));
            const f = k % 24 > 21.5 && has(look, "wave") ? fr(look, "wave") : fr(look, `front_${WALK[Math.floor(tt * 1.4) % 4]}`);
            inWater(f, x, y + bob, 13, 1);
          }
        }
      },
    };
  }

  // ---- the lifeguard tower; the guard stands behind its railing, looks along the beach, waves now and then ----
  if (scene.tower) {
    const { at: [tx, ty], guard } = scene.tower;
    const TF = FR.tower;
    // On the tower sprite (tools/build.py): the platform's front edge and the railing's top, park px above its foot.
    const deck = [tx - 12, ty - 39], rail = ty - 51;
    occluder(TF, tx, ty);
    const R = rng(77), segs = [];
    let t = 0;
    const add = (d, pose, flip = false) => { segs.push({ t0: t, t1: t + d, pose, flip }); t += d; };
    while (t < 900) {
      add(R.range(8, 18), "front_stand");
      add(R.range(3, 6), "side_stand", R() < 0.5);
      if (R() < 0.4) add(2.6, "wave");
      if (R() < 0.3) add(R.range(4, 7), "side_stand", R() < 0.5);
    }
    const seg = looped(segs);
    systems.push({
      ground() { shadow(tx + 8, ty + 2, TF.w * 1.05, 0.75); },
      items(tt) {
        const [s] = seg(tt);
        put(TF, tx, ty);
        const on = inHours(9.9, Math.min(19, day.set + 0.3), 0.1);
        if (on > 0) put(fr(guard, s.pose), deck[0], deck[1], 1, s.flip, on, rail, 0, ty + 0.5);
      },
    });
  }

  // ---- sandcastle kids: one pats the castle, one fetches water in the bucket ----
  if (scene.castle) {
    const c = scene.castle, [cx, cy] = c.at;
    const BIG = FR.castle_big, SMALL = FR.castle_small, BUCKET = FR.bucket;
    occluder(BIG, cx, cy);
    const spot = [c.bucket[0] + 7, c.bucket[1] + 3];
    const water = [spot[0] + 26, seaY(spot[0] + 26) + 2];
    const d = Math.hypot(water[0] - spot[0], water[1] - spot[1]);
    const segs = [];
    let t = 0;
    for (const [what, dur] of [["stand", 2.5], ["go", d / 18], ["fill", 2.8], ["back", d / 12], ["pour", 2.2], ["cheer", 1.1], ["stand", 4]]) { segs.push({ t0: t, t1: t + dur, what }); t += dur; }
    const seg = looped(segs);
    systems.push({
      ground() { shadow(cx + 2, cy, BIG.w * 0.95, 0.65); shadow(c.small[0], c.small[1], SMALL.w * 0.95, 0.55); },
      items(tt) {
        put(BIG, cx, cy);
        put(SMALL, c.small[0], c.small[1]);
        // The builder kneels west of the castle, facing it, patting; now and then sits back to look. Kids keep beach
        // hours; the castles stay.
        A = inHours(10.2, day.set - 1, 0.15);
        if (A <= 0) return;
        const bx = cx - 21, by = cy + 3;
        contact(bx, by, 18);
        if (tt % 17 < 13) put(fr(c.builder, "kneel"), bx, by - 0.6 * Math.abs(Math.sin(tt * 4)), 1, false, 1, Infinity, 0, by);
        else put(fr(c.builder, "front_act"), bx, by);
        // The carrier.
        const [s, k] = seg(tt), q = k / (s.t1 - s.t0), look = c.carrier;
        let x = spot[0], y = spot[1], f = fr(look, "front_stand"), flip = false, bucket = [c.bucket[0], c.bucket[1]], lift = 0;
        if (s.what === "go" || s.what === "back") {
          const a = s.what === "go" ? spot : water, b = s.what === "go" ? water : spot;
          x = lerp(a[0], b[0], q); y = lerp(a[1], b[1], q);
          const dist = d * q, [view, fl] = facing(b[0] - a[0], b[1] - a[1]);
          f = walkFrame(look, view, dist); flip = fl;
          lift = 1.2 * hop(dist, 13);
          bucket = [x + (view === "back" ? -6 : 6), y - 4 - lift];
        } else if (s.what === "fill") {
          x = water[0]; y = water[1]; f = fr(look, "kneel");
          bucket = [x + 10, y + 1];
          if (q > 0.2 && q < 0.7) sprite(SPLASH, x + 10, y + 1, 0.6, false, 0.8);
        } else if (s.what === "pour") {
          bucket = [x - 8, y - 9 + 3 * q];
        } else if (s.what === "cheer") {
          f = fr(look, "cheer"); lift = 2.5 * Math.sin(q * Math.PI);
        }
        contact(x, y, 16);
        put(f, x, y - lift, 1, flip);
        put(BUCKET, bucket[0], bucket[1], 1, false, 1, Infinity, 0, s.what === "go" || s.what === "back" ? y + 0.2 : bucket[1]);
      },
    });
  }

  // ---- swimmers beyond the foam, rising and falling with the passing waves ----
  for (const s of scene.swimmers || []) {
    const R = rng(s.seed), [x0, y0] = s.at, ph = R(), RING = s.ring ? FR[s.ring] : null;
    systems.push({
      vis: () => inHours(9.5 + ph * 0.8, day.set - 0.3 - ph * 0.6, 0.15), // nobody swims at night
      items(tt) {
        const x = x0 + 9 * Math.sin((tt / (40 + 20 * ph)) * TAU + ph * 6), y = y0 + 3 * Math.sin((tt / 57) * TAU + ph * 3);
        const bob = 1.7 * Math.sin(TAU * (wavePhase(x, y, tt) + 0.2));
        const waving = (tt + ph * 40) % 34 > 31.4 && has(s.look, "wave");
        const f = waving ? fr(s.look, "wave") : fr(s.look, `front_${WALK[Math.floor(tt * 1.2 + ph * 4) % 4]}`);
        if (!RING) return inWater(f, x, y + bob, 13, 1);
        // In a ring: the ring, the swimmer sunk into it, then the ring's near half again in front.
        const ry = y + bob;
        put(RING, x, ry, 0.9, false, 1, Infinity, 0, ry - 0.2);
        put(f, x, ry + 13, 1, false, 1, ry + 1, 0, ry - 0.1);
        put(RING, x, ry, 0.9, false, 1, Infinity, 0, ry + 0.1).cutTop = 0.5;
        ripples.push(x, ry + 3, (RING.w * 1.05) / RIPPLE.w, 0.6 * A);
      },
    });
  }

  // ---- a body-boarder: waits beyond the break, rides a wave in, walks back out with the board ----
  if (scene.boarder) {
    const b = scene.boarder, BOARD = FR.bodyboard, look = b.look;
    const [fx, fy] = b.from, [tx, ty] = b.to, dx = tx - fx, dy = ty - fy;
    const tilt = Math.atan2(dy, dx) - Math.PI; // turns the lying sprite (head to the left) to face where it rides
    const RIDE = 3.6, STAND = 1.6, BACK = 12, EVERY = 4;
    systems.push({
      vis: () => inHours(day.rise + 0.25, day.set + 0.1, 0.15), // a dawn-to-dusk surfer
      items(tt) {
        // Every few waves, the ride ends as that wave's uprush starts at `to`.
        const k = Math.floor(tt / SEA_T / EVERY) * EVERY + 1;
        let end = uprushTime(tx, ty, k);
        if (end - RIDE > tt) end = uprushTime(tx, ty, k - EVERY);
        const since = tt - (end - RIDE);
        const lie = fr(look, "lie_nap");
        if (since >= 0 && since < RIDE) {
          const q = since / RIDE, e = 0.6 * smooth(q) + 0.4 * q, x = fx + dx * e, y = fy + dy * e;
          put(BOARD, x, y, 1, false, 1, Infinity, tilt, y - 0.1);
          put(lie, x, y - 1.5, 1, false, 1, Infinity, tilt, y);
          sprite(SPLASH, x - dx * 0.08, y - dy * 0.08 + 4, 0.8, false, 0.85);
          ripples.push(x, y + 2, 1.4, 0.6 * A);
        } else if (since >= RIDE && since < RIDE + STAND) {
          inWater(fr(look, "front_stand"), tx, ty, 9, 1);
          put(BOARD, tx + 10, ty + 1, 0.9, false, 1, Infinity, 1.2, ty + 0.2);
        } else if (since >= RIDE + STAND && since < RIDE + STAND + BACK) {
          const q = smooth((since - RIDE - STAND) / BACK), x = tx - dx * q, y = ty - dy * q;
          inWater(walkFrame(look, "back", q * 60), x, y, 9 + 11 * q, 1);
          put(BOARD, x + 10, y + 1, 0.9, false, 1, Infinity, 1.2, y + 0.2);
        } else {
          const bob = 1.5 * Math.sin(TAU * (wavePhase(fx, fy, tt) + 0.15));
          put(BOARD, fx, fy + bob, 1, false, 1, Infinity, tilt, fy - 0.1);
          put(lie, fx, fy + bob - 1.5, 1, false, 1, Infinity, tilt, fy);
          ripples.push(fx, fy + bob + 2, 1.5, 0.55 * A);
        }
      },
    });
  }

  // ---- waders at the waterline: they run up the sand from each wave and follow it back down ----
  const AMP = Number(params.get("swash")) || 13;
  for (const w of scene.waders || []) {
    const R = rng(w.seed), cheerSeed = R() * 10;
    const wx = w.at[0], wy = seaY(wx) - 1, n = shoreN(wx), look = w.look, side = w.seed % 2 ? 1 : -1;
    systems.push({
      vis: () => inHours(10.5, day.set - 0.6, 0.15),
      items(tt) {
        const ph = wavePhase(wx, wy, tt), f = ph - Math.floor(ph), wave = Math.floor(ph);
        const cheers = hash1(wave * 1.7 + cheerSeed) < 0.35;
        // s: how far up the sand from the painted waterline (park px, along the shore's normal).
        let s = 2, fm = fr(look, "front_stand"), lift = 0;
        if (f >= 0.03 && f < 0.3) {
          const q = (f - 0.03) / 0.27;
          s = 2 + 24 * smooth(q);
          if (cheers && q < 0.45) { fm = fr(look, "cheer"); lift = 3 * Math.sin((q / 0.45) * Math.PI); }
          else { fm = walkFrame(look, "back", s * 1.6); lift = 1.2 * hop(s * 1.6, 9); }
        } else if (f >= 0.3 && f < 0.5) s = 26;
        else if (f >= 0.5 && f < 0.9) { s = 26 - 24 * smooth((f - 0.5) / 0.4); fm = walkFrame(look, "front", s * 1.4); }
        const x = wx + n[0] * s + side * 5 * Math.sin(wave * 2.1), y = wy + n[1] * s;
        // The foam's reach now (the sea's own timing, at its typical reach): ankle-deep when it is past their feet.
        const wet = AMP * swash(f) - s, sink = wet > 0 && !lift ? Math.min(2.5, wet * 0.3) : 0;
        contact(x, y, 18);
        put(fm, x, y + sink - lift, 1, false, 1, sink > 0 ? y + 0.5 : Infinity, 0, y);
        if (wet > 0 && wet < 7 && f < 0.3) sprite(SPLASH, x, y + 1, 0.7, false, 0.7);
      },
    });
  }

  // ---- the volleyball game ----
  let net = null;
  if (scene.volleyball) systems.push((net = volleyball(scene.volleyball)));
  function volleyball(v) {
    const C = G(v.center[0], v.center[1]);
    const Lx = v.halfLength, Lz = v.halfWidth, NET_TOP = 40, NET_LOW = 20, POST_H = 46;
    const R = rng(v.seed), looks = v.players;
    const team = (i) => (i < 2 ? 0 : 1), side = (i) => (i < 2 ? -1 : 1);
    const HOME = [[-66, -34], [-52, 34], [52, -34], [66, 34]];
    const SERVE = [[-(Lx + 14), -10], [-(Lx + 14), 12], [Lx + 14, 10], [Lx + 14, -12]];
    const ORDER = [0, 2, 1, 3], POINTS = 16;
    // Keyframes per player ({ t, x, z }), contact poses ({ t0, t1, pose, jump }), ball segments.
    const keys = HOME.map(() => []), acts = HOME.map(() => []), ball = [];
    const pos = HOME.map((h) => [...h]);
    pos[ORDER[0]] = [...SERVE[ORDER[0]]];
    keys.forEach((k, i) => k.push({ t: 0, x: pos[i][0], z: pos[i][1] }));
    const moveTo = (i, t0, t1, x, z) => {
      const k = keys[i];
      t0 = Math.max(t0, k.at(-1).t);
      t1 = Math.max(t1, t0 + 0.05);
      k.push({ t: t0, x: pos[i][0], z: pos[i][1] }, { t: t1, x, z });
      pos[i][0] = x; pos[i][1] = z;
      return t1;
    };
    const arc = (t0, t1, a, b, apex) => ball.push({ k: "arc", t0, t1, a, b, apex });
    const held = (t0, t1, i, hand = 18) => { if (t1 > t0) ball.push({ k: "held", t0, t1, i, hand }); };
    const nearest = (tm, p) => [tm * 2, tm * 2 + 1].sort((a, b) => Math.hypot(pos[a][0] - p[0], pos[a][1] - p[2]) - Math.hypot(pos[b][0] - p[0], pos[b][1] - p[2]));
    let t = 0;
    for (let pt = 0; pt < POINTS; pt++) {
      const s = ORDER[pt % 4], next = ORDER[(pt + 1) % 4];
      // Toss and serve: held, tossed up, hit as it comes down.
      held(t, t + 0.8, s, 18);
      ball.push({ k: "toss", t0: t + 0.8, t1: t + 1.4, i: s });
      acts[s].push({ t0: t + 1.15, t1: t + 1.6, pose: "spike", jump: 0 });
      t += 1.4;
      let from = [pos[s][0] - side(s) * 4, 34, pos[s][1]], rally = 0, attacker = s;
      for (;;) {
        const def = team(attacker) === 0 ? 1 : 0, sgn = def === 0 ? -1 : 1, fast = rally > 0 || R() < 0;
        const target = [sgn * R.range(fast ? 45 : 30, Lx - 8), 0, R.range(-Lz + 6, Lz - 6)];
        const out = R() < (rally > 0 ? 0.14 : 0.06);
        if (out) { target[0] = sgn * R.range(Lx + 6, Lx + 30); target[2] = R.range(-Lz - 16, Lz + 16); }
        const dur = rally > 0 ? R.range(0.7, 0.9) : R.range(1.4, 1.7);
        const [digger, setter] = nearest(def, target);
        const reach = Math.hypot(pos[digger][0] - target[0], pos[digger][1] - target[2]);
        const dig = !out && R() < (rally > 0 ? 0.8 - rally * 0.1 : 0.92) && reach < (rally > 0 ? 60 : 95);
        if (!dig) {
          // It lands, in or out: a bounce and a roll, now and then a long one. The nearest player on that side
          // fetches it; the next server walks to the serve spot, everyone else home.
          arc(t, t + dur, from, target, rally > 0 ? 5 : 42);
          moveTo(digger, t + 0.1, t + dur, lerp(pos[digger][0], target[0], 0.4), lerp(pos[digger][1], target[2], 0.4));
          t += dur;
          const dir = Math.sign(target[0]) || 1, far = R() < 0.4;
          const b1 = [target[0] + dir * 10, 0, target[2] + R.range(-6, 6)];
          arc(t, t + 0.42, target, b1, 7);
          const rollTo = [b1[0] + dir * (far ? R.range(50, 110) : R.range(8, 22)), 0, clamp(b1[2] + R.range(-30, 30) * (far ? 1.5 : 0.5), -Lz - 60, Lz + 40)];
          const rollDur = far ? R.range(2.6, 3.6) : R.range(1, 1.6);
          ball.push({ k: "roll", t0: t + 0.42, t1: t + 0.42 + rollDur, a: b1, b: rollTo });
          t += 0.42;
          const fetcher = nearest(rollTo[0] < 0 ? 0 : 1, rollTo)[0];
          const dist = Math.hypot(pos[fetcher][0] - rollTo[0], pos[fetcher][1] - rollTo[2]);
          const tArrive = moveTo(fetcher, t + 0.5, Math.max(t + rollDur, t + 0.5 + dist / (far ? 62 : 45)), rollTo[0] - Math.sign(rollTo[0] - pos[fetcher][0]) * 4, rollTo[2]);
          ball.push({ k: "rest", t0: t + rollDur, t1: tArrive + 0.35, a: rollTo });
          acts[fetcher].push({ t0: tArrive, t1: tArrive + 0.6, pose: "kneel", jump: 0 });
          let tb = tArrive + 0.35;
          let ready = 0;
          for (let i = 0; i < 4; i++) {
            if (i === fetcher) continue;
            const goal = i === next ? SERVE[i] : HOME[i];
            ready = Math.max(ready, moveTo(i, t + 1.2, t + 1.2 + Math.hypot(pos[i][0] - goal[0], pos[i][1] - goal[1]) / 30 + 0.5, goal[0], goal[1]));
          }
          if (fetcher === next) {
            held(tb, tb + 0.25, fetcher, 14);
            const goal = SERVE[next];
            const tEnd = moveTo(fetcher, tb + 0.25, tb + 0.25 + Math.hypot(pos[fetcher][0] - goal[0], pos[fetcher][1] - goal[1]) / 30 + 0.4, goal[0], goal[1]);
            held(tb + 0.25, tEnd, fetcher, 16);
            tb = tEnd;
          } else {
            // A soft lob to the next server, then home.
            const tThrow = Math.max(tb + 0.6, ready - 0.6);
            held(tb, tThrow, fetcher, 16);
            acts[fetcher].push({ t0: tThrow - 0.2, t1: tThrow + 0.35, pose: "wave", jump: 0 });
            const a = [pos[fetcher][0], 22, pos[fetcher][1]], b = [SERVE[next][0] - side(next) * 4, 18, SERVE[next][1]];
            const fly = 0.8 + Math.hypot(a[0] - b[0], a[2] - b[2]) / 260;
            arc(tThrow, tThrow + fly, a, b, 30);
            const home = HOME[fetcher];
            ready = Math.max(ready, moveTo(fetcher, tThrow + 0.4, tThrow + 0.4 + Math.hypot(pos[fetcher][0] - home[0], pos[fetcher][1] - home[1]) / 30 + 0.4, home[0], home[1]));
            tb = tThrow + fly;
          }
          const start = Math.max(tb, ready) + 1.6;
          held(tb, start, next, 18);
          t = start;
          break;
        }
        // A dig up to the setter's spot, a set, an attack over the net.
        const tc = t + dur;
        moveTo(digger, t + 0.12, tc - 0.12, target[0] - sgn * 3, target[2]);
        const setSpot = [sgn * R.range(16, 26), R.range(-14, 14)];
        moveTo(setter, t + 0.2, tc + 0.4, setSpot[0] + sgn * 3, setSpot[1]);
        acts[digger].push({ t0: tc - 0.25, t1: tc + 0.3, pose: "pass", jump: 0 });
        arc(t, tc, from, [target[0], 10, target[2]], rally > 0 ? 4 : 40);
        const passDur = R.range(1.2, 1.5), passTo = [setSpot[0], 30, setSpot[1]];
        arc(tc, tc + passDur, [target[0], 10, target[2]], passTo, 28);
        const ts = tc + passDur;
        acts[setter].push({ t0: ts - 0.25, t1: ts + 0.3, pose: "cheer", jump: 0 });
        const hitSpot = [sgn * R.range(24, 36), R.range(-24, 24)], setDur = R.range(1.0, 1.2), th = ts + setDur;
        moveTo(digger, tc + 0.4, ts + 0.4, hitSpot[0] + sgn * 8, hitSpot[1]);
        moveTo(digger, ts + 0.5, th - 0.38, hitSpot[0] + sgn * 2, hitSpot[1]);
        const hitPos = [hitSpot[0], 56, hitSpot[1]];
        arc(ts, th, passTo, hitPos, 24);
        acts[digger].push({ t0: th - 0.38, t1: th + 0.3, pose: "spike", jump: 10 });
        moveTo(setter, th + 0.1, th + 1.3, HOME[setter][0] * 0.8, HOME[setter][1]);
        moveTo(digger, th + 0.4, th + 1.6, HOME[digger][0] * 0.8, HOME[digger][1]);
        t = th;
        from = hitPos;
        attacker = digger;
        rally++;
      }
    }
    const span = t;
    for (const k of keys) { let d = 0; for (let i = 0; i < k.length; i++) { if (i) d += Math.hypot(k[i].x - k[i - 1].x, k[i].z - k[i - 1].z); k[i].d = d; } }
    ball.sort((a, b) => a.t0 - b.t0);
    const out5 = [0, 0, 0, 0, 0];
    // A player's ground position (court units), speed, distance walked and direction of travel at time u.
    function playerAt(i, u) {
      const k = keys[i];
      let j = 0;
      while (j < k.length - 1 && k[j + 1].t <= u) j++;
      const a = k[j], b = k[Math.min(j + 1, k.length - 1)];
      const dt = b.t - a.t, q = dt > 0 ? clamp((u - a.t) / dt, 0, 1) : 1, e = smooth(q), dist = Math.hypot(b.x - a.x, b.z - a.z);
      out5[0] = lerp(a.x, b.x, e); out5[1] = lerp(a.z, b.z, e);
      out5[2] = q < 1 && dist > 1 && dt > 0 ? (dist / dt) * 6 * q * (1 - q) : 0;
      out5[3] = a.d + dist * e; out5[4] = b.x - a.x;
      return out5;
    }
    const local = (x, h, z) => P([C[0] + x, 0, C[2] + z], h);
    const posts = [local(0, 0, -Lz - 8), local(0, 0, Lz + 8)];
    const NS = 6;
    const pieces = Array.from({ length: NS }, (_, i) => {
      const za = -Lz - 8 + ((2 * Lz + 16) * i) / NS, zb = -Lz - 8 + ((2 * Lz + 16) * (i + 1)) / NS;
      return { a: local(0, NET_TOP, za), b: local(0, NET_TOP, zb), c: local(0, NET_LOW, zb), d: local(0, NET_LOW, za), u0: i / NS, u1: (i + 1) / NS, y: local(0, 0, (za + zb) / 2)[1] };
    });
    const NET = FR.net, BALL = FR.volleyball;
    const corners = [local(-Lx, 0, -Lz), local(Lx, 0, -Lz), local(Lx, 0, Lz), local(-Lx, 0, Lz)];
    const bp = [0, 0, 0];
    function ballAt(u) {
      let s = null;
      for (let j = 0; j < ball.length; j++) if (ball[j].t0 <= u && u < ball[j].t1) { s = ball[j]; break; }
      if (!s) { const p = playerAt(ORDER[0], u); bp[0] = p[0] + 4; bp[1] = 18; bp[2] = p[1]; return; }
      const q = (u - s.t0) / (s.t1 - s.t0);
      if (s.k === "arc") { bp[0] = lerp(s.a[0], s.b[0], q); bp[2] = lerp(s.a[2], s.b[2], q); bp[1] = lerp(s.a[1], s.b[1], q) + 4 * s.apex * q * (1 - q); }
      else if (s.k === "roll") { const e = 1 - (1 - q) * (1 - q); bp[0] = lerp(s.a[0], s.b[0], e); bp[2] = lerp(s.a[2], s.b[2], e); bp[1] = 3; }
      else if (s.k === "rest") { bp[0] = s.a[0]; bp[1] = 3; bp[2] = s.a[2]; }
      else {
        const p = playerAt(s.i, u);
        bp[0] = p[0] - side(s.i) * 4; bp[2] = p[1];
        bp[1] = s.k === "toss" ? lerp(18, 34, q) + 88 * q * (1 - q) : s.hand;
      }
    }
    window.__volley = { keys, acts, ball, span };
    return {
      ground() {
        for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; segment(a[0], a[1], b[0], b[1], 1.7, 0.36, 0.52, 0.8, 0.42); }
        for (const p of posts) shadow(p[0] + 2, p[1], 8, 0.6);
      },
      items(tt) {
        const u = ((tt % span) + span) % span;
        for (const s of pieces) item(s.y).quad = s;
        for (const p of posts) item(p[1]).quad = p;
        // The game runs from mid morning until a while before sunset; the court stays.
        A = inHours(9.8, day.set - 0.6, 0.12);
        if (A <= 0) return;
        for (let i = 0; i < 4; i++) {
          const [x, z, speed, dist, dx] = playerAt(i, u);
          let pose = null, jump = 0;
          for (const a of acts[i]) if (u >= a.t0 && u < a.t1) { pose = a.pose; jump = a.jump * Math.sin(((u - a.t0) / (a.t1 - a.t0)) * Math.PI); break; }
          const base = local(x, 0, z);
          let f, flip = side(i) > 0, bob = 0;
          if (pose) { f = fr(looks[i], pose); if (pose === "cheer" || pose === "wave") flip = false; }
          else if (speed > 40) { f = walkFrame(looks[i], "side", dist, true); flip = dx < 0; bob = 1.6 * hop(dist, 9); }
          else if (speed > 3) { f = walkFrame(looks[i], "side", dist); flip = dx < 0; bob = 1.1 * hop(dist, 6.5); }
          else f = fr(looks[i], "side_stand");
          contact(base[0], base[1], 20 - jump * 0.6);
          put(f, base[0], base[1] - jump - bob, 1, flip, 1, Infinity, 0, base[1]);
        }
        ballAt(u);
        const g = local(bp[0], 0, bp[2]), p = local(bp[0], bp[1], bp[2]);
        contact(g[0], g[1], Math.max(3, 7 - bp[1] * 0.06));
        put(BALL, p[0], p[1], 1, false, 1, Infinity, 0, g[1] + 0.3);
      },
      drawQuad(q) {
        if (!q.a) { // a post
          segment(q[0], q[1], q[0], q[1] - POST_H * 0.877, 2.2, 0.56, 0.42, 0.31, 1);
          segment(q[0] - 0.4, q[1] - 1, q[0] - 0.4, q[1] - POST_H * 0.877 + 1, 0.7, 0.86, 0.74, 0.58, 0.8);
          return;
        }
        const du = NET.u1 - NET.u0;
        batch.quad(q.a[0] - RX, q.a[1] - RY, q.b[0] - RX, q.b[1] - RY, q.c[0] - RX, q.c[1] - RY, q.d[0] - RX, q.d[1] - RY, NET.u0 + du * q.u0, NET.v0, NET.u0 + du * q.u1, NET.v1, 1, 1, 1, 1);
      },
    };
  }

  // ---- a dog playing fetch: thrown, chased, brought back, dropped ----
  if (scene.dog) {
    const d = scene.dog, [ox, oy] = d.at, BALLF = FR.beachball, CYCLE = 15, home = [ox + 12, oy + 4];
    systems.push({
      vis: () => Math.max(inHours(day.rise - 0.2, 9.6, 0.15), inHours(17, day.set + 0.3, 0.15)), // dog walkers' hours
      items(tt) {
        const n = Math.floor(tt / CYCLE), u = tt - n * CYCLE, R = rng(n * 131 + 5);
        const tx = lerp(ox, d.to[0], R.range(0.55, 1)), ty = lerp(oy, d.to[1], R.range(0.4, 1.1)) + R.range(-20, 20);
        const left = tx < ox, dist = Math.hypot(tx - home[0], ty - home[1]);
        const tRun = 0.5, tGet = Math.max(2.6, 0.5 + dist / 75), tBack = tGet + 0.8, tHome = tBack + dist / 60;
        let owner = fr(d.owner, "front_stand"), oflip = false;
        if (u < 0.9) { owner = u > 0.2 && u < 0.8 && has(d.owner, "wave") ? fr(d.owner, "wave") : fr(d.owner, "side_stand"); oflip = left; }
        if (u > CYCLE - 1.2 && has(d.owner, "kneel")) { owner = fr(d.owner, "kneel"); oflip = !left; }
        let bx = home[0] - 6, by = home[1] + 2, bh = 0;
        if (u < 0.4 || u > CYCLE - 0.6) { bx = ox + 4; by = oy; bh = 18; }
        else if (u < 1.8) { const q = (u - 0.4) / 1.4; bx = lerp(ox + 4, tx - 10, q); by = lerp(oy, ty - 2, q); bh = lerp(18, 0, q) + 46 * q * (1 - q); }
        else if (u < tGet) { const q = clamp((u - 1.8) / 0.8, 0, 1); bx = lerp(tx - 10, tx, q); by = lerp(ty - 2, ty, q); bh = 3 * Math.sin(q * Math.PI); }
        else if (u < tBack) { bx = tx; by = ty; }
        let dx = home[0], dy = home[1], df = fr(d.pet, "front_act"), dflip = false, dbob = 0;
        if (u >= tRun && u < tGet) {
          const q = (u - tRun) / (tGet - tRun);
          dx = lerp(home[0], tx - 6, q); dy = lerp(home[1], ty, q);
          df = fr(d.pet, `side_${WALK[Math.floor(u * 9) % 4]}`); dflip = left; dbob = 1.6 * Math.abs(Math.sin(u * 14));
        } else if (u >= tGet && u < tBack) { dx = tx - 6; dy = ty; df = fr(d.pet, "side_act"); dflip = left; }
        else if (u >= tBack && u < tHome) {
          const q = (u - tBack) / (tHome - tBack);
          dx = lerp(tx - 6, home[0], q); dy = lerp(ty, home[1], q);
          df = fr(d.pet, `side_${WALK[Math.floor(u * 9) % 4]}`); dflip = !left; dbob = 1.6 * Math.abs(Math.sin(u * 14));
          bx = dx + (dflip ? -7 : 7); by = dy; bh = 6;
        }
        contact(ox, oy, 20);
        put(owner, ox, oy, 1, oflip);
        contact(dx, dy, 14);
        put(df, dx, dy - dbob, 1.25, dflip, 1, Infinity, 0, dy);
        contact(bx, by, Math.max(4, 9 - bh * 0.1));
        put(BALLF, bx, by - 4 - bh * 0.877, 1, false, 1, Infinity, 0, by + 0.2);
      },
    });
  }

  // ---- a kite on a long string ----
  if (scene.kite) {
    const { flyer, at: [kx, ky], kite: [qx, qy] } = scene.kite, KF = FR.kite;
    systems.push({
      vis: () => inHours(11.5, day.set - 1.2, 0.15),
      items() { contact(kx, ky, 20); put(fr(flyer, "back_act"), kx, ky); },
      air(tt) {
        const sx = qx + 9 * Math.sin(tt * 0.45) + 3 * Math.sin(tt * 1.7), sy = qy + 6 * Math.sin(tt * 0.6 + 1) + 2 * Math.sin(tt * 2.3);
        const rot = 0.12 * Math.sin(tt * 0.45 + 0.5) + 0.05 * Math.sin(tt * 1.9);
        const hx = kx - 1, hy = ky - 33, ex = sx - KF.w * 0.1, ey = sy - KF.h * 0.38;
        let px = hx, py = hy;
        for (let i = 1; i <= 8; i++) {
          const q = i / 8, x = lerp(hx, ex, q), y = lerp(hy, ey, q) + 40 * q * (1 - q) * (0.8 + 0.2 * Math.sin(tt * 0.6));
          segment(px, py, x, y, 0.7, 0.36, 0.29, 0.27, 0.7);
          px = x; py = y;
        }
        sprite(KF, sx, sy, 1, false, 1, Infinity, rot);
      },
    });
  }

  // ---- two walkers along the wet sand, there and back, stopping to look at the sea ----
  if (scene.walkers) {
    const w = scene.walkers, R = rng(w.seed), [ax, ay] = w.from, [bx, by] = w.to, len = Math.hypot(bx - ax, by - ay);
    const segs = [];
    let t = 0;
    for (const [q0, q1] of [[0, 1], [1, 0]]) {
      let q = q0;
      while (q !== q1) {
        const step = Math.min(Math.abs(q1 - q), R.range(0.18, 0.4)) * Math.sign(q1 - q);
        segs.push({ t0: t, t1: t + (Math.abs(step) * len) / 13, q0: q, q1: q + step });
        t = segs.at(-1).t1; q = Math.abs(q + step - q1) < 1e-9 ? q1 : q + step;
        segs.push({ t0: t, t1: t + R.range(q === q1 ? 10 : 4, q === q1 ? 20 : 9), q0: q, q1: q, back: q1 < q0 });
        t = segs.at(-1).t1;
      }
    }
    const seg = looped(segs);
    systems.push({
      vis: () => Math.max(inHours(day.rise - 0.6, 24.7, 0.2), inHours(-1, 0.7, 0.2)), // strollers, day and evening
      items(tt) {
        const [s, k] = seg(tt), qq = lerp(s.q0, s.q1, k / (s.t1 - s.t0)), moving = s.q0 !== s.q1, back = moving ? s.q1 < s.q0 : !s.back;
        for (let i = 0; i < w.looks.length; i++) {
          const look = w.looks[i], x = lerp(ax, bx, qq) + (i ? (back ? 13 : -13) : 0), y = lerp(ay, by, qq) + (i ? 6 : 0);
          const dist = qq * len + i * 4;
          contact(x, y, 18);
          put(moving ? walkFrame(look, "side", dist) : fr(look, "front_stand"), x, y - (moving ? 1.2 * hop(dist, 13) : 0), 1, moving && back);
        }
      },
    });
  }

  // ---- gulls standing about near the water; now and then one flies a loop and lands again ----
  (scene.gulls || []).forEach(([gx, gy], i) => {
    const R = rng(900 + i * 17), ph = R() * 100, FLY = 70 + R() * 50, dirn = i % 2 ? 1 : -1;
    systems.push({
      items(tt) {
        const u = (tt + ph) % FLY;
        if (u >= FLY - 12) return;
        const step = Math.floor(u / 3.1), flip = hash1(step * 3.3 + i) < 0.5;
        const walking = u % 3.1 < 0.6 && hash1(step * 1.9 + i) < 0.5;
        const x = gx + 5 * Math.sin(step * 0.9 + i) + (walking ? (flip ? -1 : 1) * ((u % 3.1) / 0.6) * 2 : 0);
        contact(x, gy, 8);
        put(walking && Math.floor(u * 8) % 2 ? FR.gull_walk : FR.gull_stand, x, gy, 1, flip);
      },
      air(tt) {
        const u = (tt + ph) % FLY;
        if (u < FLY - 12) return;
        const q = (u - (FLY - 12)) / 12, a = q * TAU;
        const x = gx + 5 * Math.sin(Math.floor((FLY - 12) / 3.1) * 0.9 + i) * (1 - q) + 70 * Math.sin(a) * dirn, h = 55 * Math.sin(q * Math.PI), y = gy - 30 * (1 - Math.cos(a)) * 0.5;
        shadow(x, y, 10, 0.35 * (1 - h / 80));
        sprite(Math.floor(u * 5) % 2 ? FR.gull_up : FR.gull_down, x, y - h, 1, Math.cos(a) * dirn < 0);
      },
    });
  });

  // ---- a jogger on the wet sand at dawn ----
  if (scene.walkers && scene.jogger) {
    const [ax, ay] = scene.walkers.from, [bx, by] = scene.walkers.to, len = Math.hypot(bx - ax, by - ay), look = scene.jogger.look, SPEED = 48;
    systems.push({
      vis: () => inHours(day.rise - 0.3, 9.7, 0.15),
      items(tt) {
        const u = (tt * SPEED) % (2 * len), back = u > len, q = back ? 2 - u / len : u / len;
        const x = lerp(ax, bx, q), y = lerp(ay, by, q) + 10;
        contact(x, y, 18);
        put(walkFrame(look, "side", u, true), x, y - 1.8 * hop(u, 9), 1, back);
      },
    });
  }

  // ---- a couple watching the sunset from the water's edge ----
  if (scene.sunset) {
    const { looks, at: [sx, sy] } = scene.sunset;
    systems.push({
      vis: () => inHours(day.set - 0.9, day.set + 0.6, 0.15),
      items() {
        looks.forEach((look, i) => {
          const x = sx + i * 17, y = sy + i * 3;
          contact(x, y + 3, 22);
          put(fr(look, i ? "front_act" : has(look, "sit_lean") ? "sit_lean" : "front_act"), x, y + 3);
        });
      },
    });
  }

  // ---- a small bonfire at night, three or four friends round it ----
  if (scene.bonfire) {
    const { at: [fx, fy], friends } = scene.bonfire;
    // Its light (flames, sparks and a warm pool on the sand) in a small canvas in the page's lights slot, above the
    // night grade, so it glows; the logs and the friends are drawn here and graded like everything else.
    const FRECT = [fx - 90, fy - 80, 180, 120], FD = 2;
    const fire = document.createElement("canvas");
    fire.width = FRECT[2] * FD; fire.height = FRECT[3] * FD;
    fire.style.cssText = `position:absolute;left:${FRECT[0]}px;top:${FRECT[1]}px;width:${FRECT[2]}px;height:${FRECT[3]}px;mix-blend-mode:plus-lighter;pointer-events:none;display:none`;
    const g2 = fire.getContext("2d");
    const glow = (x, y, rx, ry, stops) => {
      g2.save(); g2.translate(x, y); g2.scale(1, ry / rx);
      const gr = g2.createRadialGradient(0, 0, 0, 0, 0, rx);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g2.fillStyle = gr; g2.beginPath(); g2.arc(0, 0, rx, 0, TAU); g2.fill(); g2.restore();
    };
    let shown = false;
    systems.push({
      vis: () => inHours(day.set + 0.7, 23.6, 0.2),
      items(tt) {
        for (const [look, pose, dx, dy, flip] of friends) {
          contact(fx + dx, fy + dy, 20);
          put(fr(look, pose), fx + dx, fy + dy, 1, !!flip);
        }
        // Logs: two dark sticks crossed on the sand.
        segment(fx - 7, fy + 1, fx + 7, fy - 2, 2.4, 0.3, 0.2, 0.14, 0.95);
        segment(fx - 6, fy - 2, fx + 6, fy + 2, 2.2, 0.36, 0.24, 0.16, 0.95);
        const parent = ctx.slots.lights ?? ctx.slots.front;
        if (fire.parentNode !== parent) parent.append(fire);
        const k = A * clamp(0.45 + day.dark, 0, 1);
        fire.style.display = "";
        shown = true;
        g2.setTransform(FD, 0, 0, FD, -FRECT[0] * FD, -FRECT[1] * FD);
        g2.clearRect(FRECT[0], FRECT[1], FRECT[2], FRECT[3]);
        const fl = 0.85 + 0.1 * Math.sin(tt * 7.3) + 0.06 * Math.sin(tt * 17.1);
        glow(fx, fy, 78 * fl, 30 * fl, [[0, `rgba(255,150,70,${0.42 * k})`], [0.45, `rgba(255,120,50,${0.16 * k})`], [1, "rgba(255,110,40,0)"]]);
        for (let i = 0; i < 3; i++) {
          const f = 0.75 + 0.25 * Math.sin(tt * (8 + i * 1.7) + i * 2.1) + 0.08 * Math.sin(tt * 23 + i);
          glow(fx + (i - 1) * 3.2, fy - 4 - 4 * f, 4.2, 8.5 * f, [[0, `rgba(255,246,200,${0.95 * k})`], [0.4, `rgba(255,170,60,${0.75 * k})`], [1, "rgba(255,110,30,0)"]]);
        }
        for (let i = 0; i < 5; i++) {
          const q = (tt * 0.55 + i / 5) % 1;
          g2.fillStyle = `rgba(255,200,120,${(1 - q) * 0.8 * k})`;
          g2.fillRect(fx + 5 * Math.sin(tt * 1.3 + i * 2.4) - 0.5, fy - 12 - 34 * q, 1.1, 1.1);
        }
      },
      hide() { if (shown) { fire.style.display = "none"; shown = false; } },
    });
  }

  // ---- the frame ----
  let density = 0, lastT = NaN, lastH = NaN;
  const FPS = params.has("beachFps") ? Number(params.get("beachFps")) : 30;
  const reduce = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function resize(scale) {
    const want = Number(params.get("beachDensity")) || clamp(scale * (devicePixelRatio || 1), 1.5, 2.5);
    if (Math.abs(want - density) < 1e-3) return;
    density = want;
    canvas.width = Math.round(RW * density);
    canvas.height = Math.round(RH * density);
    lastT = NaN;
  }
  function cutSprite(r) {
    const f = r.f, s = r.s, w = f.w * s, h = f.h * s;
    const x0 = r.x - f.ax * s - RX, y0 = r.py - f.ay * s - RY, ys = y0 + h * r.cutTop, vs = f.v0 + (f.v1 - f.v0) * r.cutTop;
    batch.quad(x0, ys, x0 + w, ys, x0 + w, y0 + h, x0, y0 + h, f.u0, vs, f.u1, f.v1, 1, 1, 1, r.a);
  }
  function draw(t, submit = true) {
    sky.tick?.();
    day.h = sky.hour ?? 13; day.rise = sky.sun?.rise ?? 6.5; day.set = sky.sun?.set ?? 19; day.dark = sky.dark ?? 0;
    batch.begin();
    nItems = 0;
    shadows.length = 0;
    ripples.length = 0;
    for (const s of systems) { s.a = s.vis ? s.vis() : 1; if (s.a <= 0) s.hide?.(); }
    for (const s of systems) if (s.a > 0 && s.ground) { A = s.a; s.ground(t); }
    for (const s of systems) if (s.a > 0 && s.items) { A = s.a; s.items(t); }
    A = 1;
    for (let i = 0; i < shadows.length; i += 4) shadow(shadows[i], shadows[i + 1] + 0.5, shadows[i + 2], 0.8 * shadows[i + 3]);
    for (let i = 0; i < ripples.length; i += 4) sprite(RIPPLE, ripples[i], ripples[i + 1], ripples[i + 2], false, ripples[i + 3]);
    items.length = 0;
    for (let i = 0; i < nItems; i++) items.push(pool[i]);
    items.sort(byY);
    for (const r of items) {
      if (r.quad) net.drawQuad(r.quad);
      else if (r.cutTop) cutSprite(r);
      else sprite(r.f, r.x, r.py, r.s, r.flip, r.a, r.clip, r.rot, r.sx);
    }
    for (const s of systems) if (s.a > 0 && s.air) { A = s.a; s.air(t); }
    A = 1;
    return submit ? batch.end(RW, RH) : batch.quads;
  }
  resize(ctx.scale?.() ?? 1);

  window.__beach = {
    scene, FR, occluders, canvas, draw,
    // Average ms per frame over n frames: { js } placing and batching the sprites, { all } with the GL draw and a
    // sync (software GL when headless), and the quads drawn.
    cost(n = 60, t = 30) {
      const px = new Uint8Array(4), gl = canvas.getContext("webgl2");
      let t0 = performance.now();
      for (let i = 0; i < n; i++) draw(t + i / 60, false);
      const js = (performance.now() - t0) / n;
      t0 = performance.now();
      for (let i = 0; i < n; i++) draw(t + i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { js: +js.toFixed(3), all: +((performance.now() - t0) / n).toFixed(3), quads: batch.quads, canvas: [canvas.width, canvas.height] };
    },
  };

  return {
    resize,
    // Drawn at most FPS times a second (calm motion; half the compositing of a full-rate canvas).
    update(t) {
      const tt = reduce ? 40 : FPS ? Math.floor(t * FPS) / FPS : t;
      sky.tick?.();
      if (tt === lastT && sky.hour === lastH) return;
      lastT = tt; lastH = sky.hour;
      draw(tt);
    },
    // Upright props the crowd may pass behind (rides/RIDERS.md): footprint, base y, an alpha mask over the rect; only
    // the ones standing on the sand at this hour.
    occluders: occludersNow,
  };
}
