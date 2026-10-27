// Runs load_measure.mjs over devices x networks, N cold loads each, and writes the medians.
//
//   node tests/perf/tools/load_matrix.mjs --label base_dev --url http://localhost:18080/index_base.html
//        [--devices macbook,qhd,4k,phone] [--nets 4g,cable] [--runs 3] [--cpu-phone 1] [--raw <dir>] [--out <json>]
//
// Each run is a fresh Chrome profile (cold cache) with a trace for the main-thread breakdown. The JSON per run goes to
// --raw (bulky; keep it in a scratch folder), the medians to --out.
import { measure, summary } from "./load_measure.mjs";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { join } from "node:path";

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const label = opt("--label", "run"), url = opt("--url");
const devices = opt("--devices", "macbook,qhd,4k,phone").split(","), nets = opt("--nets", "4g,cable").split(",");
const runs = Number(opt("--runs", 3)), cpuPhone = Number(opt("--cpu-phone", 1));
const raw = opt("--raw", null), out = opt("--out", null);
const query = opt("--query", "");  // appended to the URL, e.g. "?loopfps=2"
// Other work on the machine (encoders, other sessions' browsers and builds) skews timings. Before each run: wait (up
// to 15 min) for the 1-minute load average to drop under --max-load (default: the core count). During the run the
// load is sampled every 2 s; a run during which it went over 1.5 x --max-load is thrown away and redone (twice at most).
const maxLoad = Number(opt("--max-load", cpus().length));
async function quiet() { const t0 = Date.now(); while (loadavg()[0] > maxLoad && Date.now() - t0 < 900000) await new Promise((d) => setTimeout(d, 5000)); return +loadavg()[0].toFixed(1); }
async function measured(url, o) {
  for (let attempt = 0; ; attempt++) {
    const load = await quiet();
    let peak = load;
    const timer = setInterval(() => { peak = Math.max(peak, loadavg()[0]); }, 2000);
    const r = await measure(url, o).finally(() => clearInterval(timer));
    r.load = load; r.peakLoad = +peak.toFixed(1);
    if (peak <= maxLoad * 1.5 || attempt >= 2) return r;
    console.log(`  redo: load peaked at ${r.peakLoad} during the run`);
  }
}

const median = (xs) => { const v = xs.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const flat = (s) => { const f = { ...s, ...Object.fromEntries(Object.entries(s.rides).map(([k, v]) => [`alive_${k}`, v])) }; delete f.rides; if (s.main) { for (const [k, v] of Object.entries(s.main)) f[`main_${k}`] = v; delete f.main; } return f; };

const results = {};
for (const net of nets) for (const device of devices) {
  const key = `${device}/${net}`, list = [];
  for (let i = 0; i < runs; i++) {
    const tracePath = raw ? join(raw, `${label}_${device}_${net}_${i}.trace.json`) : null;
    if (raw) mkdirSync(raw, { recursive: true });
    const rawPath = raw ? join(raw, `${label}_${device}_${net}_${i}.json`) : null;
    let r;
    if (rawPath && existsSync(rawPath) && a.includes("--resume")) r = JSON.parse(readFileSync(rawPath, "utf8"));
    else {
      r = await measured(url + query, { device, net, cpu: device === "phone" ? cpuPhone : 1, trace: tracePath });
      if (rawPath) writeFileSync(rawPath, JSON.stringify(r));
    }
    if (tracePath && i > 0) rmSync(tracePath, { force: true });
    const s = flat(summary(r));
    s.reached = r.reached;
    s.load = r.load ?? null;
    list.push(s);
    console.log(`${label} ${key} #${i}: painting ${s.painting} title ${s.title} all ${s.all} bytes ${(s.bytes / 1e6).toFixed(2)}MB reqs ${s.requests} decode ${s.main_decode} tbt ${s.tbt}${r.reached ? "" : " (timeout)"} load ${r.load}/${r.peakLoad}${s.errors ? ` errors ${s.errors}` : ""}`);
  }
  const keys = [...new Set(list.flatMap((s) => Object.keys(s)))];
  results[key] = Object.fromEntries(keys.map((k) => [k, typeof list[0][k] === "boolean" ? list.every((s) => s[k]) : median(list.map((s) => s[k]))]));
  results[key].runs = list.map((s) => ({ painting: s.painting, title: s.title, all: s.all }));
  if (out) writeFileSync(out, JSON.stringify({ label, url, runs, cpuPhone, results }, null, 1));
}
if (out) writeFileSync(out, JSON.stringify({ label, url, runs, cpuPhone, results }, null, 1));
console.log(JSON.stringify(results, null, 1).slice(0, 3000));
