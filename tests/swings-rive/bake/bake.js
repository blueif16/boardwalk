import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
import { createCamera } from "../../../base/camera.js";
import { DIM } from "../../swings-three/ride.js";
import { createToon, lightDir, buildTower, buildRotor, buildChair } from "../../swings-three/model.js";

const params = new URLSearchParams(location.search);
const H = Number(params.get("headings") || 32);
const TILTS = (params.get("tilts") || "0,14,28,42,56").split(",").map(Number);
const K = Number(params.get("frames") || 16);
const SCALE = Number(params.get("scale") || 2);
const VARIANTS = 4;

const stage = await (await fetch(new URL("../../../base/stage.json", import.meta.url))).json();
const camera = createCamera(stage);
const C = camera.toGround(stage.platforms[DIM.platform].floor);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
const toon = createToon(THREE, { light: lightDir(camera), px: SCALE });

function shoot(scene, [x, y, w, h]) {
  const cam = camera.three(THREE);
  cam.left = x - camera.W / 2;
  cam.right = x + w - camera.W / 2;
  cam.top = camera.H / 2 - y;
  cam.bottom = camera.H / 2 - (y + h);
  cam.updateProjectionMatrix();
  renderer.setSize(w * SCALE, h * SCALE, false);
  renderer.clear();
  renderer.render(scene, cam);
  const c = document.createElement("canvas");
  c.width = w * SCALE;
  c.height = h * SCALE;
  c.getContext("2d").drawImage(renderer.domElement, 0, 0);
  return c;
}

function alphaBox(c, box = [Infinity, Infinity, -Infinity, -Infinity]) {
  const { data, width, height } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
  return box;
}

function pack(frames, box, cols) {
  const cw = box[2] - box[0] + 3, ch = box[3] - box[1] + 3;
  const rows = Math.ceil(frames.length / cols);
  const atlas = document.createElement("canvas");
  atlas.width = cols * cw;
  atlas.height = rows * ch;
  const g = atlas.getContext("2d");
  frames.forEach((f, i) => g.drawImage(f, box[0] - 1, box[1] - 1, cw, ch, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch));
  return { atlas, cw, ch, cols, rows };
}

const meta = { scale: SCALE, box: DIM.box, headings: H, tilts: TILTS, frames: K, variants: VARIANTS, centre: C };
const out = {};

{
  const scene = new THREE.Scene();
  const chair = buildChair(THREE, toon, 0);
  const R = 44;
  const rect = [camera.W / 2 - R, camera.H / 2 - R, 2 * R, 2 * R];
  const frames = [];
  let box;
  for (let v = 0; v < VARIANTS; v++) {
    scene.clear();
    const m = buildChair(THREE, toon, v);
    scene.add(m);
    for (const tilt of TILTS)
      for (let h = 0; h < H; h++) {
        m.rotation.set(0, (h * 2 * Math.PI) / H, (tilt * Math.PI) / 180, "YZX");
        const f = shoot(scene, rect);
        box = alphaBox(f, box);
        frames.push(f);
      }
  }
  const cols = Math.ceil(Math.sqrt((frames.length * (box[3] - box[1] + 3)) / (box[2] - box[0] + 3)));
  const p = pack(frames, box, cols);
  out.chairs = p.atlas.toDataURL("image/png");
  meta.chairs = { cw: p.cw, ch: p.ch, cols: p.cols, rows: p.rows, ax: R * SCALE - (box[0] - 1), ay: R * SCALE - (box[1] - 1), width: p.atlas.width, height: p.atlas.height };
  void chair;
}

{
  const scene = new THREE.Scene();
  const rotor = buildRotor(THREE, toon);
  rotor.position.set(C[0], 0, C[2]);
  scene.add(rotor);
  const period = (2 * 2 * Math.PI) / DIM.gores;
  const frames = [];
  let box;
  for (let j = 0; j < K; j++) {
    rotor.rotation.y = (j * period) / K;
    const f = shoot(scene, DIM.box);
    box = alphaBox(f, box);
    frames.push(f);
  }
  const cols = Math.ceil(Math.sqrt(K));
  const p = pack(frames, box, cols);
  out.canopy = p.atlas.toDataURL("image/png");
  meta.canopy = { cw: p.cw, ch: p.ch, cols: p.cols, rows: p.rows, x: (box[0] - 1) / SCALE, y: (box[1] - 1) / SCALE, period, width: p.atlas.width, height: p.atlas.height };
}

{
  const scene = new THREE.Scene();
  const tower = buildTower(THREE, toon);
  tower.position.set(C[0], 0, C[2]);
  scene.add(tower);
  const f = shoot(scene, DIM.box);
  const box = alphaBox(f);
  const p = pack([f], box, 1);
  out.tower = p.atlas.toDataURL("image/png");
  meta.tower = { x: (box[0] - 1) / SCALE, y: (box[1] - 1) / SCALE, width: p.atlas.width, height: p.atlas.height };
}

window.__bake = { meta, out };
document.body.textContent = "baked";
