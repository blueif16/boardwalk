export function createBench({ seconds = 10, onDone } = {}) {
  const frames = [];
  let last = 0, startAt = 0, done = null;
  const stats = { draws: {} };

  function tick(now) {
    if (done) return;
    if (!startAt) { startAt = last = now; return; }
    frames.push(now - last);
    last = now;
    if (now - startAt >= seconds * 1000) finish();
  }

  function finish() {
    const sorted = [...frames].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const bytes = performance.getEntriesByType("resource").reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
    done = {
      seconds,
      frames: frames.length,
      fps: +(frames.length / seconds).toFixed(1),
      p50ms: +pick(0.5).toFixed(2),
      p95ms: +pick(0.95).toFixed(2),
      maxms: +pick(1).toFixed(2),
      longFrames: frames.filter((f) => f > 33.4).length,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      downloadMB: +(bytes / 1048576).toFixed(2),
      draws: { ...stats.draws },
      renderer: rendererName(),
    };
    window.__bench = done;
    onDone?.(done);
  }

  return {
    tick,
    report(layer, n) { stats.draws[layer] = n; },
    get result() { return done; },
  };
}

function rendererName() {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? "webgl (renderer hidden)" : "no webgl";
  } catch {
    return "unknown";
  }
}
