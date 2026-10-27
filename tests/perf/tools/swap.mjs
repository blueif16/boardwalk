// The page as shipped next to the page with candidate files swapped in, screenshot for screenshot, on any screen.
// Nothing in the repo changes: Chrome's Fetch domain answers the swapped URLs with the candidate's bytes (an AVIF
// served under a .webp URL decodes fine; browsers sniff image bytes).
//
//   node tests/perf/tools/swap.mjs --map map.json --out DIR [--screens 1920x1080@1,...] [--query "t=100"]
//
// map.json: { "rides/wheel/plate.webp": "/abs/path/candidate.avif", ... }. For each screen writes DIR/<screen>_now.png
// and DIR/<screen>_new.png (the viewport, device px) and DIR/<screen>.json with the bytes fetched both ways.
// The clock is frozen (&t=) so rides and the crowd stand still at the same moment in both; the title over the sea is
// hidden because it animates in on its own clock.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const base = opt("--url", "http://localhost:15178/");
const query = opt("--query", "t=100");
const map = JSON.parse(readFileSync(opt("--map"), "utf8"));
const out = opt("--out");
const screens = opt("--screens", "1920x1080@1,2560x1440@1,1512x982@2,2560x1440@1.5").split(",").map((s) => {
  const [, w, h, d] = s.match(/(\d+)x(\d+)@([\d.]+)/);
  return { width: +w, height: +h, dpr: +d, name: s };
});
const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const MIME = { ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".json": "application/json" };
mkdirSync(out, { recursive: true });

async function shot(screen, swap) {
  const profile = mkdtempSync(join(tmpdir(), "perf-swap-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--hide-scrollbars", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"]);
  const port = await new Promise((done, fail) => {
    let text = "";
    proc.stderr.on("data", (c) => { text += c; const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) done(+m[1]); });
    setTimeout(() => fail(new Error("chrome did not start")), 20000);
  });
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((d) => (ws.onopen = d));
  let id = 0;
  const pending = new Map();
  const bytes = new Map();
  const send = (method, params = {}) => new Promise((done) => { const c = ++id; pending.set(c, done); ws.send(JSON.stringify({ id: c, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Fetch.requestPaused") {
      const path = new URL(d.params.request.url).pathname.slice(1);
      const file = swap ? map[path] : null;
      if (file) {
        const body = readFileSync(file);
        bytes.set(path, body.length);
        send("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, body: body.toString("base64"),
          responseHeaders: [{ name: "Content-Type", value: MIME[extname(file)] ?? "application/octet-stream" }, { name: "Cache-Control", value: "no-cache" }] });
      } else send("Fetch.continueRequest", { requestId: d.params.requestId });
    }
  };
  const urls = new Map();
  const orig = ws.onmessage;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Network.requestWillBeSent") urls.set(d.params.requestId, new URL(d.params.request.url).pathname.slice(1) || "index.html");
    if (d.method === "Network.loadingFinished" && urls.has(d.params.requestId)) {
      const p = urls.get(d.params.requestId);
      if (!(swap && map[p])) bytes.set(p, (bytes.get(p) ?? 0) + d.params.encodedDataLength);
    }
    return orig(m);
  };
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*localhost*" }] });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".title{display:none!important}"; document.head.append(s); });` });
  await send("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: screen.dpr, mobile: false });
  await send("Page.navigate", { url: `${base}?${query}` });
  await evaluate(`new Promise((done)=>{const t0=Date.now();(function poll(){if(document.documentElement.dataset.ready||Date.now()-t0>300000)done();else setTimeout(poll,200)})()})`);
  const ready = await evaluate(`!!document.documentElement.dataset.ready`);
  if (!ready) console.error(`${screen.name} ${swap ? "new" : "now"}: page never set data-ready`);
  await new Promise((d) => setTimeout(d, 4000));
  const png = await send("Page.captureScreenshot", { format: "png" });
  const file = join(out, `${screen.name.replace(/[@]/g, "_")}_${swap ? "new" : "now"}.png`);
  writeFileSync(file, Buffer.from(png.result.data, "base64"));
  ws.close();
  proc.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
  return { file, bytes: Object.fromEntries(bytes) };
}

for (const s of screens) {
  const now = await shot(s, false);
  const neu = await shot(s, true);
  const total = (b) => Object.values(b).reduce((a, v) => a + v, 0);
  writeFileSync(join(out, `${s.name.replace(/[@]/g, "_")}.json`), JSON.stringify({ screen: s, now: now.bytes, new: neu.bytes }, null, 1));
  console.log(`${s.name}: now ${(total(now.bytes) / 1e6).toFixed(2)} MB, swapped ${(total(neu.bytes) / 1e6).toFixed(2)} MB -> ${now.file}, ${neu.file}`);
}
