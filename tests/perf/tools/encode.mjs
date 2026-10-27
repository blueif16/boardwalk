// Batch encoder over sharp (libvips 8.17: libwebp 1.6, libaom 3.13 through libheif, libimagequant 2.4).
//
//   NODE_PATH=<dir with node_modules/sharp> node tests/perf/tools/encode.mjs jobs.json > results.json
//
// jobs.json: [{ "src": "in.png", "out": "out.webp", "fmt": "webp" | "avif" | "png", "opts": { sharp options } }]
// webp opts: quality, alphaQuality, lossless, nearLossless, smartSubsample (= cwebp -sharp_yuv), preset, effort, exact
// avif opts: quality, lossless, effort, chromaSubsampling ("4:4:4" | "4:2:0"), bitdepth
// png opts:  palette, quality, colours, dither, effort, compressionLevel   (palette = libimagequant, like pngquant)
// Prints [{ out, bytes, ms }] in job order. Runs four encodes at a time (each is multi-threaded already).
import { createRequire } from "node:module";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(process.env.NODE_PATH ? `${process.env.NODE_PATH}/` : import.meta.url);
const sharp = require("sharp");
sharp.cache(false);
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const results = new Array(jobs.length);
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const i = next++, j = jobs[i];
    const t0 = performance.now();
    try {
      mkdirSync(dirname(j.out), { recursive: true });
      let img = sharp(j.src, { limitInputPixels: false });
      if (j.fmt === "webp") img = img.webp(j.opts);
      else if (j.fmt === "avif") img = img.avif(j.opts);
      else if (j.fmt === "png") img = img.png(j.opts);
      await img.toFile(j.out);
      results[i] = { out: j.out, bytes: statSync(j.out).size, ms: Math.round(performance.now() - t0) };
    } catch (err) {
      results[i] = { out: j.out, error: String(err) };
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.JOBS) || 4 }, worker));
process.stdout.write(JSON.stringify(results));
