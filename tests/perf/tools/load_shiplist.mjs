// The files the site ships: every same-origin request a load of the page makes on each screen type (a crawl in
// headless Chrome), plus every width of the painting (index.html steps up on resize) and any extra files named with
// --also. Writes the list and, with --copy, copies those files (and nothing else) into a deploy folder.
//
//   node tests/perf/tools/load_shiplist.mjs http://localhost:15178/ [--list ship.txt] [--copy <dir>] [--also a,b]
//        [--root <served folder>] [--prefix /v/  (check a deploy folder: report requests outside it)]
//
// The crawl loads the default page only: URL-parameter variants (?sea=a, ?layers=...) that fetch other files are
// listed by a static scan of the loaded JS as "referenced, not loaded", for a decision, not copied.
import { measure } from "./load_measure.mjs";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const a = process.argv.slice(2);
const url = a.find((x) => /^https?:/.test(x)) ?? "http://localhost:15178/";
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const root = resolve(opt("--root") ?? join(dirname(new URL(import.meta.url).pathname), "../../.."));
const listOut = opt("--list"), copyTo = opt("--copy");
const also = (opt("--also") ?? "").split(",").filter(Boolean);
const prefix = opt("--prefix");   // a deploy folder check: report same-origin requests outside it (e.g. /v/)

const files = new Set(), cdn = new Set();
for (const device of ["qhd", "macbook", "4k", "phone"]) {
  const r = await measure(url, { device, net: "none", settle: 1500 });
  if (!r.reached) console.error(`warning: ${device} did not reach alive:all`);
  for (const q of r.requests) {
    if (q.failed || (q.status && q.status >= 400)) { console.error(`failed: ${q.url} ${q.status ?? q.failed}`); continue; }
    if (prefix && q.url.startsWith("/") && !q.url.startsWith(prefix) && !/^\/(\?|index\.html|$)/.test(q.url)) console.error(`outside ${prefix}: ${q.url}`);
    if (q.url.startsWith("/")) files.add(decodeURIComponent(q.url.split("?")[0]).replace(/^\//, "") || "index.html");
    else cdn.add(q.url);
  }
}
// index.html picks one painting width per screen and steps up on resize: ship them all.
if (existsSync(join(root, "site/park"))) for (const f of readdirSync(join(root, "site/park"))) if (/^world_\d+\.(webp|avif|jpg)$/.test(f)) files.add(`site/park/${f}`);
for (const f of also) files.add(f);
files.add("index.html");
files.delete("index_base.html");

// Static scan: asset names in the shipped JS that the crawl never requested.
const referenced = new Set();
for (const f of files) {
  if (!f.endsWith(".js")) continue;
  const src = readFileSync(join(root, f), "utf8");
  for (const m of src.matchAll(/["'`]([\w./-]+\.(?:webp|png|json|jpg|avif|woff2|js))["'`]/g)) {
    const p = join(dirname(f), m[1]).replace(/\\/g, "/");
    if (existsSync(join(root, p)) && !files.has(p)) referenced.add(p);
  }
}

const sorted = [...files].sort();
const size = (f) => (existsSync(join(root, f)) ? statSync(join(root, f)).size : 0);
const total = sorted.reduce((s, f) => s + size(f), 0);
const lines = [`# ${sorted.length} files, ${(total / 1e6).toFixed(2)} MB (crawl of ${url} at qhd, macbook, 4k, phone)`, ...sorted.map((f) => `${f}\t${size(f)}`)];
lines.push("", "# third-party (CDN) requests", ...[...cdn].sort());
lines.push("", "# referenced by the shipped JS but not requested by the default page (parameter variants; not shipped)", ...[...referenced].sort());
if (listOut) writeFileSync(listOut, lines.join("\n") + "\n");
else console.log(lines.join("\n"));
if (copyTo) {
  for (const f of sorted) { const to = join(copyTo, f); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(root, f), to); }
  console.log(`copied ${sorted.length} files (${(total / 1e6).toFixed(2)} MB) to ${copyTo}`);
}
