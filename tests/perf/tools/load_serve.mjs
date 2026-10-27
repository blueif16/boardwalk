// A static server for load tests: serves a folder the way a real host would (HTTP/2 over TLS, brotli or gzip for
// text, long-lived caching) or the way the dev server does (HTTP/1.1, no compression, no-cache), so the same page can
// be measured both ways.
//
//   node tests/perf/tools/load_serve.mjs --root <dir> --port 18443 [--h2 --cert c.pem --key k.pem] [--compress]
//        [--cache nocache|immutable|revalidate] [--map /url=file ...] [--log file]
//
// --cache nocache     Cache-Control: no-cache on everything (tools/serve.py)
// --cache immutable   max-age=31536000, immutable on everything but HTML (HTML: no-cache), as a hashed-name deploy
// --cache revalidate  max-age=0, must-revalidate with ETags (GitHub Pages-like: max-age=600 is used with --cache gh)
// --map /index.html=tests/perf/index_fast.html serves that file at that URL (repeatable)
// --encodings gzip    only gzip (GitHub Pages); default br,gzip
import http from "node:http";
import http2 from "node:http2";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { readFileSync, statSync, existsSync, appendFileSync } from "node:fs";
import { resolve, join, extname, normalize } from "node:path";

const args = process.argv.slice(2);
const opt = { port: 18080, cache: "nocache", map: {}, encodings: ["br", "gzip"] };
for (let i = 0; i < args.length; i++) {
  const a = args[i], next = () => args[++i];
  if (a === "--root") opt.root = resolve(next());
  else if (a === "--port") opt.port = Number(next());
  else if (a === "--h2") opt.h2 = true;
  else if (a === "--cert") opt.cert = next();
  else if (a === "--key") opt.key = next();
  else if (a === "--compress") opt.compress = true;
  else if (a === "--cache") opt.cache = next();
  else if (a === "--map") { const [u, f] = next().split("="); opt.map[u] = resolve(f); }
  else if (a === "--log") opt.log = next();
  else if (a === "--encodings") opt.encodings = next().split(",");
}
if (!opt.root) { console.error("--root is required"); process.exit(1); }

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".avif": "image/avif", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".txt": "text/plain", ".wasm": "application/wasm",
  ".ktx2": "image/ktx2", ".bin": "application/octet-stream", ".webmanifest": "application/manifest+json",
};
const TEXT = new Set([".html", ".js", ".mjs", ".json", ".css", ".svg", ".txt", ".webmanifest"]);
const cache = new Map(); // path -> { mtime, body, etag, br, gz }

function load(file) {
  const st = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const body = readFileSync(file);
  const entry = { mtime: st.mtimeMs, body, etag: `"${crypto.createHash("sha1").update(body).digest("hex").slice(0, 16)}"` };
  cache.set(file, entry);
  return entry;
}
const brOf = (e) => (e.br ??= zlib.brotliCompressSync(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length } }));
const gzOf = (e) => (e.gz ??= zlib.gzipSync(e.body, { level: 9 }));

function cacheControl(ext) {
  if (opt.cache === "nocache") return "no-cache";
  if (opt.cache === "immutable") return ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  if (opt.cache === "gh") return "max-age=600";
  return "public, max-age=0, must-revalidate";
}

function handle(req, res) {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  let file = opt.map[path] ?? join(opt.root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!opt.map[path] && !file.startsWith(opt.root)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    if (opt.log) appendFileSync(opt.log, `404 ${path}\n`);
    return;
  }
  const ext = extname(file).toLowerCase();
  const e = load(file);
  const headers = { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": cacheControl(ext), etag: e.etag, vary: "accept-encoding" };
  if (req.headers["if-none-match"] === e.etag) { res.writeHead(304, headers); res.end(); return; }
  let body = e.body;
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (opt.compress && TEXT.has(ext)) {
    if (opt.encodings.includes("br") && /\bbr\b/.test(accept)) { body = brOf(e); headers["content-encoding"] = "br"; }
    else if (opt.encodings.includes("gzip") && /\bgzip\b/.test(accept)) { body = gzOf(e); headers["content-encoding"] = "gzip"; }
  }
  headers["content-length"] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
  if (opt.log) appendFileSync(opt.log, `200 ${path} ${body.length}\n`);
}

const server = opt.h2
  ? http2.createSecureServer({ cert: readFileSync(opt.cert), key: readFileSync(opt.key), allowHTTP1: true }, handle)
  : http.createServer({ keepAlive: true }, handle);
server.listen(opt.port, "127.0.0.1", () => console.log(`${opt.h2 ? "https (h2)" : "http/1.1"} on ${opt.port}: ${opt.root} compress=${!!opt.compress} cache=${opt.cache}`));
