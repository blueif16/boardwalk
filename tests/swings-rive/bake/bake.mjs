import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromePort } from "../../../scripts/chrome-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const query = process.argv[2] || "";
const outDir = process.argv[3] || join(here, "..", "rive");

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = join(homedir(), ".cache/ms-playwright");
  const found = existsSync(pw) && readdirSync(pw).sort().reverse().map((d) => join(pw, d, "chrome-linux64/chrome")).find(existsSync);
  return found || "/usr/bin/google-chrome";
}

const profile = mkdtempSync(join(tmpdir(), "swings-bake-"));
const proc = spawn(chrome(), ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"]);
const port = await chromePort(proc, profile);
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
socket.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === "Runtime.exceptionThrown") console.error("exception", d.params.exceptionDetails.exception?.description);
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") console.error("console", d.params.args.map((a) => a.value ?? a.description).join(" "));
};
await new Promise((r) => (socket.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); socket.send(JSON.stringify({ id: n, method, params })); });
const value = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

try {
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://localhost:15178/tests/swings-rive/bake/bake.html${query}` });
  const t0 = Date.now();
  while (!(await value("!!window.__bake"))) {
    if (Date.now() - t0 > 300000) throw new Error("bake timed out");
    await new Promise((r) => setTimeout(r, 500));
  }
  const meta = await value("window.__bake.meta");
  for (const name of ["chairs", "canopy", "tower"]) {
    const url = await value(`window.__bake.out.${name}`);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    const png = join(outDir, `${name}.png`), webp = join(outDir, `${name}.webp`);
    writeFileSync(png, bytes);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", webp]);
    rmSync(png);
    meta[name].pngBytes = bytes.length;
    meta[name].bytes = statSync(webp).size;
  }
  writeFileSync(join(outDir, "atlas.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`baked in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(meta));
  proc.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.error("bake failed:", err.message);
  proc.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
  process.exit(1);
}
