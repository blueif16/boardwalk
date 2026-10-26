import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCamera } from "../../base/camera.js";
import { WHEEL as W, COLORS, wheelGeometry } from "./wheel.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const stage = JSON.parse(readFileSync(here + "../../base/stage.json", "utf8"));
const camera = createCamera(stage);
const g = wheelGeometry(camera, stage);
const TAU = Math.PI * 2;

let next = 1;
const id = () => `0:${next++}`;
const f = (x) => { const v = +(+x).toFixed(4); return Object.is(v, -0) ? 0 : v; };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const argb = (h, a = 1) => (Math.round(a * 255).toString(16).padStart(2, "0") + h.slice(1)).toUpperCase();
const INK = "#2c201b";
const shade = (c) => mix(c, "#6b4a52", 0.24);
const edge = (c) => mix(c, INK, 0.72);
const tint = (c) => mix(c, INK, 0.42);

const fill = (c, a = 1) => `<Fill><SolidColor colorValue="${argb(c, a)}"/></Fill>`;
const stroke = (c, w, a = 1, cap = "round") => `<Stroke thickness="${w}" cap="${cap}" join="round"><SolidColor colorValue="${argb(c, a)}"/></Stroke>`;
const radial = (r, stops) => `<Fill><RadialGradient startX="0" startY="0" endX="${f(r)}" endY="0">${stops.map(([c, a, p]) => `<GradientStop colorValue="${argb(c, a)}" position="${p}"/>`).join("")}</RadialGradient></Fill>`;
const poly = (pts, closed = true) => `<PointsPath isClosed="${closed}">${pts.map(([x, y, r]) => `<StraightVertex x="${f(x)}" y="${f(y)}"${r ? ` radius="${r}"` : ""}/>`).join("")}</PointsPath>`;
const ellipse = (rx, ry = rx, x = 0, y = 0) => `<Ellipse x="${f(x)}" y="${f(y)}" width="${f(rx * 2)}" height="${f(ry * 2)}"/>`;
const rect = (x0, y0, x1, y1, [tl, tr, br, bl] = [0, 0, 0, 0]) =>
  `<Rectangle x="${f((x0 + x1) / 2)}" y="${f((y0 + y1) / 2)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" linkCornerRadius="false" cornerRadiusTL="${tl}" cornerRadiusTR="${tr}" cornerRadiusBR="${br}" cornerRadiusBL="${bl}"/>`;
const arc = (r, a0, a1) => {
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 6)));
  const da = (a1 - a0) / n, k = (4 / 3) * Math.tan(da / 4) * r;
  let s = "";
  for (let i = 0; i <= n; i++) {
    const a = a0 + da * i;
    s += `<CubicMirroredVertex x="${f(r * Math.cos(a))}" y="${f(r * Math.sin(a))}" rotation="${f(a + Math.PI / 2)}" distance="${f(k)}"/>`;
  }
  return `<PointsPath isClosed="false">${s}</PointsPath>`;
};
const shape = (name, body, attrs = "") => `<Shape name="${name}"${attrs}>${body}</Shape>`;
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

const VM = id(), VMI = id();
const PROPS = ["outerRotation", "scaleX", "scaleY", "innerRotation", "spin", "hubX", "hubY", "lights", "spill",
  ...Array.from({ length: W.cabins }, (_, i) => `sway${i}`)];
const P = Object.fromEntries(PROPS.map((p) => [p, id()]));
const TAP = id();
const DEFAULTS = {
  outerRotation: g.rive.outerRotation, scaleX: g.rive.scaleX, scaleY: g.rive.scaleY, innerRotation: g.rive.innerRotation,
  spin: 0, hubX: g.root[0], hubY: g.root[1], lights: 1, spill: 1,
};
const bind = (prop, key) => `<DataBindContext sourcePathIds="${VM}-${P[prop]}" propertyKey="${key}"/>`;
const KEY = { x: 13, y: 14, rotation: 15, scaleX: 16, scaleY: 17, opacity: 18 };

function plane(name, depth, spin, inner) {
  const [dx, dy] = [g.depth[0] * depth, g.depth[1] * depth];
  const body = spin ? `<Node name="${name}Spin">${bind("spin", KEY.rotation)}${inner}</Node>` : inner;
  return `<Node name="${name}" rotation="${f(g.rive.outerRotation)}" scaleX="${f(g.rive.scaleX)}" scaleY="${f(g.rive.scaleY)}">`
    + bind("outerRotation", KEY.rotation) + bind("scaleX", KEY.scaleX) + bind("scaleY", KEY.scaleY)
    + `<Node name="${name}Frame" rotation="${f(g.rive.innerRotation)}">${bind("innerRotation", KEY.rotation)}`
    + `<Node name="${name}Offset" x="${f(dx)}" y="${f(dy)}">${body}</Node></Node></Node>`;
}

const anchorAngle = (i) => (i / W.cabins) * TAU - Math.PI / 2;
const bulbAngle = (i) => ((i + 0.5) / W.bulbs) * TAU - Math.PI / 2;

function anchors(prefix) {
  const ids = [];
  const nodes = Array.from({ length: W.cabins }, (_, i) => {
    const [x, y] = polar(W.rim, anchorAngle(i));
    const nid = id();
    ids.push(nid);
    return `<Node name="${prefix}Anchor${i}" x="${f(x)}" y="${f(y)}" id="${nid}"/>`;
  }).join("");
  return { ids, xml: plane(`${prefix}Mid`, 0, true, nodes) };
}

function anchorRootPos(i) {
  const [px, py] = polar(W.rim, anchorAngle(i));
  const [a, b, c, d] = g.m;
  return [a * px + c * py, b * px + d * py];
}

function rim(prefix, front) {
  const R = W.rim, r0 = W.ring;
  const white = front ? "#fffaf1" : "#e9dfd2";
  const whiteEdge = front ? "#b9a999" : "#9f8f80";
  const parts = [];
  if (front) {
    const bolts = Array.from({ length: W.cabins }, (_, i) => ellipse(2.3, 2.3, ...polar(R, anchorAngle(i)))).join("");
    parts.push(shape(`${prefix}Bolts`, bolts + fill("#fbefd6") + stroke("#7d6650", 0.8)));
    const bulbs = Array.from({ length: W.bulbs }, (_, i) => ellipse(1.5, 1.5, ...polar(R, bulbAngle(i)))).join("")
      + Array.from({ length: W.cabins }, (_, i) => ellipse(1.3, 1.3, ...polar(r0, anchorAngle(i) + Math.PI / W.cabins))).join("");
    parts.push(shape(`${prefix}Bulbs`, bulbs + fill("#fff6dc") + stroke("#a08466", 0.6)));
  }
  for (let i = 0; i < W.cabins; i++) {
    const c = front ? COLORS[i] : mix(COLORS[i], "#8a7a8c", 0.35);
    const a0 = anchorAngle(i) - Math.PI / W.cabins, a1 = anchorAngle(i) + Math.PI / W.cabins;
    parts.push(shape(`${prefix}Rim${i}`, arc(R, a0, a1) + stroke(edge(c), front ? 8.2 : 6.6, 1, "butt") + stroke(c, front ? 6 : 4.6, 1, "butt")));
  }
  if (front) {
    let braces = "";
    for (let i = 0; i < W.spokes; i++) {
      const a = (i / W.spokes) * TAU - Math.PI / 2, b = ((i + 1) / W.spokes) * TAU - Math.PI / 2;
      braces += poly([polar(r0 + 1, a), polar(R - 3, (a + b) / 2), polar(r0 + 1, b)], false);
    }
    parts.push(shape(`${prefix}Braces`, braces + stroke(whiteEdge, 2.1) + stroke(white, 1.1)));
  }
  parts.push(shape(`${prefix}Ring`, ellipse(r0) + stroke(whiteEdge, front ? 3.8 : 3) + stroke(white, front ? 2.4 : 1.8)));
  let spokes = "";
  for (let i = 0; i < W.spokes; i++) {
    const a = (i / W.spokes) * TAU - Math.PI / 2;
    spokes += poly([polar(9, a), polar(R - 2, a)], false);
  }
  parts.push(shape(`${prefix}Spokes`, spokes + stroke(whiteEdge, front ? 3.1 : 2.4) + stroke(white, front ? 1.9 : 1.3)));
  parts.push(shape(`${prefix}HubDisc`, ellipse(11) + fill(white) + stroke(whiteEdge, 1.2)));
  return parts.join("");
}

function legs(prefix, front) {
  const H = W.hub, a = W.foot;
  const main = front ? "#5b86cf" : "#4a6aa6", hi = front ? "#8db2ea" : "#6886bd", dark = front ? "#4068ad" : "#36528a";
  const line = front ? "#233764" : "#1e2c4f";
  const parts = [];
  const leg = (s) => {
    const top = [s * 2.5, 2], bot = [s * a, H];
    const dx = bot[0] - top[0], dy = bot[1] - top[1], L = Math.hypot(dx, dy);
    const nx = -dy / L, ny = dx / L;
    const w0 = 5, w1 = 7;
    return { top, bot, nx, ny, w0, w1, quad: [[top[0] + nx * w0, top[1] + ny * w0], [bot[0] + nx * w1, bot[1] + ny * w1], [bot[0] - nx * w1, bot[1] - ny * w1], [top[0] - nx * w0, top[1] - ny * w0]] };
  };
  const L = leg(-1), Rt = leg(1);
  const yb = H * 0.64, xb = a * 0.64 + 2.5 * 0.36;
  const rivets = [0.25, 0.5, 0.82].flatMap((t) => [L, Rt].map((q) => ellipse(0.9, 0.9, q.top[0] + (q.bot[0] - q.top[0]) * t, q.top[1] + (q.bot[1] - q.top[1]) * t))).join("");
  parts.push(shape(`${prefix}Rivets`, rivets + fill("#f4ead6", front ? 0.9 : 0.6)));
  for (const [k, q] of [["L", L], ["R", Rt]]) {
    const stripe = poly([[q.top[0] + q.nx * 1.6, q.top[1] + q.ny * 1.6], [q.bot[0] + q.nx * 2.6, q.bot[1] + q.ny * 2.6]], false);
    parts.push(shape(`${prefix}Hi${k}`, stripe + stroke(hi, 1.5)));
    const shadeQuad = [q.quad[3], q.quad[2], [q.bot[0] - q.nx * 1.5, q.bot[1] - q.ny * 1.5], [q.top[0] - q.nx * 1.2, q.top[1] - q.ny * 1.2]];
    parts.push(shape(`${prefix}Shade${k}`, poly(shadeQuad) + fill(dark)));
    parts.push(shape(`${prefix}Leg${k}`, poly(q.quad) + fill(main) + stroke(line, 1.1)));
  }
  parts.push(shape(`${prefix}Bar`, rect(-xb, yb - 3, xb, yb + 3, [1.5, 1.5, 1.5, 1.5]) + fill(main) + stroke(line, 1)));
  const yb2 = H * 0.36, xb2 = a * 0.36 + 2.5 * 0.64;
  parts.push(shape(`${prefix}Bar2`, rect(-xb2, yb2 - 2.2, xb2, yb2 + 2.2, [1.2, 1.2, 1.2, 1.2]) + fill(main) + stroke(line, 0.9)));
  return parts.join("");
}

function axle() {
  const q = [g.depth[0] * W.frameDepth, g.depth[1] * W.frameDepth];
  const H = W.hub, a = W.foot;
  const braces = [-1, 1].map((s) => {
    const p = [s * (a * 0.86 + 2.5 * 0.14), H * 0.86];
    return poly([[p[0] - q[0], p[1] - q[1]], [p[0] + q[0], p[1] + q[1]]], false);
  }).join("");
  return shape("AxleBody", poly([[-q[0], -q[1]], [q[0], q[1]]], false) + stroke("#33415c", 9.5) + stroke("#9aa8bf", 7))
    + shape("SideBraces", braces + stroke("#22345c", 5.2) + stroke("#4a6aa6", 3.4));
}

function hubCap(prefix, pop) {
  return `<Node name="${prefix}Pop" id="${pop}">`
    + shape(`${prefix}Star`, `<Star width="17" height="17" points="5" innerRadius="0.5" cornerRadius="1"/>` + fill("#f8cf4f") + stroke("#d27a32", 0.9))
    + shape(`${prefix}Ring`, ellipse(10.5) + stroke("#f6d982", 2))
    + shape(`${prefix}Disc`, ellipse(12.5) + fill("#5683cf") + stroke("#243865", 1.2))
    + `</Node>`;
}

const ANIMALS = [["bear", "bunny"], ["cat", ""], ["dog", "bear"], ["bunny", "bunny"], ["", "cat"], ["bear", "dog"],
  ["bunny", "cat"], ["dog", ""], ["cat", "bear"], ["", "bunny"], ["bear", "bear"], ["dog", "cat"]];
function animal(kind, x, y) {
  const eyes = (dx) => ellipse(0.5, 0.58, x - 1.25 + dx, y - 0.5) + ellipse(0.5, 0.58, x + 1.25 + dx, y - 0.5);
  const face = (c, ears, extra = "") =>
    shape("Face", eyes(0) + fill("#3a2a24"))
    + extra
    + shape("Head", ellipse(3.5, 3.2, x, y) + ears + fill(c) + stroke(mix(c, INK, 0.55), 0.55));
  if (kind === "bear") return face("#c18c5d", ellipse(1.4, 1.4, x - 2.7, y - 2.7) + ellipse(1.4, 1.4, x + 2.7, y - 2.7), shape("Muzzle", ellipse(1.3, 1, x, y + 1.1) + fill("#efd3b1")));
  if (kind === "bunny") return face("#fbf5ee", rect(x - 2.5, y - 8.2, x - 0.8, y - 1.8, [0.9, 0.9, 0.9, 0.9]) + rect(x + 0.8, y - 8.2, x + 2.5, y - 1.8, [0.9, 0.9, 0.9, 0.9]), shape("Blush", ellipse(0.7, 0.45, x - 2.2, y + 0.9) + ellipse(0.7, 0.45, x + 2.2, y + 0.9) + fill("#f3a7b5")));
  if (kind === "cat") return face("#f0a65e", poly([[x - 3.3, y - 1.3], [x - 2.9, y - 5.1], [x - 0.7, y - 2.9]]) + poly([[x + 3.3, y - 1.3], [x + 2.9, y - 5.1], [x + 0.7, y - 2.9]]));
  if (kind === "dog") return face("#e2c191", "", shape("Ears", ellipse(1.25, 2.3, x - 3.3, y - 0.5) + ellipse(1.25, 2.3, x + 3.3, y - 0.5) + fill("#9a6a45")));
  return "";
}

const POD = { w: 14.5, top: 13.4, mid: 31, ry: 9 };
function pod(yCut) {
  const { w, top, mid, ry } = POD;
  const pts = yCut == null ? [[-w, top, 5], [w, top, 5]] : yCut <= mid ? [[-w, yCut], [w, yCut]] : [];
  const t0 = yCut != null && yCut > mid ? Math.asin((yCut - mid) / ry) : 0;
  for (let k = 0; k <= 14; k++) {
    const t = t0 + ((Math.PI - 2 * t0) * k) / 14;
    pts.push([w * Math.cos(t), mid + ry * Math.sin(t)]);
  }
  return poly(pts);
}
const hgrad = (c, s) => `<Fill><LinearGradient startX="-6" startY="0" endX="14.5" endY="0"><GradientStop colorValue="${argb(c)}" position="0"/><GradientStop colorValue="${argb(mix(c, s, 0.75))}" position="1"/></LinearGradient></Fill>`;

function cabinArt(i) {
  const c = COLORS[i], s = shade(c), e = edge(c), t = tint(c);
  const [left, right] = ANIMALS[i];
  const roof = poly([[-15.5, 15], [-14.5, 10, 5], [0, 5, 16], [14.5, 10, 5], [15.5, 15]]);
  return shape("Bolt", ellipse(2) + fill("#fbefd6") + stroke("#6f5a46", 0.7))
    + shape("Knob", ellipse(1.7, 1.7, 0, 4.6) + fill(mix(c, "#ffffff", 0.35)) + stroke(e, 0.6))
    + shape("RoofHi", poly([[-10.5, 10.4], [-3.5, 7.4]], false) + stroke(mix(c, "#ffffff", 0.45), 1.3))
    + shape("Roof", roof + fill(s) + stroke(e, 1.05))
    + shape("Mullion", poly([[0, 16.8], [0, 29.4]], false) + stroke(t, 0.85))
    + shape("Band", pod(35) + fill(s))
    + shape("Panel", pod(29.6) + hgrad(c, s))
    + shape("Sill", poly([[-12, 29.9], [12, 29.9]], false) + stroke(t, 0.9))
    + animal(left, -5.6, 26.6) + animal(right, 5.6, 26.6)
    + shape("Glass", poly([[-10.2, 17.6], [-6.6, 17.6], [-10.2, 21.2]]) + poly([[1.2, 17.6], [4.8, 17.6], [1.2, 21.2]]) + fill("#ffffff", 0.75))
    + shape("Window", rect(-11.6, 16.4, 11.6, 30, [4, 4, 1, 1]) + fill("#fff3dd") + stroke(t, 0.8))
    + shape("Body", pod() + hgrad(c, s) + stroke(e, 1.1))
    + shape("Hanger", poly([[0, 0], [0, 9]], false) + stroke("#6f5a46", 1.9));
}

function cabins(prefix, ids, art, jiggleIds) {
  return Array.from({ length: W.cabins }, (_, i) => {
    const [x, y] = anchorRootPos(i);
    const jid = id();
    jiggleIds.push(jid);
    return `<Node name="${prefix}Cabin${i}" x="${f(x)}" y="${f(y)}">`
      + `<TranslationConstraint targetId="${ids[i]}"/>`
      + bind(`sway${i}`, KEY.rotation)
      + `<Node name="${prefix}Jiggle${i}" id="${jid}">${art(i)}</Node></Node>`;
  }).join("");
}

function shadows() {
  const rel = (w) => { const p = camera.toPixel(w); return [p[0] - g.hub[0], p[1] - g.hub[1]]; };
  const blob = (name, [x, y], r, a) => `<Shape name="${name}" x="${f(x)}" y="${f(y)}" scaleY="0.44">${ellipse(r)}${radial(r, [["#5a3b2a", a, 0], ["#5a3b2a", a * 0.6, 0.45], ["#5a3b2a", 0, 1]])}</Shape>`;
  const feet = [];
  for (const s of [-1, 1]) for (const d of [-1, 1]) feet.push(blob(`Foot${s}${d}`, rel(g.world(s * W.foot, 0, d * W.frameDepth)), 12, 0.3));
  return `<Node name="Shadows">${feet.join("")}${blob("Under", rel(g.world(0, 0, 0)), 30, 0.2)}</Node>`;
}

function jiggleKeys(jiggleIds, popId) {
  const fps = 60, dur = 96;
  let xml = "";
  jiggleIds.forEach((jid, i) => {
    const delay = i * 0.025;
    let keys = "";
    for (let fr = 0; fr <= dur; fr += 3) {
      const t = fr / fps - delay;
      const v = t <= 0 ? 0 : 0.3 * Math.exp(-t / 0.42) * Math.sin(TAU * 1.7 * t);
      keys += `<KeyFrameDouble value="${f(fr === dur ? 0 : v)}" frame="${fr}" interpolationType="linear"/>`;
    }
    xml += `<KeyedObject objectId="${jid}"><KeyedProperty propertyKey="${KEY.rotation}">${keys}</KeyedProperty></KeyedObject>`;
  });
  if (popId) {
    const pts = [[0, 1], [7, 1.38], [17, 0.9], [26, 1.06], [36, 0.98], [46, 1]];
    for (const key of [KEY.scaleX, KEY.scaleY])
      xml += `<KeyedObject objectId="${popId}"><KeyedProperty propertyKey="${key}">${pts.map(([fr, v]) => `<KeyFrameDouble value="${v}" frame="${fr}" interpolationType="linear"/>`).join("")}</KeyedProperty></KeyedObject>`;
  }
  return xml;
}

const triggerCondition = () => `<TransitionViewModelCondition><TransitionPropertyViewModelComparator><BindablePropertyTrigger><DataBindContext sourcePathIds="${VM}-${TAP}" propertyKey="686"/></BindablePropertyTrigger></TransitionPropertyViewModelComparator><TransitionValueTriggerComparator value="0"/></TransitionViewModelCondition>`;

function tapLayer(restId, tapAnimId) {
  const idle = id(), tap = id();
  return `<StateMachineLayer name="Tap" id="${id()}">`
    + `<AnyState x="0" y="-150"><StateTransition stateToId="${tap}" duration="0">${triggerCondition()}</StateTransition></AnyState>`
    + `<ExitState x="500" y="-150"/>`
    + `<EntryState x="-200" y="0"><StateTransition stateToId="${idle}"/></EntryState>`
    + `<AnimationState x="100" y="0" animationId="${restId}" id="${idle}"/>`
    + `<AnimationState x="300" y="150" animationId="${tapAnimId}" reset="true" id="${tap}"><StateTransition stateToId="${idle}" enableExitTime="true" exitTimeIsPercetange="true" exitTime="100"/></AnimationState>`
    + `</StateMachineLayer>`;
}

const [BW, BH] = [W.box[2], W.box[3]];

function wheelArtboard() {
  const art = id(), sm = id(), rest = id(), jig = id(), pop = id();
  const mid = anchors("");
  const jiggles = [];
  const root = `<Node name="Root" x="${f(g.root[0])}" y="${f(g.root[1])}">${bind("hubX", KEY.x)}${bind("hubY", KEY.y)}`
    + plane("HubCap", W.frameDepth + 2, true, hubCap("Hub", pop))
    + plane("FrontFrame", W.frameDepth, false, legs("Front", true))
    + cabins("", mid.ids, cabinArt, jiggles)
    + plane("FrontRim", W.rimDepth, true, rim("Front", true))
    + mid.xml
    + plane("Axle", 0, false, axle())
    + plane("BackRim", -W.rimDepth, true, rim("Back", false))
    + plane("BackFrame", -W.frameDepth, false, legs("Back", false))
    + shadows()
    + `</Node>`;
  return `<Artboard name="Wheel" x="0" y="0" width="${BW}" height="${BH}" viewModelId="${VM}" viewModelInstanceId="${VMI}" defaultStateMachineId="${sm}" id="${art}">`
    + root
    + `<LinearAnimation name="Rest" duration="1" id="${rest}"/>`
    + `<LinearAnimation name="Jiggle" duration="96" id="${jig}">${jiggleKeys(jiggles, pop)}</LinearAnimation>`
    + `<StateMachine name="Wheel" id="${sm}">${tapLayer(rest, jig)}</StateMachine>`
    + `</Artboard>`;
}

function lightsArtboard() {
  const art = id(), sm = id(), rest = id(), tapAnim = id(), twinkle = id();
  const mid = anchors("L");
  const jiggles = [];
  const halo = (r, core, glow) => radial(r, [[core, 1, 0], [glow, 0.75, 0.2], [glow, 0.28, 0.5], [glow, 0, 1]]);
  const lamp = () => shape("RoofLamp", ellipse(1.8, 1.8, 0, 4.6) + fill("#fffbe6"))
    + `<Shape name="RoofHalo" y="4.6">${ellipse(8)}${halo(8, "#fff3c2", "#ffc35a")}</Shape>`
    + shape("WindowGlow", rect(-11.6, 16.4, 11.6, 30, [4, 4, 1, 1]) + fill("#ffc76a", 0.5))
    + `<Shape name="WindowSpill" y="23">${ellipse(18, 13)}${radial(16, [["#ffb347", 0.35, 0], ["#ffb347", 0, 1]])}</Shape>`;
  const twinkleIds = [id(), id()];
  const chaseIds = [[id(), id(), id()], [id(), id(), id()]];
  const groups = [[[], [], []], [[], [], []]];
  const bulb = (x, y, warm) => {
    const core = warm ? "#fff6d8" : "#ffe3ee", glow = warm ? "#ffc35a" : "#ff8fb1";
    return shape("Core", ellipse(1.8, 1.8, x, y) + fill(core))
      + `<Shape name="Halo" x="${f(x)}" y="${f(y)}">${ellipse(10)}${halo(10, core, glow)}</Shape>`;
  };
  for (let i = 0; i < W.bulbs; i++) groups[i % 2][Math.floor(i / 2) % 3].push(bulb(...polar(W.rim, bulbAngle(i)), i % 3 !== 2));
  for (let i = 0; i < W.cabins; i++) groups[i % 2][i % 3].push(bulb(...polar(W.ring, anchorAngle(i) + Math.PI / W.cabins), true));
  const bulbs = groups.map((sets, k) => `<Node name="Twinkle${k}" id="${twinkleIds[k]}">`
    + sets.map((list, j) => `<Node name="Chase${k}${j}" id="${chaseIds[k][j]}">${list.join("")}</Node>`).join("") + `</Node>`).join("");
  const star = `<Shape name="StarGlow">${ellipse(22)}${halo(22, "#fff2b8", "#ffcf5c")}</Shape>`
    + shape("StarLit", `<Star width="17" height="17" points="5" innerRadius="0.5" cornerRadius="1"/>` + fill("#fff0a6"));
  const root = `<Node name="Root" x="${f(g.root[0])}" y="${f(g.root[1])}">${bind("hubX", KEY.x)}${bind("hubY", KEY.y)}${bind("lights", KEY.opacity)}`
    + plane("LHub", W.frameDepth + 2, true, star)
    + cabins("L", mid.ids, lamp, jiggles)
    + plane("LRim", W.rimDepth, true, bulbs)
    + plane("LSpill", 0, false, `<Shape name="Spill">${bind("spill", KEY.opacity)}${ellipse(W.rim + 40)}${radial(W.rim + 40, [["#ffcf7a", 0.22, 0], ["#ffb35c", 0.16, 0.6], ["#ffb35c", 0.05, 0.85], ["#ffb35c", 0, 1]])}</Shape>`)
    + mid.xml
    + `</Node>`;
  const tw = (nid, from, to) => `<KeyedObject objectId="${nid}"><KeyedProperty propertyKey="${KEY.opacity}">`
    + `<KeyFrameDouble value="${from}" frame="0" interpolationType="linear"/><KeyFrameDouble value="${to}" frame="72" interpolationType="linear"/><KeyFrameDouble value="${from}" frame="144" interpolationType="linear"/>`
    + `</KeyedProperty></KeyedObject>`;
  let chase = "";
  chaseIds.flat().forEach((nid, n) => {
    const j = n % 3;
    let keys = "";
    for (let step = 0; step <= 15; step++) keys += `<KeyFrameDouble value="${step === 15 ? 1 : step % 3 === j ? 1 : 0.2}" frame="${step * 6}" interpolationType="hold"/>`;
    chase += `<KeyedObject objectId="${nid}"><KeyedProperty propertyKey="${KEY.opacity}">${keys}</KeyedProperty></KeyedObject>`;
  });
  const twState = id();
  const twinkleLayer = `<StateMachineLayer name="Twinkle" id="${id()}"><AnyState x="0" y="-150"/><ExitState x="400" y="-150"/>`
    + `<EntryState x="-200" y="0"><StateTransition stateToId="${twState}"/></EntryState>`;
  return `<Artboard name="WheelLights" x="${BW + 60}" y="0" width="${BW}" height="${BH}" viewModelId="${VM}" viewModelInstanceId="${VMI}" defaultStateMachineId="${sm}" id="${art}">`
    + root
    + `<LinearAnimation name="Rest" duration="1" id="${rest}"/>`
    + `<LinearAnimation name="Twinkle" duration="144" loopValue="loop" id="${twinkle}">${tw(twinkleIds[0], 1, 0.55)}${tw(twinkleIds[1], 0.55, 1)}</LinearAnimation>`
    + `<LinearAnimation name="Sparkle" duration="96" id="${tapAnim}">${chase}${jiggleKeys(jiggles, null)}</LinearAnimation>`
    + `<StateMachine name="Lights" id="${sm}">`
    + twinkleLayer + `<AnimationState x="100" y="0" animationId="${twinkle}" id="${twState}"/></StateMachineLayer>`
    + tapLayer(rest, tapAnim)
    + `</StateMachine></Artboard>`;
}

const wheelXml = wheelArtboard();
const lightsXml = lightsArtboard();
const vm = `<ViewModel name="Wheel" defaultInstanceId="${VMI}" id="${VM}">`
  + PROPS.map((p) => `<ViewModelPropertyNumber name="${p}" id="${P[p]}"/>`).join("")
  + `<ViewModelPropertyTrigger name="tap" id="${TAP}"/>`
  + `<ViewModelInstance exports="true" name="Default" id="${VMI}">`
  + PROPS.map((p) => `<ViewModelInstanceNumber propertyValue="${f(DEFAULTS[p] ?? 0)}" viewModelPropertyId="${P[p]}"/>`).join("")
  + `<ViewModelInstanceTrigger viewModelPropertyId="${TAP}"/>`
  + `</ViewModelInstance></ViewModel>`;

const dir = here + "rive/";
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "rive.yaml", "name: wheel\nmain: Wheel\nexclude:\n  - build\n");
writeFileSync(dir + "scene.rml", `<Rive version="1" kind="fragment">\n${wheelXml}\n${lightsXml}\n${vm}\n</Rive>\n`);
execFileSync("rive", [dir, "--once"], { stdio: "inherit" });
copyFileSync(dir + "build/wheel.riv", here + "wheel.riv");
const count = (xml, tag) => (xml.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
const meta = {
  rivBytes: statSync(here + "wheel.riv").size,
  wheel: { shapes: count(wheelXml, "Shape"), paints: count(wheelXml, "Fill") + count(wheelXml, "Stroke") },
  lights: { shapes: count(lightsXml, "Shape"), paints: count(lightsXml, "Fill") + count(lightsXml, "Stroke") },
  geometry: { hub: g.hub.map(f), root: g.root.map(f), rive: Object.fromEntries(Object.entries(g.rive).map(([k, v]) => [k, f(v)])), depth: g.depth.map(f) },
};
writeFileSync(here + "wheel.meta.json", JSON.stringify(meta, null, 1) + "\n");
console.log(JSON.stringify(meta));
