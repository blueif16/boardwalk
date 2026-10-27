// Page shots at real window sizes: rides/traffic/shots/page_<w>x<h>@<dpr>.png (whole park, traffic layer only and
// with everything), frozen at t.  node rides/traffic/tools/shots.mjs [t]
import { homedir } from "node:os";
import { join } from "node:path";

const t = process.argv[2] || "36";
const ride = new URL("..", import.meta.url).pathname;
const { chromium } = await import(join(homedir(), "3d_director/qingming/tools/node_modules/playwright-core/index.mjs"));
const exe = join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [w, h, dpr, q] of [[1512, 982, 2, "layers=traffic&crowd=0"], [2560, 1440, 1, "layers=traffic&crowd=0"], [2560, 1440, 1, ""]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`http://localhost:15178/?${q}&t=${t}`);
  await page.waitForSelector("html[data-ready]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  const name = `page_${w}x${h}@${dpr}${q ? "" : "_all"}.png`;
  await page.screenshot({ path: join(ride, "shots", name) });
  console.log(name);
  await page.close();
}
await browser.close();
