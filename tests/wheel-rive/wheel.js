export const WHEEL = {
  platform: "dream_wheel",
  headingDeg: 0,
  hub: 156,
  rim: 108,
  ring: 66,
  cabins: 12,
  spokes: 16,
  bulbs: 36,
  rimDepth: 7,
  frameDepth: 20,
  foot: 72,
  secondsPerTurn: 36,
  box: [588, 336, 284, 322],
};

export const COLORS = [
  "#ec8167", "#f2b275", "#f3d36b", "#a6cf7d", "#7cc6c4", "#85adcd",
  "#f0a3b8", "#b4a6d9", "#8cc8e6", "#f6b48f", "#9fd3a8", "#7aa3d8",
];

export function wheelGeometry(camera, stage, W = WHEEL) {
  const floor = camera.toGround(stage.platforms[W.platform].floor);
  const h = (W.headingDeg * Math.PI) / 180;
  const u = [Math.cos(h), 0, -Math.sin(h)];
  const v = [0, -1, 0];
  const n = [Math.sin(h), 0, Math.cos(h)];
  const m = camera.planeAffine(u, v);
  const rive = camera.riveTransform(m);
  const hub = camera.toPixel([floor[0], W.hub, floor[2]]);
  const ns = camera.project(n);
  const det = m[0] * m[3] - m[2] * m[1];
  const depth = [(m[3] * ns[0] - m[2] * ns[1]) / det, (m[0] * ns[1] - m[1] * ns[0]) / det];
  const [bx, by] = W.box;
  const local = (p) => [p[0] - bx, p[1] - by];
  const world = (along, up, toward) => [
    floor[0] + along * u[0] + toward * n[0], up, floor[2] + along * u[2] + toward * n[2],
  ];
  return { floor, u, v, n, m, rive, hub, root: local(hub), depth, ns, world, local };
}

export function toPlane(g, [px, py]) {
  const [a, b, c, d] = g.m;
  const x = px - g.hub[0], y = py - g.hub[1];
  const det = a * d - c * b;
  return [(d * x - c * y) / det, (a * y - b * x) / det];
}
