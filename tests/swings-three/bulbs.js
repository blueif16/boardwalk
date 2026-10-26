import { DIM, bulbPoints } from "./ride.js";

export function createBulbs({ camera, time, slots, centre }) {
  const [bx, by, bw, bh] = DIM.box;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = bw * dpr;
  canvas.height = bh * dpr;
  Object.assign(canvas.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px`, pointerEvents: "none" });
  slots.lights.append(canvas);
  const g = canvas.getContext("2d");

  const glow = document.createElement("canvas");
  glow.width = glow.height = 64;
  const gg = glow.getContext("2d");
  const grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,250,225,1)");
  grad.addColorStop(0.12, "rgba(255,236,170,0.95)");
  grad.addColorStop(0.35, "rgba(255,196,110,0.35)");
  grad.addColorStop(1, "rgba(255,170,90,0)");
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 64, 64);

  const pts = bulbPoints();
  const hx = Math.sin(camera.yaw), hz = Math.cos(camera.yaw);
  const hidden = -Math.tan(camera.pitch) / ((DIM.apexY - DIM.roofY) / DIM.rimR) + 0.04;
  let blank = false;

  function draw(state) {
    const lights = time.look.lights;
    if (lights < 0.01) {
      if (!blank) g.clearRect(0, 0, canvas.width, canvas.height);
      blank = true;
      return;
    }
    blank = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
    g.globalCompositeOperation = "lighter";
    const c = Math.cos(state.phi), s = Math.sin(state.phi), t = state.t;
    for (const b of pts) {
      const [x, y, z] = b.p;
      const w = [centre[0] + x * c + z * s, y, centre[2] - x * s + z * c];
      const ax = w[0] - centre[0], az = w[2] - centre[2], al = Math.hypot(ax, az);
      const facing = (ax * hx + az * hz) / al;
      if ((b.ring != null && facing < -0.12) || (b.seam != null && facing < hidden)) continue;
      const [px, py] = camera.toPixel(w);
      const k = b.ring != null ? 0.7 + 0.3 * Math.sin(t * 5 - b.ring * 0.8) : b.seam != null ? 0.75 + 0.25 * Math.sin(t * 2.2 - b.seam * 1.6) : 1;
      const r = b.top ? 11 : 7.5;
      g.globalAlpha = Math.min(1, lights * k);
      g.drawImage(glow, px - r, py - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  return { draw, canvas };
}
