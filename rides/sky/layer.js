// The time of day: the day painting and every live layer under this one, relit by the hour, and the clock badge
// (tests/night-park/RESULTS.md has the method, the measurements and the INTERFACE with rides/lights).
//
// A relight field per key time (dawn, golden, dusk = the blue hour, night with the lights off) gives
// graded = day * A + B per pixel (sRGB), fitted to painted relit plates of the nine pieces and the whole park and
// stored at 1 px per 4 park px (fields/<key>_{A,B}.webp, 960 x 640). The layer blends the keys by the sun's height
// (base/sky.js) and shows the result as two canvases over everything drawn before it:
//   canvas 1  mix-blend-mode: multiply   m = A / (1 - B)
//   canvas 2  mix-blend-mode: screen     s = B          -> in * m * (1 - s) + s = in * A + B
// They redraw only when the hour moves; in full day the slot is hidden (13:00 is the untouched painting).
//
// Slots: it adds `grade` after `front` (and `pool`, `lights` after it for rides/lights) if index.html hasn't.
// The badge (bottom right): the time and a sun or moon; a tap opens a day strip to scrub, `play` (a day in 24 s) and
// `now` (back to the visitor's clock). &badge=0 hides it. The sky: ctx.sky, else getSky() from base/sky.js.
import { getSky, fmt } from "../../base/sky.js";

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


function ensureSlots(slots) {
  let after = slots.front;
  for (const name of ["grade", "pool", "lights"]) {
    if (!slots[name]) {
      const d = document.createElement("div");
      d.className = "slot"; d.dataset.slot = name;
      after.after(d);
      slots[name] = d;
    }
    after = slots[name];
  }
}

const CSS = `
.sky-clock { position: fixed; right: 16px; bottom: 16px; z-index: 3; display: flex; align-items: center; gap: 10px; font: 700 18px/1 Gaegu, "Comic Sans MS", cursive; color: #362223; }
.sky-clock[hidden] { display: none; }
.sky-clock .badge { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px 0 8px; border-radius: 20px; border: 1px solid #e4dbd0; background: color-mix(in srgb, #fffdf9 92%, transparent); box-shadow: 0 2px 10px rgb(54 34 35 / 0.16); cursor: pointer; font: inherit; color: inherit; }
.sky-clock .badge img { width: 26px; height: 26px; display: block; }
.sky-clock .badge:focus-visible, .sky-clock button:focus-visible { outline: 2px solid #362223; outline-offset: 2px; }
.sky-clock .strip { display: none; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 20px; border: 1px solid #e4dbd0; background: color-mix(in srgb, #fffdf9 92%, transparent); box-shadow: 0 2px 10px rgb(54 34 35 / 0.16); }
.sky-clock[data-open] .strip { display: flex; }
.sky-clock input[type=range] { width: min(46vw, 420px); height: 18px; margin: 0; appearance: none; -webkit-appearance: none; border-radius: 9px; background: var(--day-strip); outline: none; }
.sky-clock input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #fff8ec; border: 2px solid #362223; }
.sky-clock input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff8ec; border: 2px solid #362223; }
.sky-clock .small { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid #e4dbd0; background: #fffdf9; color: #362223; font: inherit; font-size: 15px; cursor: pointer; }
`;
const SUN = `<circle cx="13" cy="13" r="6" fill="#f2b275" stroke="#2c201b" stroke-width="1.6"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = Math.PI * a / 180; return `<line x1="${(13 + 8.5 * Math.cos(r)).toFixed(2)}" y1="${(13 + 8.5 * Math.sin(r)).toFixed(2)}" x2="${(13 + 11 * Math.cos(r)).toFixed(2)}" y2="${(13 + 11 * Math.sin(r)).toFixed(2)}" stroke="#2c201b" stroke-width="1.6" stroke-linecap="round"/>`; }).join("");
// The badge's icon is an <img> of the SVG, not inline <svg>: scripts/capture.mjs clips to a page's first <svg>.
const MOON = `<path d="M17.5 4.5a9 9 0 1 0 4 12.5 7 7 0 0 1-4-12.5z" fill="#f9f4ea" stroke="#2c201b" stroke-width="1.6" stroke-linejoin="round"/>`;
const ICON = Object.fromEntries(Object.entries({ sun: SUN, moon: MOON }).map(([k, v]) => [k, `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26">${v}</svg>`)}`]));
// The strip's colours: the key times' own colours (rose dawn, blue day, honey golden hour, violet blue hour, navy night).
const KEY_RGB = { day: [143, 196, 228], dawn: [240, 196, 196], golden: [246, 192, 142], dusk: [150, 120, 200], night: [31, 52, 104] };

function mountBadge(sky) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement("div");
  el.className = "sky-clock";
  el.innerHTML = `<div class="strip"><input type="range" min="0" max="24" step="0.05" aria-label="Time of day"><button class="small" data-act="play" title="Play a day in 24 seconds">play</button><button class="small" data-act="now" title="Back to your clock">now</button></div><button class="badge" aria-label="Time of day" aria-expanded="false"><img alt=""><span class="time"></span></button>`;
  document.body.append(el);
  const badge = el.querySelector(".badge"), range = el.querySelector("input"), time = el.querySelector(".time"), icon_ = el.querySelector(".badge img");
  const play = el.querySelector("[data-act=play]");
  // Colour the strip from the sun's path for today: sample the keys along the day.
  const stops = [];
  for (let h = 0; h <= 24; h += 0.25) {
    const k = sky.keysAtHour(h);
    const c = Object.entries(KEY_RGB).reduce((a, [n, rgb]) => a.map((v, i) => v + (k[n] || 0) * rgb[i]), [0, 0, 0]).map(Math.round);
    stops.push(`rgb(${c.join(",")}) ${(h / 24 * 100).toFixed(2)}%`);
  }
  range.style.setProperty("--day-strip", `linear-gradient(90deg, ${stops.join(",")})`);
  badge.addEventListener("click", () => { const open = el.toggleAttribute("data-open"); badge.setAttribute("aria-expanded", String(open)); });
  range.addEventListener("input", () => sky.set(Number(range.value)));
  play.addEventListener("click", () => sky.play(sky.mode === "play" ? 0 : 1));
  el.querySelector("[data-act=now]").addEventListener("click", () => sky.follow());
  let last = "";
  sky.onChange((s) => {
    const t = fmt(s.hour), icon = s.dark > 0.5 ? "moon" : "sun";
    if (t + icon !== last) { last = t + icon; time.textContent = t; icon_.src = ICON[icon]; }
    play.textContent = s.mode === "play" ? "stop" : "play";
    if (document.activeElement !== range) range.value = s.hour.toFixed(2);
  });
  return el;
}

export async function mount(ctx) {
  const { slots, params, dir } = ctx;
  const sky = ctx.sky ?? getSky({ params });
  ensureSlots(slots);
  const url = (f) => new URL(`fields/${f}`, dir).href;
  const man = await fetch(url("fields.json")).then((r) => r.json());
  const [w, h] = man.size;
  const mul = surface(w, h, FRAG("mul"), "multiply");
  const scr = surface(w, h, FRAG("screen"), "screen");
  slots.grade.append(mul.c, scr.c);
  const loaded = new Set(), loading = new Map();
  let dirty = true, last = "";

  // A key time's two textures load on first need: at noon nothing, at 22:00 only night; the rest when idle.
  function need(k) {
    if (loaded.has(k) || loading.has(k)) return loading.get(k);
    const i = KEYS.indexOf(k);
    const p = Promise.all([image(url(man.keys[k].A)), image(url(man.keys[k].B))]).then(([A, B]) => {
      for (const s of [mul, scr]) { s.tex(`uA${i}`, A); s.tex(`uB${i}`, B); }
      loaded.add(k); loading.delete(k); dirty = true;
    }).catch((err) => { loading.delete(k); console.error("sky field failed", k, err); });
    loading.set(k, p);
    return p;
  }
  const weights = () => [sky.keys.dawn, sky.keys.golden, sky.keys.dusk, sky.keys.night].map((v, i) => (loaded.has(KEYS[i]) ? v : 0));
  function draw() {
    const w4 = weights();
    const key = w4.map((v) => v.toFixed(4)).join();
    if (!dirty && key === last) return;
    last = key; dirty = false;
    const any = w4.some((v) => v > 1e-4);
    slots.grade.style.display = any ? "" : "none";
    if (any) { mul.draw(w4); scr.draw(w4); }
  }
  sky.onChange(() => { for (const k of KEYS) if (sky.keys[k] > 1e-4) need(k); });
  await Promise.all(KEYS.filter((k) => sky.keys[k] > 1e-4).map(need));
  draw();
  setTimeout(() => (window.requestIdleCallback || ((f) => f()))(() => KEYS.forEach(need)), 3000);

  const badge = params.get("badge") === "0" ? null : mountBadge(sky);
  window.__sky = sky;
  return {
    update() { sky.tick(); draw(); },
    resize() {},
    sky, badge,
  };
}
