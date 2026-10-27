// Frame strips of a car passing painted objects, captured in the real page with a probe car (&probe=) stepped along
// the loop: rides/traffic/shots/strip_<name>.png, one row of frames per strip, at 2 screen px per park px.
//   node rides/traffic/tools/strips.mjs
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ride = new URL("..", import.meta.url).pathname;
const STRIPS = [
  { name: "wb_behind_median_palm_flag", design: "van", s: [4498, 4518, 4538, 4558, 4578, 4598, 4618], at: [2646, 850] },
  { name: "wb_behind_median_palm_tall", design: "hatchback", s: [4903, 4923, 4943, 4963, 4983, 5003, 5023], at: [2241, 840] },
  { name: "eb_in_front_of_median_palm", design: "pickup", s: [3221, 3241, 3261, 3281, 3301, 3321, 3341], at: [3105, 875] },
  { name: "eb_behind_kerb_palm", design: "beetle", s: [2048, 2068, 2088, 2108, 2128, 2148, 2168], at: [1935, 935] },
  { name: "eb_behind_kerb_palms_west", design: "van", s: [580, 600, 620, 640, 660, 680, 700], at: [470, 735] },
];
const { chromium } = await import(join(homedir(), "3d_director/qingming/tools/node_modules/playwright-core/index.mjs"));
const exe = join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 3840, height: 2560 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
for (const st of STRIPS) {
  const frames = [];
  for (const s of st.s) {
    await page.goto(`http://localhost:15178/?layers=traffic&crowd=0&probe=${s}:${st.design}`);
    await page.waitForSelector("html[data-ready]", { timeout: 60000 });
    await page.waitForTimeout(700);
    const [x, y] = st.at;
    frames.push(await page.screenshot({ clip: { x: x - 120, y: y - 85, width: 240, height: 130 } }));
  }
  // Join the frames side by side (PNG buffers -> one HTML canvas in the page, to avoid extra dependencies).
  const data = await page.evaluate(async (pngs) => {
    const ims = await Promise.all(pngs.map((b64) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = "data:image/png;base64," + b64; })));
    const c = document.createElement("canvas");
    c.width = ims.reduce((w, im) => w + im.width + 6, -6); c.height = ims[0].height;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    let x = 0; for (const im of ims) { g.drawImage(im, x, 0); x += im.width + 6; }
    return c.toDataURL("image/png").split(",")[1];
  }, frames.map((b) => b.toString("base64")));
  writeFileSync(join(ride, `shots/strip_${st.name}.png`), Buffer.from(data, "base64"));
  console.log("strip", st.name);
}
await browser.close();
