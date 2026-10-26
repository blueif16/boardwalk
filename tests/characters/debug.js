const COLORS = { s: "#e0398b", n: "#2f6fd6", cross: "#9a9a9a", stair: "#f08a24", sand: "#b07a2a", deck: "#7a5cc9" };
const PLACE = { queue: "#e0398b", stall: "#1f8a5b", bench: "#7a5cc9", hangout: "#f08a24", photo: "#0aa", rail: "#2f6fd6", beach: "#b07a2a" };

export function drawWalk(canvas, walk, camera, { labels = true } = {}) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = camera.W * dpr;
  canvas.height = camera.H * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  const byId = new Map(walk.nodes.map((n) => [n.id, n]));
  const line = (pts, color, width = 2, dash = []) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.stroke(); g.setLineDash([]);
  };
  const dot = ([x, y], r, color, stroke) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  };
  const arrow = (a, b, color) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.beginPath();
    g.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
    g.lineTo(mx + 6 * Math.cos(ang + 2.5), my + 6 * Math.sin(ang + 2.5));
    g.lineTo(mx + 6 * Math.cos(ang - 2.5), my + 6 * Math.sin(ang - 2.5));
    g.fillStyle = color; g.fill();
  };

  line(walk.rail, "rgba(47,111,214,.8)", 1.5, [6, 4]);
  line(walk.rail.map(([x, y]) => [x, y + 17]), "rgba(47,111,214,.5)", 1, [2, 3]);
  line(walk.wallFoot, "rgba(176,122,42,.8)", 1.5, [6, 4]);

  for (const e of walk.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    const color = e.kind === "lane" ? COLORS[e.a[0]] : COLORS[e.kind] || "#666";
    line([a.px, b.px], color, e.kind === "lane" ? 3 : e.kind === "stair" ? 4 : 1.5, e.kind === "cross" ? [3, 3] : []);
    if (e.dir) arrow(a.px, b.px, color);
  }
  for (const n of walk.nodes) dot(n.px, n.kind === "lane" ? 2.5 : 2, n.h < 0 ? COLORS.sand : "#222");

  for (const p of walk.places) {
    const c = PLACE[p.kind] || "#000";
    if (p.kind === "queue") {
      line(p.slots, c, 1);
      p.slots.forEach((s, i) => dot(s, i ? 3 : 4.5, c, "#fff"));
      dot(p.gate, 5, "#fff", c);
    } else if (p.kind === "hangout") {
      g.beginPath(); g.ellipse(p.center[0], p.center[1], 14, 7, 0, 0, Math.PI * 2); g.strokeStyle = c; g.lineWidth = 2; g.stroke();
    } else {
      for (const s of p.slots) dot(s, 3.5, c, "#fff");
      if (p.target) line([p.slots[0], p.target], c, 1, [2, 2]);
    }
    if (labels && !["rail", "beach"].includes(p.kind)) {
      const at = p.slots?.[0] || p.center;
      g.font = "10px ui-monospace, monospace"; g.fillStyle = "#000"; g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 3;
      g.strokeText(p.id, at[0] + 6, at[1] - 6); g.fillText(p.id, at[0] + 6, at[1] - 6);
    }
  }
  if (labels) {
    g.font = "9px ui-monospace, monospace";
    for (const n of walk.nodes) {
      if (n.kind === "place") continue;
      g.fillStyle = "rgba(0,0,0,.75)";
      g.fillText(n.id, n.px[0] + 3, n.px[1] + 10);
    }
  }
}
