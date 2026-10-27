// The two promenade carousels (west by the entrance, east by the Dream Wheel), turning.
//
// - Plates (plate_<name>.webp) erase the painted horses; the centre columns are cut from them (column_<name>.webp).
// - The roof, the valance and the platform's side band are the painting's own surfaces: unwrapped once
//   (tools/surfaces.py) into seamless tiles, and re-wrapped here on meshes over the same painted surfaces, shifted by
//   the turn angle. Their light (a 1-D curve over the angle) stays where the painting has it.
// - Horses are sprites (horses.webp, 5 views of 4 horses, tools/build_sprites.py) on a ring in the floor ellipse,
//   bobbing on brass poles; riders are the crowd's own sprites (tests/park-crowd/atlas.png), or the crowd's riders
//   through ctx.riders when the crowd runs (rides/RIDERS.md).
// - One WebGL2 canvas over both carousels; one sprite draw and three surface draws per carousel each frame.
// - Motion is closed form from the master clock: a 64 s cycle of loading (12 s), start-up (4 s), ride (40 s) and
//   slow-down (8 s); the east carousel runs half a cycle later. &t= freezes a frame exactly.

const T = 64, LOAD = 12, UP = 4, RIDE = 40, DOWN = 8;
const OMEGA = (2 * Math.PI) / 14;          // full speed: a turn in 14 s
const TURN_PER_CYCLE = OMEGA * (UP / 2 + RIDE + DOWN / 2);
const UNLOAD_AT = 2, BOARD_AT = 7, FADE = 0.6;
const BOX = [1550, 1090, 1340, 470];       // canvas box in park px: both carousels
const UNIT = 3840 / 3904;
const K = (38 * UNIT) / 30;                // the crowd's sprite scale at size 38
const RIDER = 0.55;                        // riders' size on a horse, against the crowd's

// Per carousel: horse count, ring radius (share of the floor ellipse), scale, horse lift, bob, cycle offset, and the
// queue (gate, slots from the gate backwards along the rail, exit) on the promenade.
const CAROUSELS = {
  west: { horses: 12, ring: 0.74, scale: 1, lift: 19, bob: 3.5, offset: 0 },
  east: { horses: 10, ring: 0.74, scale: 0.86, lift: 19, bob: 3.5, offset: T / 2 },
};
const RAIL = [[1487, 1290], [1553, 1301], [1607, 1313], [1707, 1335], [1800, 1355], [2613, 1533], [2733, 1560], [2883, 1590]];
const railY = (x) => {
  for (let i = 0; i < RAIL.length - 1; i++) {
    const [ax, ay] = RAIL[i], [bx, by] = RAIL[i + 1];
    if (x <= bx) return ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return RAIL.at(-1)[1];
};
const r1 = (v) => Math.round(v * 10) / 10;
// The queue runs west from the gate along the rail, in the open deck between the carousel and the rail.
const line = (x0, dy) => Array.from({ length: 10 }, (_, k) => [r1(x0 - 9 * k), r1(railY(x0 - 9 * k) - dy)]);
const QUEUES = {
  east: { queue: line(2738, 13), exit: [2832, 1537] },
  west: { queue: line(1594, 11), exit: [1756, 1290] },
};
for (const q of Object.values(QUEUES)) q.gate = q.queue[0];

const VS_SURF = `#version 300 es
in vec2 aPos; in float aPhi; in float aV; in float aShade;
uniform vec4 uBox;
out float vPhi; out float vV; out float vShade;
void main() {
  vPhi = aPhi; vV = aV; vShade = aShade;
  gl_Position = vec4((aPos.x - uBox.x) / uBox.z * 2.0 - 1.0, 1.0 - (aPos.y - uBox.y) / uBox.w * 2.0, 0.0, 1.0);
}`;
const FS_SURF = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexSize; uniform vec4 uRect; uniform float uM; uniform float uA0; uniform float uRot;
in float vPhi; in float vV; in float vShade;
out vec4 color;
void main() {
  // material angle under this pixel, as a share of one tile
  float s = (vPhi + uRot - uA0) * uM / 6.28318530718;
  float u = fract(s);
  vec2 tc = (uRect.xy + vec2(u, vV) * uRect.zw) / uTexSize;
  vec2 tcu = (uRect.xy + vec2(s, vV) * uRect.zw) / uTexSize;   // unwrapped, for smooth derivatives across the wrap
  // derivatives scaled by 0.75: a little sharper than trilinear's choice without shimmer as the stripes turn
  vec4 c = textureGrad(uTex, tc, dFdx(tcu) * 0.75, dFdy(tcu) * 0.75);
  color = vec4(c.rgb * vShade, 1.0);
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
void main() { color = texture(uTex, vUv, -0.4) * vCol; }   // LOD bias: crisper minified sprites`;

const load = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2);
const ramp = (x) => (x <= 0 ? 0 : x >= 1 ? x - 0.5 : x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI)); // ∫ smooth
function hash(...xs) {
  let h = 2166136261;
  for (const c of xs.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

// Turn angle (radians, growing) and speed share at time t for a carousel whose cycle starts at `offset`.
function motion(t, offset) {
  const u = t - offset, n = Math.floor(u / T), c = u - n * T;
  let a = 0, s = 0;
  if (c < LOAD) { a = 0; s = 0; }
  else if (c < LOAD + UP) { const x = (c - LOAD) / UP; a = UP * ramp(x); s = smooth(x); }
  else if (c < LOAD + UP + RIDE) { a = UP / 2 + (c - LOAD - UP); s = 1; }
  else { const x = (c - LOAD - UP - RIDE) / DOWN; a = UP / 2 + RIDE + DOWN * (x - ramp(x)); s = 1 - smooth(x); }
  return { angle: n * TURN_PER_CYCLE + OMEGA * a, speed: s, cycle: n, c };
}

function ellipse(e, phi) {
  const r = ((e.rot || 0) * Math.PI) / 180, u = e.a * Math.cos(phi), v = e.b * Math.sin(phi);
  return [e.c[0] + u * Math.cos(r) - v * Math.sin(r), e.c[1] + u * Math.sin(r) + v * Math.cos(r)];
}

export async function mount(ctx) {
  const dir = ctx.dir;
  const url = (f) => new URL(f, dir).href;
  const [geom, surf, horses, plates, cmeta, catlas, surfImg, horseImg] = await Promise.all([
    fetch(url("geom.json")).then((r) => r.json()),
    fetch(url("surfaces.json")).then((r) => r.json()),
    fetch(url("horses.json")).then((r) => r.json()),
    fetch(url("plates.json")).then((r) => r.json()),
    fetch(url("../../tests/park-crowd/atlas.json")).then((r) => r.json()),
    load(url("../../tests/park-crowd/atlas.png")),
    load(url("surfaces.webp")),
    load(url("horses.webp")),
  ]);
  const colImgs = {};
  for (const name of Object.keys(CAROUSELS)) colImgs[name] = await load(url(plates[name].column.file));
  await Promise.all(Object.keys(CAROUSELS).map((name) => {
    const img = ctx.addPatch(url(plates[name].file), plates[name].rect);
    return img.decode().catch(() => {});
  }));

  // One sprite texture: the crowd atlas, the horse atlas, both columns and a white texel for the poles.
  const AW = 2048, crowdH = catlas.height;
  const colH = Math.max(...Object.values(colImgs).map((i) => i.height));
  const AH = crowdH + horseImg.height + colH + 16;
  const pack = document.createElement("canvas");
  pack.width = AW; pack.height = AH;
  const pc = pack.getContext("2d");
  pc.drawImage(catlas, 0, 0);
  const horseY = crowdH + 4;
  pc.drawImage(horseImg, 0, horseY);
  const colY = horseY + horseImg.height + 4;
  let colX = 0;
  const colRect = {};
  for (const [name, img] of Object.entries(colImgs)) { pc.drawImage(img, colX, colY); colRect[name] = [colX, colY, img.width, img.height]; colX += img.width + 4; }
  pc.fillStyle = "#fff";
  pc.fillRect(AW - 8, AH - 8, 8, 8);
  const WHITE = [(AW - 4) / AW, (AH - 4) / AH];

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
  function texture(img, mip) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const pSurf = program(VS_SURF, FS_SURF), pSpr = program(VS_SPR, FS_SPR);
  const texSurf = texture(surfImg, true), texSpr = texture(pack, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Surface meshes: [x, y, phi, v, shade] per vertex, triangles.
  function shadeAt(curve, phi) {
    let p = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (p > Math.PI) p = 2 * Math.PI - p;           // the back half takes the front half's light, mirrored
    const f = (p / Math.PI) * (curve.length - 1), i = Math.min(curve.length - 2, Math.floor(f));
    return curve[i] + (curve[i + 1] - curve[i]) * (f - i);
  }
  function mesh(g, kind, phi0, phi1, v0, v1, nphi, nv) {
    const curve = surf.carousels[g.name][kind].shade, out = [];
    const P = (phi, v) => {
      if (kind === "roof") { const [rx, ry] = ellipse(g.rim, phi); return [g.apex[0] + v * (rx - g.apex[0]), g.apex[1] + v * (ry - g.apex[1])]; }
      const [e0, e1] = kind === "val" ? [g.rim, g.val] : [g.top, g.bot];
      const [x0, y0] = ellipse(e0, phi), [x1, y1] = ellipse(e1, phi);
      return [x0 * (1 - v) + x1 * v, y0 * (1 - v) + y1 * v];
    };
    for (let i = 0; i < nphi; i++) for (let j = 0; j < nv; j++) {
      const pa = phi0 + ((phi1 - phi0) * i) / nphi, pb = phi0 + ((phi1 - phi0) * (i + 1)) / nphi;
      const va = v0 + ((v1 - v0) * j) / nv, vb = v0 + ((v1 - v0) * (j + 1)) / nv;
      const q = [[pa, va], [pb, va], [pb, vb], [pa, va], [pb, vb], [pa, vb]];
      for (const [phi, v] of q) out.push(...P(phi, v), phi, v, shadeAt(curve, phi));
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const loc = (n) => gl.getAttribLocation(pSurf, n);
    [["aPos", 2, 0], ["aPhi", 1, 8], ["aV", 1, 12], ["aShade", 1, 16]].forEach(([n, size, off]) => {
      gl.enableVertexAttribArray(loc(n));
      gl.vertexAttribPointer(loc(n), size, gl.FLOAT, false, 20, off);
    });
    const m = surf.carousels[g.name][kind];
    return { vao, count: out.length / 5, m: m.m, a0: m.a0, rect: m.rect };
  }
  const D = Math.PI / 180;
  const rides = Object.entries(CAROUSELS).map(([name, cfg]) => {
    const g = { ...geom[name], name };
    return {
      name, cfg, g,
      surfaces: [
        mesh(g, "band", 3 * D, 177 * D, 0, 1, 90, 2),
        mesh(g, "val", 4 * D, 176 * D, 0, 1, 90, 3),
        mesh(g, "roof", 180 * D, 360 * D, 0.03, 0.985, 90, 6),
        mesh(g, "roof", 0, 180 * D, 0.03, 1, 90, 10),
      ],
    };
  });

  // Sprite batch
  const MAXQ = 2048, sdata = new Float32Array(MAXQ * 6 * 8);
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
  function quad(x0, y0, x1, y1, u0, v0, u1, v1, col) {
    if (nq >= MAXQ) return;
    const o = nq++ * 48;
    const V = [[x0, y0, u0, v0], [x1, y0, u1, v0], [x1, y1, u1, v1], [x0, y0, u0, v0], [x1, y1, u1, v1], [x0, y1, u0, v1]];
    V.forEach(([x, y, u, v], i) => { sdata.set([x, y, u, v, col[0], col[1], col[2], col[3]], o + i * 8); });
  }
  // a frame of the packed texture: rect [x, y, w, h] in texture px, size in park px, anchor in park px (from top-left)
  function sprite(rect, w, h, ax, ay, x, y, flip, alpha) {
    const [rx, ry, rw, rh] = rect;
    const u0 = rx / AW, v0 = ry / AH, u1 = (rx + rw) / AW, v1 = (ry + rh) / AH;
    const left = x - (flip ? w - ax : ax), top = y - ay;
    quad(left, top, left + w, top + h, flip ? u1 : u0, v0, flip ? u0 : u1, v1, [alpha, alpha, alpha, alpha]);
  }
  function solid(x0, y0, x1, y1, rgb, alpha) {
    quad(x0, y0, x1, y1, WHITE[0], WHITE[1], WHITE[0], WHITE[1], [rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha, alpha]);
  }

  const looks = [...new Set(Object.keys(cmeta.frames).filter((k) => k.endsWith("/front_stand")).map((k) => k.split("/")[0]))].filter((l) => l !== "pet");
  const crowdFrame = (look, view) => cmeta.frames[`${look}/${view}_stand`];

  // Views of a horse by its heading on screen: psi = 0 faces right, 90 faces the viewer, -90 away.
  const VIEWS = [["side", false], ["q_toward", false], ["front", false], ["q_toward", true], ["side", true], ["q_away", true], ["back", false], ["q_away", false]];
  function views(psi) {
    const f = ((((psi / 45) % 8) + 8) % 8), i0 = Math.floor(f), w = f - i0;
    const a = VIEWS[i0], b = VIEWS[(i0 + 1) % 8];
    const mix = w < 0.46 ? 0 : w > 0.54 ? 1 : smooth((w - 0.46) / 0.08);   // a short cross-fade at the switch
    return mix <= 0 ? [[a, 1]] : mix >= 1 ? [[b, 1]] : [[a, 1 - mix], [b, mix]];
  }
  function riderView(psi) {
    const p = ((psi % 360) + 540) % 360 - 180;
    if (p > 45 && p < 135) return ["front", false];
    if (p < -45 && p > -135) return ["back", false];
    return ["side", Math.abs(p) > 90];
  }
  const HORSES = horses.horses;
  const keyOf = (name, i) => `${name}:horse${i}`;
  const keysOf = (name) => Array.from({ length: CAROUSELS[name].horses }, (_, i) => keyOf(name, i));

  // Who rides horse i of a carousel at time t: the crowd's riders when it runs, otherwise our own, seeded per cycle.
  function ridersAt(r, i, t) {
    const fromCrowd = ctx.riders ? ctx.riders(ctx.name, keyOf(r.name, i), t) : null;
    if (fromCrowd) return fromCrowd;
    const u = t - r.cfg.offset, n = Math.floor(u / T), c = u - n * T;
    const cyc = c >= BOARD_AT ? n : c >= UNLOAD_AT ? null : n - 1;   // riders boarded at the last BOARD_AT
    if (cyc === null) return [];
    if (hash(r.name, i, cyc, "busy") > 0.62) return [];
    const kid = hash(r.name, i, cyc, "kid") < 0.18;
    return [kid ? "bear_cub" : looks[Math.floor(hash(r.name, i, cyc, "look") * looks.length)]];
  }
  function riderAlpha(r, t) {
    const c = (((t - r.cfg.offset) % T) + T) % T;
    if (c > UNLOAD_AT - FADE && c < UNLOAD_AT) return [(UNLOAD_AT - c) / FADE, t];
    if (c >= BOARD_AT && c < BOARD_AT + FADE) return [(c - BOARD_AT) / FADE, t];
    return [1, t];
  }

  let density = 1;
  function resize(scale) {
    // At least 1.5 canvas px per park px, even when the screen has fewer: matching the screen 1:1 came out half as
    // sharp as the painting (Laplacian variance 2127 against 4826 at 2560 x 1440), because the world sits at a
    // fractional offset and the compositor resamples; letting the browser shrink a denser canvas measured 5457.
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
    for (const r of rides) {
      const { g, cfg } = r;
      const mo = motion(t, cfg.offset);
      const [riderA, riderT] = riderAlpha(r, t);
      // horses, back to front; the column sorts with them at the floor's centre
      nq = 0;
      const items = [];
      for (let i = 0; i < cfg.horses; i++) {
        const theta = (i / cfg.horses) * 2 * Math.PI - mo.angle;     // counter-clockwise from above
        const [fx, fy] = ellipse({ ...g.top, a: g.top.a * cfg.ring, b: g.top.b * cfg.ring }, theta);
        const [, ty] = ellipse({ ...g.rim, a: g.rim.a * cfg.ring, b: g.rim.b * cfg.ring }, theta);
        const bob = cfg.bob * cfg.scale * Math.sin(3 * (mo.angle + (i / cfg.horses) * 2 * Math.PI) + (i % 2) * Math.PI);
        items.push({ i, theta, fx, fy, ty, bob, sort: fy });
      }
      items.push({ column: true, sort: g.top.c[1] + 0.5 });
      items.sort((a, b) => a.sort - b.sort);
      for (const it of items) {
        if (it.column) {
          const c = plates[r.name].column;
          sprite(colRect[r.name], c.rect[2], c.rect[3], 0, 0, c.rect[0], c.rect[1], false, 1);
          continue;
        }
        const sc = cfg.scale, psi = ((it.theta * 180) / Math.PI) - 90;
        const horse = HORSES[it.i % HORSES.length];
        const py = it.fy - cfg.lift * sc - it.bob;
        // contact shadow on the floor
        const sh = cmeta.frames.shadow;
        if (sh) sprite(sh.rect, (sh.rect[2] / cmeta.scale) * 0.9 * sc, (sh.rect[3] / cmeta.scale) * 0.7 * sc, (sh.anchor[0] / cmeta.scale) * 0.9 * sc, (sh.anchor[1] / cmeta.scale) * 0.7 * sc, it.fx, it.fy, false, 0.35);
        const [rv, rflip] = riderView(psi);
        const riders = riderA > 0 ? ridersAt(r, it.i, riderT) : [];
        const vs = views(psi);
        const main = vs.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        const hf = horses.frames[`${horse}/${main[0]}`];
        const seatX = (main[1] ? hf.size[0] - hf.seat[0] : hf.seat[0]) - (main[1] ? hf.size[0] - hf.pole[0] : hf.pole[0]);
        const seatY = hf.seat[1] - hf.pole[1];
        const drawRider = () => {
          for (const look of riders.slice(0, 1)) {
            const f = crowdFrame(look, rv) || crowdFrame(look, "front");
            if (!f) continue;
            const k = (K * RIDER * sc) / cmeta.scale;
            sprite(f.rect, f.rect[2] * k, f.rect[3] * k, f.anchor[0] * k, f.anchor[1] * k, it.fx + seatX * sc, py + seatY * sc, rflip, riderA);
          }
        };
        const drawPole = () => {
          const x = it.fx, w = 1.5 * sc;
          solid(x - w / 2 - 0.6, it.ty, x + w / 2 + 0.6, it.fy, [0.35, 0.24, 0.12], 0.9);
          solid(x - w / 2, it.ty, x + w / 2, it.fy, [0.91, 0.74, 0.36], 1);
          solid(x - w / 2 + 0.25, it.ty, x - w / 2 + 0.75, it.fy, [1, 0.93, 0.7], 0.8);
        };
        const frontish = main[0] === "front" || main[0] === "back";
        if (frontish) { drawPole(); drawRider(); } else { drawRider(); drawPole(); }
        for (const [[view, flip], wgt] of vs) {
          const f = horses.frames[`${horse}/${view}`];
          const ax = f.pole[0], ay = f.pole[1];
          sprite([f.rect[0], f.rect[1] + horseY, f.rect[2], f.rect[3]], f.size[0] * sc, f.size[1] * sc, ax * sc, ay * sc, it.fx, py, flip, wgt);
        }
      }
      gl.useProgram(pSpr);
      gl.bindVertexArray(svao);
      gl.bindBuffer(gl.ARRAY_BUFFER, sbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sdata, 0, nq * 48);
      gl.uniform4f(gl.getUniformLocation(pSpr, "uBox"), BOX[0], BOX[1], BOX[2], BOX[3]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texSpr);
      gl.uniform1i(gl.getUniformLocation(pSpr, "uTex"), 0);
      gl.drawArrays(gl.TRIANGLES, 0, nq * 6);
      // the turning surfaces over everything under the roof
      gl.useProgram(pSurf);
      gl.bindTexture(gl.TEXTURE_2D, texSurf);
      gl.uniform1i(gl.getUniformLocation(pSurf, "uTex"), 0);
      gl.uniform4f(gl.getUniformLocation(pSurf, "uBox"), BOX[0], BOX[1], BOX[2], BOX[3]);
      gl.uniform2f(gl.getUniformLocation(pSurf, "uTexSize"), surf.size[0], surf.size[1]);
      gl.uniform1f(gl.getUniformLocation(pSurf, "uRot"), mo.angle);
      for (const s of r.surfaces) {
        gl.uniform4f(gl.getUniformLocation(pSurf, "uRect"), ...s.rect);
        gl.uniform1f(gl.getUniformLocation(pSurf, "uM"), s.m);
        gl.uniform1f(gl.getUniformLocation(pSurf, "uA0"), s.a0);
        gl.bindVertexArray(s.vao);
        gl.drawArrays(gl.TRIANGLES, 0, s.count);
      }
    }
    stats.ms += performance.now() - t0;
    stats.frames++;
  }

  const riders = {
    ...QUEUES.east,
    keys: keysOf("east"),
    more: [{ ...QUEUES.west, keys: keysOf("west") }],
    loads(t0, t1) {
      const out = [];
      for (const [name, cfg] of Object.entries(CAROUSELS)) {
        // board at offset + n T + BOARD_AT; riders get off at the next cycle's UNLOAD_AT
        const n0 = Math.ceil((t0 - cfg.offset - BOARD_AT) / T), n1 = Math.ceil((t1 - cfg.offset - BOARD_AT) / T);
        for (let n = Math.max(0, n0); n < n1; n++) {
          const t = cfg.offset + n * T + BOARD_AT;
          if (t < t0 || t >= t1) continue;
          for (const key of keysOf(name)) out.push({ t, key, seats: 1, until: cfg.offset + (n + 1) * T + UNLOAD_AT });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    },
  };

  window.__carousel = { motion: (t, name) => motion(t, CAROUSELS[name].offset), stats, rides, riders };

  return {
    update(t) { draw(t); },
    resize,
    riders,
  };
}
