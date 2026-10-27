// Builds vendor/vendor.js: the parts of three.js the site uses (site/title, rides/teacups), the fat-line addons and
// gsap, minified into one ES module to self-host instead of seven jsDelivr requests. Pinned to the versions
// index.html's import map uses. Needs esbuild, three and gsap installed in --deps (npm i esbuild three@0.170.0
// gsap@3.13.0 there); nothing is installed into the repo.
//
//   node tests/perf/tools/load_vendor.mjs --deps <dir with node_modules> --out vendor/vendor.js
//
// If a layer starts using another THREE.* name, add it to NAMES (the page fails loudly: "THREE.X is not a constructor").
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import zlib from "node:zlib";

const a = process.argv.slice(2);
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const deps = resolve(opt("--deps")), out = resolve(opt("--out") ?? "vendor/vendor.js");
const NAMES = ["Vector2", "Vector3", "Vector4", "Color", "MathUtils", "Object3D", "Group", "Mesh", "Scene", "Texture",
  "WebGLRenderer", "PerspectiveCamera", "OrthographicCamera", "ShaderMaterial", "MeshBasicMaterial", "BoxGeometry",
  "CircleGeometry", "CylinderGeometry", "EdgesGeometry", "ExtrudeGeometry", "LatheGeometry", "PlaneGeometry",
  "ShapeGeometry", "SphereGeometry", "TorusGeometry", "TubeGeometry", "Shape", "Path", "QuadraticBezierCurve3",
  "RepeatWrapping", "DoubleSide", "BackSide"];
const entry = join(deps, "vendor-entry.js");
writeFileSync(entry, [
  `export { ${NAMES.join(", ")} } from "three";`,
  ...["LineSegments2", "LineSegmentsGeometry", "LineMaterial"].map((n) => `export { ${n} } from "three/examples/jsm/lines/${n}.js";`),
  `export { gsap } from "gsap";`,
].join("\n"));
mkdirSync(dirname(out), { recursive: true });
execFileSync(join(deps, "node_modules/.bin/esbuild"), [entry, "--bundle", "--format=esm", "--minify", "--target=es2020", "--legal-comments=none", `--outfile=${out}`], { cwd: deps, stdio: "inherit" });
const b = readFileSync(out);
console.log(`${out}: ${b.length} bytes, ${zlib.brotliCompressSync(b).length} brotli, ${zlib.gzipSync(b, { level: 9 }).length} gzip`);
