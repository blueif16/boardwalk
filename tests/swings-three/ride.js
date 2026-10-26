export const DIM = {
  platform: "sea_swings",
  n: 16,
  variants: [0, 1, 2, 3, 1, 0, 3, 2, 0, 2, 1, 3, 2, 3, 0, 1],
  pivotR: 56,
  pivotY: 128,
  chain: 80,
  spread: 10,
  rimR: 82,
  valR: 85,
  scallop: 6,
  crown: 6,
  chairScale: 1.35,
  valanceTop: 164,
  valanceBot: 128,
  roofY: 165,
  apexY: 221,
  gores: 16,
  box: [784, 404, 320, 290],
};

export const SPEED = { omega: (2 * Math.PI) / 5.5, cycle: 48, g: 175, maxTheta: (56 * Math.PI) / 180, boost: 0.8, kick: 0.45, cap: 1.3 };

export function domeY(r) {
  const s = Math.min(1, Math.max(0, r / DIM.rimR));
  return DIM.roofY + (DIM.apexY - DIM.roofY) * (1 - s);
}

export function bulbPoints() {
  const pts = [];
  const r = DIM.valR + 1;
  for (let i = 0; i < 2 * DIM.gores; i++) {
    const a = -Math.PI + (i * Math.PI) / DIM.gores;
    pts.push({ p: [r * Math.cos(a), DIM.valanceTop + (i % 2 ? DIM.crown - 1.5 : 0.5), r * Math.sin(a)], ring: i });
  }
  for (let i = 0; i < DIM.gores; i++) {
    const a = (i * 2 * Math.PI) / DIM.gores + Math.PI;
    for (const [j, f] of [0.3, 0.6].entries()) {
      const rr = DIM.rimR * (1 - f);
      pts.push({ p: [rr * Math.cos(a), domeY(rr) + 1.2, -rr * Math.sin(a)], seam: j });
    }
  }
  pts.push({ p: [0, DIM.apexY + 21, 0], top: true });
  return pts;
}

const S = (x) => x * x * (3 - 2 * x);
const SI = (x) => x * x * x - (x * x * x * x) / 2;

export function program(t) {
  const { omega: w, cycle } = SPEED;
  const per = 32 * w;
  const n = Math.floor(t / cycle);
  const u = t - n * cycle;
  let phi, omega;
  if (u < 4) { phi = 0; omega = 0; }
  else if (u < 12) { const x = (u - 4) / 8; phi = 8 * w * SI(x); omega = w * S(x); }
  else if (u < 36) { phi = w * (4 + (u - 12)); omega = w; }
  else if (u < 44) { const x = (u - 36) / 8; phi = w * (28 + 8 * (x - SI(x))); omega = w * (1 - S(x)); }
  else { phi = per; omega = 0; }
  return { phi: n * per + phi, omega };
}

export function thetaEq(omega) {
  let th = 0;
  for (let i = 0; i < 8; i++) th = Math.atan((omega * omega * (DIM.pivotR + DIM.chain * Math.sin(th))) / SPEED.g);
  return Math.min(th, SPEED.maxTheta);
}

export function createRide({ stage, camera, clock, slots }) {
  const p = stage.platforms[DIM.platform];
  const C = camera.toGround(p.floor);
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch);
  const toward = [sy * cp, sp, cy * cp];

  const hit = document.createElement("div");
  const [bx, by, bw, bh] = DIM.box;
  Object.assign(hit.style, { position: "absolute", left: `${bx + 20}px`, top: `${by + 10}px`, width: `${bw - 40}px`, height: `${bh - 20}px`, borderRadius: "50%", cursor: "pointer" });
  hit.setAttribute("aria-label", "Sea Swings: hover or tap to spin it up");
  slots.rides.append(hit);

  let hover = false, boost = 0, extra = 0, theta = null, thetaV = 0, last = null;
  hit.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hover = true; });
  hit.addEventListener("pointerleave", () => { hover = false; });
  hit.addEventListener("pointerdown", () => { boost = Math.min(boost + SPEED.kick * SPEED.omega, (SPEED.cap - 0.2) * SPEED.omega); });

  const chairs = Array.from({ length: DIM.n }, (_, k) => ({ k, variant: DIM.variants[k % DIM.variants.length] }));
  const state = { t: 0, phi: 0, omega: 0, theta: 0, chairs, centre: C, toward };

  function step(t) {
    const dt = last == null ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const base = program(t);
    for (let left = dt; left > 1e-6; ) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      const target = hover ? SPEED.boost * SPEED.omega : 0;
      const tau = target > boost ? 1.2 : 3.5;
      boost += ((target - boost) * h) / tau;
      const room = SPEED.cap * SPEED.omega - program(t - left).omega;
      boost = Math.min(boost, Math.max(0, room));
      extra += boost * h;
      const eq = thetaEq(program(t - left).omega + boost);
      const acc = 9 * (eq - theta) - 4.2 * thetaV;
      thetaV += acc * h;
      theta += thetaV * h;
    }
    const omega = base.omega + boost;
    if (theta == null) { theta = thetaEq(omega); thetaV = 0; }
    theta = Math.max(0, Math.min(SPEED.maxTheta, theta));
    state.t = t;
    state.phi = base.phi + extra;
    state.omega = omega;
    state.theta = theta;
    pose();
    return state;
  }

  function pose() {
    const { phi, theta } = state;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (const c of chairs) {
      const psi = phi + (c.k * 2 * Math.PI) / DIM.n;
      const ux = Math.cos(psi), uz = -Math.sin(psi);
      const tx = -Math.sin(psi), tz = -Math.cos(psi);
      const P = [C[0] + DIM.pivotR * ux, DIM.pivotY, C[2] + DIM.pivotR * uz];
      const Sx = [P[0] + DIM.chain * st * ux, P[1] - DIM.chain * ct, P[2] + DIM.chain * st * uz];
      const s = DIM.spread;
      c.psi = psi;
      c.theta = theta;
      c.pivot = P;
      c.seat = Sx;
      c.hangers = [
        [[P[0] - s * tx, P[1], P[2] - s * tz], [Sx[0] - s * tx, Sx[1], Sx[2] - s * tz]],
        [[P[0] + s * tx, P[1], P[2] + s * tz], [Sx[0] + s * tx, Sx[1], Sx[2] + s * tz]],
      ];
      c.front = (Sx[0] - C[0]) * sy + (Sx[2] - C[2]) * cy;
      c.depth = Sx[0] * toward[0] + Sx[1] * toward[1] + Sx[2] * toward[2];
    }
  }

  return {
    state,
    centre: C,
    hit,
    step,
    get hover() { return hover; },
    tap() { hit.dispatchEvent(new PointerEvent("pointerdown")); },
    setHover(v) { hover = v; },
    destroy() { hit.remove(); },
  };
}
