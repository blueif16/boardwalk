// One cold load of a page in headless Chrome under emulated network and device, with the numbers that matter for the
// boardwalk's first visit: when the painting is on screen, when the title plays, when each ride and the crowd are
// alive, bytes and requests, main-thread long tasks, canvas memory and process RSS.
//
//   node tests/perf/tools/load_measure.mjs <url> --device macbook|qhd|4k|phone --net 4g|cable|none [--cpu 4]
//        [--out run.json] [--profile dir (reuse for a warm repeat visit)] [--film dir] [--timeout 150000]
//        [--rafFps 2 (throttle requestAnimationFrame: stands in for a real GPU under headless software WebGL)]
//
// The page reports its own milestones with performance.mark: "alive:<ride>" when a ride's mount() resolves,
// "alive:crowd" when the crowd is mounted, "alive:all" after the last layer (load_instrument.mjs adds these to a copy
// of index.html). The title ("title": .title gets data-shown) and the ready flag ("ready") are watched from outside,
// as are LCP, first contentful paint and long tasks. Times are ms from navigation start.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

export const DEVICES = {
  macbook: { width: 1512, height: 982, scale: 2 },
  qhd: { width: 2560, height: 1440, scale: 1 },
  "4k": { width: 3840, height: 2160, scale: 1 },
  phone: { width: 390, height: 844, scale: 3, mobile: true },
};
// Chrome DevTools throttling: latency is added to every request (not to DNS/TCP/TLS setup), throughput is shared.
export const NETS = {
  "4g": { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 },
  cable: { latency: 30, downloadThroughput: 50e6 / 8, uploadThroughput: 10e6 / 8 },
  none: null,
};

const EARLY = `(() => {
  const T = window.__perf = { lcp: [], long: [], paints: [], seen: {}, imgs: [] };
  try { performance.setResourceTimingBufferSize(2000); } catch {}
  const obs = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  obs("largest-contentful-paint", (e) => T.lcp.push({ t: e.renderTime || e.loadTime, load: e.loadTime, size: e.size, url: e.url, id: e.id }));
  obs("longtask", (e) => T.long.push({ t: e.startTime, d: e.duration }));
  obs("paint", (e) => T.paints.push({ name: e.name, t: e.startTime }));
  obs("element", (e) => T.paints.push({ name: "element:" + e.identifier, t: e.renderTime || e.loadTime, url: e.url }));
  const once = (k) => { if (!T.seen[k]) { T.seen[k] = performance.now(); performance.mark(k); } };
  // Element Timing on the painting, the preview and the placeholder, added as they are parsed (pages need no edits).
  const tag = (el) => { if (el.nodeType !== 1 || el.hasAttribute("elementtiming")) return; const k = el.id === "painting" ? "painting" : el.id === "preview" ? "preview" : el.classList?.contains("lqip") ? "lqip" : null; if (k) el.setAttribute("elementtiming", k); };
  new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) tag(n); }).observe(document, { childList: true, subtree: true });
  new MutationObserver(() => {
    if (document.querySelector(".title[data-shown]")) once("title");
    if (document.documentElement.dataset.ready) once("ready");
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-shown", "data-ready"] });
  document.addEventListener("load", (e) => {
    const el = e.target;
    if (el && el.tagName === "IMG") {
      T.imgs.push({ t: Math.round(performance.now()), src: (el.currentSrc || el.src).split("/").slice(-2).join("/"), id: el.id, w: el.naturalWidth, h: el.naturalHeight });
      if (el.id === "painting") once("painting-load:" + (el.currentSrc || el.src).split("/").pop());
    }
  }, true);
})();`;

const COLLECT = `(() => {
  const T = window.__perf;
  const marks = Object.fromEntries(performance.getEntriesByType("mark").map((m) => [m.name, Math.round(m.startTime)]));
  const nav = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource").map((r) => ({ url: r.name, type: r.initiatorType, start: Math.round(r.startTime), ttfb: Math.round(r.responseStart), end: Math.round(r.responseEnd), transfer: r.transferSize, body: r.encodedBodySize, decoded: r.decodedBodySize, proto: r.nextHopProtocol }));
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height, cls: c.id || c.parentElement?.dataset?.slot || c.parentElement?.className || "" }));
  const domImgs = [...document.images].map((i) => ({ src: (i.currentSrc || i.src).split("/").slice(-2).join("/"), w: i.naturalWidth, h: i.naturalHeight }));
  return { marks, nav: nav && { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) },
    lcp: T.lcp, long: T.long, paints: T.paints, imgs: T.imgs, res, canvases, domImgs,
    heap: performance.memory?.usedJSHeapSize, dpr: devicePixelRatio, inner: [innerWidth, innerHeight] };
})()`;

function chromeBinary() {
  for (const p of [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]) if (p && existsSync(p)) return p;
  throw new Error("no Chrome");
}

function processMemory(rootPid) {
  // RSS (KB) of Chrome's renderer and GPU processes; software WebGL keeps its textures in the GPU process.
  try {
    const out = execSync("ps -eo pid=,ppid=,rss=,args=", { encoding: "utf8", maxBuffer: 1 << 24 });
    const procs = out.trim().split("\n").map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] }; }).filter(Boolean);
    const kids = new Set([rootPid]);
    for (let grew = true; grew;) { grew = false; for (const p of procs) if (kids.has(p.ppid) && !kids.has(p.pid)) { kids.add(p.pid); grew = true; } }
    const mine = procs.filter((p) => kids.has(p.pid));
    const sum = (re) => mine.filter((p) => re.test(p.args)).reduce((s, p) => s + p.rss, 0);
    return { renderer: sum(/--type=renderer/), gpu: sum(/--type=gpu-process/), total: mine.reduce((s, p) => s + p.rss, 0) };
  } catch { return null; }
}

export async function measure(url, { device = "macbook", net = "4g", cpu = 1, out, profile, film, trace, extra, rafFps, timeout = 150000, settle = 3000, until = "alive:all" } = {}) {
  const dev = DEVICES[device], cond = NETS[net];
  const own = !profile;
  const dir = profile ?? mkdtempSync(join(tmpdir(), "perf-"));
  const chrome = spawn(chromeBinary(), [
    "--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--ignore-certificate-errors", "--disable-background-networking", "--disable-component-update", "about:blank",
  ]);
  const port = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not start")), 20000);
    chrome.stderr.on("data", (c) => { text += c; const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) { clearTimeout(timer); done(+m[1]); } });
  });
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((d) => (ws.onopen = d));
  let id = 0;
  const pending = new Map(), reqs = new Map(), frames = [], errors = [], traceEvents = [];
  let traceDone = null;
  const send = (method, params = {}, wait = 60000) => new Promise((done, fail) => {
    const call = ++id;
    const timer = setTimeout(() => { pending.delete(call); fail(new Error(`${method} timed out`)); }, wait);
    pending.set(call, (d) => { clearTimeout(timer); d.error ? fail(new Error(`${method}: ${d.error.message}`)) : done(d.result); });
    ws.send(JSON.stringify({ id: call, method, params }));
  });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    const p = d.params;
    if (d.method === "Network.requestWillBeSent") { if (!reqs.has(p.requestId)) reqs.set(p.requestId, { url: p.request.url, t0: p.timestamp, wall: p.wallTime, type: p.type, prio: p.request.initialPriority }); }
    else if (d.method === "Network.responseReceived") { const r = reqs.get(p.requestId); if (r) { const h = Object.fromEntries(Object.entries(p.response.headers).map(([k, v]) => [k.toLowerCase(), v])); Object.assign(r, { status: p.response.status, proto: p.response.protocol, cached: !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache), sw: !!p.response.fromServiceWorker, enc: h["content-encoding"] }); } }
    else if (d.method === "Network.loadingFinished") { const r = reqs.get(p.requestId); if (r) { r.bytes = p.encodedDataLength; r.t1 = p.timestamp; } }
    else if (d.method === "Network.loadingFailed") { const r = reqs.get(p.requestId); if (r) { r.failed = p.errorText; r.t1 = p.timestamp; } }
    else if (d.method === "Network.resourceChangedPriority") { const r = reqs.get(p.requestId); if (r) r.prio2 = p.newPriority; }
    else if (d.method === "Runtime.exceptionThrown") errors.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").slice(0, 300));
    else if (d.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    else if (d.method === "Tracing.dataCollected") traceEvents.push(...p.value);
    else if (d.method === "Tracing.tracingComplete") traceDone?.();
    else if (d.method === "Page.screencastFrame") { frames.push({ ts: p.metadata.timestamp, data: p.data }); send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {}); }
  };
  const evaluate = async (expression, wait) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, wait)).result?.value;
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Network.enable", {});
    if (cond) await send("Network.emulateNetworkConditions", { offline: false, ...cond });
    if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await send("Emulation.setDeviceMetricsOverride", { width: dev.width, height: dev.height, deviceScaleFactor: dev.scale, mobile: !!dev.mobile });
    if (dev.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: EARLY });
    // --rafFps N: requestAnimationFrame callbacks at most N times a second, for every page alike. Headless WebGL is
    // software (~120 ms a frame); this stands in for a real GPU's cheap frames when a page animates while it loads.
    if (rafFps) await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const raf = window.requestAnimationFrame.bind(window), every = ${1000 / Number(rafFps)}; window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), every); })();` });
    if (trace) await send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing", "loading", "toplevel"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
    if (film) await send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 640, maxHeight: 420, everyNthFrame: 1 });
    await send("Page.navigate", { url });
    const reached = await evaluate(`new Promise((done) => { const t0 = Date.now(); (function poll() { if (performance.getEntriesByName(${JSON.stringify(until)}, "mark").length) done(true); else if (Date.now() - t0 > ${timeout}) done(false); else setTimeout(poll, 50); })(); })`, timeout + 30000).catch(() => false);
    await new Promise((d) => setTimeout(d, settle));
    const page = await evaluate(COLLECT);
    if (extra) page.extra = await evaluate(extra);
    const mem = processMemory(chrome.pid);
    if (film) await send("Page.stopScreencast").catch(() => {});
    let mainThread = null;
    if (trace) {
      const done = new Promise((d) => (traceDone = d));
      await send("Tracing.end");
      await done;
      writeFileSync(trace, JSON.stringify({ traceEvents }));
      mainThread = mainThreadBreakdown(traceEvents, page.marks["alive:all"]);
    }
    const origin = new URL(url).origin;
    const list = [...reqs.values()].filter((r) => !r.url.startsWith("data:"));
    const navT0 = list[0]?.t0 ?? 0;
    const requests = list.map((r) => ({ url: r.url.startsWith(origin) ? r.url.slice(origin.length) : r.url, status: r.status, bytes: r.bytes ?? 0, proto: r.proto, enc: r.enc, prio: r.prio2 ?? r.prio, start: Math.round((r.t0 - navT0) * 1000), end: r.t1 ? Math.round((r.t1 - navT0) * 1000) : null, cached: r.cached, sw: r.sw, failed: r.failed }));
    const bytes = requests.reduce((s, r) => s + r.bytes, 0);
    const result = { url, device, net, cpu, reached, page, requests, bytes, count: requests.length, mem, errors, mainThread };
    if (film) {
      mkdirSync(film, { recursive: true });
      result.film = frames.map((f, i) => { const t = Math.round((f.ts - (list[0]?.wall ?? f.ts)) * 1000); const file = join(film, `f${String(i).padStart(3, "0")}_${t}.jpg`); writeFileSync(file, Buffer.from(f.data, "base64")); return { t, file }; });
    }
    if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 1)); }
    return result;
  } finally {
    ws.close();
    chrome.kill("SIGKILL");
    await new Promise((d) => setTimeout(d, 400));
    if (own) try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Main-thread self time by kind, from the trace, between navigation start and `untilMs` (+ 1 s for the first frames):
// image decode (synchronous decodes for canvas drawImage / texImage2D), script, style/layout/paint, GC, and "commit"
// (waiting on the compositor: inflated by headless software GL, not a real-GPU number). Off-main-thread decode is
// reported apart.
export function mainThreadBreakdown(events, untilMs) {
  const meta = events.filter((e) => e.ph === "M" && e.name === "thread_name");
  const mains = new Set(meta.filter((e) => e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const nav = events.filter((e) => e.name === "navigationStart" && /^http/.test(e.args?.data?.documentLoaderURL ?? "")).at(-1);
  if (!mains.size || !nav) return null;
  const t0 = nav.ts, t1 = untilMs != null ? t0 + (untilMs + 1000) * 1000 : Infinity;
  const kind = (n) => /Decode|ImageDecode/.test(n) ? "decode" : /^Commit$|ProxyMain|WaitForCommit/.test(n) ? "commit"
    : /GC|Gc/.test(n) ? "gc" : /Layout|UpdateLayoutTree|RecalcStyle|Paint|PrePaint|Layerize|UpdateLayer|HitTest|ScrollLayer/.test(n) ? "render"
    : /EvaluateScript|FunctionCall|TimerFire|FireAnimationFrame|EventDispatch|v8|V8|RunMicrotasks|Compile|ParseHTML|Microtask|evaluateModule|XHR|Script/.test(n) ? "script" : "other";
  const out = { decode: 0, script: 0, render: 0, gc: 0, commit: 0, other: 0, offMainDecode: 0, longestDecode: 0 };
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || e.ts < t0 || e.ts > t1) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!mains.has(k)) { if (/ImageDecodeTask/.test(e.name)) out.offMainDecode += e.dur / 1000; continue; }
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  for (const list of byThread.values()) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    const close = (e) => { out[e.k] += e.self / 1000; };
    for (const e of list) {
      while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) close(stack.pop());
      const node = { ts: e.ts, dur: e.dur, self: e.dur, k: /RunTask|OnHandleReady|ThreadController|Receive mojo/.test(e.name) ? "other" : kind(e.name) };
      if (stack.length) stack.at(-1).self -= e.dur;
      if (node.k === "decode" && !stack.some((s) => s.k === "decode")) out.longestDecode = Math.max(out.longestDecode, e.dur / 1000);
      stack.push(node);
    }
    while (stack.length) close(stack.pop());
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

// The milestones of one run, flat (ms from navigation start).
export function summary(r) {
  const m = r.page.marks;
  // The painting is not an LCP candidate (Chrome skips full-viewport images): use its element timing.
  const lcpPaint = r.page.paints.filter((p) => p.name === "element:painting").at(-1)?.t ?? r.page.lcp.filter((e) => /world_/.test(e.url ?? "")).at(-1)?.t ?? null;
  const firstPaint = r.page.paints.filter((p) => p.name.startsWith("element:")).reduce((a, p) => Math.min(a, p.t), Infinity);
  const el = (id) => { const e = r.page.paints.find((p) => p.name === `element:${id}`); return e ? Math.round(e.t) : null; };
  const fcp = r.page.paints.find((p) => p.name === "first-contentful-paint")?.t ?? null;
  const rides = Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith("alive:") && k !== "alive:all").map(([k, v]) => [k.slice(6), v]));
  const long = r.page.long;
  return {
    fcp: fcp && Math.round(fcp), first: Number.isFinite(firstPaint) ? Math.round(firstPaint) : null, painting: lcpPaint && Math.round(lcpPaint),
    lqip: el("lqip"), preview: el("preview"), title: m.title ?? null, ready: m.ready ?? null,
    rides, all: m["alive:all"] ?? null, bytes: r.bytes, requests: r.count,
    longTasks: long.length, longMs: Math.round(long.reduce((s, t) => s + t.d, 0)), maxLong: Math.round(Math.max(0, ...long.map((t) => t.d))),
    tbt: Math.round(long.reduce((s, t) => s + Math.max(0, t.d - 50), 0)),
    canvasMB: +(r.page.canvases.reduce((s, c) => s + c.w * c.h * 4, 0) / 2 ** 20).toFixed(1),
    rssMB: r.mem ? Math.round((r.mem.renderer + r.mem.gpu) / 1024) : null, heapMB: r.page.heap ? Math.round(r.page.heap / 2 ** 20) : null, errors: r.errors.length,
    ...(r.mainThread ? { main: r.mainThread } : {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), o = {};
  let url;
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : true; } else url = a[i];
  }
  for (const k of ["cpu", "timeout", "settle"]) if (o[k]) o[k] = Number(o[k]);
  const r = await measure(url, o);
  console.log(JSON.stringify(summary(r)));
  if (r.errors.length) console.log("errors:", r.errors.slice(0, 6));
}
