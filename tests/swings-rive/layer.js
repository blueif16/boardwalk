import { DIM, createRide } from "../swings-three/ride.js";
import { createBulbs } from "../swings-three/bulbs.js";

const RIVE = "https://cdn.jsdelivr.net/npm/@rive-app/canvas-advanced@2.42.2/";
const SLOTS = 9;

export async function mount({ stage, camera, time, clock, slots, bench, dir }) {
  const [bx, by, bw, bh] = DIM.box;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = bw * dpr;
  canvas.height = bh * dpr;
  Object.assign(canvas.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px`, pointerEvents: "none" });
  slots.rides.append(canvas);

  const { default: RiveCanvas } = await import(`${RIVE}canvas_advanced.mjs`);
  const [rive, meta, bytes] = await Promise.all([
    RiveCanvas({ locateFile: () => `${RIVE}rive.wasm` }),
    fetch(new URL("rive/atlas.json", dir)).then((r) => r.json()),
    fetch(new URL("rive/build/swings.riv", dir)).then((r) => r.arrayBuffer()),
  ]);
  const file = await rive.load(new Uint8Array(bytes));
  const artboard = file.artboardByName("Swings");
  const renderer = rive.makeRenderer(canvas);
  const node = (name) => artboard.node(name);
  const seat = (name) => ({ root: node(name), img: node(`${name}_img`) });
  const back = Array.from({ length: SLOTS }, (_, i) => ({ seat: seat(`b${i}s`), chains: [node(`b${i}a`), node(`b${i}b`)] }));
  const front = Array.from({ length: SLOTS }, (_, i) => ({ seat: seat(`fs${i}`), chains: [node(`fc${i}a`), node(`fc${i}b`)] }));
  const canopy = node("canopy_img");

  const ride = createRide({ stage, camera, clock, slots });
  const bulbs = createBulbs({ camera, time, slots, centre: ride.centre });
  const s = 1 / meta.scale, ch = meta.chairs, cn = meta.canopy, H = meta.headings, T = meta.tilts.length;
  const px = (p) => { const [x, y] = camera.toPixel(p); return [x - bx, y - by]; };
  const hide = (n) => { n.scaleX = 0; n.scaleY = 0; };

  function place(slot, c) {
    const [x, y] = px(c.seat);
    const h = ((Math.round(c.psi / ((2 * Math.PI) / H)) % H) + H) % H;
    const deg = (c.theta * 180) / Math.PI;
    let ti = 0;
    meta.tilts.forEach((v, i) => { if (Math.abs(v - deg) < Math.abs(meta.tilts[ti] - deg)) ti = i; });
    const cell = (c.variant * T + ti) * H + h;
    const col = cell % ch.cols, row = Math.floor(cell / ch.cols);
    const r = slot.seat.root;
    r.x = x; r.y = y; r.scaleX = 1; r.scaleY = 1;
    slot.seat.img.x = -s * (ch.ax + col * ch.cw);
    slot.seat.img.y = -s * (ch.ay + row * ch.ch);
    c.hangers.forEach(([a, b], j) => {
      const [x0, y0] = px(a), [x1, y1] = px(b);
      const n = slot.chains[j];
      n.x = x0; n.y = y0;
      n.rotation = Math.atan2(-(x1 - x0), y1 - y0);
      n.scaleX = 1;
      n.scaleY = Math.hypot(x1 - x0, y1 - y0);
    });
  }

  let visible = 0;
  function render(t) {
    const st = ride.step(t);
    const sorted = [...st.chairs].sort((a, b) => a.depth - b.depth);
    const groups = [sorted.filter((c) => c.front <= 0), sorted.filter((c) => c.front > 0)];
    visible = 0;
    [back, front].forEach((slotsOf, g) => slotsOf.forEach((slot, i) => {
      const c = groups[g][i];
      if (c) { place(slot, c); visible++; } else { hide(slot.seat.root); slot.chains.forEach(hide); }
    }));
    const j = Math.round((((st.phi % cn.period) + cn.period) % cn.period) / cn.period * meta.frames) % meta.frames;
    canopy.x = -s * (j % cn.cols) * cn.cw;
    canopy.y = -s * Math.floor(j / cn.cols) * cn.ch;
    artboard.advance(0);
    renderer.clear();
    renderer.save();
    renderer.align(rive.Fit.fill, rive.Alignment.topLeft, { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height }, artboard.bounds);
    artboard.draw(renderer);
    renderer.restore();
    rive.resolveAnimationFrame();
    bulbs.draw(st);
    bench?.report("swings-rive", visible * 3 + 2);
  }

  render(clock.now());
  window.__swings = { ride, rive, artboard, meta };
  return { update(dt, t) { render(t); } };
}
