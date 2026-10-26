const KEYS = [
  [0, 0, 0, 0, 1],
  [5.2, 0, 0, 0, 1],
  [6.4, 0.75, 0, 0, 0.25],
  [7.2, 0.7, 0, 0, 0],
  [9, 0, 0, 0, 0],
  [16.5, 0, 0, 0, 0],
  [18, 0, 0.85, 0, 0],
  [18.7, 0, 1, 0, 0],
  [19.3, 0, 0, 1, 0],
  [19.7, 0, 0, 0.8, 0.2],
  [20.4, 0, 0, 0, 1],
  [24, 0, 0, 0, 1],
];

const DUSK = [18.45, 19.85];
const DAWN = [5.6, 6.7];
const SWITCH = 0.03;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function weights(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const s = smooth((h - a[0]) / (b[0] - a[0]));
  const [dawn, golden, dusk, night] = [1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * s);
  return { day: Math.max(0, 1 - dawn - golden - dusk - night), dawn, golden, dusk, night };
}

export function wave(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= DUSK[0]) return clamp01((h - DUSK[0]) / (DUSK[1] - DUSK[0]));
  if (h < DAWN[0]) return 1;
  return clamp01((DAWN[1] - h) / (DAWN[1] - DAWN[0]));
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const GATE = `
uniform sampler2D uMeta;
uniform float uP;
uniform float uT;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float gate(vec3 m, bool flicker) {
  float on = clamp((uP * (1.0 + ${SWITCH}) - m.r) / ${SWITCH}, 0.0, 1.0);
  if (flicker && on > 0.0 && on < 1.0) on *= mix(step(0.45, hash(floor(uT * 12.0) + m.g * 977.0)), 1.0, on * on);
  return on;
}`;

const PLATE = `#version 300 es
precision highp float;
uniform sampler2D uDay, uDawn, uGolden, uDusk, uNight, uWarm, uSpill;
uniform vec4 uW;
${GATE}
in vec2 uv;
out vec4 o;
vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float day = max(0.0, 1.0 - uW.x - uW.y - uW.z - uW.w);
  vec3 c = texture(uDay, uv).rgb * day + texture(uDawn, uv).rgb * uW.x + texture(uGolden, uv).rgb * uW.y + texture(uDusk, uv).rgb * uW.z + texture(uNight, uv).rgb * uW.w;
  float on = gate(texture(uMeta, uv).rgb, false);
  c = c * mix(vec3(1.0), texture(uWarm, uv).rgb, on) + texture(uSpill, uv).rgb * on;
  o = vec4(encode(clamp(c, 0.0, 1.0)), 1.0);
}`;

const SOURCES = `#version 300 es
precision highp float;
uniform sampler2D uSources;
uniform float uGain;
${GATE}
in vec2 uv;
out vec4 o;
void main() {
  vec3 m = texture(uMeta, uv).rgb;
  float tw = 1.0 - m.b * 0.3 * (0.5 + 0.5 * sin(uT * (1.4 + m.g * 2.0) + m.g * 6.2832));
  o = vec4(texture(uSources, uv).rgb * gate(m, true) * tw * uGain, 1.0);
}`;

function image(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`failed to load ${src}`));
    im.src = src;
  });
}

function surface(W, H, frag, textures, css) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;${css}`;
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  Object.entries(textures).forEach(([name, im], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    const linear = ["uWarm", "uMeta", "uSources"].includes(name);
    gl.texImage2D(gl.TEXTURE_2D, 0, linear ? gl.RGB8 : gl.SRGB8, im.width, im.height, 0, gl.RGB, gl.UNSIGNED_BYTE, im);
    const filter = name === "uMeta" ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  });
  gl.viewport(0, 0, W, H);
  const u = (name) => gl.getUniformLocation(prog, name);
  return { canvas, gl, u, draw() { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } };
}

export async function mount({ stage, time, slots, bench, base, dir, params }) {
  const [W, H] = stage.size;
  const url = (name) => new URL(`plates/${name}`, dir).href;
  const names = ["dawn.webp", "golden.webp", "dusk.webp", "night.webp", "warm.webp", "spill.webp", "sources.webp", "lights_meta.png"];
  const [day, dawn, golden, dusk, night, warm, spill, sources, meta] = await Promise.all([
    image(new URL(stage.image, base).href),
    ...names.map((n) => image(url(n))),
  ]);

  const plate = surface(W, H, PLATE, { uDay: day, uDawn: dawn, uGolden: golden, uDusk: dusk, uNight: night, uWarm: warm, uSpill: spill, uMeta: meta }, "");
  const lights = surface(W, H, SOURCES, { uSources: sources, uMeta: meta }, "mix-blend-mode:plus-lighter;");
  slots.water.prepend(plate.canvas);
  slots.lights.append(lights.canvas);

  const demo = Number(params.get("dusk")) || 0;
  let progress = 0, dirty = true, lit = true;

  time.onChange((look) => {
    const w = weights(look.hour);
    plate.gl.uniform4f(plate.u("uW"), w.dawn, w.golden, w.dusk, w.night);
    lights.gl.uniform1f(lights.u("uGain"), 0.55 + 0.45 * (w.night + w.dusk * 0.7));
    progress = wave(look.hour);
    plate.gl.uniform1f(plate.u("uP"), progress);
    lights.gl.uniform1f(lights.u("uP"), progress);
    dirty = true;
  });

  window.__night = { weights, wave, get progress() { return progress; } };

  return {
    update(dt, t) {
      if (demo) {
        const s = (t % (demo + 3)) / demo;
        time.set(18.2 + Math.min(1, s) * 2.4);
      }
      let n = 0;
      if (dirty) { plate.draw(); dirty = false; n++; }
      if (progress > 0 || lit) {
        lights.gl.uniform1f(lights.u("uT"), t);
        lights.draw();
        lit = progress > 0;
        n++;
      }
      bench?.report("night", n);
    },
  };
}
