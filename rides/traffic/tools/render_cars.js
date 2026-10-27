// Renders one car GLB to sprites at the park painting's camera (tests/park-crowd/park.json: yaw 24.1, pitch 28.7,
// orthographic) from HEADINGS ground headings, D sprite px per park px. Query: glb, len (ground units, the car's
// length), yaw0 (deg, model's forward axis offset, found by PCA unless given), flip (1 = the model faces -X),
// headings, d, light (0..1 mix of lit shading over the flat texture).
// Heading k is the ground direction theta = k * 360 / HEADINGS degrees in the (x east, z south) plane; theta 0 drives
// east (screen right and slightly down), 90 drives south (towards the viewer).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCamera } from "../../../base/camera.js";

const q = new URLSearchParams(location.search);
const HEADINGS = Number(q.get("headings")) || 32;
const D = Number(q.get("d")) || 4;
const LEN = Number(q.get("len")) || 80;
const LIGHT = Number(q.get("light") ?? 0.35);
const park = await (await fetch("../../../tests/park-crowd/park.json")).json();
const pcam = createCamera(park);

const gltf = await new GLTFLoader().loadAsync(q.get("glb"));
const model = gltf.scene;
const pts = [];
model.updateMatrixWorld(true);
model.traverse((o) => {
  if (!o.isMesh) return;
  const p = o.geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.clone()); }
  const map = o.material.map;
  // Flat painted colour plus a little real light, so the roof, sides and front separate at small size.
  o.material = new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1 - LIGHT, color: new THREE.Color(LIGHT, LIGHT, LIGHT) });
});
// Forward axis: the principal axis of the footprint (x, z), unless yaw0 is given.
let yaw0 = q.has("yaw0") ? (Number(q.get("yaw0")) * Math.PI) / 180 : null;
if (yaw0 == null) {
  let mx = 0, mz = 0; for (const p of pts) { mx += p.x; mz += p.z; } mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0; for (const p of pts) { const x = p.x - mx, z = p.z - mz; sxx += x * x; szz += z * z; sxz += x * z; }
  yaw0 = 0.5 * Math.atan2(2 * sxz, sxx - szz); // angle of the long axis from +X towards +Z
}
const flip = q.get("flip") === "1";
// Normalise: long axis on +X (forward), ground at y = 0, centred, length LEN.
const inner = new THREE.Group();
inner.add(model);
inner.rotation.y = yaw0 + (flip ? Math.PI : 0); // three's rotation.y turns +X towards -Z, so +yaw0 undoes the offset
const box = new THREE.Box3().setFromObject(inner);
const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
const s = LEN / size.x;
const norm = new THREE.Group();
norm.add(inner);
norm.scale.setScalar(s);
norm.position.set(-center.x * s, -box.min.y * s, -center.z * s);
const pivot = new THREE.Group();
pivot.add(norm);

// Contact shadow: a soft rounded patch on the ground under the car, turning with it.
const sc = document.createElement("canvas"); sc.width = 128; sc.height = 64;
const g = sc.getContext("2d");
const grad = g.createRadialGradient(64, 32, 4, 64, 32, 62);
grad.addColorStop(0, "rgba(44,32,27,0.5)"); grad.addColorStop(0.7, "rgba(44,32,27,0.3)"); grad.addColorStop(1, "rgba(44,32,27,0)");
g.setTransform(1, 0, 0, 0.5, 0, 16); g.fillStyle = grad; g.fillRect(0, -32, 128, 128);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(LEN * 1.12, size.z * s * 1.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.05;
shadow.renderOrder = -1;
pivot.add(shadow);

const scene = new THREE.Scene();
scene.add(pivot);
scene.add(new THREE.AmbientLight(0xffffff, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e6, 1.4);
sun.position.set(-0.6, 1.4, 0.8); // from the upper left and in front, as the painting's soft light
scene.add(sun);

// The park camera, framed on the car: one park px = D canvas px, the car's ground centre at the cell's anchor.
const CW = Math.ceil(LEN * 1.25 * D / 8) * 8, CH = Math.ceil(LEN * 1.0 * D / 8) * 8;
const cam = pcam.three(THREE);
const half = [CW / 2 / D, CH / 2 / D];
cam.left = -half[0]; cam.right = half[0]; cam.top = half[1]; cam.bottom = -half[1];
// Shift the view so the ground centre sits at (CW/2, CH*0.68): move the camera along its screen axes.
const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
const ay = CH * 0.68;
cam.position.copy(up.multiplyScalar((ay - CH / 2) / D)).add(right.multiplyScalar(0));
cam.updateProjectionMatrix();
cam.updateMatrixWorld(true);
const o = new THREE.Vector3(0, 0, 0).project(cam);
const anchor = [((o.x + 1) / 2) * CW, ((1 - o.y) / 2) * CH];
// Check against the painting's own projection: a ground step east must land where toPixel puts it.
const e = new THREE.Vector3(10, 0, 0).project(cam), ez = new THREE.Vector3(0, 0, 10).project(cam);
const check = { east: [((e.x - o.x) / 2) * CW / D, (-(e.y - o.y) / 2) * CH / D], toPixelEast: pcam.project([10, 0, 0]),
  south: [((ez.x - o.x) / 2) * CW / D, (-(ez.y - o.y) / 2) * CH / D], toPixelSouth: pcam.project([0, 0, 10]) };

const COLS = 8, ROWS = Math.ceil(HEADINGS / COLS);
const canvas = document.createElement("canvas");
canvas.width = CW * COLS; canvas.height = CH * ROWS;
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
renderer.clear();
const frames = {};
for (let k = 0; k < HEADINGS; k++) {
  const theta = (k / HEADINGS) * Math.PI * 2;
  pivot.rotation.y = -theta;
  const c = k % COLS, r = Math.floor(k / COLS);
  const x = c * CW, y = (ROWS - 1 - r) * CH;
  renderer.setViewport(x, y, CW, CH); renderer.setScissor(x, y, CW, CH);
  renderer.render(scene, cam);
  frames[`h${k}`] = { rect: [c * CW, r * CH, CW, CH], anchor, theta: (theta * 180) / Math.PI };
}
window.__result = { dataURL: canvas.toDataURL("image/png"), frames, headings: HEADINGS, density: D, len: LEN, yaw0: (yaw0 * 180) / Math.PI, flip, size: [size.x * s, size.y * s, size.z * s], check };
