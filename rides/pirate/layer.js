// The Pirate Ship swinging.
//
// The painted ship is erased by a plate (plate.webp, tools/park_patch.py: the painting with the hull and its arms
// removed, the A-frame and the hub kept). Over it, bottom to top: one canvas with the ship's soft shadow on the
// platform, the ship (ship_back.webp: the whole ship and its two arms), its riders, and the ship's near hull side again
// (ship_front.webp), so riders sit inside the boat with only their heads and shoulders showing; then front.webp, the
// things that stand in front of the swinging ship: the front A-frame legs and the hub (the plate's own pixels) and three
// lamps (the painting's). Art and geometry: tools/build_ship.py, ship.json, front.json.
//
// Depth for the crowd (rides/RIDERS.md "Depth"): `occluders(t)` gives the ship at its swing (ship_back.webp's
// silhouette placed by the same matrix it is drawn with) on its plane halfway between the A-frame's front and back
// feet, and front.webp's front A-frame with the hub on its feet, so animals queueing for the Double Shot behind the
// platform pass behind the ship and the front legs.
//
// The ship swings in the A-frame's plane, which the painting draws face-on: the horizontal axis that projects to the
// screen's horizontal is foreshortened by 1, the vertical by cos(pitch). So a swing by theta in that plane is, on screen,
// S R(theta) S^-1 about the hub with S = diag(1, cos(pitch)): a rotation that flattens a little as it tilts.
//
// The motion is a fixed cycle (closed form, so any clock time and a frozen &t= give the same frame), like the real
// HUSS Pirate: stopped to load, then pushed into a growing swing over BUILD swings, held at MAX for HOLD swings, eased
// down over DOWN swings to a stop. Riders get out and in during the stop, row by row.
const PITCH = (28.7 * Math.PI) / 180;
const K = Math.cos(PITCH);      // vertical foreshortening of the swing plane
const BOX = [690, 1035, 1180, 1305]; // park px: the canvas covers every position of the swinging ship
const T = 5.6;                   // s per swing (there and back)
const LOAD = 16;                 // s stopped at the platform
const BUILD = 4, HOLD = 3, DOWN = 3; // swings
const MAX = 42;                  // deg, the biggest swing (the real ride goes further; past ~45 the wide A of arms reads as a sideways bar)
const SWING = (BUILD + HOLD + DOWN) * T;
const CYCLE = LOAD + SWING;
const ALIGHT = 1.5, BOARD = 6;   // s into the stop when row 0's riders step out and new ones step in
const ROW_LAG_OUT = 0.3, ROW_LAG_IN = 0.4, FADE = 0.6;
const SEATS = 3;                 // riders shown per row (far, middle, near)
const SEAT_OFF = [[-5, -5], [1, -2], [6, 1]]; // park px, far to near, in the ship's frame
const SHOW = 20;                 // park px of a rider above the near gunwale
const SIZE = 38;                 // the crowd's character size (tests/park-crowd/crowd.js)
const UNIT = 3840 / 3904;
const RAD = Math.PI / 180;

import { rideHours } from "../../base/park_hours.js";
import { getSky } from "../../base/sky.js";
const REST = 4.2;                 // s into the cycle where it waits while the park is closed: stopped, everyone out

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
const hash = (n) => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const smooth = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

// Swing angle (deg; positive = the ship out to the left, its left end up) at time tau into the cycle.
export function angleAt(tau) {
  if (tau < LOAD) return 0;
  const s = tau - LOAD;
  let a;
  if (s < BUILD * T) a = MAX * (1 - Math.cos((Math.PI * s) / (BUILD * T))) / 2;
  else if (s < (BUILD + HOLD) * T) a = MAX;
  else a = MAX * (1 + Math.cos((Math.PI * (s - (BUILD + HOLD) * T)) / (DOWN * T))) / 2;
  return -a * Math.sin((2 * Math.PI * s) / T); // the first push sends the ship to the right
}
export const cycle = CYCLE;

// Rail top (park px), from tests/park-crowd/tools/make_walk.mjs, for keeping the queue on the deck.
const RAIL = [[753, 1270], [803, 1283], [827, 1297], [900, 1323], [1000, 1330], [1093, 1317]];
const along = (line, x) => { for (let i = 0; i < line.length - 1; i++) if (x <= line[i + 1][0]) return line[i][1] + ((x - line[i][0]) / (line[i + 1][0] - line[i][0])) * (line[i + 1][1] - line[i][1]); return line.at(-1)[1]; };
// The platform's front rim (park px), measured on the plate: centre (935, 1261), radii 83 x 36.
const rim = (x) => 1261 + 36 * Math.sqrt(Math.max(0, 1 - ((x - 935) / 83) ** 2));

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowd = new URL("../../tests/park-crowd/", ctx.dir);
  const [meta, plate, front, atlasMeta, back, near, frontImg, atlas] = await Promise.all([
    fetch(url("ship.json")).then((r) => r.json()),
    fetch(url("plate.json")).then((r) => r.json()),
    fetch(url("front.json")).then((r) => r.json()),
    fetch(new URL("atlas.json", crowd)).then((r) => r.json()),
    loadImage(url("ship_back.webp")), loadImage(url("ship_front.webp")), loadImage(url("front.webp")),
    loadImage(new URL("atlas.png", crowd).href),
  ]);
  // Park hours (base/park_hours.js): closed, the ship finishes its swing and hangs still at the platform.
  const hours = rideHours(ctx.sky ?? getSky({ params: ctx.params }), { period: CYCLE, rest: REST, frozen: ctx.clock.frozen });
  const [PX, PY] = meta.pivot;
  const [IW, IH] = meta.image_park, [OX, OY] = meta.pivot_in_image;
  const ROWS = meta.seats.length;
  const AS = atlasMeta.scale, RK = (SIZE * UNIT) / 30;
  const looks = [...new Set(Object.keys(atlasMeta.frames).filter((k) => k.endsWith("/side_stand")).map((k) => k.split("/")[0]))].filter((l) => l !== "pet");

  // Rows 0-2 (bow half, left) face right, towards the middle of the ship; rows 3-5 face left.
  const facesLeft = (r) => r >= ROWS / 2;
  const boardAt = (r) => BOARD + ROW_LAG_IN * r, alightAt = (r) => ALIGHT + ROW_LAG_OUT * r;
  // The riders on row r at time t: who, and how much they show (0..1). Boarded at cycle n's stop, out at n+1's.
  function riders(r, t) {
    const n = Math.floor((t - boardAt(r)) / CYCLE);
    if (n < 0) return null;
    const tb = n * CYCLE + boardAt(r), tu = (n + 1) * CYCLE + alightAt(r);
    if (t >= tu) return null;
    const alpha = smooth((t - tb) / FADE) * smooth((tu - t) / FADE);
    let who = ctx.riders ? ctx.riders(ctx.name, `row${r}`, hours.master(t)) : null;
    if (who == null) {
      // No crowd: our own riders, decided once per boarding.
      const h = hash(n * 31 + r * 7 + 1);
      const count = h < 0.1 ? 0 : h < 0.35 ? 1 : h < 0.7 ? 2 : 3;
      who = Array.from({ length: count }, (_, j) => looks[Math.floor(hash(n * 131 + r * 17 + j * 5 + 3) * looks.length)]);
    }
    return { who: who.slice(0, SEATS), alpha };
  }

  ctx.addPatch(url("plate.webp"), plate.rect);
  const [bx, by, bx1, by1] = BOX, bw = bx1 - bx, bh = by1 - by;
  const c = document.createElement("canvas");
  c.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
  ctx.slots.rides.append(c);
  const g = c.getContext("2d");
  const [fx, fy, fw, fh] = front.rect;
  frontImg.alt = "";
  frontImg.style.cssText = `left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px`;
  ctx.slots.rides.append(frontImg);

  let density = 1;
  function resize(scale) {
    density = scale * Math.min(devicePixelRatio || 1, 2 / scale);
    c.width = Math.round(bw * density);
    c.height = Math.round(bh * density);
  }
  resize(ctx.scale());

  function drawRider(look, x, y, flip, alpha) {
    const f = atlasMeta.frames[`${look}/side_stand`];
    if (!f) return;
    const [sx, sy, sw, sh] = f.rect, [ax, ay] = f.anchor, k = RK / AS;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    g.drawImage(atlas, sx, sy, sw, sh, -ax * k, -ay * k, sw * k, sh * k);
    g.restore();
  }

  function draw(t) {
    const tau = ((t % CYCLE) + CYCLE) % CYCLE;
    const th = angleAt(tau) * RAD;
    g.setTransform(density, 0, 0, density, -bx * density, -by * density);
    g.clearRect(bx, by, bw, bh);
    g.imageSmoothingQuality = "high";
    // The shadow on the platform, under the hull's middle; fainter as the ship rises.
    const hx = PX - (meta.keel_at_rest - PY - 30) / K * Math.sin(th), lift = Math.cos(th);
    g.save();
    g.translate(hx, 1266);
    g.scale(1, 0.2);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, 80);
    sh.addColorStop(0, `rgba(44, 32, 27, ${0.2 * lift * lift})`);
    sh.addColorStop(1, "rgba(44, 32, 27, 0)");
    g.fillStyle = sh;
    g.fillRect(-80, -80, 160, 160);
    g.restore();
    // The ship's frame: S R(theta) S^-1 about the hub.
    g.translate(PX, PY);
    g.scale(1, K);
    g.rotate(th);
    g.scale(1, 1 / K);
    g.drawImage(back, -OX, -OY, IW, IH);
    for (let r = 0; r < ROWS; r++) {
      const st = riders(r, t);
      if (!st || st.alpha <= 0.004) continue;
      const seat = meta.seats[r];
      st.who.forEach((look, j) => {
        const [dx, dy] = SEAT_OFF[SEATS - st.who.length + j];
        drawRider(look, seat.x + dx, seat.gunwale + (42 - SHOW) + dy, facesLeft(r), st.alpha);
      });
    }
    g.drawImage(near, -OX, -OY, IW, IH);
  }

  // The crowd's side (rides/RIDERS.md): the queue on the deck in front of the platform, from the gate westwards.
  const gate = [995, Math.round(Math.min(rim(995) + 12, along(RAIL, 995) - 9))];
  const queue = [];
  for (let x = 995; x >= 870; x -= 17) queue.push([x, Math.round(Math.min(rim(x) + 12, along(RAIL, x) - 9))]);
  function loads(t0, t1) {
    const out = [];
    const n0 = Math.max(0, Math.floor((t0 - BOARD - ROW_LAG_IN * ROWS) / CYCLE)), n1 = Math.ceil(t1 / CYCLE);
    for (let n = n0; n <= n1; n++) {
      for (let r = 0; r < ROWS; r++) {
        const t = n * CYCLE + boardAt(r);
        if (t >= t0 && t < t1) out.push({ t, key: `row${r}`, seats: SEATS, until: (n + 1) * CYCLE + alightAt(r) });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // Depth (rides/RIDERS.md): what hides the crowd's animals standing behind it. The ship swings in the plane halfway
  // between the A-frame's front feet (y 1264-1269, measured on front.webp's alpha) and back feet (1223-1226).
  const SHIP_Y = 1245;
  const fk = frontImg.naturalWidth / fw;
  const part = (rect, base) => ({
    rect, mask: frontImg, crop: [(rect[0] - fx) * fk, (rect[1] - fy) * fk, rect[2] * fk, rect[3] * fk],
    ...(Array.isArray(base) ? { sortY: (base[1] + base[3]) / 2, sortLine: base } : { sortY: base }),
  });
  // front.webp's three lamps come with the painting's own cut-outs (tests/park-crowd/occ.*, tight masks); their part
  // of front.webp carries strips of deck that would cut holes in animals.
  const parts = [part([836, 1076, 194, 198], [850, 1264, 1020, 1269])]; // front legs and hub: the front A-frame's feet
  function occluders(t) {
    t = hours.run(t);
    const tau = ((t % CYCLE) + CYCLE) % CYCLE, th = angleAt(tau) * RAD, c = Math.cos(th), s = Math.sin(th);
    // S R(theta) S^-1 about the hub, as in draw(): park = (c x - s y / K, K s x + c y) + hub.
    return [{ rect: [-OX, -OY, IW, IH], matrix: [c, K * s, -s / K, c, PX, PY], sortY: SHIP_Y, mask: back }, ...parts];
  }

  let cost = 0, frames = 0;
  window.__pirate = { cycle: CYCLE, angleAt, riders, loads, draw, occluders, cost: () => cost / Math.max(1, frames) };
  return {
    update(t) {
      const t0 = performance.now();
      draw(hours.run(t));
      cost += performance.now() - t0;
      frames++;
    },
    resize,
    riders: { gate, queue, exit: [850, 1290], loads: hours.loads(loads) },
    occluders,
  };
}
