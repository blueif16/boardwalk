// WebGL2 sprite batcher: one atlas texture, one dynamic vertex buffer, one drawElements per frame.
//
// Occlusion (tests/park-crowd/DEPTH.md), optional: masks of things standing in front of the sprites.
// masks(bytes, w, h) uploads one R8 texture of packed masks; occluders(list) sets this frame's occluders, each
//   { box: [x0, y0, x1, y1],   // canvas px it can cover (for culling)
//     m: [a, b, c, d, e, f],   // canvas px -> mask uv: u = a x + c y + e, v = b x + d y + f
//     uv: [u0, v0, u1, v1],    // the mask's packed rect in the texture; outside it the occluder covers nothing
//     sortY, line? }           // its base y (canvas px), or line [xa, ya, xb, yb] read at the foot's x
// A sprite or line drawn with a foot [x, y] (canvas px) is hidden wherever an occluder nearer than the foot (base y
// greater than foot y) covers it: up to 4 occluders per quad, chosen on the CPU from the boxes, tested per fragment.
// sprite() and line() return how many occluders they got.
// Without a foot, or with no occluders, a quad draws exactly as before (the characters test draws no foot).
const VS = `#version 300 es
in vec2 aPos;
in vec3 aUv;
in vec4 aOcc;
uniform vec2 uSize;
out vec3 vUv;
out vec2 vPos;
flat out ivec4 vOcc;
void main() {
  vUv = aUv;
  vPos = aPos;
  vOcc = ivec4(aOcc);
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform highp sampler2D uOcc;
in vec3 vUv;
in vec2 vPos;
flat in ivec4 vOcc;
out vec4 color;
float cover(int i) {
  if (i < 0) return 0.0;
  ivec2 t = ivec2(3 * (i % 1024), i / 1024);
  vec4 a = texelFetch(uOcc, t, 0), b = texelFetch(uOcc, t + ivec2(1, 0), 0), r = texelFetch(uOcc, t + ivec2(2, 0), 0);
  vec2 uv = vec2(a.x * vPos.x + a.z * vPos.y + b.x, a.y * vPos.x + a.w * vPos.y + b.y);
  if (uv.x < r.x || uv.y < r.y || uv.x > r.z || uv.y > r.w) return 0.0;
  return texture(uMask, uv).r;
}
void main() {
  vec4 c = texture(uTex, vUv.xy) * vUv.z;
  if (vOcc.x >= 0) c *= (1.0 - cover(vOcc.x)) * (1.0 - cover(vOcc.y)) * (1.0 - cover(vOcc.z)) * (1.0 - cover(vOcc.w));
  color = c;
}`;
const STRIDE = 9; // floats per vertex: x, y, u, v, alpha, 4 occluder indices (-1 = none)
const ROW = 1024;  // occluders per row of the occluder table (3 texels each)

export function createRenderer(canvas, image, meta, { W, H, maxQuads = 8192 }) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const texture = (unit, filter) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // Unit 0: the sprite atlas; 1: the packed masks (R8); 2: the occluder table (RGBA32F, 3 texels per occluder).
  texture(0, gl.LINEAR_MIPMAP_LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  texture(1, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(4));
  texture(2, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 3, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(12));
  gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "uMask"), 1);
  gl.uniform1i(gl.getUniformLocation(prog, "uOcc"), 2);
  gl.activeTexture(gl.TEXTURE0);

  const data = new Float32Array(maxQuads * 4 * STRIDE);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  const idx = new Uint16Array(Math.min(maxQuads, 16383) * 6);
  for (let q = 0, i = 0; i < idx.length; q++, i += 6) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], i);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  const aPos = gl.getAttribLocation(prog, "aPos"), aUv = gl.getAttribLocation(prog, "aUv"), aOcc = gl.getAttribLocation(prog, "aOcc");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE * 4, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 3, gl.FLOAT, false, STRIDE * 4, 8);
  gl.enableVertexAttribArray(aOcc);
  gl.vertexAttribPointer(aOcc, 4, gl.FLOAT, false, STRIDE * 4, 20);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), W, H);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const [AW, AH] = meta.size;
  const frames = {};
  for (const [name, f] of Object.entries(meta.frames)) {
    const [x, y, w, h] = f.rect, s = 1 / (f.scale ?? meta.scale);
    frames[name] = { name, u0: x / AW, v0: y / AH, u1: (x + w) / AW, v1: (y + h) / AH, w: w * s, h: h * s, ax: f.anchor[0] * s, ay: f.anchor[1] * s, at: f.at, sortY: f.sortY };
  }

  let n = 0, snap = 1, quads = 0, hidden = 0, hiddenNow = 0;
  const px = (v) => Math.round(v * snap) / snap;

  // This frame's occluders, and the table the fragment shader reads. Occluders are bucketed by x (CELL px columns),
  // so a quad tests only the few near it.
  const CELL = 64, cells = [];
  let occ = [], table = new Float32Array(12), dirty = false, stamp = new Int32Array(1), quadId = 0;
  let o0 = -1, o1 = -1, o2 = -1, o3 = -1;
  const picked = [-1, -1, -1, -1]; // the last quad's occluders, for checks
  function pick(x0, y0, x1, y1, foot) {
    o0 = o1 = o2 = o3 = -1;
    if (!foot || !occ.length) return 0;
    const fx = foot[0], fy = foot[1];
    let k = 0;
    quadId++;
    const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.min(cells.length - 1, Math.floor(x1 / CELL));
    for (let c = c0; c <= c1 && k < 4; c++) for (const i of cells[c]) {
      if (stamp[i] === quadId) continue;
      stamp[i] = quadId;
      const o = occ[i], b = o.box;
      if (b[0] >= x1 || b[2] <= x0 || b[1] >= y1 || b[3] <= y0) continue;
      let base = o.sortY;
      if (o.line) {
        const l = o.line, u = l[2] === l[0] ? 0 : Math.min(1, Math.max(0, (fx - l[0]) / (l[2] - l[0])));
        base = l[1] + (l[3] - l[1]) * u;
      }
      if (fy >= base) continue;
      if (k === 0) o0 = i; else if (k === 1) o1 = i; else if (k === 2) o2 = i; else o3 = i;
      if (++k === 4) break;
    }
    if (k > 1) {
      // Same occluders in the same order whichever cell found them first (stable across frames).
      const l = [o0, o1, o2, o3].slice(0, k).sort((a, b) => a - b);
      o0 = l[0]; o1 = l[1] ?? -1; o2 = l[2] ?? -1; o3 = l[3] ?? -1;
    }
    if (k) hiddenNow++;
    picked[0] = o0; picked[1] = o1; picked[2] = o2; picked[3] = o3;
    return k;
  }

  function vert(p, x, y, u, v, alpha) {
    data[p] = x; data[p + 1] = y; data[p + 2] = u; data[p + 3] = v; data[p + 4] = alpha;
    data[p + 5] = o0; data[p + 6] = o1; data[p + 7] = o2; data[p + 8] = o3;
  }
  function put(x0, y0, x1, y1, x2, y2, x3, y3, f, flip, alpha, foot) {
    if (n >= maxQuads) return 0;
    const k = pick(Math.min(x0, x1, x2, x3), Math.min(y0, y1, y2, y3), Math.max(x0, x1, x2, x3), Math.max(y0, y1, y2, y3), foot);
    const o = n * 4 * STRIDE;
    const ua = flip ? f.u1 : f.u0, ub = flip ? f.u0 : f.u1;
    vert(o, x0, y0, ua, f.v0, alpha);
    vert(o + STRIDE, x1, y1, ub, f.v0, alpha);
    vert(o + 2 * STRIDE, x2, y2, ub, f.v1, alpha);
    vert(o + 3 * STRIDE, x3, y3, ua, f.v1, alpha);
    n++;
    return k;
  }

  return {
    gl, frames,
    resize(cssScale, dpr) {
      snap = cssScale * dpr;
      const w = Math.round(W * snap), h = Math.round(H * snap);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    },
    // The packed masks: R8 bytes, w x h, row 0 at the top (as read from a canvas).
    masks(bytes, w, h) {
      gl.activeTexture(gl.TEXTURE1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.activeTexture(gl.TEXTURE0);
    },
    // This frame's occluders (see the top of this file). Call before the sprites; the list stays until replaced.
    occluders(list) {
      occ = list;
      if (stamp.length < list.length) stamp = new Int32Array(list.length * 2);
      const nc = Math.ceil(W / CELL) + 1;
      for (let c = 0; c < nc; c++) (cells[c] ||= []).length = 0;
      cells.length = nc;
      for (let i = 0; i < list.length; i++) {
        const b = list[i].box, c0 = Math.max(0, Math.floor(b[0] / CELL)), c1 = Math.min(nc - 1, Math.floor(b[2] / CELL));
        for (let c = c0; c <= c1; c++) cells[c].push(i);
      }
      const need = Math.ceil(Math.max(1, list.length) / ROW) * ROW * 12;
      if (table.length < need) table = new Float32Array(need);
      for (let i = 0; i < list.length; i++) {
        const m = list[i].m, uv = list[i].uv, p = i * 12;
        table[p] = m[0]; table[p + 1] = m[1]; table[p + 2] = m[2]; table[p + 3] = m[3];
        table[p + 4] = m[4]; table[p + 5] = m[5]; table[p + 6] = 0; table[p + 7] = 0;
        table[p + 8] = uv[0]; table[p + 9] = uv[1]; table[p + 10] = uv[2]; table[p + 11] = uv[3];
      }
      dirty = true;
    },
    begin() { n = 0; hiddenNow = 0; },
    sprite(f, x, y, sx = 1, sy = 1, flip = false, alpha = 1, foot = null) {
      const ax = flip ? f.w - f.ax : f.ax;
      const x0 = px(x - ax * sx), y0 = px(y - f.ay * sy);
      const x1 = x0 + px(f.w * sx), y1 = y0 + px(f.h * sy);
      return put(x0, y0, x1, y0, x1, y1, x0, y1, f, flip, alpha, foot);
    },
    line(f, xa, ya, xb, yb, width, alpha = 1, foot = null) {
      const dx = xb - xa, dy = yb - ya, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * width * 0.5, ny = (dx / l) * width * 0.5;
      return put(xa + nx, ya + ny, xb + nx, yb + ny, xb - nx, yb - ny, xa - nx, ya - ny, f, false, alpha, foot);
    },
    end() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (dirty) {
        // 48 bytes per occluder: a few KB per frame at most.
        gl.activeTexture(gl.TEXTURE2);
        const count = Math.max(1, occ.length), rows = Math.ceil(count / ROW);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, (rows > 1 ? ROW : count) * 3, rows, 0, gl.RGBA, gl.FLOAT, table, 0);
        gl.activeTexture(gl.TEXTURE0);
        dirty = false;
      }
      hidden = hiddenNow;
      if (!n) { quads = 0; return 0; }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 4 * STRIDE);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
      quads = n;
      return 1;
    },
    get quads() { return quads; },
    picked,
    // Quads in the last frame with at least one occluder over them.
    get occluded() { return hidden; },
  };
}
