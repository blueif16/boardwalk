import { DIM, domeY, bulbPoints } from "./ride.js";

export const COLORS = {
  ink: "#2c201b",
  gore: ["#4b8fd6", "#f9f4ea"],
  frame: "#f4cd72",
  border: "#7aafdc",
  panel: ["#fae5a3", "#cfe6f2"],
  stripes: ["#f2aaa4", "#f9f4ea", "#9fc8ea"],
  gold: "#f4c56c",
  drum: "#9fc8ea",
  chain: "#7a6662",
  bead: "#fff1c6",
  seat: ["#ec8167", "#f2b275", "#85adcd", "#8cc4a0"],
  shirt: ["#85adcd", "#ec8167", "#f2c46b", "#b4a6d6"],
  fur: ["#b8845c", "#f8f2ea", "#f2a865", "#eccf9f"],
  muzzle: ["#ecd2b0", "#ffffff", "#fbe3c6", "#fbeedd"],
  ear: ["#b8845c", "#f4b5b0", "#f2a865", "#a8744e"],
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const vec = (hex) => `vec3(${rgb(hex).map((v) => v.toFixed(4)).join(",")})`;

export function lightDir(camera) {
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch);
  const v = [-0.6 * cy + 0.4 * sy * cp, 0.8 + 0.4 * sp, 0.6 * sy + 0.4 * cy * cp];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

const VERT = `
attribute vec3 tint;
attribute vec3 hullNormal;
uniform float uHull;
varying vec3 vN;
varying vec3 vTint;
varying vec3 vP;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec4 w = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  #ifdef HULL
  vec3 h = mat3(m) * hullNormal;
  float hl = length(h);
  if (hl > 0.0) w.xyz += h / hl * uHull;
  #endif
  vTint = tint;
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = `
uniform vec3 uLight;
uniform float uPx;
varying vec3 vN;
varying vec3 vTint;
varying vec3 vP;
const float TAU = 6.2831853;
float angleWidth(float count) {
  vec2 dx = dFdx(vP.xz), dy = dFdy(vP.xz);
  float r2 = max(dot(vP.xz, vP.xz), 1e-4);
  float ax = (vP.x * dx.y - vP.z * dx.x) / r2;
  float ay = (vP.x * dy.y - vP.z * dy.x) / r2;
  return (abs(ax) + abs(ay)) * count / TAU;
}
float lineMask(float dist, float w) { return 1.0 - smoothstep(0.45 * uPx, 0.45 * uPx + w, dist); }
vec3 paint(out vec3 lineColor, out float line) {
  line = 0.0;
  lineColor = vec3(0.0);
  #if PATTERN == 1
  float g = (atan(vP.z, vP.x) / TAU + 0.5) * ${DIM.gores}.0;
  int i = int(mod(floor(g), 2.0));
  vec3 base = i == 0 ? ${vec(COLORS.gore[0])} : ${vec(COLORS.gore[1])};
  float fw = max(angleWidth(${DIM.gores}.0), 1e-5);
  float d = (0.5 - abs(fract(g) - 0.5)) / fw;
  float r = length(vP.xz);
  line = lineMask(d, 1.0) * smoothstep(6.0, 18.0, r) * 0.8;
  lineColor = ${vec(COLORS.gore[0])} * 0.62;
  return base;
  #elif PATTERN == 2
  float g = (atan(vP.z, vP.x) / TAU + 0.5) * ${DIM.gores}.0;
  float f = fract(g);
  int i = int(mod(floor(g), 2.0));
  float pw = TAU * ${DIM.valR}.0 / ${DIM.gores}.0;
  vec2 q = vec2((f - 0.5) * pw, vP.y - ${(DIM.valanceBot + DIM.valanceTop + DIM.crown - DIM.scallop) / 2}.0);
  vec2 half_ = vec2(pw * 0.5 - 4.0, ${(DIM.valanceTop - DIM.valanceBot) / 2}.0 - 4.0);
  vec2 k = abs(q) - (half_ - 4.0);
  float sd = length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - 4.0;
  vec3 frame = ${vec(COLORS.frame)};
  vec3 base = sd > 0.0 ? frame : (sd > -2.6 ? ${vec(COLORS.border)} : (i == 0 ? ${vec(COLORS.panel[0])} : ${vec(COLORS.panel[1])}));
  float px = max(fwidth(sd), 1e-4);
  float l1 = lineMask(abs(sd) / px, 1.0);
  float l2 = lineMask(abs(sd + 2.6) / px, 1.0) * 0.6;
  float fw = max(angleWidth(${DIM.gores}.0), 1e-5);
  float l3 = lineMask((0.5 - abs(f - 0.5)) / fw, 1.0) * 0.8;
  line = max(max(l1, l2), l3);
  lineColor = l3 > max(l1, l2) ? frame * 0.62 : ${vec(COLORS.border)} * 0.6;
  return base;
  #elif PATTERN == 3
  float g = (atan(vP.z, vP.x) / TAU + 0.5) * 12.0;
  int i = int(mod(floor(g), 3.0));
  vec3 base = i == 0 ? ${vec(COLORS.stripes[0])} : (i == 1 ? ${vec(COLORS.stripes[1])} : ${vec(COLORS.stripes[2])});
  float fw = max(angleWidth(12.0), 1e-5);
  line = lineMask((0.5 - abs(fract(g) - 0.5)) / fw, 1.0) * 0.5;
  lineColor = base * 0.6;
  return base;
  #else
  return vTint;
  #endif
}
void main() {
  vec3 lineColor; float line;
  vec3 base = paint(lineColor, line);
  #ifdef HULL
  gl_FragColor = vec4(mix(base * 0.5, ${vec(COLORS.ink)}, 0.45), 1.0);
  #else
  float l = dot(normalize(vN), uLight);
  float lit = smoothstep(0.04, 0.12, l);
  vec3 c = mix(base * vec3(0.85, 0.8, 0.88), base, lit);
  c = mix(c, lineColor * mix(0.85, 1.0, lit), line);
  gl_FragColor = vec4(c, 1.0);
  #endif
}`;

export function createToon(THREE, { light, px = 1 }) {
  const cache = new Map();
  const uniforms = { uLight: { value: new THREE.Vector3(...light) }, uPx: { value: px } };
  function material(pattern = 0, hull = 0) {
    const key = `${pattern}:${hull}`;
    if (!cache.has(key)) {
      cache.set(key, new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: hull ? { PATTERN: pattern, HULL: 1 } : { PATTERN: pattern },
        uniforms: { ...uniforms, uHull: { value: hull } },
        side: hull ? THREE.BackSide : THREE.FrontSide,
      }));
    }
    return cache.get(key);
  }
  return { material, uniforms };
}

function prepare(THREE, geo, hex, hull = true) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const tint = new Float32Array(n * 3);
  const c = rgb(hex);
  for (let i = 0; i < n; i++) tint.set(c, i * 3);
  g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  const hn = new Float32Array(n * 3);
  if (hull) {
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const sums = new Map();
    const key = (i) => `${Math.round(pos[i * 3] * 200)},${Math.round(pos[i * 3 + 1] * 200)},${Math.round(pos[i * 3 + 2] * 200)}`;
    for (let i = 0; i < n; i++) {
      const k = key(i);
      const s = sums.get(k) || [0, 0, 0];
      s[0] += nor[i * 3]; s[1] += nor[i * 3 + 1]; s[2] += nor[i * 3 + 2];
      sums.set(k, s);
    }
    for (let i = 0; i < n; i++) {
      const s = sums.get(key(i));
      const l = Math.hypot(...s) || 1;
      hn.set([s[0] / l, s[1] / l, s[2] / l], i * 3);
    }
  }
  g.setAttribute("hullNormal", new THREE.BufferAttribute(hn, 3));
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "tint", "hullNormal"].includes(name)) g.deleteAttribute(name);
  return g;
}

function merge(THREE, parts) {
  const names = ["position", "normal", "tint", "hullNormal"];
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const arr = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}

function place(geo, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  geo.scale(...scale);
  geo.rotateX(rot[0]); geo.rotateY(rot[1]); geo.rotateZ(rot[2]);
  geo.translate(...at);
  return geo;
}

function toonMesh(THREE, toon, geo, { pattern = 0, hull = 1 } = {}) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, toon.material(pattern, 0)));
  if (hull) group.add(new THREE.Mesh(geo, toon.material(pattern, hull)));
  return group;
}

export function buildTower(THREE, toon) {
  const g = new THREE.Group();
  const P = (geo, hex, o, hull) => prepare(THREE, place(geo, o), hex, hull);
  const plain = merge(THREE, [
    P(new THREE.CylinderGeometry(26, 27, 9, 36), COLORS.drum, { at: [0, 4.5, 0] }),
    P(new THREE.CylinderGeometry(15, 16, 7, 28), COLORS.gold, { at: [0, 12.5, 0] }),
    P(new THREE.TorusGeometry(15.4, 2.6, 6, 32), COLORS.gold, { at: [0, 18, 0], rot: [Math.PI / 2, 0, 0] }),
    P(new THREE.TorusGeometry(14.4, 2.1, 6, 32), COLORS.stripes[0], { at: [0, 74, 0], rot: [Math.PI / 2, 0, 0] }),
    P(new THREE.TorusGeometry(13.8, 2.1, 6, 32), COLORS.gold, { at: [0, 120, 0], rot: [Math.PI / 2, 0, 0] }),
  ]);
  g.add(toonMesh(THREE, toon, plain, { hull: 1.2 }));
  const column = prepare(THREE, place(new THREE.CylinderGeometry(13, 14.5, 150, 36, 1), { at: [0, 90, 0] }), "#ffffff");
  g.add(toonMesh(THREE, toon, column, { pattern: 3, hull: 1.2 }));
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2).translate(0, 0.3, 0),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: "varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying vec2 vP; void main(){ float r = length(vP) / 40.0; gl_FragColor = vec4(${vec(COLORS.ink)}, 0.22 * (1.0 - smoothstep(0.55, 1.0, r))); }`,
    }),
  );
  shadow.renderOrder = -1;
  g.add(shadow);
  return g;
}

function valanceGeometry(THREE) {
  const per = 8, seg = DIM.gores * per, Ro = DIM.valR, Ri = DIM.valR - 1.6;
  const pos = [], nor = [];
  const at = (i) => -Math.PI + (i * 2 * Math.PI) / seg;
  const top = (k) => DIM.valanceTop + DIM.crown * (1 - (2 * k - 1) ** 2);
  const bot = (k) => DIM.valanceBot + DIM.scallop * (2 * k - 1) ** 2;
  const P = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
  const tri = (a, b, c, na, nb, nc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); };
  for (let i = 0; i < seg; i++) {
    const a0 = at(i), a1 = at(i + 1), k0 = (i % per) / per, k1 = ((i % per) + 1) / per;
    const t0 = top(k0), t1 = top(k1), b0 = bot(k0), b1 = bot(k1);
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const m0 = n0.map((v) => -v), m1 = n1.map((v) => -v), up = [0, 1, 0], dn = [0, -1, 0];
    const OT0 = P(Ro, a0, t0), OT1 = P(Ro, a1, t1), OB0 = P(Ro, a0, b0), OB1 = P(Ro, a1, b1);
    const IT0 = P(Ri, a0, t0), IT1 = P(Ri, a1, t1), IB0 = P(Ri, a0, b0), IB1 = P(Ri, a1, b1);
    tri(OT0, OB1, OB0, n0, n1, n0); tri(OT0, OT1, OB1, n0, n1, n1);
    tri(IT0, IB0, IB1, m0, m0, m1); tri(IT0, IB1, IT1, m0, m1, m1);
    tri(OT0, IT0, OT1, up, up, up); tri(OT1, IT0, IT1, up, up, up);
    tri(OB0, OB1, IB0, dn, dn, dn); tri(OB1, IB1, IB0, dn, dn, dn);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function buildRotor(THREE, toon) {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const r = DIM.rimR * (1 - i / 24) + 0.01;
    prof.push(new THREE.Vector2(r, domeY(r)));
  }
  const roof = merge(THREE, [
    prepare(THREE, new THREE.LatheGeometry(prof, 64), "#ffffff"),
    prepare(THREE, place(new THREE.CircleGeometry(DIM.rimR, 64), { rot: [Math.PI / 2, 0, 0], at: [0, DIM.roofY, 0] }), "#ffffff"),
  ]);
  g.add(toonMesh(THREE, toon, roof, { pattern: 1, hull: 1.4 }));
  const vb = DIM.valanceBot, R = DIM.valR;
  const valance = merge(THREE, [
    prepare(THREE, valanceGeometry(THREE), "#ffffff"),
  ]);
  g.add(toonMesh(THREE, toon, valance, { pattern: 2, hull: 1.3 }));
  const P = (geo, hex, o, hull) => prepare(THREE, place(geo, o), hex, hull);
  const trim = merge(THREE, [
    P(new THREE.TorusGeometry(DIM.rimR, 2.6, 6, 64), COLORS.gold, { at: [0, DIM.roofY, 0], rot: [Math.PI / 2, 0, 0] }),
    P(new THREE.SphereGeometry(5.5, 14, 10), COLORS.gold, { at: [0, DIM.apexY + 2, 0] }),
    P(new THREE.ConeGeometry(2.8, 10, 16), COLORS.gold, { at: [0, DIM.apexY + 11, 0] }),
    P(new THREE.SphereGeometry(2.2, 12, 8), COLORS.gold, { at: [0, DIM.apexY + 17, 0] }),
  ]);
  g.add(toonMesh(THREE, toon, trim, { hull: 1.2 }));
  const beads = merge(THREE, bulbPoints().filter((b) => !b.top).map((b) => P(new THREE.SphereGeometry(1.5, 6, 4), COLORS.bead, { at: b.p }, false)));
  g.add(toonMesh(THREE, toon, beads, { hull: 0 }));
  return g;
}

export function chairGeometry(THREE, v) {
  const P = (geo, hex, o, hull = true) => prepare(THREE, place(geo, o), hex, hull);
  const fur = COLORS.fur[v], seat = COLORS.seat[v], shirt = COLORS.shirt[v], ink = COLORS.ink;
  const parts = [
    P(new THREE.BoxGeometry(12, 3.5, 15), seat, { at: [0, -2, 0] }),
    P(new THREE.BoxGeometry(3, 13, 15), seat, { at: [-6.5, 4, 0] }),
    P(new THREE.CapsuleGeometry(4.2, 4, 3, 10), shirt, { at: [0.5, 5.5, 0] }),
    P(new THREE.SphereGeometry(5.8, 16, 11), fur, { at: [1, 14.5, 0] }),
    P(new THREE.SphereGeometry(2.4, 10, 7), COLORS.muzzle[v], { at: [5.6, 12.7, 0] }),
    P(new THREE.SphereGeometry(0.85, 6, 4), ink, { at: [6.3, 15.2, 2.2] }, false),
    P(new THREE.SphereGeometry(0.85, 6, 4), ink, { at: [6.3, 15.2, -2.2] }, false),
    P(new THREE.SphereGeometry(0.8, 6, 4), ink, { at: [7.9, 13.3, 0] }, false),
  ];
  for (const s of [-1, 1]) {
    parts.push(P(new THREE.CapsuleGeometry(1.7, 4.5, 2, 6), fur, { at: [7, -3.5, 2.6 * s], rot: [0, 0, 0.35] }));
    parts.push(P(new THREE.CapsuleGeometry(1.35, 4, 2, 6), shirt, { at: [0.8, 8.5, 5.2 * s], rot: [-0.9 * s, 0, 0] }));
    if (v === 0) parts.push(P(new THREE.SphereGeometry(2.3, 8, 6), fur, { at: [0.4, 19.4, 4.2 * s] }));
    if (v === 1) parts.push(P(new THREE.CapsuleGeometry(1.6, 6.5, 2, 8), fur, { at: [0, 22.5, 2.3 * s], rot: [0.18 * s, 0, 0] }));
    if (v === 2) parts.push(P(new THREE.ConeGeometry(2.6, 4.6, 8), fur, { at: [0.6, 20.2, 3.5 * s], rot: [0.32 * s, 0, 0] }));
    if (v === 3) parts.push(P(new THREE.SphereGeometry(2.4, 8, 6), COLORS.ear[3], { at: [0.4, 14.2, 5.6 * s], scale: [1, 1.7, 0.6] }));
  }
  const g = merge(THREE, parts);
  g.scale(DIM.chairScale, DIM.chairScale, DIM.chairScale);
  return g;
}

export function buildChair(THREE, toon, v) {
  const g = new THREE.Group();
  g.rotation.order = "YZX";
  g.add(toonMesh(THREE, toon, chairGeometry(THREE, v), { hull: 0.9 }));
  return g;
}

export function buildChains(THREE, toon, count) {
  const geo = prepare(THREE, new THREE.CylinderGeometry(0.55, 0.55, 1, 6, 1, true).translate(0, 0.5, 0), COLORS.chain, false);
  const mesh = new THREE.InstancedMesh(geo, toon.material(0, 0), count);
  mesh.frustumCulled = false;
  return mesh;
}
