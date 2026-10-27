// The crowd's depth order against everything that stands in front of it (DEPTH.md, rides/RIDERS.md "Depth").
//
// Sources are what ride layers return as `occluders` from mount(ctx) (and the crowd's own painted cut-outs): an
// array, or a function of clock time t returning one, of
//   { rect: [x, y, w, h], sortY, mask?, matrix?, sortLine?, crop? }
// rect is park px (or the matrix's local units); sortY is the y of the thing's base in park px; mask is an image,
// canvas or URL whose alpha covers rect (none: the whole rect); matrix [a, b, c, d, e, f] places rect like a canvas
// transform (park = a x + c y + e, b x + d y + f) for things that turn or swing; sortLine [xa, ya, xb, yb] is a sloped
// base for long or slanted things (read at the animal's x, flat past its ends); crop [sx, sy, sw, sh] picks the mask
// from a sheet. An animal whose feet are above (less than) the base is hidden where the mask is opaque.
//
// Masks are packed once into one R8 texture (at most MAX_DENSITY px per park px), the first time they are seen; a
// function that returns the same mask objects every frame costs only a small table upload per frame. A mask seen for
// the first time later is packed then (one re-upload), and skipped until it is.
const MAX_DENSITY = 1.5; // mask px per park px (the crowd draws at 1.5 device px per park px)
const SHEET_W = 2048;   // the mask texture's width
const GAP = 2;          // px between packed masks, so linear filtering never reads a neighbour
const SOLID = "solid";  // the mask of a rect without one

const loadImage = (url) => new Promise((done, fail) => { const im = new Image(); im.onload = () => done(im); im.onerror = fail; im.src = url; });
const sizeOf = (m) => [m.naturalWidth || m.videoWidth || m.width, m.naturalHeight || m.videoHeight || m.height];

// sources: each an array, a function of t, or { name, occluders } (either, named for checks).
export async function createOcclusion(sources, { Y0 = 0, H = 2560, onMasks = () => {} } = {}) {
  const statics = [], dynamics = [];
  sources.forEach((s, i) => {
    const name = s?.name ?? `source${i}`, list = s && !Array.isArray(s) && typeof s !== "function" ? s.occluders : s;
    if (!list) return;
    if (typeof list === "function") dynamics.push({ fn: list, name });
    else statics.push(...list.map((o) => ({ ...o, from: name })));
  });
  // Masks by source (image, canvas or URL) and crop; each gets a place in the sheet.
  const images = new Map(), entries = new Map();
  const keyOf = (o) => (o.mask ? o.mask : SOLID);
  const cropKey = (o) => (o.crop ? o.crop.join(",") : "");
  const entryOf = (o) => entries.get(keyOf(o))?.get(cropKey(o));
  let sheet = { w: 8, h: 8 }, packing = null, packs = 0;

  async function imageOf(mask) {
    if (typeof mask !== "string") {
      if (mask.decode && !mask.complete) await mask.decode().catch(() => {});
      return mask;
    }
    if (!images.has(mask)) images.set(mask, loadImage(new URL(mask, location.href).href));
    return images.get(mask);
  }

  // Wanted size of a mask in the sheet: its own pixels, at most MAX_DENSITY per park px of its rect on screen.
  function want(o, img) {
    const m = o.matrix || [1, 0, 0, 1, 0, 0];
    const pw = o.rect[2] * Math.hypot(m[0], m[1]), ph = o.rect[3] * Math.hypot(m[2], m[3]);
    const [iw, ih] = o.crop ? [o.crop[2], o.crop[3]] : sizeOf(img);
    return [Math.max(1, Math.round(Math.min(iw, pw * MAX_DENSITY))), Math.max(1, Math.round(Math.min(ih, ph * MAX_DENSITY)))];
  }

  // (Re)pack every mask seen so far plus `more`, and upload the sheet through onMasks(bytes, w, h).
  let packMs = 0;
  async function pack(more) {
    const list = [];
    for (const crops of entries.values()) for (const e of crops.values()) list.push(e);
    for (const o of more) {
      if (!o.mask) continue;
      const crops = entries.get(o.mask) || new Map();
      if (crops.has(cropKey(o))) continue;
      const img = await imageOf(o.mask).catch((err) => { console.error("occluder mask failed", o.mask, err); return null; });
      const e = { img, crop: o.crop, size: img ? want(o, img) : [1, 1] };
      crops.set(cropKey(o), e);
      entries.set(o.mask, crops);
      list.push(e);
    }
    // Shelf packing, tallest first; the solid block first of all.
    const solid = { solid: true, size: [8, 8] };
    entries.set(SOLID, new Map([["", solid]]));
    const order = [solid, ...list.filter((e) => !e.solid).sort((a, b) => b.size[1] - a.size[1])];
    let x = 0, y = 0, row = 0;
    for (const e of order) {
      let [w, h] = e.size;
      if (w > SHEET_W) { h = Math.max(1, Math.round((h * SHEET_W) / w)); w = SHEET_W; e.size = [w, h]; }
      if (x + w > SHEET_W) { x = 0; y += row + GAP; row = 0; }
      e.at = [x, y];
      x += w + GAP;
      row = Math.max(row, h);
    }
    const SW = SHEET_W, SH = Math.max(8, y + row), tPack = performance.now();
    const c = document.createElement("canvas");
    c.width = SW; c.height = SH;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 8, 8);
    for (const e of order) {
      if (e.solid || !e.img) continue;
      const [ax, ay] = e.at, [w, h] = e.size;
      if (e.crop) g.drawImage(e.img, e.crop[0], e.crop[1], e.crop[2], e.crop[3], ax, ay, w, h);
      else g.drawImage(e.img, ax, ay, w, h);
    }
    // One readback at pack time (never per frame): the alpha channel becomes the R8 sheet.
    const rgba = g.getImageData(0, 0, SW, SH).data, bytes = new Uint8Array(SW * SH);
    for (let i = 0, j = 3; i < bytes.length; i++, j += 4) bytes[i] = rgba[j];
    for (const e of order) {
      // The solid block: sample its middle only, so the rect is covered edge to edge.
      const [ax, ay] = e.solid ? [2, 2] : e.at, [w, h] = e.solid ? [4, 4] : e.size;
      e.uv = [ax / SW, ay / SH, (ax + w) / SW, (ay + h) / SH];
    }
    sheet = { w: SW, h: SH };
    packs++;
    onMasks(bytes, SW, SH);
    packMs = performance.now() - tPack;
    for (const o of staticItems) o.item = null;
  }

  // An occluder -> the renderer's item, in canvas px (park y - Y0).
  function itemOf(o) {
    const e = entryOf(o);
    if (!e?.uv) return null;
    const [rx, ry, rw, rh] = o.rect;
    const [a, b, c, d, e0, f] = o.matrix || [1, 0, 0, 1, 0, 0];
    const det = a * d - b * c;
    if (!det || !rw || !rh) return null;
    // Bounding box of the placed rect.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lx, ly] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
      const X = a * lx + c * ly + e0, Y = b * lx + d * ly + f - Y0;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    if (y1 < 0 || y0 > H) return null;
    // canvas (x, y) -> local: the inverse matrix applied to (x, y + Y0); local -> sheet uv.
    const su = (e.uv[2] - e.uv[0]) / rw, sv = (e.uv[3] - e.uv[1]) / rh;
    const lxc = (-d * e0 - c * (Y0 - f)) / det, lyc = (b * e0 + a * (Y0 - f)) / det;
    const m = [su * d / det, sv * -b / det, su * -c / det, sv * a / det, su * (lxc - rx) + e.uv[0], sv * (lyc - ry) + e.uv[1]];
    const l = o.sortLine;
    return { box: [x0, y0, x1, y1], m, uv: e.uv, sortY: o.sortY - Y0, line: l ? [l[0], l[1] - Y0, l[2], l[3] - Y0] : null, from: o.from };
  }

  // A still occluder only needs its rows inside the crowd's band (an animal's head can't reach above it): clip
  // its rect, and its mask's crop with it, before packing.
  for (let i = 0; i < statics.length; i++) {
    const o = statics[i];
    if (o.matrix) continue;
    const [rx, ry, rw, rh] = o.rect, top = Math.max(ry, Y0), bot = Math.min(ry + rh, Y0 + H);
    if (bot <= top) { statics.splice(i--, 1); continue; }
    if (top === ry && bot === ry + rh) continue;
    if (o.mask) {
      const img = await imageOf(o.mask).catch(() => null);
      if (!img) continue;
      const [sx, sy, sw, sh] = o.crop || [0, 0, ...sizeOf(img)];
      const k = sh / rh;
      statics[i] = { ...o, rect: [rx, top, rw, bot - top], crop: [sx, sy + (top - ry) * k, sw, (bot - top) * k] };
    } else statics[i] = { ...o, rect: [rx, top, rw, bot - top] };
  }
  const staticItems = statics.map((o) => ({ o, item: null }));
  await pack([...statics, ...dynamics.flatMap(({ fn }) => { try { return fn(0) || []; } catch { return []; } })]);

  let last = [];
  return {
    // This frame's items for the renderer.
    at(t) {
      const out = [];
      for (const s of staticItems) {
        if (s.item === null) s.item = itemOf(s.o) || false;
        if (s.item) out.push(s.item);
      }
      let missing = null;
      for (const { fn, name } of dynamics) {
        let list;
        try { list = fn(t) || []; } catch (err) { console.error(`occluders of ${name} failed`, err); continue; }
        for (const o of list) {
          if (o.mask && !entryOf(o)) { (missing ||= []).push(o); continue; }
          const it = itemOf(o);
          if (it) { it.from = name; out.push(it); }
        }
      }
      if (missing && !packing) packing = pack(missing).finally(() => { packing = null; });
      last = out;
      return out;
    },
    stats: () => ({ occluders: last.length, sheet: `${sheet.w}x${sheet.h}`, packs, packMs: Math.round(packMs) }),
    entries, itemOf,
  };
}
