// The grade: the day painting and every live layer under it, relit by the hour (tests/night-park/RESULTS.md).
//
// A relight field per key time (dawn, golden, dusk, night) gives graded = day * A + B per pixel (sRGB), fitted to
// painted relit plates and stored at 1 px per 4 park px (plates/<key>_{A,B}.webp, 960 x 640 for the whole park).
// The page blends the keys by the sky's weights (day is A = 1, B = 0) and shows the result as two canvases over
// everything below them:
//   canvas 1  mix-blend-mode: multiply   value m = A / (1 - B)
//   canvas 2  mix-blend-mode: screen     value s = B          -> in * m * (1 - s) + s = in * A + B
// Both are tiny (960 x 640) and stretched to the park frame by the compositor (bilinear). They redraw only when the
// sky changes. In full day the slot is hidden, so the page costs nothing extra at midday.
const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = (out) => `#version 300 es
precision highp float;
uniform sampler2D uA0, uA1, uA2, uA3, uB0, uB1, uB2, uB3;
uniform vec4 uW;   // dawn, golden, dusk, night (day = 1 - sum)
in vec2 uv;
out vec4 o;
void main() {
  float day = max(0.0, 1.0 - uW.x - uW.y - uW.z - uW.w);
  vec3 A = vec3(day) + texture(uA0, uv).rgb * uW.x + texture(uA1, uv).rgb * uW.y + texture(uA2, uv).rgb * uW.z + texture(uA3, uv).rgb * uW.w;
  vec3 B = texture(uB0, uv).rgb * uW.x + texture(uB1, uv).rgb * uW.y + texture(uB2, uv).rgb * uW.z + texture(uB3, uv).rgb * uW.w;
  B = clamp(B, 0.0, 0.98);
  ${out === "mul" ? "o = vec4(clamp(A / (1.0 - B), 0.0, 1.0), 1.0);" : "o = vec4(B, 1.0);"}
}`;

export const KEYS = ["dawn", "golden", "dusk", "night"];

function image(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`failed to load ${src}`));
    im.src = src;
  });
}

function surface(w, h, frag, blend) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.style.cssText = `position:absolute;left:0;top:0;width:3840px;height:2560px;mix-blend-mode:${blend};pointer-events:none`;
  const gl = c.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.viewport(0, 0, w, h);
  const units = {};
  const tex = (name, im) => {
    if (!(name in units)) units[name] = Object.keys(units).length;
    gl.activeTexture(gl.TEXTURE0 + units[name]);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    // Raw numbers, not colours: RGBA8 (not SRGB8), no colour-space conversion.
    if (im) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([name.startsWith("uA") ? 255 : 0, name.startsWith("uA") ? 255 : 0, name.startsWith("uA") ? 255 : 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, name), units[name]);
  };
  for (let i = 0; i < 4; i++) { tex(`uA${i}`); tex(`uB${i}`); }
  const uW = gl.getUniformLocation(prog, "uW");
  return { c, gl, tex, draw(w4) { gl.uniform4f(uW, ...w4); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } };
}

export async function mountGrade(slot, sky, { base, size = [960, 640] } = {}) {
  const url = (f) => new URL(f, base).href;
  const man = await fetch(url("fields.json")).then((r) => r.json());
  const [w, h] = size;
  const mul = surface(w, h, FRAG("mul"), "multiply");
  const scr = surface(w, h, FRAG("screen"), "screen");
  slot.append(mul.c, scr.c);
  const loaded = new Set(), loading = new Map();
  let dirty = true, last = "";

  // Load a key's two textures on first need (a visitor at noon downloads nothing; at 22:00 only night).
  function need(k) {
    if (loaded.has(k) || loading.has(k)) return loading.get(k);
    const i = KEYS.indexOf(k);
    const p = Promise.all([image(url(man.keys[k].A)), image(url(man.keys[k].B))]).then(([A, B]) => {
      for (const s of [mul, scr]) { s.tex(`uA${i}`, A); s.tex(`uB${i}`, B); }
      loaded.add(k); loading.delete(k); dirty = true;
    });
    loading.set(k, p);
    return p;
  }

  function weights() {
    const k = sky.keys;
    return [k.dawn, k.golden, k.dusk, k.night].map((v, i) => (loaded.has(KEYS[i]) ? v : 0));
  }

  function draw() {
    const w4 = weights();
    const key = w4.map((v) => v.toFixed(4)).join();
    if (!dirty && key === last) return 0;
    last = key; dirty = false;
    const any = w4.some((v) => v > 1e-4);
    slot.style.display = any ? "" : "none";
    if (any) { mul.draw(w4); scr.draw(w4); }
    return any ? 2 : 0;
  }

  const ready = () => Promise.all(KEYS.filter((k) => sky.keys[k] > 1e-4).map(need));
  sky.onChange(() => { KEYS.forEach((k) => { if (sky.keys[k] > 1e-4) need(k); }); dirty = true; });
  await ready();
  draw();
  // Prefetch the next key times when the browser is idle, so scrubbing the clock never waits.
  setTimeout(() => (window.requestIdleCallback || ((f) => f()))(() => KEYS.forEach(need)), 2000);
  return { update: draw, ready, need, canvases: [mul.c, scr.c] };
}
