export async function mount({ stage, camera, slots }) {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = camera.W * dpr;
  canvas.height = camera.H * dpr;
  slots.debug.append(canvas);
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);

  const circle = (center, r, height, color) => {
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const [px, py] = camera.toPixel([center[0] + r * Math.cos(a), height, center[2] + r * Math.sin(a)]);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
  };

  const report = {};
  for (const [name, p] of Object.entries(stage.platforms)) {
    const ground = camera.toGround(p.floor);
    circle(ground, p.radius, 0, "#e0398b");
    circle(ground, p.radius, p.fencePx / Math.cos(camera.pitch), "#1f8a5b");
    const back = camera.toPixel(ground);
    report[name] = { ground: ground.map((v) => +v.toFixed(1)), roundTripPx: +Math.hypot(back[0] - p.floor[0], back[1] - p.floor[1]).toFixed(3) };
    const [ux, uy] = camera.toPixel([ground[0], 120, ground[2]]);
    g.beginPath(); g.moveTo(...p.floor); g.lineTo(ux, uy); g.strokeStyle = "#1f8a5b"; g.stroke();
  }

  const [a, b] = stage.wall.railTop;
  g.setLineDash([8, 6]); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.strokeStyle = "#2f6fd6"; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
  const origin = camera.toGround(a);
  const along = camera.toPixel([origin[0] + 1700, 0, origin[2]]);
  g.beginPath(); g.moveTo(...a); g.lineTo(...along); g.strokeStyle = "#f08a24"; g.stroke();

  for (const [x, y] of stage.stairs) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fillStyle = "#2f6fd6"; g.fill(); }
  window.__calibration = report;
  console.log("calibration", JSON.stringify(report));
}
