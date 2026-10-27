// Makes a copy of index.html that reports its milestones for load_measure.mjs, without changing what it loads:
// performance.mark("alive:<ride>") after each ride's mount resolves, "alive:crowd" after the crowd mounts and
// "alive:all" after the last layer. Fails if index.html's ride loop no longer has the lines it hooks.
//
//   node tests/perf/tools/load_instrument.mjs index.html <out.html>
import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
let html = readFileSync(src, "utf8");
const hooks = [
  [/rides\.push\(layer\);/, (s) => `${s} performance.mark("alive:" + name);`],
  [/crowd\.resize\(scale\);\n\}/, (s) => s.replace("crowd.resize(scale);", `crowd.resize(scale); performance.mark("alive:crowd");`)],
  [/\nconst panel = document\.getElementById\("panel"\);/, (s) => `\nperformance.mark("alive:all");${s}`],
  [/<img id="painting"/, (s) => `${s} elementtiming="painting"`],
];
for (const [re, fn] of hooks) {
  const n = (html.match(new RegExp(re.source, "g")) || []).length;
  if (n !== 1) { console.error(`instrument: expected one match of ${re}, found ${n}`); process.exit(1); }
  html = html.replace(re, fn);
}
writeFileSync(out, html);
console.log(`instrumented ${src} -> ${out}`);
