// A repeat visit: one cold load to fill the cache, then a second load in the same Chrome profile (a new browser
// process, so only the disk cache and a service worker carry over), with what the second load still fetched.
//
//   node tests/perf/tools/load_repeat.mjs <url> --device macbook --net 4g [--out warm.json] [--gap 2000]
import { measure, summary } from "./load_measure.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const a = process.argv.slice(2);
const url = a.find((x) => /^https?:/.test(x));
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const device = opt("--device", "macbook"), net = opt("--net", "4g"), gap = Number(opt("--gap", 2000));
const profile = mkdtempSync(join(tmpdir(), "perf-repeat-"));
try {
  const cold = await measure(url, { device, net, profile });
  await new Promise((d) => setTimeout(d, gap));
  const warm = await measure(url, { device, net, profile });
  const net304 = warm.requests.filter((q) => q.status === 304).length;
  const fromCache = warm.requests.filter((q) => q.cached).length;
  const onWire = warm.requests.filter((q) => !q.cached && !q.sw && q.status !== 304).length;
  const res = { url, device, net, cold: summary(cold), warm: { ...summary(warm), revalidated304: net304, fromCache, fetched: onWire, wireBytes: warm.bytes } };
  console.log(JSON.stringify(res));
  if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify({ ...res, warmRequests: warm.requests }, null, 1));
} finally { rmSync(profile, { recursive: true, force: true }); }
