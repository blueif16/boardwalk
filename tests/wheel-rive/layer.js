import { WHEEL as W, wheelGeometry, toPlane } from "./wheel.js";

const VERSION = "2.42.2";
const RUNTIMES = {
  canvas: { pkg: "canvas-advanced", entry: "canvas_advanced.mjs" },
  webgl2: { pkg: "webgl2-advanced", entry: "webgl2_advanced.mjs" },
};
const TAU = Math.PI * 2;
const OMEGA = TAU / W.secondsPerTurn;
const RISE = 0.2, FALL = 0.8;
const SWING = { hz: 1.1, damping: 0.22, length: 20, gain: 1.6 };
const anchorAngle = (i) => (i / W.cabins) * TAU - Math.PI / 2;

export async function mount({ stage, camera, time, slots, world, bench, base, dir, params }) {
  const g = wheelGeometry(camera, stage);
  const kind = params.get("rive") === "webgl2" ? "webgl2" : "canvas";
  const cdn = `https://cdn.jsdelivr.net/npm/@rive-app/${RUNTIMES[kind].pkg}@${VERSION}/`;
  const [{ default: init }, bytes, meta] = await Promise.all([
    import(cdn + RUNTIMES[kind].entry),
    fetch(new URL("wheel.riv", dir)).then((r) => r.arrayBuffer()),
    fetch(new URL("wheel.meta.json", dir)).then((r) => r.json()),
  ]);
  const rive = await init({ locateFile: () => cdn + "rive.wasm" });
  const file = await rive.load(new Uint8Array(bytes));
  const [bx, by, bw, bh] = W.box;

  slots.rides.append(fenceOverlay(stage, camera, base));

  const wheel = layer("Wheel", slots.rides);
  const lights = layer("WheelLights", slots.lights);
  lights.canvas.style.mixBlendMode = "screen";
  const all = [wheel, lights];

  const rt = g.rive;
  for (const L of all) {
    L.set.outerRotation(rt.outerRotation);
    L.set.scaleX(rt.scaleX);
    L.set.scaleY(rt.scaleY);
    L.set.innerRotation(rt.innerRotation);
    L.set.hubX(g.root[0]);
    L.set.hubY(g.root[1]);
  }

  function layer(name, slot) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;pointer-events:none`;
    slot.append(canvas);
    if (kind === "canvas" && params.has("cpu2d")) canvas.getContext("2d", { willReadFrequently: true });
    const artboard = file.artboardByName(name);
    const machine = new rive.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);
    const vmi = file.defaultArtboardViewModel(artboard).defaultInstance();
    artboard.bindViewModelInstance(vmi);
    machine.bindViewModelInstance(vmi);
    const renderer = rive.makeRenderer(canvas, !params.has("direct"));
    const names = ["outerRotation", "scaleX", "scaleY", "innerRotation", "spin", "hubX", "hubY", "lights", "spill",
      ...Array.from({ length: W.cabins }, (_, i) => `sway${i}`)];
    const set = Object.fromEntries(names.map((n) => { const p = vmi.number(n); return [n, (v) => { p.value = v; }]; }));
    return { canvas, artboard, machine, renderer, set, tap: vmi.trigger("tap"), visible: true, pxScale: 0 };
  }

  function resize(L) {
    const s = (Number(world.dataset.scale) || 1) * Math.min(2, devicePixelRatio || 1);
    if (Math.abs(s - L.pxScale) < 1e-3) return;
    L.pxScale = s;
    L.canvas.width = Math.round(bw * s);
    L.canvas.height = Math.round(bh * s);
  }

  function draw(L, dt) {
    resize(L);
    const { renderer, artboard, machine, canvas } = L;
    machine.advanceAndApply(dt);
    renderer.clear();
    renderer.save();
    renderer.align(rive.Fit.fill, rive.Alignment.topLeft, { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height }, artboard.bounds);
    artboard.draw(renderer);
    renderer.restore();
    renderer.flush();
  }

  const state = { mult: 1, extra: 0, angle: 0, hovered: false, boostUntil: 0, flash: 0, sway: new Float64Array(W.cabins), swayV: new Float64Array(W.cabins) };

  function cabinBoxes() {
    const [a, b, c, d] = g.m;
    return Array.from({ length: W.cabins }, (_, i) => {
      const phi = anchorAngle(i) + state.angle;
      const x = W.rim * Math.cos(phi), y = W.rim * Math.sin(phi);
      return [g.hub[0] + a * x + c * y, g.hub[1] + b * x + d * y];
    });
  }

  function hit(p) {
    const [x, y] = toPlane(g, p);
    if (Math.hypot(x, y) < W.rim + 8) return true;
    if (y > 0 && y < W.hub + 6 && Math.abs(x) < (W.foot * y) / W.hub + 9) return true;
    return cabinBoxes().some(([cx, cy]) => p[0] > cx - 16 && p[0] < cx + 16 && p[1] > cy - 4 && p[1] < cy + 42);
  }

  const toStage = (e) => {
    const r = world.getBoundingClientRect();
    const s = r.width / camera.W;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  };
  const setHover = (on) => {
    if (on === state.hovered) return;
    state.hovered = on;
    world.style.cursor = on ? "pointer" : "";
  };
  world.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") setHover(hit(toStage(e))); });
  world.addEventListener("pointerleave", () => setHover(false));
  world.addEventListener("pointerdown", (e) => {
    if (!hit(toStage(e))) return;
    for (const L of all) L.tap.trigger();
    state.flash = 1;
    if (e.pointerType !== "mouse") state.boostUntil = performance.now() + 1600;
  });

  const perf = [];
  let tick = 0;

  function update(dt, t) {
    const t0 = performance.now();
    const want = state.hovered || t0 < state.boostUntil ? 2 : 1;
    const prev = state.mult;
    state.mult += (want - state.mult) * (1 - Math.exp(-dt / (want > state.mult ? RISE : FALL)));
    state.extra += (state.mult - 1) * dt;
    state.angle = OMEGA * (t + state.extra);
    const alpha = dt > 0 ? (OMEGA * (state.mult - prev)) / dt : 0;
    const w0 = TAU * SWING.hz;
    for (let i = 0; i < W.cabins; i++) {
      const phi = anchorAngle(i) + state.angle;
      const ah = -alpha * W.rim * Math.sin(phi);
      const acc = -w0 * w0 * state.sway[i] - 2 * SWING.damping * w0 * state.swayV[i] + (SWING.gain * ah) / SWING.length;
      state.swayV[i] += acc * dt;
      state.sway[i] += state.swayV[i] * dt;
    }
    state.flash = Math.max(0, state.flash - dt / 1.6);
    const lit = Math.max(time.look.lights, state.flash);

    wheel.set.spin(state.angle);
    for (let i = 0; i < W.cabins; i++) wheel.set[`sway${i}`](state.sway[i]);
    draw(wheel, dt);

    const show = lit > 0.004;
    if (show !== lights.visible) { lights.visible = show; lights.canvas.style.display = show ? "" : "none"; }
    if (show) {
      lights.set.spin(state.angle);
      lights.set.lights(lit);
      lights.set.spill(lit > 0 ? time.look.lights / lit : 0);
      for (let i = 0; i < W.cabins; i++) lights.set[`sway${i}`](state.sway[i]);
      draw(lights, dt);
    }
    rive.resolveAnimationFrame();
    bench?.report("wheel-rive", meta.wheel.paints + (show ? meta.lights.paints : 0));
    perf[tick++ % 600] = performance.now() - t0;
  }

  function check() {
    const hubW = [g.floor[0], W.hub, g.floor[2]];
    let anchor = 0, cabin = 0, squash = 0;
    for (let i = 0; i < W.cabins; i++) {
      const a = wheel.artboard.transformComponent(`Anchor${i}`).worldTransform();
      const c = wheel.artboard.transformComponent(`Cabin${i}`).worldTransform();
      const phi = anchorAngle(i) + state.angle;
      const x = W.rim * Math.cos(phi), y = W.rim * Math.sin(phi);
      const p = camera.toPixel([0, 1, 2].map((k) => hubW[k] + g.u[k] * x + g.v[k] * y));
      anchor = Math.max(anchor, Math.hypot(a.tx + bx - p[0], a.ty + by - p[1]));
      cabin = Math.max(cabin, Math.hypot(c.tx - a.tx, c.ty - a.ty));
      const sx = Math.hypot(c.xx, c.xy), sy = Math.hypot(c.yx, c.yy);
      squash = Math.max(squash, Math.abs(sx - 1), Math.abs(sy - 1), Math.abs(Math.atan2(c.xy, c.xx) - state.sway[i]));
    }
    return { angle: +state.angle.toFixed(4), anchorErrPx: +anchor.toFixed(4), cabinToAnchorPx: +cabin.toFixed(4), cabinScaleOrTiltErr: +squash.toFixed(5) };
  }

  function stats() {
    const s = perf.slice().sort((a, b) => a - b);
    const q = (k) => +(s[Math.min(s.length - 1, Math.floor(k * s.length))] ?? 0).toFixed(3);
    return { runtime: kind, frames: s.length, p50ms: q(0.5), p95ms: q(0.95), maxms: q(1), mult: +state.mult.toFixed(3) };
  }

  window.__wheelRive = { check, stats, state, hit, toPlane: (p) => toPlane(g, p), geometry: g, kind };
  return { update };
}

function fenceOverlay(stage, camera, base) {
  const p = stage.platforms[W.platform];
  const rx = p.radius + 2.5, ry = p.radius * Math.sin(camera.pitch);
  const pts = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI;
    pts.push([p.rimCenter[0] + rx * Math.cos(t), p.rimCenter[1] + (ry + 1) * Math.sin(t) - 2]);
  }
  for (let k = 48; k >= 0; k--) {
    const t = (k / 48) * Math.PI;
    const x = p.floor[0] + rx * Math.cos(t);
    let y = p.floor[1] + ry * Math.sin(t) + 3.5;
    if (x > p.gate[0] - 30 && x < p.gate[0] + 14) y = Math.max(y, p.gate[1] + 15);
    pts.push([x, y]);
  }
  const img = new Image();
  img.src = new URL(stage.image, base).href;
  img.alt = "";
  img.style.cssText = `position:absolute;left:0;top:0;width:${camera.W}px;height:${camera.H}px;pointer-events:none;clip-path:polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`;
  return img;
}
