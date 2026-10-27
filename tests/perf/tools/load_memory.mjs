// Decoded image memory of a load_measure.mjs run: every image it fetched, at its pixel size x 4 bytes (RGBA), read
// from the file headers (PNG, WebP, AVIF/JPEG not needed here), plus the page's canvas backing stores.
//
//   node tests/perf/tools/load_memory.mjs --root <served folder> run.json [run.json ...]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
    if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  return null;
}

export function memoryOf(run, root) {
  const seen = new Set(), images = [];
  for (const q of run.requests) {
    const path = q.url.split("?")[0];
    if (!/\.(png|webp)$/.test(path) || seen.has(path) || !path.startsWith("/")) continue;
    seen.add(path);
    const f = join(root, decodeURIComponent(path));
    if (!existsSync(f)) continue;
    const s = imageSize(readFileSync(f));
    if (s) images.push({ path, w: s[0], h: s[1], mb: (s[0] * s[1] * 4) / 2 ** 20 });
  }
  const canvasMB = run.page.canvases.reduce((s, c) => s + c.w * c.h * 4, 0) / 2 ** 20;
  return { imagesMB: +images.reduce((s, i) => s + i.mb, 0).toFixed(1), canvasMB: +canvasMB.toFixed(1), images: images.sort((p, q) => q.mb - p.mb) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const root = a[a.indexOf("--root") + 1];
  for (const f of a.filter((x) => x.endsWith(".json"))) {
    const run = JSON.parse(readFileSync(f, "utf8"));
    const m = memoryOf(run, root);
    console.log(`${f.split("/").pop()}: decoded images ${m.imagesMB} MB (${m.images.length}), canvases ${m.canvasMB} MB; largest: ${m.images.slice(0, 6).map((i) => `${i.path.split("/").slice(-2).join("/")} ${i.w}x${i.h} ${i.mb.toFixed(1)}MB`).join(", ")}`);
  }
}
