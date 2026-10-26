export function createCamera(stage) {
  const [W, H] = stage.size;
  const yaw = (stage.camera.yawDeg * Math.PI) / 180;
  const pitch = (stage.camera.pitchDeg * Math.PI) / 180;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const ex = [cy, sp * sy];
  const ez = [-sy, sp * cy];
  const ey = [0, -cp];
  const center = [W / 2, H / 2];

  function toPixel([x, y, z]) {
    return [center[0] + x * ex[0] + z * ez[0], center[1] + x * ex[1] + z * ez[1] + y * ey[1]];
  }

  function toGround([px, py], height = 0) {
    const bx = px - center[0];
    const by = py - center[1] - height * ey[1];
    const det = ex[0] * ez[1] - ez[0] * ex[1];
    return [(bx * ez[1] - ez[0] * by) / det, height, (ex[0] * by - bx * ex[1]) / det];
  }

  function project(dir) {
    return [dir[0] * ex[0] + dir[2] * ez[0], dir[0] * ex[1] + dir[1] * ey[1] + dir[2] * ez[1]];
  }

  function planeAffine(u, v) {
    const a = project(u), b = project(v);
    return [a[0], a[1], b[0], b[1]];
  }

  function riveTransform(m) {
    const [a, b, c, d] = m;
    const E = (a + d) / 2, F = (a - d) / 2, G = (b + c) / 2, Hh = (b - c) / 2;
    const Q = Math.hypot(E, Hh), R = Math.hypot(F, G);
    const a1 = Math.atan2(G, F), a2 = Math.atan2(Hh, E);
    const outer = (a2 + a1) / 2, inner = (a2 - a1) / 2;
    return { outerRotation: outer, scaleX: Q + R, scaleY: Q - R, innerRotation: inner };
  }

  function three(THREE, { near = -20000, far = 20000 } = {}) {
    const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, near, far);
    cam.rotation.order = "YXZ";
    cam.rotation.y = yaw;
    cam.rotation.x = -pitch;
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }

  function groundEllipse(name) {
    const p = stage.platforms[name];
    return { center: p.floor, rx: p.radius, ry: p.radius * sp };
  }

  return { W, H, yaw, pitch, ex, ey, ez, toPixel, toGround, project, planeAffine, riveTransform, three, groundEllipse };
}
