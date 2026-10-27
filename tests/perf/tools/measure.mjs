// What a fresh load of the site fetches and decodes, per screen type.
//
//   node tests/perf/tools/measure.mjs [url] [--screens 1920x1080@1,2560x1440@1,1512x982@2,2560x1440@1.5,1920x1080@2]
//        [--wait 6000] [--out tests/perf/shots/measure.json]
//
// Headless Chrome with a fresh profile and the cache off; every response's bytes on the wire (encodedDataLength),
// every image the page decodes (natural size, from a hook on HTMLImageElement), every canvas backing store and every
// WebGL texture upload (texImage2D / texSubImage2D / texStorage2D). Prints a table per screen and writes JSON.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const url = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:15178/";
const screens = opt("--screens", "1920x1080@1,2560x1440@1,1512x982@2,2560x1440@1.5,1920x1080@2").split(",").map((s) => {
  const [, w, h, d] = s.match(/(\d+)x(\d+)@([\d.]+)/);
  return { width: +w, height: +h, dpr: +d, name: s };
});
const wait = +opt("--wait", 6000);
const out = resolve(opt("--out", "tests/perf/shots/measure.json"));
const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

// Runs in the page before anything else: records decoded images, canvases and GL textures.
const HOOK = `(() => {
  const seen = (window.__perf = { images: [], gl: [] });
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    set(v) {
      const img = this;
      img.addEventListener("load", () => seen.images.push({ url: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight }), { once: true });
      desc.set.call(this, v);
    },
    get() { return desc.get.call(this); },
  });
  const wrap = (proto) => {
    if (!proto) return;
    for (const fn of ["texImage2D", "texSubImage2D", "texStorage2D", "compressedTexImage2D"]) {
      const orig = proto[fn];
      if (!orig) continue;
      proto[fn] = function (...a) {
        let w = 0, h = 0, src = "";
        if (fn === "texStorage2D") { w = a[3]; h = a[4]; }
        else if (a.length >= 9 || fn === "compressedTexImage2D") { w = a[3]; h = a[4]; if (fn === "texSubImage2D") { w = a[4]; h = a[5]; } }
        else { const s = a[a.length - 1]; w = s?.naturalWidth || s?.videoWidth || s?.width || 0; h = s?.naturalHeight || s?.videoHeight || s?.height || 0; src = s?.currentSrc || s?.src || (s?.constructor?.name ?? ""); }
        seen.gl.push({ fn, level: a[1], w, h, src: String(src).slice(-80) });
        return orig.apply(this, a);
      };
    }
  };
  wrap(window.WebGLRenderingContext?.prototype);
  wrap(window.WebGL2RenderingContext?.prototype);
})();`;

async function run(screen) {
  const profile = mkdtempSync(join(tmpdir(), "perf-measure-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"]);
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
  const reqs = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    const p = d.params;
    if (d.method === "Network.requestWillBeSent") reqs.set(p.requestId, { url: p.request.url, t0: p.timestamp });
    else if (d.method === "Network.responseReceived") Object.assign(reqs.get(p.requestId) ?? {}, { status: p.response.status, mime: p.response.mimeType });
    else if (d.method === "Network.loadingFinished") Object.assign(reqs.get(p.requestId) ?? {}, { bytes: p.encodedDataLength, t1: p.timestamp });
  };
  const send = (method, params = {}) => new Promise((done) => { const c = ++id; pending.set(c, done); ws.send(JSON.stringify({ id: c, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await send("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: screen.dpr, mobile: false });
  await send("Page.navigate", { url });
  await evaluate(`new Promise((done)=>{const t0=Date.now();(function poll(){if(document.documentElement.dataset.ready||Date.now()-t0>60000)done();else setTimeout(poll,200)})()})`);
  await new Promise((d) => setTimeout(d, wait));
  const page = await evaluate(`(() => ({
    images: window.__perf.images, gl: window.__perf.gl,
    canvases: [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height, parent: c.parentElement?.dataset?.slot || c.parentElement?.id || c.id || c.parentElement?.className })),
    painting: document.getElementById("painting")?.currentSrc,
    dpr: devicePixelRatio, inner: [innerWidth, innerHeight],
  }))()`);
  ws.close();
  proc.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
  const files = [...reqs.values()].filter((r) => r.bytes != null).map((r) => ({ url: r.url, status: r.status, mime: r.mime, bytes: r.bytes }));
  return { screen, files, ...page };
}

const results = [];
for (const s of screens) {
  const r = await run(s);
  results.push(r);
  const local = r.files.filter((f) => !/jsdelivr|unpkg|cdnjs/.test(f.url));
  const cdn = r.files.filter((f) => /jsdelivr|unpkg|cdnjs/.test(f.url));
  const sum = (a) => a.reduce((s, f) => s + f.bytes, 0);
  const decoded = r.images.reduce((s, i) => s + i.w * i.h * 4, 0);
  const canv = r.canvases.reduce((s, c) => s + c.w * c.h * 4, 0);
  console.log(`\n== ${s.name}  painting ${r.painting?.split("/").pop()}  ${local.length} local files ${(sum(local) / 1e6).toFixed(2)} MB + cdn ${cdn.length} files ${(sum(cdn) / 1e6).toFixed(2)} MB`);
  console.log(`   decoded images ${(decoded / 1e6).toFixed(1)} MB (${r.images.length})  canvases ${(canv / 1e6).toFixed(1)} MB (${r.canvases.length})  gl uploads ${r.gl.length}`);
  for (const f of local.sort((a, b) => b.bytes - a.bytes).slice(0, 12)) console.log(`   ${(f.bytes / 1e3).toFixed(0).padStart(6)} kB  ${f.url.replace(/^https?:\/\/[^/]+\//, "")}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`\nwrote ${out}`);
