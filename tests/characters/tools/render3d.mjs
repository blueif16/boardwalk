import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [glb, name, lit = "1"] = process.argv.slice(2);
if (!glb || !name) {
  console.log("node render3d.mjs <glb url path under the server> <name> [lit 1|0]   -> gen/sprites_<name>.png/.json");
  process.exit(1);
}
const { chromium } = await import(join(homedir(), "3d_director/qingming/tools/node_modules/playwright-core/index.mjs"));
const exe = join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const url = `http://localhost:15178/tests/characters/tools/render3d.html?glb=${encodeURIComponent(glb)}&lit=${lit}`;
await page.goto(url);
await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
const res = await page.evaluate(() => window.__result);
await browser.close();
const out = new URL(`../gen/sprites_${name}`, import.meta.url).pathname;
writeFileSync(`${out}.png`, Buffer.from(res.dataURL.split(",")[1], "base64"));
const { dataURL, ...meta } = res;
writeFileSync(`${out}.json`, JSON.stringify({ ...meta, image: `sprites_${name}.png`, look: name, targetPx: 30, outline: true }));
console.log(`gen/sprites_${name}.png: ${Object.keys(meta.frames).length} frames, clip ${meta.clip} ${meta.duration.toFixed(2)} s`);
