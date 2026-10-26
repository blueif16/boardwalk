import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
import { DIM, createRide } from "./ride.js";
import { createToon, lightDir, buildTower, buildRotor, buildChair, buildChains } from "./model.js";
import { createBulbs } from "./bulbs.js";

export async function mount({ stage, camera, time, clock, slots, bench }) {
  const [bx, by, bw, bh] = DIM.box;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(bw, bh, false);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px`, pointerEvents: "none" });
  slots.rides.append(canvas);

  const cam = camera.three(THREE);
  cam.left = bx - camera.W / 2;
  cam.right = bx + bw - camera.W / 2;
  cam.top = camera.H / 2 - by;
  cam.bottom = camera.H / 2 - (by + bh);
  cam.updateProjectionMatrix();

  const ride = createRide({ stage, camera, clock, slots });
  const C = ride.centre;
  const toon = createToon(THREE, { light: lightDir(camera), px: dpr });
  const scene = new THREE.Scene();
  const tower = buildTower(THREE, toon);
  tower.position.set(C[0], 0, C[2]);
  const rotor = buildRotor(THREE, toon);
  rotor.position.set(C[0], 0, C[2]);
  scene.add(tower, rotor);
  const chairs = ride.state.chairs.map((c) => {
    const m = buildChair(THREE, toon, c.variant);
    scene.add(m);
    return m;
  });
  const chains = buildChains(THREE, toon, DIM.n * 2);
  scene.add(chains);
  const bulbs = createBulbs({ camera, time, slots, centre: C });

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), SC = new THREE.Vector3();

  function render(t) {
    const st = ride.step(t);
    rotor.rotation.y = st.phi;
    st.chairs.forEach((c, i) => {
      const m = chairs[i];
      m.position.set(...c.seat);
      m.rotation.set(0, c.psi, c.theta, "YZX");
      c.hangers.forEach(([a, b], j) => {
        V.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const len = V.length();
        Q.setFromUnitVectors(Y, V.normalize());
        M.compose(SC.set(...a), Q, V.set(1, len, 1));
        chains.setMatrixAt(i * 2 + j, M);
      });
    });
    chains.instanceMatrix.needsUpdate = true;
    renderer.render(scene, cam);
    bulbs.draw(st);
    bench?.report("swings-three", renderer.info.render.calls);
  }

  render(clock.now());
  window.__swings = { ride, renderer, scene };
  return { update(dt, t) { render(t); } };
}
