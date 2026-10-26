const LOOP = 72;
const PERIOD = 8;
const FOAM = "#f9f4ea";
const WET = "#c99a5e";
const WET_LINE = "#b0865c";

const VERT = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const rgb = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (a, m) => a.map((v, i) => v * m[i]);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function palette(look, graded = true) {
  const foam = rgb(FOAM);
  const night = clamp01((look.lights - 0.6) / 0.4);
  const gain = rgb(look.tint).map((v) => v * look.exposure);
  const lifted = rgb(look.sea).map((v, i) => v / gain[i]);
  const top = Math.max(1, ...lifted);
  const sea = graded ? mix(rgb(look.sea), lifted.map((v) => v / top), 0.8 - 0.25 * night) : rgb(look.sea);
  return {
    uSea: sea,
    uDeep1: mul(sea, [0.95, 0.92, 0.97]),
    uDeep2: mul(sea, [0.88, 0.83, 0.93]),
    uShallow: mix(sea, foam, 0.38),
    uSheet: mix(sea, foam, 0.62),
    uFoam: foam,
    uFoamLine: mix(mul(sea, [0.85, 0.9, 0.95]), foam, 0.35),
    uWet: rgb(WET),
    uWetLine: rgb(WET_LINE),
    uRipLight: mix(foam, sea, 0.1 + 0.1 * night),
    uRipDark: mul(sea, [0.78, 0.8, 0.88]),
  };
}

const fract = (x) => x - Math.floor(x);
const h11 = (p) => { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); };
const n1 = (x) => { const i = Math.floor(x), f = x - i, a = h11(i); return a + (h11(i + 1) - a) * f * f * (3 - 2 * f); };
const psin = (turns) => { const x = fract(turns + 0.5) * 2 - 1; return 4 * x * (1 - Math.abs(x)); };

function shoreTable(u0, du, width, waves) {
  const rows = 2 * waves + 1;
  const data = new Float32Array(width * rows * 4);
  const put = (i, row, v) => data.set(v, (row * width + i) * 4);
  for (let i = 0; i < width; i++) {
    const u = u0 + (i + 0.5) * du;
    for (let k = 0; k < waves; k++) {
      const set = 0.78 + 0.44 * h11(k * 3.17 + 0.5);
      const along = 0.62 + 0.38 * n1(u / 430 + k * 11.3) + 0.18 * (n1(u / 140 + k * 4.7) - 0.5);
      const a = Math.abs(psin(u * 0.00573 + k * 0.302 + 0.414 * n1(u / 150 + k * 2.3)));
      const lobe = 12 * (0.5 - a - (Math.sqrt(a) - a) * 0.6) * (0.5 + n1(u / 110 + k * 7.7));
      const w = 16 * (n1(u / 70 + k * 6.1) - 0.5) + 10 * (n1(u / 190 + k * 2.9) - 0.5);
      put(i, k, [set * along, w, lobe + 0.45 * w, n1(u / 52 + k * 5.3)]);
      put(i, waves + k, [0.7 * n1(u / 13 + k * 9) + 0.3 * n1(u / 41 + k * 3.7), 3 * psin(u * 0.0175 + 0.318 * n1(u / 30 + k)), 0, 0]);
    }
    put(i, 2 * waves, [0.22 * n1(u / 520 + 3.1), 0, 0, 0]);
  }
  return { data, rows };
}

function bandRow(out, u0, du, width, t) {
  const a = t / LOOP;
  for (let i = 0; i < width; i++) {
    const u = u0 + (i + 0.5) * du;
    out[i * 4] = 34 + 22 * n1(u / 230 + 1.7 + 0.35 * psin(a + u / 3770));
    out[i * 4 + 1] = 250 + 60 * n1(u / 300 + 7 + 0.3 * psin(2 * a + u / 3142));
    out[i * 4 + 2] = 520 + 90 * n1(u / 380 + 13 + 0.3 * psin(a + 0.21 + u / 4398));
    out[i * 4 + 3] = 34 + 16 * n1(u / 80 + 0.5 * psin(3 * a + u / 1885));
  }
  return out;
}

function lace(size = 128, cells = 32) {
  const h = (x, y) => { const v = Math.sin(((x % cells) + cells) % cells * 127.1 + (((y % cells) + cells) % cells) * 311.7) * 43758.5453; return v - Math.floor(v); };
  const s = (f) => f * f * (3 - 2 * f);
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = ((x + 0.5) * cells) / size, py = ((y + 0.5) * cells) / size;
    const ix = Math.floor(px), iy = Math.floor(py), fx = s(px - ix), fy = s(py - iy);
    const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx;
    const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx;
    data[y * size + x] = Math.round((a + (b - a) * fy) * 255);
  }
  return data;
}

function texture(gl, unit, width, height, data, { format = gl.RGBA16F, wrap = gl.CLAMP_TO_EDGE } = {}) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (format === gl.R8) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

const hash = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

function createGlitter(slot, railY, slope, shore) {
  const cx = (r) => 300 - 50 * r;
  const yTop = railY + slope * cx(0) + shore + 42;
  const h = 1024 - yTop;
  if (h < 30) return { draw() {} };
  const x0 = 160, w = 240, dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * dpr;
  canvas.height = Math.ceil(h * dpr);
  Object.assign(canvas.style, { left: `${x0}px`, top: `${yTop}px`, width: `${w}px`, height: `${h}px` });
  slot.append(canvas);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -yTop * dpr);
  g.lineCap = "round";
  let shown = false;
  return {
    draw(t, moon) {
      if (moon < 0.01 && !shown) return;
      g.clearRect(x0, yTop, w, h);
      shown = moon >= 0.01;
      if (!shown) return;
      for (let i = 0; i < 56; i++) {
        const life = LOOP / (hash(i, 0.5) < 0.33 ? 8 : hash(i, 0.5) < 0.66 ? 9 : 12);
        const ph = t / life + hash(i, 1.7);
        const m = Math.floor(ph) % (LOOP / life);
        const a = ph - Math.floor(ph);
        const r = Math.pow(hash(i, m + 3.1), 0.8);
        const spread = 16 + 80 * r * r;
        const x = cx(r) + (hash(i, m + 5.3) + hash(i, m + 7.9) - 1) * spread + 4 * a;
        const y = yTop + 6 + r * (h - 10);
        const len = (2 + 7 * hash(i, m + 9.4)) * (0.6 + 0.6 * r) * (0.5 + 0.5 * Math.sin(Math.PI * a));
        g.globalAlpha = moon * Math.pow(Math.sin(Math.PI * a), 2) * (0.55 + 0.45 * r);
        g.strokeStyle = "#fff2c6";
        g.lineWidth = 1.3 + 0.8 * r;
        g.beginPath();
        g.moveTo(x - len, y - 0.123 * len);
        g.lineTo(x + len, y + 0.123 * len);
        g.stroke();
      }
    },
  };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export async function mount({ stage, camera, time, clock, slots, bench, dir, params }) {
  const scale = Number(params.get("waterscale")) || 1;
  const graded = params.get("grade") !== "off";
  const shore = Number(params.get("shore")) || 205;
  const ampUnits = Number(params.get("swash")) || 85;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(camera.W * scale);
  canvas.height = Math.round(camera.H * scale);
  slots.water.append(canvas);
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error("water needs WebGL2");

  const src = await (await fetch(new URL("sea.frag", dir))).text();
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, src));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindVertexArray(gl.createVertexArray());
  const loc = (name) => gl.getUniformLocation(prog, name);

  const { ex, ez } = camera;
  const det = ex[0] * ez[1] - ez[0] * ex[1];
  const [rail] = stage.wall.railTop;
  const shoreZ = camera.toGround([rail[0], rail[1] + shore])[2];
  const glitter = params.get("moon") === "0" ? { draw() {} } : createGlitter(slots.lights, rail[1], ex[1] / ex[0], shore);
  let moon = 0;
  gl.uniform2f(loc("uCenter"), camera.W / 2, camera.H / 2);
  gl.uniformMatrix2fv(loc("uToGround"), false, [ez[1] / det, -ex[1] / det, -ez[0] / det, ex[0] / det]);
  gl.uniform1f(loc("uScale"), scale);
  gl.uniform1f(loc("uHeight"), canvas.height);
  gl.uniform1f(loc("uShoreZ"), shoreZ);
  gl.uniform1f(loc("uLoop"), LOOP);
  gl.uniform1f(loc("uPeriod"), PERIOD);
  gl.uniform1f(loc("uWaves"), LOOP / PERIOD);
  gl.uniform1f(loc("uAmp"), ampUnits);
  gl.uniform1f(loc("uVpx"), det / Math.hypot(ex[0], ex[1]));
  gl.uniform1f(loc("uWetAlpha"), 0.62);
  const u0Offset = Number(params.get("shoreu")) || 0;
  gl.uniform1f(loc("uU0"), u0Offset);
  const uTime = loc("uTime");

  const corners = [[0, 0], [camera.W, 0], [0, camera.H], [camera.W, camera.H]].map((p) => camera.toGround(p)[0] + u0Offset);
  const TW = 2048;
  const uMin = Math.min(...corners) - 16;
  const du = (Math.max(...corners) + 16 - uMin) / TW;
  const waves = LOOP / PERIOD;
  const table = shoreTable(uMin, du, TW, waves);
  texture(gl, 0, TW, table.rows, table.data);
  texture(gl, 2, 128, 128, lace(), { format: gl.R8, wrap: gl.REPEAT });
  gl.uniform1i(loc("uLace"), 2);
  const bands = new Float32Array(TW * 4);
  const bandTex = texture(gl, 1, TW, 1, bandRow(bands, uMin, du, TW, 0));
  gl.uniform1i(loc("uTab"), 0);
  gl.uniform1i(loc("uBands"), 1);
  gl.uniform3f(loc("uTabMap"), uMin, 1 / (TW * du), table.rows);

  let dirty = true;
  time.onChange((look) => {
    for (const [name, value] of Object.entries(palette(look, graded))) gl.uniform3fv(loc(name), value);
    moon = clamp01((look.lights - 0.75) / 0.25);
    dirty = true;
  });

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  bench?.report("water", 1);

  function draw(t) {
    const tl = ((t % LOOP) + LOOP) % LOOP;
    gl.uniform1f(uTime, tl);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bandTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, 1, gl.RGBA, gl.FLOAT, bandRow(bands, uMin, du, TW, tl));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    glitter.draw(tl, moon);
  }

  let flat = null;
  function cost(n = 10, t = 1.5) {
    if (!flat) {
      flat = gl.createProgram();
      gl.attachShader(flat, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(flat, compile(gl, gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(0.3, 0.6, 0.8, 1.0); }"));
      gl.linkProgram(flat);
    }
    const px = new Uint8Array(4);
    const run = (p) => {
      gl.useProgram(p);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { if (p === prog) gl.uniform1f(uTime, t + i * 0.1); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (performance.now() - t0) / n;
    };
    const a = run(flat), b = run(prog), c = run(flat);
    gl.useProgram(prog);
    dirty = true;
    return { waterMs: +b.toFixed(2), flatMs: +((a + c) / 2).toFixed(2), ratio: +(2 * b / (a + c)).toFixed(1) };
  }

  window.__water = { shoreZ, shore, loop: LOOP, period: PERIOD, draw, cost };
  return {
    update(dt, t) {
      if (clock.frozen && !dirty) return;
      dirty = false;
      draw(t);
    },
  };
}
