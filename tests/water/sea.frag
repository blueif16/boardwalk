#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform mat2 uToGround;
uniform float uScale, uHeight;
uniform float uShoreZ, uTime, uLoop, uPeriod, uWaves, uAmp, uVpx;
uniform vec3 uSea, uDeep1, uDeep2, uShallow, uSheet, uFoam, uFoamLine, uWet, uWetLine, uRipLight, uRipDark;
uniform float uWetAlpha, uU0;
uniform sampler2D uTab, uBands, uLace;
uniform vec3 uTabMap;

out vec4 outColor;

const float FA = -0.42;
const float FP = 0.36;
const float FE = 1.12;
const float B = 105.0;
const float R0 = 14.0;

float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float n2(vec2 p) { return texture(uLace, p / 32.0).r; }
float psin(float turns) { float x = fract(turns + 0.5) * 2.0 - 1.0; return 4.0 * x * (1.0 - abs(x)); }
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a, a) + dst * (1.0 - a); }
float edge(float dv) { return clamp(dv * uVpx + 0.5, 0.0, 1.0); }
float line(float dv, float w) { return clamp(w * 0.5 + 0.5 - abs(dv * uVpx), 0.0, 1.0); }
vec4 tab(float x, float row) { return texture(uTab, vec2(x, (row + 0.5) / uTabMap.z)); }

float front(float f, float a) {
  if (f < FA) return 1e4;
  if (f < 0.0) return B * f / FA;
  if (f < FP) { float s = 1.0 - f / FP; return -a * (1.0 - s * s); }
  float g = min((f - FP) / (FE - FP), 1.0);
  return -a + (a + R0) * g * g;
}

float shape(vec2 c, float f) {
  return mix(c.x, c.y, smoothstep(-0.12, 0.08, f)) * (1.0 - smoothstep(FE - 0.15, FE, f)) * smoothstep(FA, FA + 0.1, f);
}

float foamWidth(float f) {
  if (f < FA) return 0.0;
  if (f < 0.0) return 5.0 + 9.0 * smoothstep(FA, 0.0, f);
  if (f < FP) return mix(14.0, 32.0, smoothstep(0.0, 0.07, f)) - 10.0 * smoothstep(0.07, FP, f);
  return 22.0 * (1.0 - smoothstep(FP, FE, f));
}

vec4 ripple(vec2 px, vec2 cell, float density, float shallow) {
  vec2 r = vec2(0.990 * px.x + 0.122 * px.y, -0.122 * px.x + 0.990 * px.y);
  vec2 id = floor(r / cell);
  vec2 lp = r - (id + 0.5) * cell;
  float h = h21(id);
  float life = uLoop / (h < 0.33 ? 8.0 : h < 0.66 ? 9.0 : 12.0);
  float ph = uTime / life + h * 7.0;
  float m = mod(floor(ph), uLoop / life);
  float t = fract(ph);
  float h2 = h21(id * 1.31 + m * 17.17);
  if (h2 > density) return vec4(0);
  float h3 = h21(id * 0.77 + m * 5.31 + 3.0);
  float len = mix(5.0, 11.0, h3) * (1.0 - 0.45 * shallow);
  float hl = len * (0.35 + 0.65 * smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.65, 1.0, t)));
  vec2 room = cell * 0.5 - vec2(len + 4.0, 4.0);
  vec2 ctr = (vec2(fract(h3 * 3.7), fract(h2 * 7.3)) - 0.5) * 2.0 * room + vec2(4.0, -1.5) * (t - 0.5);
  vec2 q = lp - ctr;
  float x = clamp(q.x, -hl, hl);
  float bend = (fract(h3 * 5.1) - 0.5) * 2.4;
  float tilde = step(0.72, fract(h2 * 13.7));
  float y = mix(bend * x * x / (hl * hl + 1.0), 1.1 * psin(0.5 * x / max(hl, 0.5)), tilde);
  float dark = step(fract(h2 * 3.7), 0.26) * (1.0 - shallow);
  float d = length(vec2(q.x - x, q.y - y)) - mix(0.95, 0.75, dark);
  float a = clamp(0.5 - d, 0.0, 1.0) * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.88, 1.0, t));
  return vec4(mix(uRipLight, uRipDark, dark), a);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uScale;
  vec2 g = uToGround * (px - uCenter);
  float u = g.x + uU0, v = g.y - uShoreZ;
  if (v < -1.45 * uAmp - 24.0) { outColor = vec4(0); return; }
  float tx = (u - uTabMap.x) * uTabMap.y;

  bool near = v < B + 60.0;
  float k[3], f[3], A[3], F[3], G[3];
  vec2 C[3];
  float water = R0;
  vec4 col = vec4(0);

  if (near) {
    float p = uTime / uPeriod + u / 3800.0 + tab(tx, 2.0 * uWaves).x;
    float n = floor(p), fr = p - n;
    for (int j = 0; j < 3; j++) {
      k[j] = mod(n + 1.0 - float(j), uWaves);
      f[j] = fr - 1.0 + float(j);
      vec4 w = tab(tx, k[j]);
      A[j] = uAmp * w.x;
      C[j] = w.yz;
      G[j] = w.w;
      F[j] = front(f[j], A[j]) + shape(C[j], f[j]);
      water = min(water, F[j]);
    }

    float wet = 0.0, mark = 0.0, left = 0.0;
    for (int j = 2; j >= 1; j--) {
      float fp = min(f[j], FP);
      float P = front(fp, A[j]) + shape(C[j], fp);
      float age = 1.0 - smoothstep(0.9, 2.0, f[j]);
      float after = smoothstep(FP - 0.02, FP + 0.12, f[j]);
      float d = v - P;
      wet = max(wet, edge(d) * age);
      mark = max(mark, line(d - 0.6 / uVpx, 1.1) * age * after);
      float strand = after * (1.0 - smoothstep(FP + 0.2, FP + 1.1, f[j]));
      if (strand > 0.0 && d > -2.0 && d < 16.0) {
        float drift = 9.0 * smoothstep(FP, FP + 1.1, f[j]);
        float seg = tab(tx, uWaves + k[j]).x;
        float thr = 0.52 + 0.35 * (1.0 - strand);
        left = max(left, line(d - drift - 2.0 / uVpx, 1.2 + 1.0 * strand) * smoothstep(thr - 0.04, thr + 0.04, seg) * strand);
      }
    }
    col = over(col, uWet, uWetAlpha * wet);
    col = over(col, uWetLine, 0.55 * mark);
    col = over(col, uFoam, 0.9 * left);
  }

  float wcov = edge(v - water);
  if (wcov > 0.0) {
    vec4 bands = texture(uBands, vec2(tx, 0.5));
    vec3 wc = mix(uSea, uDeep1, edge(v - bands.y));
    wc = mix(wc, uDeep2, edge(v - bands.z));
    wc = mix(uShallow, wc, edge(v - bands.x));
    wc = mix(uSheet, wc, edge(v - water - bands.w));
    col = over(col, wc, wcov);
    float shallow = 1.0 - edge(v - bands.x - 12.0);
    if (v > water + bands.w + 6.0) {
      vec4 r = ripple(px, vec2(38.0, 20.0), mix(0.72, 0.3, shallow), shallow);
      col = over(col, r.rgb, r.a);
    }
  }

  if (near) {
    for (int j = 2; j >= 0; j--) {
      float d = v - F[j];
      if (d < -8.0 || d > 50.0) continue;
      float seg = G[j];
      float grow = smoothstep(FA, -0.05, f[j]);
      float th = foamWidth(f[j]) * mix(smoothstep(0.62 - 0.45 * grow, 0.8 - 0.2 * grow, seg), 0.55 + 0.9 * seg, step(0.0, f[j]));
      if (th <= 0.5) continue;
      if (f[j] < 0.0) d -= tab(tx, uWaves + k[j]).y;
      if (d < -4.0 || d > th + 2.0) continue;
      float q = clamp(d / th, 0.0, 1.0);
      float br = smoothstep(FP * 0.5, FE, f[j]) + 0.25 * (1.0 - step(0.0, f[j]));
      float nz = n2(vec2(u / 8.0 + f[j] * 1.3 + k[j] * 17.0, d / 13.0 + k[j] * 3.0));
      float base = -0.2 + br * 0.75 + (0.5 - seg) * br * 0.9;
      float thr = base + q * q * 1.15;
      float body = smoothstep(thr - 0.05, thr + 0.05, nz) * edge(d);
      float core = smoothstep(thr + 0.1, thr + 0.2, nz);
      float rim = line(d + 0.7 / uVpx, 1.3) * smoothstep(base - 0.05, base + 0.05, nz);
      col = over(col, uFoamLine, 0.85 * rim);
      col = over(col, mix(uFoamLine, uFoam, core), body);
    }
  }

  outColor = col;
}
