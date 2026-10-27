// The Sea Swings (east of the Dream Wheel): a wave swinger whose canopy lifts, turns and tilts while its chairs swing
// out on chains. It replaces the painting's second carousel, which the plate paints over.
//
// - Plate (plate.webp, tools/plate.py): the old carousel filled in with deck and the ride's static base painted on it
//   (platform, skirt, railing, drum); cut-outs from it (drum.webp, fence.webp) are drawn among the chairs.
// - The canopy (crown band, top cone, striped cupola) and the column are the painted ride's own surfaces
//   (gen/ride_v1_0.png, gen/ride_v1_1.png), unwrapped once into seamless tiles (tools/surfaces.py) and rewrapped
//   here on meshes over the painted ellipses, shifted by the turn angle; their light stays fixed. The canopy rises
//   35 px on its column for the ride (the column's panels slide up out of the drum) and tilts up to 5 degrees, so
//   the chairs rise and dip as they go round: the "wave".
// - Chairs are sprites (chairs.webp: 5 views x 6 chairs, tools/build_chairs.py), each a pendulum on two chains from
//   a ring under the crown band: it swings out with the speed (tan theta = omega^2 r / g), trails at start-up and
//   runs ahead when slowing, and is drawn in front of or behind the column and drum by its side.
// - Riders: the crowd's own sprites (tests/park-crowd/atlas.png), from ctx.riders when the crowd runs
//   (rides/RIDERS.md), otherwise our own, seeded per cycle.
// - Motion: a 75 s cycle (loading 14, lift 5, spin-up 8, ride 32, slow-down 8, lowering 5, settle 3). The turn and
//   the chairs' swing are integrated once over a cycle at mount (every cycle starts from rest) and looked up by
//   clock time, so &t= freezes a frame exactly.
// - One WebGL2 canvas over the ride, at 1.5-2.5 px per park px. Depth: returns `occluders` (rides/RIDERS.md), a
//   function of t giving the ride's silhouette (base, column, canopy, chairs) as a mask.

import { rideHours } from "../../base/park_hours.js";
import { getSky } from "../../base/sky.js";
const T = 75, LOAD = 14, LIFT_S = 5, UP = 8, RIDE = 32, DOWN = 8, LOWER = 5;
const C_LIFT = LOAD, C_UP = C_LIFT + LIFT_S, C_RIDE = C_UP + UP, C_DOWN = C_RIDE + RIDE, C_LOWER = C_DOWN + DOWN, C_STOP = C_LOWER + LOWER;
const UNLOAD_AT = 2, BOARD_AT = 8, FADE = 0.6;
const REST = 4.5;   // s into the cycle where it waits while the park is closed (base/park_hours.js): down, emptied
const G = 90;                          // gravity in park px/s^2 (a park px is about 11 cm: the canopy is 12 m across)
const W_SLOW = 0.3, W_FULL = 1.028;    // rad/s: the slow turn while the canopy lifts and lowers; full speed (a turn in 6.1 s)
const ZETA = 0.12;                     // the chairs' damping ratio
const TILT = (5 * Math.PI) / 180;      // the wave: the canopy's largest tilt
const BOX = [2680, 1335, 212, 207];    // canvas box in park px
const UNIT = 3840 / 3904;
const K = (38 * UNIT) / 30;            // the crowd's sprite scale at size 38
const RIDER = 0.5;                     // riders against the crowd's size
const RIDER_DROP = 6;                  // a rider's feet hang this far below the seat
// The chairs round the ring: single, single, double, four times; colours in turn (fifteen crowded the ring at rest).
const LAYOUT = Array.from({ length: 12 }, (_, i) => (i % 3 === 2 ? 2 : 1));
const SINGLE = ["yellow", "green", "red", "blue"], DOUBLE = ["orange", "pink"];
// The queue (gate first) on the deck in front of the platform's front-left opening, then west along the rail in front of
// the lamp; the exit in front of the front-right opening.
const RAIL = [[2613, 1533], [2733, 1560], [2883, 1590]];
const railY = (x) => {
  for (let i = 0; i < RAIL.length - 1; i++) {
    const [ax, ay] = RAIL[i], [bx, by] = RAIL[i + 1];
    if (x <= bx) return ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return RAIL.at(-1)[1];
};
const r1 = (v) => Math.round(v * 10) / 10;
const QUEUE = [[2760, 1536], [2750, 1541], [2741, 1546], ...Array.from({ length: 7 }, (_, k) => [2732 - 9 * k, r1(railY(2732 - 9 * k) - 10)])];
const EXIT = [2818, 1536];

const VS_SURF = `#version 300 es
in vec2 aPos; in float aPhi; in float aV; in float aShade; in float aR; in float aH;
uniform vec4 uBox; uniform float uDy; uniform float uSinA; uniform float uDir; uniform float uK;
uniform float uCol; uniform float uColTop; uniform float uColLen; uniform float uColFull;
out float vPhi; out float vV; out float vShade;
void main() {
  vec2 p = aPos;
  float v = aV;
  if (uCol > 0.5) {
    // the column: its top follows the canopy, its foot stays in the drum; the panels slide with the top
    p.y = uColTop + aPos.y + aV * uColLen;
    v = aV * uColLen / uColFull;
  } else {
    p.y += uDy + aR * uSinA * cos(aPhi - uDir);
    p += aH * uSinA * vec2(cos(uDir), uK * sin(uDir));
  }
  vPhi = aPhi; vV = v; vShade = aShade;
  gl_Position = vec4((p.x - uBox.x) / uBox.z * 2.0 - 1.0, 1.0 - (p.y - uBox.y) / uBox.w * 2.0, 0.0, 1.0);
}`;
const FS_SURF = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexSize; uniform vec4 uRect; uniform float uM; uniform float uA0; uniform float uRot;
in float vPhi; in float vV; in float vShade;
out vec4 color;
void main() {
  float s = (vPhi + uRot - uA0) * uM / 6.28318530718;
  float u = fract(s);
  vec2 tc = (uRect.xy + vec2(u, vV) * uRect.zw) / uTexSize;
  vec2 tcu = (uRect.xy + vec2(s, vV) * uRect.zw) / uTexSize;
  vec4 c = textureGrad(uTex, tc, dFdx(tcu) * 0.75, dFdy(tcu) * 0.75);
  color = vec4(c.rgb * vShade, c.a);
}`;
const VS_SPR = `#version 300 es
in vec2 aPos; in vec2 aUv; in vec4 aCol;
uniform vec4 uBox;
out vec2 vUv; out vec4 vCol;
void main() {
  vUv = aUv; vCol = aCol;
  gl_Position = vec4((aPos.x - uBox.x) / uBox.z * 2.0 - 1.0, 1.0 - (aPos.y - uBox.y) / uBox.w * 2.0, 0.0, 1.0);
}`;
const FS_SPR = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv; in vec4 vCol;
out vec4 color;
void main() { color = texture(uTex, vUv, -0.4) * vCol; }`;

const load = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2);
function hash(...xs) {
  let h = 2166136261;
  for (const c of xs.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

// The cycle's envelopes, c in [0, T): turn speed (rad/s), lift (0 down, 1 up) and tilt amplitude (radians).
function omegaAt(c) {
  if (c < C_LIFT) return 0;
  if (c < C_UP) return W_SLOW * smooth((c - C_LIFT) / LIFT_S);
  if (c < C_RIDE) return W_SLOW + (W_FULL - W_SLOW) * smooth((c - C_UP) / UP);
  if (c < C_DOWN) return W_FULL;
  if (c < C_LOWER) return W_FULL - (W_FULL - W_SLOW) * smooth((c - C_DOWN) / DOWN);
  if (c < C_STOP) return W_SLOW * (1 - smooth((c - C_LOWER) / LOWER));
  return 0;
}
function liftAt(c) {
  if (c < C_LIFT) return 0;
  if (c < C_UP) return smooth((c - C_LIFT) / LIFT_S);
  if (c < C_LOWER) return 1;
  if (c < C_STOP) return 1 - smooth((c - C_LOWER) / LOWER);
  return 0;
}
function tiltAt(c) {
  if (c < C_RIDE || c > C_DOWN) return 0;
  return TILT * Math.min(smooth((c - C_RIDE) / 4), 1 - smooth((c - (C_DOWN - 4)) / 4));
}
// the canopy dips lowest towards the front right (55 degrees, swaying 15 either way): the chairs swoop low over the deck
// in front, and stay high on the left (the lamp, the Dream Wheel)
const tiltDir = (t) => (55 * Math.PI) / 180 + 0.26 * Math.sin((2 * Math.PI * t) / 23);

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const [geom, surf, chairs, cut, plate, cmeta, catlas, surfImg, chairImg] = await Promise.all([
    fetch(url("geom.json")).then((r) => r.json()),
    fetch(url("surfaces.json")).then((r) => r.json()),
    fetch(url("chairs.json")).then((r) => r.json()),
    fetch(url("cutouts.json")).then((r) => r.json()),
    fetch(url("plate.json")).then((r) => r.json()),
    fetch(url("../../tests/park-crowd/atlas.json")).then((r) => r.json()),
    load(url("../../tests/park-crowd/atlas.png")),
    load(url("surfaces.webp")),
    load(url("chairs.webp")),
  ]);
  const cutImg = {};
  for (const [name, c] of Object.entries(cut)) cutImg[name] = await load(url(c.file));
  const plateImg = ctx.addPatch(url(plate.file), plate.rect);
  await plateImg.decode().catch(() => {});

  const HUB = geom.hub, K0 = geom.k0, KZ = geom.kz;
  const PT = geom.painted;
  const R0 = geom.canopy.hang, L = geom.chain, HZ = geom.hang_z, LIFT = geom.lift;
  const FLOOR = geom.platform.h, FENCE_R = geom.fence.r;
  const proj = (X, Y, z) => [HUB[0] + X, HUB[1] + (K0 - KZ * z) * Y - z];

  // ---- the cycle, integrated once: turn angle, the chairs' outward swing (theta) and trailing swing (beta)
  const HZS = 120, N = Math.round(T * HZS);
  const tab = { rot: new Float64Array(N + 1), th: new Float32Array(N + 1), be: new Float32Array(N + 1) };
  {
    let rot = 0, th = 0, thv = 0, be = 0, bev = 0;
    const sub = 4, dt = 1 / (HZS * sub);
    for (let i = 0; i <= N; i++) {
      tab.rot[i] = rot; tab.th[i] = th; tab.be[i] = be;
      for (let s = 0; s < sub; s++) {
        const c = (i * sub + s) * dt;
        const w = omegaAt(c), a = (omegaAt(c + dt) - omegaAt(c - dt)) / (2 * dt);
        const r = R0 + L * Math.sin(th);
        const geff = Math.hypot(G, w * w * r), wn = Math.sqrt(geff / L);
        const thEq = Math.atan2(w * w * r, G), beEq = Math.atan2(-a * r, geff);
        thv += (-2 * ZETA * wn * thv - wn * wn * (th - thEq)) * dt;
        th += thv * dt;
        bev += (-2 * ZETA * wn * bev - wn * wn * (be - beEq)) * dt;
        be += bev * dt;
        rot += w * dt;
      }
    }
  }
  const ROT_CYCLE = tab.rot[N];
  function motion(t) {
    const n = Math.floor(t / T), c = t - n * T;
    const f = c * HZS, i = Math.min(N - 1, Math.floor(f)), w = f - i;
    const lerp = (A) => A[i] + (A[i + 1] - A[i]) * w;
    return { n, c, rot: n * ROT_CYCLE + lerp(tab.rot), th: lerp(tab.th), be: lerp(tab.be), omega: omegaAt(c), lift: liftAt(c), tilt: tiltAt(c), dir: tiltDir(t) };
  }

  // ---- chairs: layout, riders
  let ns = 0, nd = 0;
  const CH = LAYOUT.map((seats, i) => {
    const colour = seats === 1 ? SINGLE[ns++ % SINGLE.length] : DOUBLE[nd++ % DOUBLE.length];
    return { i, seats, colour, key: `chair${i}`, phi0: (i / LAYOUT.length) * 2 * Math.PI, ph: hash("ph", i) * 2 * Math.PI, amp: 0.6 + 0.8 * hash("amp", i) };
  });
  const looks = [...new Set(Object.keys(cmeta.frames).filter((k) => k.endsWith("/front_stand")).map((k) => k.split("/")[0]))].filter((l) => !l.startsWith("pet"));
  const crowdFrame = (look, view) => cmeta.frames[`${look}/${view}_stand`];
  // Park hours: closed, the swings finish their ride and wait lowered at the platform, emptied; open again, they start.
  const hours = rideHours(ctx.sky ?? getSky({ params: ctx.params }), { period: T, rest: REST, frozen: ctx.clock.frozen });
  function ridersAt(ch, t) {
    const fromCrowd = ctx.riders ? ctx.riders(ctx.name, ch.key, hours.master(t)) : null;
    if (fromCrowd) return fromCrowd;
    const n = Math.floor(t / T), c = t - n * T;
    const cyc = c >= BOARD_AT ? n : c >= UNLOAD_AT ? null : n - 1;   // riders boarded at the last BOARD_AT
    if (cyc === null || cyc < 0) return [];
    return ownRiders(ch, cyc);
  }
  function ownRiders(ch, cyc) {
    if (hash("busy", ch.i, cyc) > 0.68) return [];
    const out = [];
    for (let s = 0; s < ch.seats; s++) {
      if (s > 0 && hash("second", ch.i, cyc) > 0.7) break;
      const kid = hash("kid", ch.i, cyc, s) < 0.2;
      out.push(kid ? ["bear_cub", "fox_kid", "panda_kid", "bunny_kid", "lion_cub"][Math.floor(hash("kidlook", ch.i, cyc, s) * 5)] : looks[Math.floor(hash("look", ch.i, cyc, s) * looks.length)]);
    }
    return out;
  }
  function riderAlpha(t) {
    const c = ((t % T) + T) % T;
    if (c > UNLOAD_AT - FADE && c < UNLOAD_AT) return (UNLOAD_AT - c) / FADE;
    if (c >= BOARD_AT && c < BOARD_AT + FADE) return (c - BOARD_AT) / FADE;
    return 1;
  }

  // One chair's pose at time t: everything in park px on screen, plus its depth.
  function chairPose(ch, mo, t) {
    const phi = ch.phi0 - mo.rot;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const er = [cp, sp], et = [sp, -cp];
    // per chair: a sway after boarding (riders climbing in) and a little life while flying
    const c = mo.c;
    let dth = 0, dbe = 0;
    if (c >= BOARD_AT && c < C_LIFT + 3) {
      const u = c - BOARD_AT;
      dth += 0.035 * ch.amp * Math.exp(-u / 2.5) * Math.sin(1.4 * u + ch.ph);
      dbe += 0.05 * ch.amp * Math.exp(-u / 2.5) * Math.sin(1.4 * u + ch.ph * 1.7);
    }
    const fly = clamp01(mo.omega / W_FULL);
    dth += 0.012 * fly * ch.amp * Math.sin(2.1 * t + ch.ph);
    dbe += 0.02 * fly * ch.amp * Math.sin(1.7 * t + ch.ph * 2.3);
    const th = mo.th + dth, be = mo.be + dbe;
    const hc = HZ - LIFT * (1 - mo.lift) - R0 * Math.sin(mo.tilt) * Math.cos(phi - mo.dir);
    // the chain's direction, down from the canopy: out by theta, back along the travel by beta
    const d = [Math.sin(th) * Math.cos(be) * er[0] + Math.sin(be) * et[0], Math.sin(th) * Math.cos(be) * er[1] + Math.sin(be) * et[1], -Math.cos(th) * Math.cos(be)];
    const H = [R0 * cp, R0 * sp, hc];
    const C = [H[0] + L * d[0], H[1] + L * d[1], H[2] + L * d[2]];
    // the chair's lateral axis (radial, tilted with the swing)
    const a = [Math.cos(th) * er[0], Math.cos(th) * er[1], Math.sin(th)];
    const pH = proj(...H), pC = proj(...C);
    const angle = Math.atan2(pC[0] - pH[0], pC[1] - pH[1]);   // the chain's lean on screen, from straight down
    const psi = (phi * 180) / Math.PI - 90;
    return { ch, phi, er, et, d, H, C, a, pH, pC, angle: -angle, psi, Y: C[1], r: Math.hypot(C[0], C[1]), th, be };
  }

  // ---- GL
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `position:absolute;left:${BOX[0]}px;top:${BOX[1]}px;width:${BOX[2]}px;height:${BOX[3]}px`;
  ctx.slots.rides.append(canvas);
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true });
  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function texture(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const pSurf = program(VS_SURF, FS_SURF), pSpr = program(VS_SPR, FS_SPR);

  // One sprite texture: the crowd atlas, the chairs, the cut-outs, a soft round shadow and a white texel.
  const AW = 2048, crowdH = catlas.height;
  const pack = document.createElement("canvas");
  const chairY = crowdH + 4, cutY = chairY + chairImg.height + 4;
  let cx = 0, cutH = 0;
  const cutRect = {};
  for (const [name, img] of Object.entries(cutImg)) { cutRect[name] = [cx, cutY, img.width, img.height]; cx += img.width + 4; cutH = Math.max(cutH, img.height); }
  const shadowRect = [cx, cutY, 64, 32];
  pack.width = AW; pack.height = cutY + Math.max(cutH, 32) + 12;
  const AH = pack.height;
  const pc = pack.getContext("2d");
  pc.drawImage(catlas, 0, 0);
  pc.drawImage(chairImg, 0, chairY);
  for (const [name, img] of Object.entries(cutImg)) pc.drawImage(img, cutRect[name][0], cutRect[name][1]);
  const grad = pc.createRadialGradient(shadowRect[0] + 32, shadowRect[1] + 16, 0, shadowRect[0] + 32, shadowRect[1] + 16, 16);
  grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  pc.save(); pc.translate(shadowRect[0] + 32, shadowRect[1] + 16); pc.scale(2, 1); pc.translate(-(shadowRect[0] + 32), -(shadowRect[1] + 16));
  pc.fillStyle = grad; pc.fillRect(shadowRect[0], shadowRect[1], 64, 32); pc.restore();
  pc.fillStyle = "#fff";
  pc.fillRect(AW - 8, AH - 8, 8, 8);
  const WHITE = [(AW - 4) / AW, (AH - 4) / AH];
  const texSurf = texture(surfImg), texSpr = texture(pack);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // ---- surface meshes: [x, y, phi, v, shade, r, h] per vertex, at the painted pose (canopy lifted)
  const ell = (e, phi) => [e.c[0] + e.a * Math.cos(phi), e.c[1] + e.b * Math.sin(phi)];
  function shadeAt(curve, phi) {
    let p = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (p > Math.PI) p = 2 * Math.PI - p;
    const f = (p / Math.PI) * (curve.length - 1), i = Math.min(curve.length - 2, Math.floor(f));
    return curve[i] + (curve[i + 1] - curve[i]) * (f - i);
  }
  const RIM_Y = PT.band_top.c[1];
  function point(kind, phi, v) {
    if (kind === "top" || kind === "band") {
      const e2 = kind === "top" ? PT.collar : PT.band_bot;
      const [x0, y0] = ell(PT.band_top, phi), [x1, y1] = ell(e2, phi);
      const r = PT.band_top.a + (e2.a - PT.band_top.a) * v;
      const x = x0 + (x1 - x0) * v, y = y0 + (y1 - y0) * v;
      // h: height over the rim's plane, for the lean when the canopy tilts (the cone rises to the collar)
      return [x, y, r, kind === "top" ? v * (RIM_Y - PT.collar.c[1]) : 0];
    }
    if (kind === "cupola") {
      const c = PT.cupola, vc = c.collar_v;
      const r = v < vc ? PT.collar.a : c.a * Math.cos(((v - vc) / (1 - vc)) * Math.PI / 2);
      const h = v < vc ? (c.collar_h * v) / vc : c.collar_h + c.h * Math.sin(((v - vc) / (1 - vc)) * Math.PI / 2);
      const k = c.b / c.a;
      const x = PT.collar.c[0] + r * Math.cos(phi), y = PT.collar.c[1] + k * r * Math.sin(phi) - h;
      return [x, y, r, RIM_Y - PT.collar.c[1] + h];
    }
    // column: x and the ellipse's offset from the top centre; the shader adds the top and the length
    const c = PT.column;
    return [c.c[0] + c.r * Math.cos(phi), c.b * Math.sin(phi), 0, 0];
  }
  function mesh(kind, phi0, phi1, nphi, nv) {
    const s = surf.surfaces[kind], out = [];
    for (let i = 0; i < nphi; i++) for (let j = 0; j < nv; j++) {
      const pa = phi0 + ((phi1 - phi0) * i) / nphi, pb = phi0 + ((phi1 - phi0) * (i + 1)) / nphi;
      const va = j / nv, vb = (j + 1) / nv;
      for (const [phi, v] of [[pa, va], [pb, va], [pb, vb], [pa, va], [pb, vb], [pa, vb]]) {
        const [x, y, r, h] = point(kind, phi, v);
        out.push(x, y, phi, v, shadeAt(s.shade, phi), r, h);
      }
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [["aPos", 2, 0], ["aPhi", 1, 8], ["aV", 1, 12], ["aShade", 1, 16], ["aR", 1, 20], ["aH", 1, 24]].forEach(([n, size, off]) => {
      const l = gl.getAttribLocation(pSurf, n);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, 28, off);
    });
    return { kind, vao, count: out.length / 7, m: s.m, a0: s.a0, rect: s.rect };
  }
  const D = Math.PI / 180;
  const canopy = [mesh("top", 0, 2 * Math.PI, 144, 8), mesh("band", 0, Math.PI, 96, 3), mesh("cupola", 0, Math.PI, 48, 12)];
  const column = mesh("column", 0, Math.PI, 48, 4);
  const COL_FULL = PT.column.len + 2.5;      // down into the leaf ring, which the drum cut-out lays over it

  // ---- sprite batch
  const MAXQ = 4096, sdata = new Float32Array(MAXQ * 6 * 8);
  const sbuf = gl.createBuffer(), svao = gl.createVertexArray();
  gl.bindVertexArray(svao);
  gl.bindBuffer(gl.ARRAY_BUFFER, sbuf);
  gl.bufferData(gl.ARRAY_BUFFER, sdata.byteLength, gl.DYNAMIC_DRAW);
  [["aPos", 2, 0], ["aUv", 2, 8], ["aCol", 4, 16]].forEach(([n, size, off]) => {
    const l = gl.getAttribLocation(pSpr, n);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 32, off);
  });
  let nq = 0;
  function quad4(P, U, col) {   // P: 4 corners (tl, tr, br, bl), U: [u0, v0, u1, v1]
    if (nq >= MAXQ) return;
    const o = nq++ * 48;
    const [u0, v0, u1, v1] = U;
    const V = [[P[0], u0, v0], [P[1], u1, v0], [P[2], u1, v1], [P[0], u0, v0], [P[2], u1, v1], [P[3], u0, v1]];
    V.forEach(([[x, y], u, v], i) => { sdata.set([x, y, u, v, col[0], col[1], col[2], col[3]], o + i * 8); });
  }
  // A frame of the packed texture, w x h park px, anchored at (ax, ay) from its top-left, placed at (x, y), turned by
  // angle about the anchor; [s0, s1] draws only that horizontal slice (shares of the height).
  function sprite(rect, w, h, ax, ay, x, y, angle, flip, alpha, s0 = 0, s1 = 1) {
    if (alpha <= 0.002 || s1 <= s0) return;
    const [rx, ry, rw, rh] = rect;
    const c = Math.cos(angle), s = Math.sin(angle);
    const lx0 = flip ? -(w - ax) : -ax, lx1 = lx0 + w, ly0 = -ay + s0 * h, ly1 = -ay + s1 * h;
    const tr = (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c];
    let u0 = rx / AW, u1 = (rx + rw) / AW;
    if (flip) [u0, u1] = [u1, u0];
    const v0 = (ry + s0 * rh) / AH, v1 = (ry + s1 * rh) / AH;
    quad4([tr(lx0, ly0), tr(lx1, ly0), tr(lx1, ly1), tr(lx0, ly1)], [u0, v0, u1, v1], [alpha, alpha, alpha, alpha]);
  }
  function line(a, b, w, rgb, alpha) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
    const col = [rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha, alpha];
    quad4([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], [WHITE[0], WHITE[1], WHITE[0], WHITE[1]], col);
  }
  function shadow(x, y, w, h, alpha) {
    const [rx, ry, rw, rh] = shadowRect;
    quad4([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], [rx / AW, ry / AH, (rx + rw) / AW, (ry + rh) / AH], [alpha, alpha, alpha, alpha]);
  }
  function cutout(name) {
    const c = cut[name];
    const [rx, ry, rw, rh] = cutRect[name];
    const [x, y, w, h] = c.rect;
    quad4([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], [rx / AW, ry / AH, (rx + rw) / AW, (ry + rh) / AH], [1, 1, 1, 1]);
  }
  function flush() {
    if (!nq) return;
    gl.useProgram(pSpr);
    gl.bindVertexArray(svao);
    gl.bindBuffer(gl.ARRAY_BUFFER, sbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sdata, 0, nq * 48);
    gl.uniform4f(gl.getUniformLocation(pSpr, "uBox"), BOX[0], BOX[1], BOX[2], BOX[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texSpr);
    gl.uniform1i(gl.getUniformLocation(pSpr, "uTex"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, nq * 6);
    nq = 0;
  }
  function surfaces(list, mo, col) {
    gl.useProgram(pSurf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texSurf);
    const U = (n) => gl.getUniformLocation(pSurf, n);
    gl.uniform1i(U("uTex"), 0);
    gl.uniform4f(U("uBox"), BOX[0], BOX[1], BOX[2], BOX[3]);
    gl.uniform2f(U("uTexSize"), surf.size[0], surf.size[1]);
    gl.uniform1f(U("uRot"), mo.rot);
    gl.uniform1f(U("uDy"), LIFT * (1 - mo.lift));
    gl.uniform1f(U("uSinA"), Math.sin(mo.tilt));
    gl.uniform1f(U("uDir"), mo.dir);
    gl.uniform1f(U("uK"), K0 - KZ * HZ);
    gl.uniform1f(U("uCol"), col ? 1 : 0);
    if (col) {
      const top = PT.column.c[1] + LIFT * (1 - mo.lift);
      gl.uniform1f(U("uColTop"), top);
      gl.uniform1f(U("uColLen"), PT.column.c[1] + COL_FULL - top);
      gl.uniform1f(U("uColFull"), PT.column.len);
    }
    for (const s of list) {
      gl.uniform4f(U("uRect"), ...s.rect);
      gl.uniform1f(U("uM"), s.m);
      gl.uniform1f(U("uA0"), s.a0);
      gl.bindVertexArray(s.vao);
      gl.drawArrays(gl.TRIANGLES, 0, s.count);
    }
  }

  // Chair and rider views by heading on screen: psi = 0 faces right, 90 faces the viewer, -90 away (as the carousel).
  const VIEWS = [["side", false], ["q_toward", false], ["front", false], ["q_toward", true], ["side", true], ["q_away", true], ["back", false], ["q_away", false]];
  function views(psi) {
    const f = ((((psi / 45) % 8) + 8) % 8), i0 = Math.floor(f), w = f - i0;
    const a = VIEWS[i0], b = VIEWS[(i0 + 1) % 8];
    const mix = w < 0.46 ? 0 : w > 0.54 ? 1 : smooth((w - 0.46) / 0.08);
    return mix <= 0 ? [[a, 1]] : mix >= 1 ? [[b, 1]] : [[a, 1 - mix], [b, mix]];
  }
  function riderView(psi) {
    const p = ((psi % 360) + 540) % 360 - 180;
    if (p > 45 && p < 135) return ["front", false];
    if (p < -45 && p > -135) return ["back", false];
    return ["side", Math.abs(p) > 90];
  }
  const CHAIN_RGB = [0.36, 0.33, 0.35], CHAIN_HI = [0.78, 0.76, 0.74];

  function drawChair(pose, t, alphaR) {
    const { ch, pC, angle, psi } = pose;
    const vs = views(psi);
    const main = vs.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const mf = chairs.frames[`${ch.colour}/${main[0]}`];
    // chains: from two points under the canopy to the chair's rings (the rings' half spread, along its lateral axis)
    const frontHalf = (chairs.frames[`${ch.colour}/front`].rings[1][0] - chairs.frames[`${ch.colour}/front`].rings[0][0]) / 2;
    for (const sg of [-1, 1]) {
      const top = proj(pose.H[0] + sg * frontHalf * 0.55 * pose.er[0], pose.H[1] + sg * frontHalf * 0.55 * pose.er[1], pose.H[2]);
      const bot = proj(pose.C[0] + sg * frontHalf * pose.a[0], pose.C[1] + sg * frontHalf * pose.a[1], pose.C[2] + sg * frontHalf * pose.a[2]);
      line(top, bot, 0.62, CHAIN_RGB, 0.9);
      line(top, bot, 0.22, CHAIN_HI, 0.45);
    }
    // riders: one per seat, on the seat line, offset along the lateral axis for a double
    const riders = alphaR > 0 ? ridersAt(ch, t).slice(0, ch.seats) : [];
    const [rv, rflip] = riderView(psi);
    const cA = Math.cos(angle), sA = Math.sin(angle);
    const toScreen = (lx, ly) => [pC[0] + lx * cA - ly * sA, pC[1] + lx * sA + ly * cA];
    const seatDown = mf.seat[1] - mf.hang[1];
    const seatX = (main[1] ? mf.size[0] - mf.seat[0] : mf.seat[0]) - (main[1] ? mf.size[0] - mf.hang[0] : mf.hang[0]);
    const placed = riders.map((look, s) => {
      const off = ch.seats === 2 ? (s === 0 ? -1 : 1) * frontHalf * 0.5 : 0;
      const lat = proj(pose.C[0] + off * pose.a[0], pose.C[1] + off * pose.a[1], pose.C[2] + off * pose.a[2]);
      return { look, dx: lat[0] - pC[0], dy: lat[1] - pC[1], depth: pose.C[1] + off * pose.a[1] };
    }).sort((p, q) => p.depth - q.depth);
    const drawRiders = () => {
      for (const p of placed) {
        const f = crowdFrame(p.look, rv) || crowdFrame(p.look, "front");
        if (!f) continue;
        const k = (K * RIDER) / cmeta.scale;
        const [fx, fy] = toScreen(seatX, seatDown + RIDER_DROP);
        sprite(f.rect, f.rect[2] * k, f.rect[3] * k, f.anchor[0] * k, f.anchor[1] * k, fx + p.dx, fy + p.dy, angle, rflip, alphaR);
      }
    };
    const part = (s0, s1) => {
      for (const [[view, flip], wgt] of vs) {
        const f = chairs.frames[`${ch.colour}/${view}`];
        const r = f.rect;
        const ax = f.hang[0], ay = f.hang[1];
        const cutS = f.cut / f.size[1];
        const a0 = s0 === "cut" ? cutS : s0, a1 = s1 === "cut" ? cutS : s1;
        sprite([r[0], r[1] + chairY, r[2], r[3]], f.size[0], f.size[1], ax, ay, pC[0], pC[1], angle, flip, wgt, a0, a1);
      }
    };
    part(0, "cut");      // what is behind the riders: the backrest (nothing for back views, whose cut is 0)
    drawRiders();
    part("cut", 1);      // the seat front, safety bar and footrest; the whole chair for back views
  }

  let density = 1;
  function resize(scale) {
    density = Math.min(2.5, Math.max(1.5, scale * (devicePixelRatio || 1)));
    canvas.width = Math.round(BOX[2] * density);
    canvas.height = Math.round(BOX[3] * density);
  }
  resize(ctx.scale());

  const stats = { ms: 0, frames: 0 };
  function draw(t) {
    const t0 = performance.now();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const mo = motion(t);
    const alphaR = riderAlpha(t);
    const poses = CH.map((ch) => chairPose(ch, mo, t));
    // contact shadows while a chair hangs low over the platform
    nq = 0;
    for (const p of poses) {
      const zb = p.C[2] - 9, over = p.r < geom.platform.r ? FLOOR : 0;
      const hgt = zb - over;
      const a = 0.28 * clamp01(1 - hgt / 14);
      if (a > 0.01) {
        const [sx, sy] = proj(p.C[0], p.C[1], over);
        shadow(sx, sy, p.ch.seats === 2 ? 16 : 11, 4.5, a);
      }
    }
    const back = poses.filter((p) => p.Y < 0).sort((a, b) => a.Y - b.Y);
    const front = poses.filter((p) => p.Y >= 0).sort((a, b) => (a.r < FENCE_R ? a.Y : 1000 + a.Y) - (b.r < FENCE_R ? b.Y : 1000 + b.Y));
    for (const p of back) drawChair(p, t, alphaR);
    flush();
    surfaces([column], mo, true);
    cutout("drum");
    let fenceDone = false;
    for (const p of front) {
      if (!fenceDone && p.r >= FENCE_R) { cutout("fence"); fenceDone = true; }
      drawChair(p, t, alphaR);
    }
    if (!fenceDone) cutout("fence");
    flush();
    surfaces(canopy, mo, false);
    // the finial on the cupola's tip, moved with the lift and the tilt
    const fin = cut.finial;
    const hF = RIM_Y - fin.anchor[1];
    const sa = Math.sin(mo.tilt);
    const fx = fin.anchor[0] + hF * sa * Math.cos(mo.dir), fy = fin.anchor[1] + LIFT * (1 - mo.lift) + hF * sa * (K0 - KZ * HZ) * Math.sin(mo.dir);
    const [rx, ry, rw, rh] = cutRect.finial;
    const [x0, y0, w0, h0] = fin.rect;
    const ox = x0 - fin.anchor[0] + fx, oy = y0 - fin.anchor[1] + fy;
    quad4([[ox, oy], [ox + w0, oy], [ox + w0, oy + h0], [ox, oy + h0]], [rx / AW, ry / AH, (rx + rw) / AW, (ry + rh) / AH], [1, 1, 1, 1]);
    flush();
    stats.ms += performance.now() - t0;
    stats.frames++;
    last = { t, mo, poses };
  }
  let last = null;

  // ---- riders contract (rides/RIDERS.md)
  const riders = {
    gate: QUEUE[0],
    queue: QUEUE,
    exit: EXIT,
    keys: CH.map((c) => c.key),
    loads(t0, t1) {
      const out = [];
      const n0 = Math.ceil((t0 - BOARD_AT) / T), n1 = Math.ceil((t1 - BOARD_AT) / T);
      for (let n = Math.max(0, n0); n < n1; n++) {
        const t = n * T + BOARD_AT;
        if (t < t0 || t >= t1) continue;
        for (const ch of CH) out.push({ t, key: ch.key, seats: ch.seats, until: (n + 1) * T + UNLOAD_AT });
      }
      return out;
    },
  };

  // ---- depth (rides/RIDERS.md "Depth"): what stands in front of animals behind the ride. The crowd packs each mask
  // once, so the masks are drawn here once and moved with rect / matrix: the base (static), the canopy (its rect
  // follows the lift; the tilt, under 5 px, is left out), the column (a solid rect from the canopy down to the drum)
  // and every chair with its rider (a solid rect in the chair's own units, turned with its chain by a matrix). sortY is
  // the ride's axis on the deck; for a chair, the point of the deck under it.
  const MS = 2;   // mask px per park px
  function maskOf(rect, drawFn) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(rect[2] * MS); c.height = Math.ceil(rect[3] * MS);
    const m = c.getContext("2d");
    m.setTransform(MS, 0, 0, MS, -rect[0] * MS, -rect[1] * MS);
    m.fillStyle = "#000";
    drawFn(m);
    return c;
  }
  const poly = (m, pts) => { m.beginPath(); pts.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y))); m.closePath(); m.fill(); };
  const pl = geom.platform, fe = geom.fence;
  const ringPts = (r, z) => Array.from({ length: 72 }, (_, i) => proj(r * Math.cos((i / 72) * 2 * Math.PI), r * Math.sin((i / 72) * 2 * Math.PI), z));
  const baseRect = [HUB[0] - pl.r - 2, cut.drum.rect[1] - 1, 2 * pl.r + 4, HUB[1] + K0 * (pl.r + 1) - cut.drum.rect[1] + 2];
  const baseMask = maskOf(baseRect, (m) => {
    for (const pts of [ringPts(pl.r + 0.8, 0), ringPts(pl.r + 0.5, pl.h), ringPts(fe.r + 0.5, pl.h + fe.h + 1.5)]) poly(m, pts);
    m.fillRect(HUB[0] - pl.r - 0.8, HUB[1] - pl.h, 2 * pl.r + 1.6, pl.h);
    m.fillRect(...cut.drum.rect);
  });
  const e1 = PT.band_top, e2 = PT.band_bot, fin = cut.finial;
  const canopyRect = [e2.c[0] - e2.a - 1, fin.rect[1] - 1, 2 * e2.a + 2, e2.c[1] + e2.b - fin.rect[1] + 2];
  const canopyMask = maskOf(canopyRect, (m) => {
    const pts = [];
    for (let i = 0; i <= 36; i++) { const p = Math.PI + (i / 36) * Math.PI; pts.push([e1.c[0] + e1.a * Math.cos(p), e1.c[1] + e1.b * Math.sin(p)]); }
    for (let i = 0; i <= 36; i++) { const p = (i / 36) * Math.PI; pts.push([e2.c[0] + e2.a * Math.cos(p), e2.c[1] + e2.b * Math.sin(p)]); }
    poly(m, pts);
    m.beginPath(); m.ellipse(PT.collar.c[0], PT.collar.c[1] - PT.cupola.h / 2, PT.collar.a, PT.cupola.h / 2 + PT.collar.b + PT.cupola.collar_h, 0, 0, 2 * Math.PI); m.fill();
    m.fillRect(...fin.rect);
  });
  const occBase = { rect: baseRect, sortY: HUB[1], mask: baseMask };
  const occCanopy = { rect: [...canopyRect], sortY: HUB[1], mask: canopyMask };
  const occColumn = { rect: [0, 0, 0, 0], sortY: HUB[1] };
  const occChairs = CH.map(() => ({ rect: [0, 0, 0, 0], matrix: [1, 0, 0, 1, 0, 0], sortY: HUB[1] }));
  const occList = [occBase, occCanopy, occColumn, ...occChairs];
  let occT = null;
  function occluders(t) {
    if (t === occT) return occList;
    occT = t;
    const mo = motion(t), dy = LIFT * (1 - mo.lift);
    occCanopy.rect[1] = canopyRect[1] + dy;
    const top = PT.column.c[1] + dy;
    occColumn.rect = [PT.column.c[0] - PT.column.r, top, 2 * PT.column.r, PT.column.c[1] + COL_FULL - top];
    CH.forEach((ch, i) => {
      const p = chairPose(ch, mo, t), f = chairs.frames[`${ch.colour}/front`], o = occChairs[i];
      o.rect = [-f.size[0] / 2, -f.hang[1] - 9, f.size[0], f.size[1] + 9];   // the chair and 9 px of rider above it
      o.matrix = [Math.cos(p.angle), Math.sin(p.angle), -Math.sin(p.angle), Math.cos(p.angle), p.pC[0], p.pC[1]];
      o.sortY = HUB[1] + K0 * p.C[1];
    });
    return occList;
  }

  // ---- checks: the chairs (with their riders) against the neighbours over a whole cycle. Each chair is sampled as
  // points over its box turned with the chain; each neighbour is a polygon traced on the painting. gap: the nearest
  // sample's distance outside it (negative: samples inside, as deep as the deepest).
  const KEEP = {
    lamp: [[2675, 1456], [2684, 1453], [2693, 1451], [2702, 1453], [2709, 1457], [2709, 1478], [2675, 1478]],
    wheel: [[2638, 1300], [2694, 1300], [2694, 1416], [2638, 1416]],
    stall: [[2859, 1489], [2899, 1449], [2960, 1449], [2960, 1600], [2859, 1600]],
  };
  function polyDist(x, y, P) {
    let inside = false, d = Infinity;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const ex = xj - xi, ey = yj - yi, u = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(x - xi - u * ex, y - yi - u * ey));
    }
    return inside ? -d : d;
  }
  function clearance(step = 0.05) {
    const worst = {};
    for (let t = 0; t < T; t += step) {
      const mo = motion(t);
      for (const ch of CH) {
        const p = chairPose(ch, mo, t);
        const f = chairs.frames[`${ch.colour}/front`];
        const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
        for (let u = 0; u <= 6; u++) for (let v = 0; v <= 8; v++) {
          const lx = -f.size[0] / 2 + (f.size[0] * u) / 6, ly = -f.hang[1] - 8 + ((f.size[1] + 8) * v) / 8;   // 8 px of rider above
          const x = p.pC[0] + lx * ca - ly * sa, y = p.pC[1] + lx * sa + ly * ca;
          for (const [name, P] of Object.entries(KEEP)) {
            const g = polyDist(x, y, P);
            if (!(name in worst) || g < worst[name].gap) worst[name] = { gap: Math.round(g * 10) / 10, t: Math.round(t * 100) / 100, chair: ch.key };
          }
        }
      }
    }
    return worst;
  }

  window.__swings = { motion, chairPose: (i, t) => chairPose(CH[i], motion(t), t), ridersAt: (t) => CH.map((c) => ridersAt(c, t)), fromCrowd: (t) => CH.map((c) => (ctx.riders ? ctx.riders(ctx.name, c.key, t) : null)), CH, stats, riders, occluders, clearance, tab, get last() { return last; } };

  riders.loads = hours.loads(riders.loads);
  return {
    update(t) { draw(hours.run(t)); },
    resize,
    riders,
    occluders: (t) => occluders(hours.run(t)),
  };
}
