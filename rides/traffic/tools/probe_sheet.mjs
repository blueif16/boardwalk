// Captures every crossing in rides/traffic/gen/crossings.json in the real page (probe cars, &probe=), at 1 park px per
// screen px, and tiles a crop around each into rides/traffic/shots/crossings.png.
//   node rides/traffic/tools/probe_sheet.mjs [design]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const design = process.argv[2] || "van";
const ride = new URL("..", import.meta.url).pathname;
const cross = JSON.parse(readFileSync(join(ride, "gen/crossings.json")));
const { chromium } = await import(join(homedir(), "3d_director/qingming/tools/node_modules/playwright-core/index.mjs"));
const exe = join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 3840, height: 2560 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
// Batches of crossings far enough apart that their probe cars don't touch.
const batches = [];
for (const c of cross) {
  const b = batches.find((bb) => bb.every((o) => Math.abs(o[4][0] - c[4][0]) > 260 || Math.abs(o[4][1] - c[4][1]) > 170));
  if (b) b.push(c); else batches.push([c]);
}
const tiles = [];
mkdirSync(join(ride, "gen/probe"), { recursive: true });
for (const [k, b] of batches.entries()) {
  const probe = b.map((c) => `${c[0]}:${design}`).join(",");
  await page.goto(`http://localhost:15178/?layers=traffic&crowd=0&probe=${probe}`);
  await page.waitForSelector("html[data-ready]", { timeout: 60000 });
  await page.waitForTimeout(1200);
  for (const c of b) {
    const [x, y] = c[4];
    const clip = { x: Math.max(0, x - 130), y: Math.max(0, y - 100), width: 260, height: 150 };
    const file = join(ride, `gen/probe/c${String(tiles.length).padStart(3, "0")}.png`);
    await page.screenshot({ path: file, clip });
    tiles.push({ file, c });
  }
  console.log(`batch ${k + 1}/${batches.length}: ${b.length} crossings`);
}
await browser.close();
writeFileSync(join(ride, "gen/probe/index.json"), JSON.stringify(tiles.map((t) => ({ file: t.file, s: t.c[0], piece: t.c[1], kind: t.c[2], sortY: t.c[3], at: t.c[4] }))));
console.log(`${tiles.length} tiles`);
