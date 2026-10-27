// A milestone chart (SVG): one row per configuration, with when something first shows, the painting, the title,
// each ride and the crowd, and everything alive (medians from load_matrix.mjs --out files).
//
//   node tests/perf/tools/load_compare.mjs out.svg --key macbook/4g "Label=results/x.json[:still]" ...
// ":still" marks a configuration whose rides do not move until the last layer is mounted (index.html today): its
// ride ticks are drawn hollow and labelled "loaded, still".
import { readFileSync, writeFileSync } from "node:fs";

const [outp, ...rest] = process.argv.slice(2);
const ki = rest.indexOf("--key"), key = ki >= 0 ? rest[ki + 1] : "macbook/4g";
const ti = rest.indexOf("--title"), title = ti >= 0 ? rest[ti + 1] : `Milestones, ${key}`;
const rows = rest.filter((x, i) => x.includes("=") && i !== ki + 1 && i !== ti + 1).map((spec) => {
  const [label, src] = spec.split("=");
  const [file, flag] = src.split(":");
  const r = JSON.parse(readFileSync(file, "utf8")).results[key];
  return { label, r, still: flag === "still" };
});
const maxT = Math.ceil(Math.max(...rows.map(({ r }) => r.all ?? 0)) / 2000) * 2000 + 1000;
const W = 1000, L = 210, rowH = 54, top = 40, H = top + rows.length * rowH + 34;
const x = (t) => L + (t / maxT) * (W - L - 24);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif"><rect width="100%" height="100%" fill="#fffdf9"/>`;
svg += `<text x="10" y="20" font-size="13" font-weight="600" fill="#362223">${esc(title)}</text>`;
for (let t = 0; t <= maxT; t += 1000) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 26}" stroke="${t % 5000 ? "#f1ebe3" : "#e2d8cc"}"/>${t % 2000 ? "" : `<text x="${x(t)}" y="${H - 12}" font-size="10" text-anchor="middle" fill="#8a7f78">${t / 1000}s</text>`}`;
rows.forEach(({ label, r, still }, i) => {
  const y = top + i * rowH + 18;
  svg += `<text x="10" y="${y + 4}" font-size="11.5" fill="#362223">${esc(label)}</text><text x="10" y="${y + 18}" font-size="10" fill="#8a7f78">${(r.bytes / 1e6).toFixed(1)} MB · ${r.requests} requests</text>`;
  svg += `<line x1="${x(0)}" x2="${x(r.all ?? 0)}" y1="${y}" y2="${y}" stroke="#d8cec2" stroke-width="2"/>`;
  const rides = Object.entries(r).filter(([k]) => k.startsWith("alive_") && k !== "alive_crowd");
  for (const [, t] of rides) svg += still ? `<circle cx="${x(t)}" cy="${y}" r="3.5" fill="#fffdf9" stroke="#3a7fc1" stroke-width="1.5"/>` : `<circle cx="${x(t)}" cy="${y}" r="3.5" fill="#3a7fc1"/>`;
  const first = r.first ?? r.fcp;
  const marks = [[still ? null : first, "first look", "#b9a48f"], [r.painting, "painting", "#d9822b"], [r.title, "title", "#7a5cc4"], [r.alive_crowd, "crowd", "#3d8f5a"], [r.all, "all alive", "#362223"]];
  let lab = 0;
  for (const [t, name, color] of marks) {
    if (t == null) continue;
    svg += `<rect x="${x(t) - 1.5}" y="${y - 9}" width="3" height="18" fill="${color}"/>`;
    svg += `<text x="${x(t) + 3}" y="${y + (lab++ % 2 ? 22 : -11)}" font-size="9.5" fill="${color}">${name} ${(t / 1000).toFixed(1)}</text>`;
  }
  if (still && rides.length) svg += `<text x="${x(Math.min(...rides.map(([, t]) => t)))}" y="${y + 22}" font-size="9" fill="#3a7fc1">rides loaded, still until "all alive"</text>`;
});
svg += "</svg>";
writeFileSync(outp, svg);
console.log(outp, rows.length, "rows");
