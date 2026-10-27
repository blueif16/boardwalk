// Decode time of image files in Chrome: fetch each file once, then createImageBitmap(blob) 7 times, median ms.
// Software-only headless Chrome on this machine; compare formats against each other, not against a phone.
//
//   node tests/perf/tools/decode.mjs DIR file1 file2 ...     (files relative to DIR; serves DIR on 127.0.0.1:15199)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

const [dir, ...files] = process.argv.slice(2);
const MIME = { ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".html": "text/html" };
const page = `<!doctype html><script>
window.run = async (files) => {
  const out = [];
  for (const f of files) {
    const blob = await (await fetch(f)).blob();
    const t = [];
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); const b = await createImageBitmap(blob); t.push(performance.now() - t0); b.close(); }
    t.sort((a, b) => a - b);
    out.push({ file: f, bytes: blob.size, ms: +t[3].toFixed(1) });
  }
  return out;
};
</script>`;
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/bench.html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page); return; }
  try { const b = readFileSync(join(dir, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(15199, "127.0.0.1");

const profile = mkdtempSync(join(tmpdir(), "perf-decode-"));
const proc = spawn(process.env.CHROME_PATH ?? "/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"]);
const port = await new Promise((done) => { let t = ""; proc.stderr.on("data", (c) => { t += c; const m = t.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) done(+m[1]); }); });
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((d) => (ws.onopen = d));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((done) => { const c = ++id; pending.set(c, done); ws.send(JSON.stringify({ id: c, method, params })); });
await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:15199/bench.html" });
await new Promise((d) => setTimeout(d, 1500));
const r = await send("Runtime.evaluate", { expression: `run(${JSON.stringify(files.map((f) => "/" + f))})`, awaitPromise: true, returnByValue: true });
for (const x of r.result.result.value) console.log(`${String(x.ms).padStart(8)} ms ${String(x.bytes).padStart(9)} B  ${x.file}`);
ws.close(); proc.kill("SIGKILL"); server.close(); rmSync(profile, { recursive: true, force: true });
