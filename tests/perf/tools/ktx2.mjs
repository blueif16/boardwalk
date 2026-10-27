// KTX2 / Basis Universal sizes for the WebGL textures (ktx2-encoder 0.6 = basis_universal's wasm encoder).
//
//   NODE_PATH=<dir with node_modules/{sharp,ktx2-encoder}> node tests/perf/tools/ktx2.mjs out_dir file.png ...
//
// For each input: ETC1S (quality 128 and 255, mipmaps) and UASTC (level 2, RDO 1.0, zstd, mipmaps). Prints bytes
// and writes the .ktx2 files (decode them with three's KTX2Loader to look; the GPU then holds BC7/ASTC at 1 byte
// per texel, or BC1/ETC1 at 0.5 for opaque ETC1S, instead of 4 bytes RGBA).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const require = createRequire(process.env.NODE_PATH ? `${process.env.NODE_PATH}/` : import.meta.url);
const sharp = require("sharp");
const { encodeToKTX2 } = await import(join(process.env.NODE_PATH, "ktx2-encoder/dist/node/index.js"));
const [out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const modes = {
  etc1s_q128: { isUASTC: false, qualityLevel: 128, compressionLevel: 2, generateMipmap: true },
  etc1s_q255: { isUASTC: false, qualityLevel: 255, compressionLevel: 2, generateMipmap: true },
  uastc_rdo: { isUASTC: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1, needSupercompression: true, generateMipmap: true },
};
for (const f of files) {
  const png = await sharp(f).png().toBuffer();
  for (const [name, opts] of Object.entries(modes)) {
    const t0 = performance.now();
    const data = await encodeToKTX2(new Uint8Array(png), { ...opts, imageDecoder });
    const p = join(out, `${basename(f).replace(/\.\w+$/, "")}_${name}.ktx2`);
    writeFileSync(p, data);
    console.log(JSON.stringify({ file: f, mode: name, bytes: data.length, ms: Math.round(performance.now() - t0), out: p }));
  }
}
