// Builds the deploy folder: only the files the page loads (a ship list from load_shiplist.mjs), all of them under
// one content-hashed version folder so they can be cached forever, plus index.html (always revalidated) and the
// host's header file. No bundler: the one rewrite is index.html's own root-relative paths, which get the version
// prefix; every other file loads its neighbours relative to its own URL (import.meta.url, ctx.dir), so nothing else
// changes. A new deploy with any changed file gets a new version folder; an unchanged tree keeps its hash.
//
//   node tests/perf/tools/load_dist.mjs --list ship.txt --out dist [--root .] [--host cloudflare|netlify|vercel|github]
//        [--index tests/perf/index_fast.html] [--keep N]
//
// dist/index.html, dist/v/<hash>/..., dist/_headers (cloudflare, netlify) or dist/vercel.json (vercel). GitHub Pages
// takes no headers (it sends max-age=600 on everything), so --host github only writes .nojekyll.
// --keep copies older version folders already in --out back in, so a visitor whose page is from the previous deploy
// can still lazy-load its files (rides that come on screen after a resize).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync, cpSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const root = resolve(opt("--root", ".")), out = resolve(opt("--out", "dist")), host = opt("--host", "cloudflare");
const indexSrc = opt("--index") ? resolve(opt("--index")) : join(root, "index.html"), keep = Number(opt("--keep", 1));
const files = readFileSync(opt("--list"), "utf8").split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("http")).map((l) => l.split("\t")[0])
  .filter((f) => f !== "index.html" && existsSync(join(root, f)));

// The version: a hash of every shipped file's path and bytes.
const tree = createHash("sha256");
for (const f of [...files].sort()) tree.update(f).update("\0").update(createHash("sha256").update(readFileSync(join(root, f))).digest()).update("\0");
const ver = tree.digest("hex").slice(0, 10);

// Keep the newest older versions (by mtime) from a previous build in --out.
const older = existsSync(join(out, "v")) ? readdirSync(join(out, "v")).filter((d) => d !== ver).map((d) => ({ d, t: statSync(join(out, "v", d)).mtimeMs })).sort((p, q) => q.t - p.t).slice(0, keep) : [];
const stash = join(dirname(out), `.dist-keep-${process.pid}`);
for (const { d } of older) cpSync(join(out, "v", d), join(stash, d), { recursive: true });
rmSync(out, { recursive: true, force: true });
for (const { d } of older) { cpSync(join(stash, d), join(out, "v", d), { recursive: true }); }
rmSync(stash, { recursive: true, force: true });

let bytes = 0;
for (const f of files) { const to = join(out, "v", ver, f); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(root, f), to); bytes += statSync(to).size; }

// index.html: prefix the root-relative paths of the shipped top-level folders ("./rides/…", `site/park/…`, url(site/…)).
const tops = [...new Set(files.map((f) => f.split("/")[0]).filter((t) => !t.includes(".")))];
let html = readFileSync(indexSrc, "utf8");
let n = 0;
html = html.replace(new RegExp(`(["'\`(])(\\./)?(${tops.join("|")})/`, "g"), (m, q, dot, top) => { n++; return `${q}${dot ?? ""}v/${ver}/${top}/`; });
html = html.replace(/<base href="[^"]*">\n?/, "");  // the prototype's <base> (for serving from tests/perf/) is not wanted here
writeFileSync(join(out, "index.html"), html);

const longLived = "public, max-age=31536000, immutable";
if (host === "cloudflare" || host === "netlify") {
  writeFileSync(join(out, "_headers"), `/v/*\n  Cache-Control: ${longLived}\n/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`);
} else if (host === "vercel") {
  writeFileSync(join(out, "vercel.json"), JSON.stringify({ headers: [
    { source: "/v/(.*)", headers: [{ key: "Cache-Control", value: longLived }] },
    { source: "/", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ] }, null, 2));
} else if (host === "github") writeFileSync(join(out, ".nojekyll"), "");
console.log(`dist ${out}: version ${ver}, ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB, ${n} paths prefixed in index.html, host ${host}${older.length ? `, kept ${older.map((o) => o.d).join(", ")}` : ""}`);
