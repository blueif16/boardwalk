import { createCamera } from "./camera.js";
import { createTime, NAMED } from "./time.js";
import { createClock } from "./clock.js";
import { createBench } from "./bench.js";

const params = new URLSearchParams(location.search);
const base = new URL(".", import.meta.url);
const stage = await (await fetch(new URL("stage.json", base))).json();
const camera = createCamera(stage);
const time = createTime();
const clock = createClock();
const world = document.getElementById("world");
const slots = Object.fromEntries([...world.querySelectorAll("[data-slot]")].map((el) => [el.dataset.slot, el]));
const benchEl = document.getElementById("bench");
const bench = params.has("bench") ? createBench({ seconds: Number(params.get("bench")) || 10, onDone: (r) => { benchEl.textContent = `${r.fps} fps · p95 ${r.p95ms} ms · ${r.longFrames} long · ${r.downloadMB} MB`; console.log("bench", JSON.stringify(r)); } }) : null;

const stageImg = document.getElementById("stage");
stageImg.src = new URL(stage.image, base).href;

// The world covers the whole window (&fit=contain letterboxes it instead). Whatever overflows is reached by dragging,
// the wheel or the arrow keys. pan is the view centre as a fraction of the world, so a resize keeps the same spot.
const viewport = world.parentElement;
const containFit = params.get("fit") === "contain";
const pan = { fx: Number(params.get("x") ?? 0.5), fy: Number(params.get("y") ?? 0.5) };
let view = { s: 1, x: 0, y: 0, vw: 1, vh: 1 };
function place() {
  const { s, vw, vh } = view, W = stage.size[0] * s, H = stage.size[1] * s;
  const clamp = (v, lo) => (lo >= 0 ? lo / 2 : Math.min(0, Math.max(lo, v)));
  view.x = clamp(vw / 2 - pan.fx * W, vw - W);
  view.y = clamp(vh / 2 - pan.fy * H, vh - H);
  pan.fx = (vw / 2 - view.x) / W;
  pan.fy = (vh / 2 - view.y) / H;
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
}
function fit() {
  const vp = viewport.getBoundingClientRect();
  const sx = vp.width / stage.size[0], sy = vp.height / stage.size[1];
  view = { ...view, s: containFit ? Math.min(sx, sy) : Math.max(sx, sy), vw: vp.width, vh: vp.height };
  world.dataset.scale = view.s;
  place();
}
function panBy(dx, dy) {
  pan.fx -= dx / (stage.size[0] * view.s);
  pan.fy -= dy / (stage.size[1] * view.s);
  place();
}
addEventListener("resize", fit);
fit();

let drag = null;
viewport.addEventListener("pointerdown", (e) => { if (e.button === 0) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; });
viewport.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) { drag.moved = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add("dragging"); }
  drag.x = e.clientX;
  drag.y = e.clientY;
  panBy(dx, dy);
});
const endDrag = () => { drag = null; viewport.classList.remove("dragging"); };
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);
viewport.addEventListener("wheel", (e) => {
  e.preventDefault();
  const along = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  // A plain wheel pans along whichever axis overflows most; a trackpad's two axes pan directly.
  if (e.deltaX && e.deltaY) panBy(-e.deltaX, -e.deltaY);
  else if (stage.size[0] * view.s - view.vw >= stage.size[1] * view.s - view.vh) panBy(-along, 0);
  else panBy(0, -along);
}, { passive: false });
addEventListener("keydown", (e) => {
  const step = 80, d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
  if (d && e.target === document.body) { e.preventDefault(); panBy(...d); }
});

const grade = document.getElementById("grade");
const hourInput = document.getElementById("hour");
const hourLabel = document.getElementById("hourLabel");
const timeButtons = Object.keys(NAMED).map((name) => {
  const b = document.createElement("button");
  b.textContent = name;
  b.addEventListener("click", () => time.set(NAMED[name]));
  document.getElementById("times").append(b);
  return b;
});
const live = document.createElement("button");
live.textContent = "clock";
live.addEventListener("click", () => time.follow());
document.getElementById("times").append(live);
hourInput.addEventListener("input", () => time.set(Number(hourInput.value)));

const grading = params.get("grade") !== "off";
time.onChange((look) => {
  if (grading) {
    grade.style.background = look.tint;
    world.querySelector(".stage").style.filter = `brightness(${look.exposure}) saturate(${look.saturation})`;
    for (const name of ["water", "rides", "characters", "front"]) slots[name].style.filter = `brightness(${look.exposure}) saturate(${look.saturation})`;
  }
  hourInput.value = look.hour.toFixed(1);
  const hh = Math.floor(look.hour), mm = Math.round((look.hour - hh) * 60) % 60;
  hourLabel.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${look.name}`;
  timeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === look.name && !time.following)));
  live.setAttribute("aria-pressed", String(time.following));
});

const names = (params.get("tests") || "").split(",").map((s) => s.trim()).filter(Boolean);
document.getElementById("tests").textContent = names.length ? names.join(" + ") : "stage only (add ?tests=name,name)";
const ctx = { stage, camera, time, clock, slots, world, bench, base, params };
const layers = [];
for (const name of names) {
  try {
    const mod = await import(new URL(`../tests/${name}/layer.js`, base).href);
    const layer = await mod.mount({ ...ctx, name, dir: new URL(`../tests/${name}/`, base) });
    layers.push({ name, layer: layer || {} });
  } catch (err) {
    console.error(`layer ${name} failed`, err);
  }
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  const t = clock.now();
  for (const { layer } of layers) layer.update?.(dt, t);
  bench?.tick(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__compose = { ctx, layers, view: () => ({ ...view, ...pan }), panBy };

// Ready once the stage is decoded, every layer has mounted and two frames have drawn: screenshots wait for
// <html data-ready>, or for window.__ready (a promise).
window.__ready = stageImg.decode().catch(() => {})
  .then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  .then(() => { document.documentElement.dataset.ready = "1"; });
