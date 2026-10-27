// Stand-ins for the `lights` block each live layer would return from mount(ctx) (RESULTS.md, "The contract for live
// layers"). The rides' files are not ours to change, so these read the state the layers already expose for tests
// (window.__wheel, __coaster, __traffic) and their geometry files. Each returns a provider for lights.register():
//   { name, rect, group, frame(t, out, {dark, on}), masks: [{ el, rect, alpha }] }
import { hash } from "./behaviour.js";

const loadImage = (url) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = url; });
const RAD = Math.PI / 180;

// --- The Dream Wheel: a Chance Century Wheel with colour-changing LEDs on its rim, spokes and inner ring. Its permit
// rules out red-spectrum light (migrating birds), so the palette is blue, cyan, teal, green, violet and white. Five
// programs of 12 s each, cross-faded: rim chase, spoke sweep, colour fade, a rainbow that turns, sparkle.
const WHEEL_PAL = ["#58d0ff", "#3d86ff", "#7d6bff", "#b884ff", "#4fe3c4", "#94ff9e", "#f4f8ff"];
const mixHex = (a, b, t) => { const p = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
const palAt = (u) => { const n = WHEEL_PAL.length, x = (((u % 1) + 1) % 1) * n, i = Math.floor(x); return mixHex(WHEEL_PAL[i], WHEEL_PAL[(i + 1) % n], x - i); };

export async function wheelLights(ctx) {
  const W = window.__wheel;
  if (!W) return null;
  const base = new URL("../../rides/wheel/", import.meta.url);
  const meta = await fetch(new URL("wheel.json", base)).then((r) => r.json());
  const legs = await loadImage(new URL("legs.webp", base).href);
  const hub = await loadImage(new URL("hub.webp", base).href);
  const [HX, HY] = meta.hub, [RA, RB] = meta.ring, KR = meta.wheel.knob_radius;
  const HUB = (meta.wheel.hub_size / meta.cabins.density) / 2;
  const cab = meta.cabins.frames.yellow_empty, CD = meta.cabins.density;
  const CW = cab.rect[2] / CD, CH = cab.rect[3] / CD, CAX = cab.anchor[0] / CD, CAY = cab.anchor[1] / CD;
  const P = (r, deg) => [HX + RA * (r / KR) * Math.cos(deg * RAD), HY + RB * (r / KR) * Math.sin(deg * RAD)];
  // Where the LEDs are, in sprite px (radius) and degrees from a spoke: 48 on the rim, 7 on each of 12 spokes, 24 on
  // the inner ring.
  const leds = [];
  for (let k = 0; k < 48; k++) leds.push({ part: "rim", r: 297, d: k * 7.5, i: k });
  for (let s = 0; s < 12; s++) for (let j = 0; j < 7; j++) leds.push({ part: "spoke", r: 70 + j * 33, d: s * 30, i: s, j });
  for (let k = 0; k < 24; k++) leds.push({ part: "inner", r: 120, d: k * 15 + 7.5, i: k });
  const legsRect = meta.legs.rect;
  let angle = 0;
  const cabins = [];
  return {
    name: "wheel", rect: [2440, 1160, 280, 300], group: "ride",
    frame(t, out) {
      angle = W.angle(t);
      cabins.length = 0;
      for (let k = 0; k < 12; k++) { const p = (k * 30 + angle) * RAD; cabins.push([HX + RA * Math.cos(p), HY + RB * Math.sin(p)]); }
      const prog = Math.floor(t / 12) % 5, f = (t % 12) / 12;
      const fade = Math.min(1, f * 12, (1 - f) * 12); // 1 s cross-fade at each end
      for (const L of leds) {
        const deg = L.d + angle;
        const [x, y] = P(L.r, deg);
        let col, a;
        switch (prog) {
          case 0: { // rim chase: groups of four running clockwise; spokes a dim steady blue
            const ph = ((L.i - Math.floor(t * 10)) % 4 + 4) % 4;
            if (L.part === "rim") { col = "#5ed6ff"; a = ph === 0 ? 1 : 0.18; } else { col = "#3d86ff"; a = 0.35; }
            break;
          }
          case 1: { // spoke sweep: one spoke after another lights from the hub out, leaving a fading trail
            const head = (t * 5) % 12, back = ((head - L.i) % 12 + 12) % 12;
            if (L.part === "spoke") { col = back < 1 ? "#f4f8ff" : "#b884ff"; a = Math.max(0.12, 1 - back / 4) * (back < 1 ? Math.min(1, (t * 5 % 1) * 7 / (L.j + 1)) : 1); }
            else { col = "#7d6bff"; a = 0.45; }
            break;
          }
          case 2: { col = palAt(t / 8); a = 0.85; break; } // one colour for the whole wheel, fading through the palette
          case 3: { col = palAt((L.d + angle) / 360 + t * 0.08); a = 0.9; break; } // a rainbow (no red) turning round
          default: { // sparkle: white points twinkling over a dim blue
            const k = hash(L.i * 31 + L.r + Math.floor(t * 7) * 977);
            col = k > 0.86 ? "#ffffff" : "#3d86ff"; a = k > 0.86 ? 1 : 0.3;
          }
        }
        // The cabins hang in front of the rim: a LED inside a cabin's box is hidden.
        let vis = 1;
        for (const [cx, cy] of cabins) if (x > cx - CAX + 2 && x < cx - CAX + CW - 2 && y > cy - CAY + 3 && y < cy - CAY + CH - 3) { vis = 0; break; }
        out.push({ x, y, kind: "led", colour: col, a: a * (0.35 + 0.65 * fade), vis, r: L.part === "rim" ? 1.9 : 1.6, bloom: 1.5 });
      }
    },
    masks: [{ el: legs, rect: legsRect }, { el: hub, rect: [HX - HUB, HY - HUB, 2 * HUB, 2 * HUB] }],
  };
}

// --- The Giant Dipper: 3,150 bulbs along its outline (the Boardwalk's count), "chaser lights ... chasing the train as
// it goes around the track". The bulbs sit on the painted track's top edge (lights.json: dipper_track_*); a chase
// runs along them in the direction of travel, and a bright packet rides with each train. Two providers: the front run
// (cut by the station shed and the Fireball's hub) and the run behind the lattice (cut by the lattice), both cut by
// the trains themselves.
export async function coasterLights(ctx, inventory) {
  const C = window.__coaster;
  if (!C) return [];
  const base = new URL("../../rides/coaster/", import.meta.url);
  const occ = async (name) => ({ meta: await fetch(new URL(`occ_${name}.json`, base)).then((r) => r.json()), el: await loadImage(new URL(`occ_${name}.webp`, base).href) });
  const [lattice, station, fireball] = await Promise.all(["lattice", "station", "fireball"].map(occ));
  const track = await fetch(new URL("track.json", base)).then((r) => r.json());
  const P = track.points, L = P.length;
  // Each bulb's arc position u on the track (nearest point), so the chase and the train packet can use track distance.
  const nearest = (x, y) => { let b = 0, bd = 1e9; for (let i = 0; i < L; i++) { const d = (P[i][0] - x) ** 2 + (P[i][1] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const runs = ["front", "back"].map((name) => {
    const src = inventory.find((l) => l.id === `dipper_track_${name}`);
    return { name, bulbs: (src?.pts ?? []).map(([x, y]) => ({ x, y, u: nearest(x, y) })), dim: src?.dim ?? 1 };
  });
  const trains = [0, C.cycle / 2];
  const CAR = 41, BODY = 19; // the coaster's car spacing and half a car's length along the track
  const make = (run, masks) => ({
    name: `coaster_${run.name}`, rect: [1990, 900, 1250, 362], group: "ride",
    frame(t, out) {
      const leads = trains.map((o) => C.station + C.travel(t + o));
      const step = Math.floor(t * 8);
      for (const b of run.bulbs) {
        const chase = ((Math.floor(b.u / 7) - step) % 3 + 3) % 3 === 0 ? 1 : 0.42;
        let packet = 0, vis = 1;
        for (const lead of leads) {
          const d = (((lead - b.u) % L) + L) % L; // track px behind the lead car's centre
          if (d < 160) packet = Math.max(packet, 1 - d / 160);
          if (d < 2 * CAR + BODY + 2 || d > L - BODY - 2) vis = 0; // under a car of the train
        }
        out.push({ x: b.x, y: b.y, kind: "bulb", colour: "#fff1d2", a: run.dim * Math.min(1, chase * 0.8 + packet * 0.6), vis, r: 1.35, bloom: 0.8 });
      }
    },
    masks,
  });
  const rectOf = (o) => o.meta.rect;
  return [
    make(runs[0], [{ el: station.el, rect: rectOf(station) }, { el: fireball.el, rect: rectOf(fireball) }]),
    make(runs[1], [{ el: lattice.el, rect: rectOf(lattice), alpha: 0.88 }]),
  ];
}

// --- Cars on Beach Street: headlights and their wash on the road ahead, tail lights (brighter while braking). Parked
// cars are dark. On at dusk with the photocells (drivers switch on as it gets dark).
export async function trafficLights(ctx, rect) {
  const T = window.__traffic;
  if (!T) return null;
  if (!rect) { // the whole street: the loop's extent and the parking stalls'
    const ps = [T.loop.pts, ...T.cars().filter((c) => c.stall).map((c) => c.stall.path.pts)].flat();
    const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    rect = [Math.max(0, Math.min(...xs) - 90), Math.max(0, Math.min(...ys) - 60), 0, 0];
    rect[2] = Math.min(3840, Math.max(...xs) + 90) - rect[0]; rect[3] = Math.max(...ys) + 60 - rect[1];
  }
  const cam = ctx.camera, [ex0, ex1] = cam.ex, [ez0, ez1] = cam.ez, up = Math.cos(cam.pitch);
  const scr = (gx, gz) => [gx * ex0 + gz * ez0, gx * ex1 + gz * ez1];
  const at = (path, s) => { const i = Math.max(0, Math.min(path.n - 1, s)), i0 = Math.floor(i), f = i - i0, a = path.pts[i0], b = path.pts[Math.min(path.n - 1, i0 + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, path.th[Math.round(i)]]; };
  const lastV = new Map();
  const HALF = 30, SIDE = 11, HEAD_H = 9, TAIL_H = 11;
  return {
    name: "traffic", rect, group: "photocell",
    frame(t, out) {
      for (const c of T.cars()) {
        if (c.mode === "parked") continue;
        const [x, y, th] = at(c.mode === "loop" ? T.loop : c.stall.path, c.s);
        if (x < rect[0] - 60 || x > rect[0] + rect[2] + 60) continue;
        const fx = Math.cos(th), fz = Math.sin(th), sx = -fz, sz = fx;
        const [fdx, fdy] = scr(fx, fz);
        const towards = fdy; // > 0: the car's front faces the viewer
        const brake = (lastV.get(c.id) ?? c.v) - c.v > 0.4; lastV.set(c.id, c.v);
        for (const side of [-1, 1]) {
          const [hx, hy] = scr(fx * HALF + sx * SIDE * side, fz * HALF + sz * SIDE * side);
          const [tx, ty] = scr(-fx * HALF + sx * SIDE * side, -fz * HALF + sz * SIDE * side);
          const aHead = Math.min(1, Math.max(0, 0.25 + towards * 2.2)), aTail = Math.min(1, Math.max(0, 0.25 - towards * 2.2));
          out.push({ x: x + hx, y: y + hy - HEAD_H * up, kind: "head", colour: "#fff6dc", a: aHead, r: 1.8 });
          out.push({ x: x + tx, y: y + ty - TAIL_H * up, kind: "tail", colour: "#ff5a48", a: aTail * (brake ? 1 : 0.6), r: 1.5, bloom: brake ? 1.4 : 0.8 });
        }
        // The wash on the asphalt ahead of the car, along its heading on screen.
        const [px, py] = scr(fx * (HALF + 4), fz * (HALF + 4));
        const n = Math.hypot(fdx, fdy) || 1;
        out.push({ x: x + px, y: y + py, kind: "beam", colour: "#fff1d0", dx: fdx / n, dy: fdy / n, len: 78 * Math.max(0.5, n), w: 40, a: 1 });
      }
    },
  };
}

// --- The west carousel (rides/carousel): a ring of warm bulbs on its rounding board, turning with it, steady with a
// slow twinkle (the Looff tradition: Looff was the first carousel maker to add lights as decoration). The back half
// of the ring is behind the canopy, so only the front half shows; a warm glow lights the horses through their colours.
export async function carouselLights(ctx) {
  const C = window.__carousel;
  if (!C) return null;
  const geom = await fetch(new URL("../../rides/carousel/geom.json", import.meta.url)).then((r) => r.json());
  const g = geom.west, N = 28;
  const at = (e, phi) => { const r = ((e.rot || 0) * Math.PI) / 180, u = e.a * Math.cos(phi), v = e.b * Math.sin(phi); return [e.c[0] + u * Math.cos(r) - v * Math.sin(r), e.c[1] + u * Math.sin(r) + v * Math.cos(r)]; };
  const [bx0, by0] = [g.box[0] - 10, g.box[1] - 10];
  return {
    name: "carousel", rect: [bx0, by0, g.box[2] - g.box[0] + 20, g.box[3] - g.box[1] + 20], group: "ride",
    pools: [{ c: [g.bot.c[0], g.bot.c[1] + 8], r: 70, colour: "#e0b070" }],
    frame(t, out) {
      const a = C.motion(t, "west").angle;
      for (let k = 0; k < N; k++) {
        const phi = (k / N) * 2 * Math.PI + a;
        const s = Math.sin(phi);
        if (s < -0.1) continue; // behind the canopy
        const [x, y] = at(g.val, phi);
        const tw = 0.86 + 0.14 * Math.sin(t * (1.1 + hash(k) * 1.3) + hash(k * 3) * 6.28);
        out.push({ x, y: y + g.val.b * 0.55, kind: "bulb", colour: "#fff0c8", a: tw * (0.55 + 0.45 * Math.min(1, s + 0.3)), r: 1.5 });
      }
    },
  };
}

// --- The Sea Swings (rides/swings): warm bulbs round the canopy's crown band, turning with the canopy and riding up
// and down with its lift (its tilt, under 5 px, is left out); a slow chase while it runs, steady while it loads.
export async function swingsLights(ctx) {
  const S = window.__swings;
  if (!S) return null;
  const geom = await fetch(new URL("../../rides/swings/geom.json", import.meta.url)).then((r) => r.json());
  const band = geom.painted.band_bot, LIFT = geom.lift, N = 30;
  const [x0, y0, x1, y1] = geom.region;
  return {
    name: "swings", rect: [x0, y0, x1 - x0, y1 - y0], group: "ride",
    pools: [{ c: [geom.hub[0], geom.hub[1] + 6], r: 52, colour: "#e8b070" }],
    frame(t, out) {
      const m = S.motion(t), dy = LIFT * (1 - m.lift), running = m.omega > 0.2;
      const step = Math.floor(t * 4);
      for (let k = 0; k < N; k++) {
        const phi = (k / N) * 2 * Math.PI + m.rot;
        const s = Math.sin(phi);
        if (s < -0.15) continue; // the far side of the band is behind the canopy
        const x = band.c[0] + band.a * Math.cos(phi), y = band.c[1] + band.b * s + dy - 2;
        const chase = running ? (((k - step) % 3 + 3) % 3 === 0 ? 1 : 0.45) : 0.9;
        out.push({ x, y, kind: "bulb", colour: "#ffefc4", a: chase * (0.55 + 0.45 * Math.min(1, s + 0.3)), r: 1.5 });
      }
    },
  };
}
