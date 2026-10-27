// The sea comes alive, gently, out of the painting's own pixels (rides/sea/RESULTS.md).
//
// One WebGL2 canvas over the sea and the swash zone, in the plate slot (rides and the crowd stay above). Its base is
// the painting itself, cropped from the page's #painting image at the canvas's own resolution, so a still frame is
// the painting. Every approach shares the swash: the painted foam band slides up the sand and back along the shore
// normal (a signed-distance field traced from the painting), waves sweeping obliquely along the beach, and the sand
// a retreating wave uncovers stays a little darker for a moment. The open water differs:
//   &sea=a  warp:  the painted water sways a pixel or two in a slow noise field; tiny glints twinkle
//   &sea=b  drift: the painted ripple dashes are lifted off (the water under them filled from around) and each drifts
//                  shoreward and fades in and out on its own cycle
//   &sea=c  cycle: colour cycling: the dashes stay where they are painted and bands of light roll through them
//                  toward the shore, as waves do
// &swash=13 is how far (park px) the foam runs up the sand at most.
// &sea=copy only redraws the painting (the cost floor for comparisons).
// &fps=8 draws on threes (limited animation, also the cheapest), &calm=0 stops all motion (must equal the still),
// &calm=0.5 halves it. prefers-reduced-motion stops it too.
const VS = `#version 300 es
in vec2 aPos;
out vec2 vP;
uniform vec2 uRect;
void main() { vP = (aPos * 0.5 + 0.5) * uRect; vP.y = uRect.y - vP.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `
uniform sampler2D uPaint, uMasks, uDash, uClean, uHole;
uniform vec2 uRect;
uniform float uT, uCalm, uAmp;
uniform vec2 uShore;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float sdf(vec2 p) { return texture(uMasks, p / uRect).r * 255.0 - 128.0; }
vec3 paint(vec2 p) { return texture(uPaint, p / uRect).rgb; }

// Swash: quick uprush, slow backwash, a short rest. f in [0, 1) is the phase within one wave.
float swash(float f) {
  if (f < 0.28) { float k = f / 0.28; return mix(-0.3, 1.0, 1.0 - (1.0 - k) * (1.0 - k)); }
  float k = clamp((f - 0.28) / 0.6, 0.0, 1.0);
  return mix(1.0, -0.3, k * k * (3.0 - 2.0 * k));
}
const float T = 8.5;   // seconds per wave
const float L = 1400.0; // park px along the shore per wave phase: the uprush sweeps down the beach

// Returns the swash displacement (park px along n, + up the sand) and, in w, how much this pixel follows it.
// peak: this wave's reach; since: seconds since it peaked.
float swashAt(vec2 p, float s, float ang, out vec2 n, out float w, out float peak, out float since) {
  n = vec2(cos(ang), sin(ang));
  float u = dot(p, uShore);
  float ph = uT / T - u / L + 0.45 * vnoise(u / 610.0);
  float wave = floor(ph);
  float amp = uAmp * (0.65 + 0.7 * vnoise(u / 420.0 + wave * 3.7)) * uCalm;
  float f = fract(ph);
  peak = amp;
  since = f < 0.28 ? 99.0 : (f - 0.28) * T;
  w = smoothstep(-120.0, -40.0, s) * (1.0 - smoothstep(14.0, 80.0, s));
  return amp * swash(f);
}

// The sand a wave has just left stays darker for a moment.
vec3 wetten(vec3 c, float s, float d, float peak, float since) {
  float under = smoothstep(peak + 2.0, peak * 0.55, s) * smoothstep(d - 1.0, d + 4.0, s);
  float wet = under * exp(-since / 2.6) * step(0.0, s);
  return mix(c, c * vec3(0.86, 0.83, 0.87), wet * 0.85);
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 outColor;
uniform int uMode;
${COMMON}
void main() {
  vec2 p = vP;
  vec4 m = texture(uMasks, p / uRect);
  float s = m.r * 255.0 - 128.0;
  float open = m.g;
  if (s > 82.0) { outColor = vec4(0.0); return; }
  if (uMode == 3) { outColor = vec4(paint(p), 1.0); return; }  // the cost floor: just the painting
  vec2 n = vec2(0.0); float w = 0.0, peak = 0.0, since = 99.0, d = 0.0;
  // The swash only within reach of the shore; the open sea skips it.
  if (s > -125.0) d = swashAt(p, s, m.b * 6.2831853 - 3.1415927, n, w, peak, since);
  vec2 q = p - n * d * w;
  vec3 c;
  if (uMode == 0) {
    // warp: the open water sways a pixel or two in a slow drifting field.
    vec2 g = vec2(vnoise2(p / 140.0 + vec2(uT * 0.05, uT * 0.017)), vnoise2(p / 140.0 + vec2(13.1 - uT * 0.03, uT * 0.041)));
    q += (g - 0.5) * 3.2 * open * uCalm;
    c = paint(q);
    // Glints: a speck in some 22 px cells, lit briefly, flattened by the camera.
    vec2 cell = floor(p / vec2(22.0, 14.0));
    float h = hash2(cell);
    vec2 at = (cell + vec2(0.2 + 0.6 * hash2(cell + 7.1), 0.2 + 0.6 * hash2(cell + 3.3))) * vec2(22.0, 14.0);
    float tw = max(0.0, sin(uT * (0.5 + h) + h * 40.0));
    tw = pow(tw, 30.0) * step(0.55, h) * uCalm;
    vec2 dd = (p - at) / vec2(2.4, 1.1);
    c = mix(c, vec3(0.98, 0.96, 0.92), tw * smoothstep(1.0, 0.3, length(dd)) * open);
  } else if (uMode == 1) {
    // drift: the base without its dashes (the water under them, filled from around); the dashes come back as
    // sprites drawn over it, split so that dash over base is the painting again.
    c = mix(paint(q), texture(uClean, q / uRect).rgb, texture(uHole, q / uRect).r);
  } else {
    // cycle: the dashes stay put; bands of light roll through them toward the shore.
    float band = sin(dot(p, vec2(-uShore.y, uShore.x)) / 46.0 + uT * 0.9 + 2.0 * vnoise(dot(p, uShore) / 300.0));
    float lit = mix(1.0, 0.5 + 0.5 * smoothstep(-0.8, 0.2, band), uCalm);
    // Within each dash, fade between the water under it and the painting: lit = 1 is the painting.
    c = mix(texture(uClean, q / uRect).rgb, paint(q), mix(1.0, lit, texture(uHole, q / uRect).r));
  }
  if (w > 0.0) c = wetten(c, s, d * w, peak * w, since);
  float a = max(max(w, open), step(0.02, abs(d * w)));
  outColor = vec4(c * a, a);
}`;

// Dash sprites for &sea=b: each dash, cut from the painting with its mask, drifts along its own shore normal.
const DVS = `#version 300 es
in vec2 aCorner;
in vec4 aRect;   // x, y, w, h (rect-local park px)
in vec4 aDash;   // normal x, y, seed, stroke id
uniform vec2 uRect;
uniform float uT, uCalm;
out vec2 vP;
out vec2 vOff;
out float vA;
flat out float vId;
void main() {
  vId = aDash.w;
  float seed = aDash.z;
  float period = 9.0 + 5.0 * seed;
  float f = fract(uT / period + seed * 7.13);
  float drift = 6.0 * uCalm;
  // A slow push toward the shore and back (a smooth loop, so no jump), dimming a little as it goes.
  float wv = 0.5 - 0.5 * cos(6.2831853 * f);
  vec2 off = aDash.xy * (wv - 0.5) * drift;
  vA = mix(1.0, 0.55 + 0.45 * (0.5 + 0.5 * cos(6.2831853 * (f - 0.25))), uCalm);
  vec2 pad = vec2(drift + 2.0);
  vec2 p = aRect.xy - pad + aCorner * (aRect.zw + 2.0 * pad);
  vP = p;
  vOff = off;
  vec2 ndc = vec2(p.x / uRect.x * 2.0 - 1.0, 1.0 - p.y / uRect.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;
const DFS = `#version 300 es
precision highp float;
in vec2 vP;
in vec2 vOff;
in float vA;
flat in float vId;
uniform sampler2D uPaint, uDash, uStroke;
uniform vec2 uRect;
out vec4 outColor;
void main() {
  vec2 src = vP - vOff;
  vec3 sid = texelFetch(uStroke, ivec2(src), 0).rgb * 255.0;
  if (abs(sid.r + 256.0 * sid.g - vId) > 0.5) discard;
  vec4 d = texture(uDash, src / uRect);
  float a = d.a * vA;
  outColor = vec4(d.rgb * a, a);
}`;

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const { params, slots, W, H, dir } = ctx;
  const mode = { a: 0, b: 1, c: 2, copy: 3 }[params.get("sea")] ?? 0;
  const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const calm = reduced ? 0 : Math.max(0, Math.min(1, Number(params.get("calm") ?? 1)));
  const fps = Number(params.get("fps")) || 0;
  // Each mode loads only what it uses (a: the masks; b: everything; c: the masks, clean and hole).
  const blank = document.createElement("canvas");
  blank.width = blank.height = 1;
  const want = (name, used) => (used ? loadImage(new URL(name, dir).href) : blank);
  const [info, masks, dashes, clean, hole, strokes] = await Promise.all([
    fetch(new URL("sea.json", dir)).then((r) => r.json()),
    loadImage(new URL("masks.png", dir).href),
    want("dashpaint.webp", mode === 1),
    want("clean.webp", mode === 1 || mode === 2),
    want("hole.png", mode === 1 || mode === 2),
    want("strokes.png", mode === 1),
  ]);
  const [rx, ry, rw, rh] = info.rect;
  const sl = Math.hypot(1, info.shoreSlope);
  const shore = [1 / sl, info.shoreSlope / sl];

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `left:${rx}px;top:${ry}px;width:${rw}px;height:${rh}px`;
  slots.plate.append(canvas);
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });

  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const prog = program(VS, FS);
  const dprog = program(DVS, DFS);

  function texture(unit, src, filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  texture(1, masks);
  texture(2, dashes);
  texture(3, clean);
  texture(4, hole);
  texture(5, strokes, gl.NEAREST);
  let paintTex = null;

  // Full-screen triangle pair.
  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Dash instances.
  const dvao = gl.createVertexArray();
  gl.bindVertexArray(dvao);
  const cb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(dprog, "aCorner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const inst = new Float32Array(info.dashes.length * 8);
  info.dashes.forEach((d, i) => {
    const seed = ((i * 2654435761) % 1000) / 1000;
    inst.set([d.r[0] - rx, d.r[1] - ry, d.r[2], d.r[3], d.n[0], d.n[1], seed, d.id], i * 8);
  });
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ib);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
  for (const [name, size, off] of [["aRect", 4, 0], ["aDash", 4, 16]]) {
    const loc = gl.getAttribLocation(dprog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);

  const U = (p, n) => gl.getUniformLocation(p, n);
  gl.useProgram(prog);
  gl.uniform1i(U(prog, "uPaint"), 0); gl.uniform1i(U(prog, "uMasks"), 1); gl.uniform1i(U(prog, "uDash"), 2); gl.uniform1i(U(prog, "uClean"), 3); gl.uniform1i(U(prog, "uHole"), 4);
  gl.uniform2f(U(prog, "uRect"), rw, rh);
  gl.uniform2f(U(prog, "uShore"), shore[0], shore[1]);
  gl.uniform1f(U(prog, "uCalm"), calm);
  gl.uniform1f(U(prog, "uAmp"), Number(params.get("swash")) || 13);
  gl.uniform1i(U(prog, "uMode"), mode);
  gl.useProgram(dprog);
  gl.uniform1i(U(dprog, "uPaint"), 0); gl.uniform1i(U(dprog, "uDash"), 2); gl.uniform1i(U(dprog, "uStroke"), 5);
  gl.uniform2f(U(dprog, "uRect"), rw, rh);
  gl.uniform1f(U(dprog, "uCalm"), calm);

  // The painting's pixels under the canvas, at the canvas's own resolution, from the page's painting.
  const painting = document.getElementById("painting");
  let density = 0, lastT = -1, dirty = true;
  function cropPainting() {
    const img = painting?.complete && painting.naturalWidth ? painting : null;
    if (!img) return false;
    const kx = img.naturalWidth / W, ky = img.naturalHeight / H;
    const c2 = document.createElement("canvas");
    c2.width = canvas.width; c2.height = canvas.height;
    const g2 = c2.getContext("2d");
    g2.imageSmoothingQuality = "high";
    g2.drawImage(img, rx * kx, ry * ky, rw * kx, rh * ky, 0, 0, c2.width, c2.height);
    if (paintTex) gl.deleteTexture(paintTex);
    paintTex = texture(0, c2);
    dirty = true;
    return true;
  }
  painting?.addEventListener("load", () => { cropPainting(); });

  function resize(scale) {
    const d = scale * Math.min(devicePixelRatio || 1, 1.25 / scale);
    if (Math.abs(d - density) < 1e-4 && paintTex) return;
    density = d;
    canvas.width = Math.round(rw * d);
    canvas.height = Math.round(rh * d);
    cropPainting();
  }

  function draw(t) {
    if (!paintTex) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paintTex);
    gl.useProgram(prog);
    gl.uniform1f(U(prog, "uT"), t);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (mode === 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(dprog);
      gl.uniform1f(U(dprog, "uT"), t);
      gl.bindVertexArray(dvao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, info.dashes.length);
    }
    gl.bindVertexArray(null);
  }

  window.__sea = {
    mode, calm, fps, rect: info.rect,
    draw,
    // Average ms per draw, with a sync after each (software WebGL when headless).
    cost(n = 20, t = 3) { const px = new Uint8Array(4); const t0 = performance.now(); for (let i = 0; i < n; i++) { draw(t + i * 0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / n; },
  };

  return {
    resize,
    update(t) {
      const tt = calm === 0 ? 0 : fps ? Math.floor(t * fps) / fps : t;
      if (tt === lastT && !dirty) return;
      if (!paintTex && !cropPainting()) return;
      lastT = tt;
      dirty = false;
      draw(tt);
    },
  };
}
