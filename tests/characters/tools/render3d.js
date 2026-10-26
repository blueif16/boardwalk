import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const q = new URLSearchParams(location.search);
const CELL = Number(q.get("cell")) || 256;
const HEADINGS = Number(q.get("headings")) || 8;
const LIT = q.get("lit") !== "0";
const PITCH = (28.7 * Math.PI) / 180;
const POSES = ["stand", "walk0", "walk1", "walk2", "walk3"];

const gltf = await new GLTFLoader().loadAsync(q.get("glb"));
const model = gltf.scene;
const clip = gltf.animations[0];
const mixer = new THREE.AnimationMixer(model);
mixer.clipAction(clip).play();
let hips = null, lfoot = null, rfoot = null;
model.traverse((o) => {
  if (o.isBone && /hips/i.test(o.name) && !hips) hips = o;
  if (o.isBone && /left.?foot/i.test(o.name) && !lfoot) lfoot = o;
  if (o.isBone && /right.?foot/i.test(o.name) && !rfoot) rfoot = o;
  if (o.isMesh && !LIT) o.material = new THREE.MeshBasicMaterial({ map: o.material.map });
  if (o.isMesh) o.frustumCulled = false;
});
const hips0 = hips.position.clone();

const scene = new THREE.Scene();
const pivot = new THREE.Group();
pivot.add(model);
scene.add(pivot);
scene.add(new THREE.HemisphereLight(0xfff6ee, 0x8a7a6a, LIT ? 2.1 : 0));
const sun = new THREE.DirectionalLight(0xffffff, LIT ? 1.3 : 0);
sun.position.set(-1, 2, 2);
scene.add(sun);

function pose(t) {
  mixer.setTime(t);
  hips.position.x = hips0.x;
  hips.position.z = hips0.z;
  model.updateMatrixWorld(true);
}

const dur = clip.duration, N = 48;
let tc = 0, best = -1;
const a = new THREE.Vector3(), b = new THREE.Vector3();
for (let i = 0; i < N; i++) {
  pose((i / N) * dur);
  lfoot.getWorldPosition(a);
  rfoot.getWorldPosition(b);
  const d = a.z - b.z;
  if (d > best) { best = d; tc = (i / N) * dur; }
}
const times = { walk0: tc, walk1: tc + dur / 4, walk2: tc + dur / 2, walk3: tc + (3 * dur) / 4, stand: tc + dur / 4 };

pose(times.stand);
const box = new THREE.Box3().setFromObject(model);
const height = box.max.y - box.min.y;
const half = height * 0.72;
const cam = new THREE.OrthographicCamera(-half, half, half, -half, -100, 100);
cam.position.set(0, Math.sin(PITCH) * 10 + height * 0.5, Math.cos(PITCH) * 10);
cam.lookAt(0, height * 0.5, 0);
cam.updateMatrixWorld(true);
const foot = new THREE.Vector3(0, 0, 0).project(cam);
const anchor = [((foot.x + 1) / 2) * CELL, ((1 - foot.y) / 2) * CELL];

const canvas = document.createElement("canvas");
canvas.width = CELL * POSES.length;
canvas.height = CELL * HEADINGS;
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setScissorTest(true);
renderer.clear();
const frames = {};
for (let h = 0; h < HEADINGS; h++) {
  pivot.rotation.y = (h / HEADINGS) * Math.PI * 2;
  POSES.forEach((p, c) => {
    pose(times[p]);
    const x = c * CELL, y = (HEADINGS - 1 - h) * CELL;
    renderer.setViewport(x, y, CELL, CELL);
    renderer.setScissor(x, y, CELL, CELL);
    renderer.render(scene, cam);
    frames[`h${h}_${p}`] = { rect: [x, h * CELL, CELL, CELL], anchor };
  });
}
window.__result = { dataURL: canvas.toDataURL("image/png"), frames, headings: HEADINGS, clip: clip.name, duration: dur, height };
