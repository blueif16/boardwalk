// node rides/traffic/tools/render_cars.mjs NAME [query]   -> rides/traffic/gen/render_NAME.png + .json
// Renders rides/traffic/gen/meshy/NAME/model_urls_glb.glb with render_cars.html (headless Chrome, software GL) through
// the local server on port 15178. Extra query (e.g. "flip=1&light=0.3") is passed to the page.
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [name, extra = ""] = process.argv.slice(2);
const { chromium } = await import(join(homedir(), "3d_director/qingming/tools/node_modules/playwright-core/index.mjs"));
const exe = join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const glb = `/rides/traffic/gen/meshy/${name}/model_urls_glb.glb`;
await page.goto(`http://localhost:15178/rides/traffic/tools/render_cars.html?glb=${encodeURIComponent(glb)}&${extra}`);
await page.waitForFunction(() => window.__result, null, { timeout: 180000 });
const res = await page.evaluate(() => window.__result);
await browser.close();
const out = new URL(`../gen/render_${name}`, import.meta.url).pathname;
writeFileSync(`${out}.png`, Buffer.from(res.dataURL.split(",")[1], "base64"));
const { dataURL, ...meta } = res;
writeFileSync(`${out}.json`, JSON.stringify({ ...meta, name, query: extra }, null, 1));
console.log(`${out}.png`, JSON.stringify({ yaw0: meta.yaw0, size: meta.size, check: meta.check }));
