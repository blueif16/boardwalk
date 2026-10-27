// Tables for LOADING.md from the raw runs: medians per label x device x network, recomputed with the current
// summary() and the decoded-memory estimate.
//
//   node tests/perf/tools/load_report.mjs --raw <dir> [--raw <dir> ...] --root <served folder> [--labels a,b] [--cols ...]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { summary } from "./load_measure.mjs";
import { memoryOf } from "./load_memory.mjs";

const a = process.argv.slice(2);
const all = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : []));
const root = all("--root")[0];
const labels = all("--labels")[0]?.split(",");
const median = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

const groups = new Map();
for (const dir of all("--raw")) for (const f of readdirSync(dir)) {
  const m = f.match(/^(.+)_(macbook|qhd|4k|phone)_(4g|cable|none)_(\d+)\.json$/);
  if (!m) continue;
  const [, label, device, net] = m;
  if (labels && !labels.includes(label)) continue;
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const s = summary(r);
  const mem = root ? memoryOf(r, root) : {};
  const row = { ...s, ...Object.fromEntries(Object.entries(s.rides).map(([k, v]) => [`r_${k}`, v])), imagesMB: mem.imagesMB, decode: r.mainThread?.decode, script: r.mainThread?.script, offDecode: r.mainThread?.offMainDecode, load: r.load };
  const k = `${label}|${device}|${net}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(row);
}
const out = [];
for (const [k, rows] of groups) {
  const [label, device, net] = k.split("|");
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((x) => x !== "rides");
  out.push({ label, device, net, n: rows.length, ...Object.fromEntries(keys.map((x) => [x, median(rows.map((r) => r[x]))])) });
}
const order = { macbook: 0, qhd: 1, "4k": 2, phone: 3 };
out.sort((p, q) => p.net.localeCompare(q.net) || (labels ? labels.indexOf(p.label) - labels.indexOf(q.label) : p.label.localeCompare(q.label)) || order[p.device] - order[q.device]);
const s1 = (v) => (v == null ? "–" : (v / 1000).toFixed(1));
const cols = all("--cols")[0]?.split(",") ?? ["label", "device", "net", "first", "painting", "title", "firstRide", "all", "MB", "reqs", "decode", "tbt", "imagesMB", "canvasMB"];
console.log(`| ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}|`);
for (const r of out) {
  const rideTimes = Object.entries(r).filter(([k]) => k.startsWith("r_") && k !== "r_crowd").map(([, v]) => v);
  const cell = { ...r, first: s1(r.first ?? r.fcp), painting: s1(r.painting), title: s1(r.title), all: s1(r.all), firstRide: s1(rideTimes.length ? Math.min(...rideTimes) : null),
    crowd: s1(r.r_crowd), MB: (r.bytes / 1e6).toFixed(2), reqs: r.requests, lqip: s1(r.lqip), preview: s1(r.preview) };
  for (const k of Object.keys(r)) if (k.startsWith("r_") && cell[k] === r[k]) cell[k] = s1(r[k]);
  console.log(`| ${cols.map((c) => cell[c] ?? "–").join(" | ")} |`);
}
