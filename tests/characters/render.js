const VS = `#version 300 es
in vec2 aPos;
in vec3 aUv;
uniform vec2 uSize;
out vec3 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec3 vUv;
out vec4 color;
void main() { color = texture(uTex, vUv.xy) * vUv.z; }`;

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

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const data = new Float32Array(maxQuads * 4 * 5);
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
  const aPos = gl.getAttribLocation(prog, "aPos"), aUv = gl.getAttribLocation(prog, "aUv");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 3, gl.FLOAT, false, 20, 8);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), W, H);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const [AW, AH] = meta.size;
  const frames = {};
  for (const [name, f] of Object.entries(meta.frames)) {
    const [x, y, w, h] = f.rect, s = 1 / (f.scale ?? meta.scale);
    frames[name] = { name, u0: x / AW, v0: y / AH, u1: (x + w) / AW, v1: (y + h) / AH, w: w * s, h: h * s, ax: f.anchor[0] * s, ay: f.anchor[1] * s, at: f.at, sortY: f.sortY };
  }

  let n = 0, snap = 1, quads = 0;
  const px = (v) => Math.round(v * snap) / snap;

  function put(x0, y0, x1, y1, x2, y2, x3, y3, f, flip, alpha) {
    if (n >= maxQuads) return;
    const o = n * 20;
    const ua = flip ? f.u1 : f.u0, ub = flip ? f.u0 : f.u1;
    data[o] = x0; data[o + 1] = y0; data[o + 2] = ua; data[o + 3] = f.v0; data[o + 4] = alpha;
    data[o + 5] = x1; data[o + 6] = y1; data[o + 7] = ub; data[o + 8] = f.v0; data[o + 9] = alpha;
    data[o + 10] = x2; data[o + 11] = y2; data[o + 12] = ub; data[o + 13] = f.v1; data[o + 14] = alpha;
    data[o + 15] = x3; data[o + 16] = y3; data[o + 17] = ua; data[o + 18] = f.v1; data[o + 19] = alpha;
    n++;
  }

  return {
    gl, frames,
    resize(cssScale, dpr) {
      snap = cssScale * dpr;
      const w = Math.round(W * snap), h = Math.round(H * snap);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    },
    begin() { n = 0; },
    sprite(f, x, y, sx = 1, sy = 1, flip = false, alpha = 1) {
      const ax = flip ? f.w - f.ax : f.ax;
      const x0 = px(x - ax * sx), y0 = px(y - f.ay * sy);
      const x1 = x0 + px(f.w * sx), y1 = y0 + px(f.h * sy);
      put(x0, y0, x1, y0, x1, y1, x0, y1, f, flip, alpha);
    },
    line(f, xa, ya, xb, yb, width, alpha = 1) {
      const dx = xb - xa, dy = yb - ya, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * width * 0.5, ny = (dx / l) * width * 0.5;
      put(xa + nx, ya + ny, xb + nx, yb + ny, xb - nx, yb - ny, xa - nx, ya - ny, f, false, alpha);
    },
    end() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!n) { quads = 0; return 0; }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 20);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
      quads = n;
      return 1;
    },
    get quads() { return quads; },
  };
}
