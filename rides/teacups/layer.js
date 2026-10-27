// Twirlin' Teacups: six cups orbit the turntable while each spins on its own, round a teapot that turns with the
// platform.
//
// The painted cups are erased by a plate patch (plate.webp, tools/park_patch.py paste: an empty turntable drum). The
// cups, saucers, teapot and riders are a small three.js scene rendered into a canvas over the ride's box only:
// - an orthographic camera tilted to match the painted drum (its top is an ellipse 0.56 as tall as wide, so the pitch
//   is asin(0.56), steeper than the park camera's 28.7 deg: the painting's ellipses vary from ride to ride);
// - lathe-turned cups wrapped in painted pattern bands (textures.webp, generated in the painting's style), two-tone
//   shading with a plum-tinted shade, inverted-hull outlines tinted to each colour, a little paper grain;
// - riders are the crowd's own animal sprites (tests/park-crowd/atlas.png) on camera-facing cards that face their
//   cup's wheel, so their view (front, side, back) changes as the cup spins; the cup's front wall hides their legs.
// Motion: one 77 s cycle (load 10, start-up 5, ride 55, slow-down 7), integrated once at mount; any clock time gives
// the same frame (a frozen &t= works). Riders sink out of sight and new ones rise during each loading pause.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const HUB = [3210, 1560];             // park px: the centre of the painted drum's top surface
const PITCH = Math.asin(0.56);        // the drum's drawn ellipse ratio
const BOX = [3080, 1428, 3340, 1650]; // park px: the canvas covers only the ride
const ORBIT = 63;                     // cup centres sit on this circle (park px); the drum's top radius is 101
const CUP = { r: 20.5, h: 22 };
const T = { load: 10, up: 5, ride: 55, down: 7 };
const CYCLE = T.load + T.up + T.ride + T.down;
const PLATFORM_REV = 1 / 9;           // turns per second at full speed
const RATE = 120;                     // integration steps per second
const OUTLINE = 0.85;                 // park px
const KIDS = ["bear_cub"];

const CUPS = [ // pattern band and body colour (handle, outline tint)
  { band: "pink_dots", color: "#ec8378" }, { band: "yellow_daisies", color: "#f4cf63" },
  { band: "blue_stars", color: "#62a3dd" }, { band: "mint_stripes", color: "#83c08f" },
  { band: "lavender_hearts", color: "#ac9bd6" }, { band: "peach_scallops", color: "#f1a982" },
];
const CREAM = "#fbf0da", GOLD = "#f0c463", POT_BLUE = "#7fb0e4", INK = "#2c201b";

// Colours go to the shaders as raw sRGB, like the painting's pixels (no colour management).
const vec3 = (hex) => new THREE.Vector3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// 0 while loading, easing up to 1 for the ride, easing back to 0 at the end.
function envelope(ph) {
  if (ph < T.load) return 0;
  if (ph < T.load + T.up) return smooth((ph - T.load) / T.up);
  if (ph < T.load + T.up + T.ride) return 1;
  return 1 - smooth((ph - T.load - T.up - T.ride) / T.down);
}

const VERT = `
uniform float uHull;
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  #ifdef HULL
  w.xyz += vN * uHull;
  #endif
  vP = position;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// MODE 0: flat colour. MODE 1: a painted band round a lathe (u from the angle about y, with the seam on -x under the
// handle; v from the height), and a cream inside where the lathe profile turns inward (uv.y above uRim).
const FRAG = `
uniform vec3 uLight;
uniform vec3 uColor;
uniform vec3 uInk;
uniform sampler2D uMap;
uniform vec2 uBand;      // atlas v at the band's top (the rim) and bottom
uniform float uRim;
uniform float uHeight;
uniform float uRepeat;
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  #ifdef HULL
  gl_FragColor = vec4(mix(uColor * 0.5, uInk, 0.45), 1.0);
  #else
  vec3 base = uColor;
  #if MODE == 1
  if (vUv.y <= uRim) {
    float u = fract((atan(vP.z, vP.x) / 6.2831853 + 0.5) * uRepeat);
    float v = clamp(vP.y / uHeight, 0.0, 1.0);
    base = texture2D(uMap, vec2(u, mix(uBand.y, uBand.x, v))).rgb;
  } else {
    base = vec3(0.984, 0.941, 0.855) * 0.94;
  }
  #endif
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float lit = smoothstep(-0.05, 0.25, dot(n, uLight));
  vec3 c = mix(base * vec3(0.80, 0.75, 0.86), base, lit);
  c *= 0.975 + 0.05 * hash(floor(gl_FragCoord.xy));
  gl_FragColor = vec4(c, 1.0);
  #endif
}`;

const CARD_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CARD_FRAG = `
uniform sampler2D uMap;
uniform vec4 uRect;   // u0, v0, u1, v1 in the atlas
uniform float uFlip;
uniform float uCut;   // card v below which the rider is inside the cup (only while sinking or rising)
varying vec2 vUv;
void main() {
  if (vUv.y < uCut) discard;
  float x = uFlip > 0.5 ? 1.0 - vUv.x : vUv.x;
  vec4 c = texture2D(uMap, vec2(mix(uRect.x, uRect.z, x), mix(uRect.y, uRect.w, vUv.y)));
  if (c.a < 0.05) discard;
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;

const SHADOW_FRAG = `
uniform vec3 uInk;
varying vec2 vP;
void main() { float a = 0.24 * (1.0 - smoothstep(0.55, 1.0, length(vP))); gl_FragColor = vec4(uInk * a, a); }`;

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });

export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const crowdDir = new URL("../../tests/park-crowd/", ctx.dir);
  const [plateMeta, texMeta, texImg, atlasMeta, atlasImg] = await Promise.all([
    fetch(url("plate.json")).then((r) => r.json()),
    fetch(url("textures.json")).then((r) => r.json()),
    loadImage(url("textures.webp")),
    fetch(new URL("atlas.json", crowdDir)).then((r) => r.json()),
    loadImage(new URL("atlas.png", crowdDir).href),
  ]);
  const plate = ctx.addPatch(url("plate.webp"), plateMeta.rect);
  await plate.decode().catch(() => {});

  // The renderer covers the ride's box only.
  const [bx, by, bw, bh] = [BOX[0], BOX[1], BOX[2] - BOX[0], BOX[3] - BOX[1]];
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`;
  ctx.slots.rides.append(canvas);
  function resize(scale) {
    renderer.setPixelRatio(scale * Math.min(devicePixelRatio || 1, 1.5 / scale)); // at most 1.5 device px per park px
    renderer.setSize(bw, bh, false);
  }
  resize(ctx.scale());

  // World origin = the drum's floor centre; 1 unit = 1 park px; +z towards the viewer.
  const cam = new THREE.OrthographicCamera(bx - HUB[0], bx + bw - HUB[0], HUB[1] - by, HUB[1] - (by + bh), -1000, 1000);
  cam.rotation.order = "YXZ";
  cam.rotation.x = -PITCH;
  cam.updateMatrixWorld(true);
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const scene = new THREE.Scene();

  const light = new THREE.Vector3(-0.55, 0.75, 0.55).normalize();
  const texture = new THREE.Texture(texImg);
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const atlas = new THREE.Texture(atlasImg);
  atlas.needsUpdate = true;

  function toon(color, { mode = 0, band = null, rim = 1, height = 1, repeat = 1, hull = 0 } = {}) {
    const slot = band ? texMeta.slots[band] : { v0: 0, v1: 1 };
    return new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      defines: hull ? { MODE: mode, HULL: 1 } : { MODE: mode },
      uniforms: {
        uLight: { value: light }, uColor: { value: vec3(color) }, uInk: { value: vec3(INK) }, uMap: { value: texture },
        uBand: { value: new THREE.Vector2(1 - slot.v0, 1 - slot.v1) }, uRim: { value: rim }, uHeight: { value: height },
        uRepeat: { value: repeat }, uHull: { value: hull },
      },
      side: hull ? THREE.BackSide : THREE.DoubleSide,
    });
  }
  function withOutline(geo, mat, color, outline = OUTLINE) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    if (outline) g.add(new THREE.Mesh(geo, toon(color, { hull: outline })));
    return g;
  }
  const lathe = (pts, seg = 56) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const shadowGeo = new THREE.CircleGeometry(1, 40);
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: SHADOW_FRAG, uniforms: { uInk: { value: vec3(INK) } },
  });
  function shadow(r) {
    const m = new THREE.Mesh(shadowGeo, shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.15;
    m.scale.setScalar(r);
    m.renderOrder = -1;
    return m;
  }

  // A cup: a lathe profile up the outside to the rim, then down the inside to its floor.
  const outside = [[0, 0], [12, 0], [12.4, 2.4], [14.5, 3.6], [17.3, 6.5], [19.3, 10.5], [20.4, 15], [20.8, 19.2], [CUP.r, CUP.h]];
  const inside = [[19.8, CUP.h + 0.4], [19.2, 19], [18.1, 13.5], [15.6, 8.4], [10.5, 5.2], [0, 4.6]];
  const rimFrac = (outside.length - 1) / (outside.length + inside.length - 1) + 1e-4;
  const cupGeo = lathe([...outside, ...inside]);
  const cupHullGeo = lathe(outside);
  const handleGeo = new THREE.TorusGeometry(6.2, 1.7, 8, 20, Math.PI * 1.1);
  const saucerGeo = lathe([[0, 0], [22, 0], [25.5, 1.6], [26, 2.6], [23, 2.4], [0, 2.1]]);
  const postGeo = new THREE.CylinderGeometry(1.2, 1.4, 7, 10);
  const wheelGeo = new THREE.TorusGeometry(4.2, 0.9, 6, 18);
  const CUP_Y = 2.2; // the cup stands on its saucer

  const platform = new THREE.Group();
  scene.add(platform);
  const cups = CUPS.map((spec, i) => {
    const orbit = new THREE.Group(); // carried round by the platform
    const a = (i / CUPS.length) * Math.PI * 2;
    orbit.position.set(Math.cos(a) * ORBIT, 0, Math.sin(a) * ORBIT);
    orbit.add(shadow(28));
    const spin = new THREE.Group();  // the cup's own spin
    orbit.add(spin);
    spin.add(withOutline(saucerGeo, toon(CREAM), GOLD));
    const body = new THREE.Group();
    body.add(new THREE.Mesh(cupGeo, toon(spec.color, { mode: 1, band: spec.band, rim: rimFrac, height: CUP.h, repeat: 1.5 })));
    body.add(new THREE.Mesh(cupHullGeo, toon(spec.color, { hull: OUTLINE })));
    body.position.y = CUP_Y;
    spin.add(body);
    const handle = withOutline(handleGeo, toon(spec.color), spec.color);
    handle.rotation.z = Math.PI / 2 + 0.05 * Math.PI; // a C on the -x side, over the band's seam
    handle.position.set(-CUP.r - 1.2, CUP_Y + 12.5, 0);
    spin.add(handle);
    const post = withOutline(postGeo, toon(GOLD), GOLD, 0.6);
    post.position.y = CUP_Y + 4.6 + 3.5;
    spin.add(post);
    const wheel = withOutline(wheelGeo, toon(GOLD), GOLD, 0.6);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = CUP_Y + 4.6 + 7.2;
    spin.add(wheel);
    platform.add(orbit);
    const seats = [0, 1].map(() => { const s = new THREE.Object3D(); spin.add(s); return s; });
    return { orbit, spin, seats };
  });

  // The teapot in the middle, on a gold plinth, turning with the platform.
  const pot = new THREE.Group();
  pot.add(withOutline(lathe([[0, 0], [16, 0], [21, 3.5], [25, 10], [26.4, 18], [25.2, 26], [21, 32.5], [14.5, 36]]),
    toon(CREAM, { mode: 1, band: "cream_flowers", rim: 1.01, height: 36, repeat: 1.15 }), POT_BLUE));
  pot.add(withOutline(lathe([[0, 35.5], [15.5, 35.5], [15, 37.5], [11, 41], [5, 43], [0, 43.4]], 48), toon(POT_BLUE), POT_BLUE));
  const knob = withOutline(new THREE.SphereGeometry(3.4, 16, 10), toon(GOLD), GOLD, 0.6);
  knob.position.y = 46;
  pot.add(knob);
  const spout = new THREE.QuadraticBezierCurve3(new THREE.Vector3(22, 13, 0), new THREE.Vector3(36, 14, 0), new THREE.Vector3(38, 30, 0));
  pot.add(withOutline(new THREE.TubeGeometry(spout, 16, 3.4, 10, false), toon(POT_BLUE), POT_BLUE));
  const potHandle = withOutline(new THREE.TorusGeometry(9.5, 2.4, 8, 20, Math.PI * 1.15), toon(POT_BLUE), POT_BLUE);
  potHandle.rotation.z = Math.PI / 2 + 0.075 * Math.PI;
  potHandle.position.set(-24.5, 19, 0);
  pot.add(potHandle);
  pot.position.y = 3;
  const plinth = withOutline(new THREE.CylinderGeometry(30, 31, 3, 48), toon(GOLD), GOLD);
  plinth.position.y = 1.5;
  platform.add(shadow(37), plinth, pot);

  // Riders: the crowd's sprites on cards that always face the camera, placed at their seats each frame.
  const frames = atlasMeta.frames, AS = atlasMeta.scale, [AW, AH] = atlasMeta.size;
  const looks = [...new Set(Object.keys(frames).filter((k) => k.endsWith("/front_stand")).map((k) => k.split("/")[0]))];
  const adults = looks.filter((l) => !KIDS.includes(l) && l !== "pet");
  const K = ((38 * (3840 / 3904)) / 30) * 0.72; // the crowd's size, a little smaller sitting in a cup
  const cardGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const cards = [];
  for (const c of cups) {
    for (const seat of c.seats) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, transparent: true, premultipliedAlpha: true,
        uniforms: { uMap: { value: atlas }, uRect: { value: new THREE.Vector4() }, uFlip: { value: 0 }, uCut: { value: 0 } },
      });
      const mesh = new THREE.Mesh(cardGeo, mat);
      mesh.quaternion.copy(cam.quaternion);
      scene.add(mesh);
      cards.push({ mesh, mat, seat, cup: c });
    }
  }
  const P = new THREE.Vector3();
  function placeCard(card, key, flip, kid, sunk = 0) {
    const f = frames[key];
    if (!f) { card.mesh.visible = false; return; }
    const [x, y, w, h] = f.rect, [ax, ay] = f.anchor;
    const k = ((kid ? 1.12 : 1) * K) / AS;
    card.mat.uniforms.uRect.value.set(x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH);
    card.mat.uniforms.uFlip.value = flip ? 1 : 0;
    card.mesh.scale.set(w * k, h * k, 1);
    card.seat.getWorldPosition(P);
    // The card's bottom-centre goes to the seat, moved so the frame's feet anchor is on it.
    const dx = ((flip ? w - ax : ax) - w / 2) * k, dy = (h - ay) * k;
    card.mesh.position.copy(P).addScaledVector(camRight, -dx).addScaledVector(camUp, -dy);
    // While sinking or rising, cut the card where it meets the cup's rim (sunk = park px below the seated height),
    // so the rider seems to duck into the cup rather than slide through its front wall.
    card.mat.uniforms.uCut.value = sunk > 0 ? Math.min(1, (dy + sunk * Math.cos(PITCH)) / (h * k)) : 0;
    card.mesh.visible = true;
  }

  // One cycle's angles, integrated once: the platform's turn and each cup's own spin.
  const steps = Math.round(CYCLE * RATE);
  const R0 = rng(20261026);
  const spinSpec = cups.map(() => ({ dir: R0() < 0.35 ? -1 : 1, base: 0.32 + 0.3 * R0(), amp: 0.08 + 0.16 * R0(), period: 7 + 8 * R0(), phase: R0() * 6.283 }));
  const plat = new Float32Array(steps + 1), spins = cups.map(() => new Float32Array(steps + 1));
  for (let k = 1; k <= steps; k++) {
    const t = (k - 0.5) / RATE, e = envelope(t);
    plat[k] = plat[k - 1] + (e * PLATFORM_REV * 2 * Math.PI) / RATE;
    spinSpec.forEach((s, i) => {
      const rev = s.dir * (s.base + s.amp * Math.sin((2 * Math.PI * t) / s.period + s.phase));
      spins[i][k] = spins[i][k - 1] + (e * rev * 2 * Math.PI) / RATE;
    });
  }
  const sample = (arr, ph) => {
    const x = Math.min(steps, Math.max(0, ph * RATE)), i = Math.min(steps - 1, Math.floor(x)), f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };

  // Who rides in cycle n: one or two animals per cup, now and then a cub; it changes in each loading pause.
  function crew(n) {
    const R = rng(1000003 * (n + 7) + 17);
    return cups.map(() => {
      const pick = () => (R() < 0.22 ? KIDS[0] : adults[Math.floor(R() * adults.length)]);
      return R() < 0.55 ? [pick(), pick()] : [adults[Math.floor(R() * adults.length)]];
    });
  }

  const SEAT_R = 7.2, SEAT_Y = CUP_Y + 6.4, SINK = 15;
  function view(beta) {
    // A rider faces the cup's wheel: direction (-cos b, -sin b) in (x, z); +z is towards the viewer.
    const fx = -Math.cos(beta), fz = -Math.sin(beta);
    if (fz > 0.707) return ["front", false];
    if (fz < -0.707) return ["back", false];
    return ["side", fx < 0];
  }

  const timing = { ms: 0, frames: 0 };
  function render(clock) {
    const t0 = performance.now();
    const n = Math.floor(clock / CYCLE), ph = clock - n * CYCLE;
    const theta = n * plat[steps] + sample(plat, ph);
    platform.rotation.y = -theta; // counter-clockwise seen from above
    const phis = cups.map((_, i) => n * spins[i][steps] + sample(spins[i], ph));
    cups.forEach((c, i) => { c.spin.rotation.y = -phis[i]; });
    // Loading pause: last cycle's riders sink below the rim (2-4 s), this cycle's rise (6-8 s).
    let who = crew(n), sink = 0;
    if (ph < T.load) {
      if (ph < 5) { who = crew(n - 1); sink = smooth((ph - 2) / 2); } else sink = 1 - smooth((ph - 6) / 2);
    }
    cups.forEach((c, i) => c.seats.forEach((seat, s) => {
      const alpha = (s / Math.max(1, who[i].length)) * Math.PI * 2 + 0.6 + i;
      seat.position.set(Math.cos(alpha) * SEAT_R, SEAT_Y - sink * SINK, Math.sin(alpha) * SEAT_R);
    }));
    scene.updateMatrixWorld();
    cards.forEach((card) => {
      const i = cups.indexOf(card.cup), s = card.cup.seats.indexOf(card.seat), look = who[i][s];
      if (!look || sink > 0.999) { card.mesh.visible = false; return; }
      const alpha = (s / Math.max(1, who[i].length)) * Math.PI * 2 + 0.6 + i;
      const [v, flip] = view(theta + phis[i] + alpha); // the seat's angle in the world
      placeCard(card, `${look}/${v}_stand`, flip, KIDS.includes(look), sink * SINK);
    });
    renderer.render(scene, cam);
    timing.ms += performance.now() - t0;
    timing.frames++;
  }
  render(ctx.clock.now());
  window.__teacups = { timing, cycle: CYCLE, calls: () => ({ ...renderer.info.render }) };

  return {
    update(t) { render(t); },
    resize(scale) { resize(scale); render(ctx.clock.now()); },
  };
}
