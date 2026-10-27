// A waterfall chart (SVG) of one load_measure.mjs run: one bar per request from start to end, coloured by what it
// belongs to, with the page's milestones as vertical lines.
//
//   node tests/perf/tools/load_waterfall.mjs run.json out.svg [--title "..."] [--max 20000]
import { readFileSync, writeFileSync } from "node:fs";

const [inp, outp, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const r = JSON.parse(readFileSync(inp, "utf8"));
const title = opt("--title", `${r.url.replace(/^https?:\/\/[^/]+/, "")} · ${r.device} · ${r.net}`);
const reqs = r.requests.filter((q) => q.end != null).sort((a, b) => a.start - b.start);
const marks = r.page.marks;
const paint = r.page.paints.filter((p) => p.name === "element:painting").at(-1)?.t;
const maxT = Number(opt("--max", Math.ceil((Math.max(...reqs.map((q) => q.end), marks["alive:all"] ?? 0) + 1200) / 1000) * 1000));

const GROUPS = [
  [/site\/park\//, "painting", "#d9822b"],
  [/site\/title|vendor\/|cdn\.jsdelivr/, "title + three/gsap", "#7a5cc4"],
  [/tests\/park-crowd|tests\/characters/, "crowd (atlas, walk)", "#3d8f5a"],
  [/rides\//, "rides", "#3a7fc1"],
  [/./, "page", "#8a7f78"],
];
const groupOf = (u) => GROUPS.find(([re]) => re.test(u));
const W = 1100, L = 230, rowH = 6, top = 46, H = top + reqs.length * rowH + 40;
const x = (t) => L + (Math.min(t, maxT) / maxT) * (W - L - 20);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const short = (u) => u.replace("https://cdn.jsdelivr.net/npm/", "cdn:").replace(/\?.*$/, "").slice(-44);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`;
svg += `<rect width="100%" height="100%" fill="#fffdf9"/><text x="10" y="18" font-size="13" font-weight="600" fill="#362223">${esc(title)}</text>`;
svg += `<text x="10" y="34" font-size="11" fill="#5d4a47">${(r.bytes / 1e6).toFixed(2)} MB in ${r.count} requests</text>`;
let lx = 260;
for (const [, name, color] of GROUPS) { svg += `<rect x="${lx}" y="26" width="10" height="10" fill="${color}"/><text x="${lx + 14}" y="35" font-size="11" fill="#5d4a47">${name}</text>`; lx += 24 + name.length * 6.2; }
for (let t = 0; t <= maxT; t += 1000) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 30}" stroke="#eee6dc"/><text x="${x(t)}" y="${H - 16}" font-size="10" text-anchor="middle" fill="#8a7f78">${t / 1000}s</text>`;
reqs.forEach((q, i) => {
  const [, , color] = groupOf(q.url);
  const y = top + i * rowH;
  svg += `<rect x="${x(q.start)}" y="${y}" width="${Math.max(1, x(q.end) - x(q.start))}" height="${rowH - 1}" fill="${color}" opacity="${q.bytes > 200000 ? 1 : 0.55}"><title>${esc(q.url)} ${q.bytes} B ${q.start}-${q.end} ms</title></rect>`;
  if (q.bytes > 150000) svg += `<text x="${L - 6}" y="${y + rowH - 1}" font-size="8" text-anchor="end" fill="#5d4a47">${esc(short(q.url))} ${(q.bytes / 1e6).toFixed(2)}MB</text>`;
});
const lines = [[paint, "painting", "#d9822b"], [marks.title, "title", "#7a5cc4"], [marks["alive:all"], "all alive", "#362223"]];
for (const [k, v] of Object.entries(marks)) if (k.startsWith("alive:") && k !== "alive:all") lines.push([v, k.slice(6), k === "alive:crowd" ? "#3d8f5a" : "#3a7fc1", true]);
let labelRow = 0;
for (const [t, name, color, small] of lines.filter((l) => l[0] != null).sort((a, b) => a[0] - b[0])) {
  svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - 30}" stroke="${color}" stroke-width="${small ? 1 : 2}" stroke-dasharray="${small ? "3 3" : ""}"/>`;
  svg += `<text x="${x(t) + 3}" y="${top + 10 + (labelRow++ % 12) * 11}" font-size="${small ? 9 : 11}" font-weight="${small ? 400 : 600}" fill="${color}">${esc(name)} ${(t / 1000).toFixed(1)}s</text>`;
}
svg += "</svg>";
writeFileSync(outp, svg);
console.log(`${outp}: ${reqs.length} requests, ${(svg.length / 1024).toFixed(0)} KB`);
