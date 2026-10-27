// A stand-in for the base's night grade (tests/night-park owns the real one), so the lights can be judged over it.
// mode "field" (default): the look agent's relight fields (tests/night-park/gen/fields: out = in x A + B as a
// multiply canvas m = A / (1 - B) and a screen canvas s = B over everything the page draws), blended by hour with
// the bakeoff's hour weights; the piece round the slice uses its own fields, the rest of the park the park field.
// mode "grade": one flat multiply from base/time.js's tint and exposure. mode "model": our lights-off plate of the
// slice (gen/reg/off_v1_0_reg.png) laid over the painting, live layers dimmed by a filter.
import { weights } from "../night/layer.js";

const loadImage = (url) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error(url)); im.src = url; });
function pixels(im) { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; }

export async function mountBase({ slot, under, look, mode = "field", dir }) {
  const F = new URL("../night-park/gen/fields/", dir);
  const canvases = [];
  function overlay(rect, w, h, blend, parent = slot) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.style.cssText = `position:absolute;left:${rect[0]}px;top:${rect[1]}px;width:${rect[2]}px;height:${rect[3]}px;mix-blend-mode:${blend};pointer-events:none`;
    parent.append(c);
    canvases.push(c);
    return c;
  }
  if (mode === "model") {
    const im = new Image();
    im.src = new URL("gen/reg/off_v1_0_reg.png", dir).href;
    im.style.cssText = "position:absolute;left:1700px;top:650px;width:1500px;height:1000px";
    under.append(im);
    return { set() {}, liveFilter: "brightness(0.55) saturate(0.85)" };
  }
  if (mode === "grade") {
    const c = overlay([0, 0, 3840, 2560], 1, 1, "multiply");
    return { set(h) { const L = look(h); const g = c.getContext("2d"); const t = [1, 3, 5].map((i) => parseInt(L.tint.slice(i, i + 2), 16)); const e = L.exposure; g.fillStyle = `rgb(${t.map((v) => Math.round(255 - (255 - v) * (1 - e) / 0.38 * 0.75)).join(",")})`; g.fillRect(0, 0, 1, 1); } };
  }
  // Relight fields.
  const load = async (name) => { const meta = await fetch(new URL(`${name}.json`, F)).then((r) => r.json()); const [A, B] = await Promise.all([loadImage(new URL(`${name}_A.png`, F).href), loadImage(new URL(`${name}_B.png`, F).href)]); return { meta, A: pixels(A), B: pixels(B), w: A.width, h: A.height }; };
  const pick = async (...names) => { for (const n of names) { try { return await load(n); } catch {} } return null; };
  const park = await pick("night_park");
  const piece = { golden: await pick("piece_golden"), dusk: await pick("piece_dusk"), night: await pick("piece_night_h", "piece_night"), dawn: await pick("piece_dawn") };
  const layers = [];
  if (park) layers.push({ f: { night: park }, rect: park.meta.rect, w: park.w, h: park.h, hole: piece.night?.meta.rect });
  if (piece.night) layers.push({ f: piece, rect: piece.night.meta.rect, w: piece.night.w, h: piece.night.h });
  if (!layers.length) return mountBase({ slot, under, look, mode: "grade", dir });
  for (const L of layers) { L.m = overlay(L.rect, L.w, L.h, "multiply"); L.s = overlay(L.rect, L.w, L.h, "screen"); }
  return {
    set(hour) {
      const wt = weights(hour);
      for (const L of layers) {
        const N = L.w * L.h, mi = new ImageData(L.w, L.h), si = new ImageData(L.w, L.h);
        // Without its own dusk/golden/dawn field (the park layer) a key falls back to the night field at part weight.
        const keys = ["golden", "dusk", "night", "dawn"].map((k) => [L.f[k] ?? L.f.night, L.f[k] ? wt[k] : wt[k] * (k === "golden" ? 0.25 : 0.7)]);
        const wday = Math.max(0, 1 - keys.reduce((s, [, w]) => s + w, 0));
        for (let i = 0; i < N; i++) {
          const px = i % L.w, py = (i / L.w) | 0;
          const inHole = L.hole && (() => { const X = L.rect[0] + (px + 0.5) * L.rect[2] / L.w, Y = L.rect[1] + (py + 0.5) * L.rect[3] / L.h; const [hx, hy, hw, hh] = L.hole; return X > hx + 4 && X < hx + hw - 4 && Y > hy + 4 && Y < hy + hh - 4; })();
          for (let k = 0; k < 3; k++) {
            let A = wday, B = 0;
            for (const [f, w] of keys) { if (!w) continue; A += w * f.A[i * 4 + k] / 255; B += w * f.B[i * 4 + k] / 255; }
            if (inHole) { A = 1; B = 0; }
            mi.data[i * 4 + k] = Math.round(Math.min(1, A / Math.max(0.02, 1 - B)) * 255);
            si.data[i * 4 + k] = Math.round(B * 255);
          }
          mi.data[i * 4 + 3] = si.data[i * 4 + 3] = 255;
        }
        L.m.getContext("2d").putImageData(mi, 0, 0);
        L.s.getContext("2d").putImageData(si, 0, 0);
      }
    },
    fields: layers.length,
  };
}
