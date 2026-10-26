import { readFileSync, writeFileSync } from "node:fs";

const [input, output, bbox] = process.argv.slice(2);
if (!input || !output || !bbox) {
  console.log("node osm_plan.mjs <overpass.json> <out.svg> <south,west,north,east>  draws a top-down plan, north up, 1 px = 0.5 m");
  process.exit(1);
}

const [lat0, lon0, lat1, lon1] = bbox.split(",").map(Number);
const elements = JSON.parse(readFileSync(input, "utf8")).elements.filter((e) => {
  const b = e.bounds;
  return !b || (b.maxlat - b.minlat < 4 * (lat1 - lat0) && b.maxlon - b.minlon < 4 * (lon1 - lon0));
});
const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
const S = 2;
const W = Math.round((lon1 - lon0) * k * 111320 * S), H = Math.round((lat1 - lat0) * 110540 * S);
const xy = (p) => [((p.lon - lon0) * k * 111320 * S).toFixed(1), ((lat1 - p.lat) * 110540 * S).toFixed(1)];

function points(e) {
  if (e.type === "node") return [e];
  if (e.geometry) return e.geometry;
  if (e.members) return e.members.flatMap((m) => m.geometry || (m.type === "node" ? [m] : []));
  return [];
}

function rings(e) {
  if (e.geometry) return [e.geometry];
  if (e.members) return join(e.members.filter((m) => m.geometry && m.role !== "inner").map((m) => m.geometry));
  return [];
}

function join(ways) {
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const left = ways.map((w) => [...w]);
  const out = [];
  while (left.length) {
    let ring = left.shift();
    let grown = true;
    while (grown && !same(ring[0], ring.at(-1))) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        if (same(ring.at(-1), w[0])) ring = ring.concat(w.slice(1));
        else if (same(ring.at(-1), w.at(-1))) ring = ring.concat([...w].reverse().slice(1));
        else if (same(ring[0], w.at(-1))) ring = w.concat(ring.slice(1));
        else if (same(ring[0], w[0])) ring = [...w].reverse().concat(ring.slice(1));
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(ring);
  }
  return out;
}

function sea() {
  const coast = join(elements.filter((e) => e.tags?.natural === "coastline" && e.geometry).map((e) => e.geometry));
  return coast.map((line) => {
    const a = line[0], b = line.at(-1);
    const corner = (p) => ({ lat: lat0 - 0.001, lon: p.lon < (lon0 + lon1) / 2 ? lon0 - 0.001 : lon1 + 0.001 });
    return `<path d="${path([...line, corner(b), corner(a)])}Z" ${STYLE.water}/>`;
  });
}

const path = (ring) => "M" + ring.map((p) => xy(p).join(",")).join("L");

function kind(t) {
  if (t.attraction) return "ride";
  if (t.natural === "water" || t.water || t.waterway === "riverbank" || t.natural === "bay") return "water";
  if (t.natural === "coastline") return "coast";
  if (t.waterway) return "river";
  if (t.natural === "beach" || t.natural === "sand" || t.surface === "sand") return "sand";
  if (t.railway === "rail") return "rail";
  if (t.building) return "building";
  if (t.amenity === "parking") return "parking";
  if (t.highway === "footway" || t.highway === "pedestrian" || t.highway === "steps" || t.highway === "cycleway") return "foot";
  if (t.highway) return "road";
  if (t.leisure === "park" || t.landuse === "grass") return "green";
  return null;
}

const STYLE = {
  water: 'fill="#a1cde2" stroke="#54b3d9" stroke-width="1"',
  coast: 'fill="none" stroke="#2f7fb0" stroke-width="3"',
  river: 'fill="none" stroke="#54b3d9" stroke-width="6"',
  sand: 'fill="#f9d7a7" stroke="#e0b67f" stroke-width="1"',
  green: 'fill="#cfe0b0" stroke="none"',
  parking: 'fill="#e6e3dc" stroke="#cfcac0" stroke-width="1"',
  building: 'fill="#d9d2c6" stroke="#8c8172" stroke-width="1"',
  road: 'fill="none" stroke="#bdb6aa" stroke-width="7" stroke-linecap="round"',
  foot: 'fill="none" stroke="#cfc8bc" stroke-width="2" stroke-dasharray="4 3"',
  rail: 'fill="none" stroke="#5a4a40" stroke-width="3" stroke-dasharray="10 4"',
  ride: 'fill="#ec8167" fill-opacity=".55" stroke="#b44d36" stroke-width="2"',
};
const ORDER = ["green", "sand", "water", "parking", "road", "foot", "rail", "river", "coast", "building", "ride"];

const layers = Object.fromEntries(ORDER.map((n) => [n, []]));
layers.water.push(...sea());
const labels = [];
for (const e of elements) {
  const t = e.tags || {};
  const n = kind(t);
  if (!n) continue;
  const linear = ["road", "foot", "rail", "river", "coast"].includes(n) || t.aerialway || (n === "ride" && e.geometry && !closed(e.geometry));
  if (e.type === "node") {
    if (n === "ride") {
      const [x, y] = xy(e);
      layers.ride.push(`<circle cx="${x}" cy="${y}" r="7" fill="#ec8167" stroke="#b44d36" stroke-width="2"/>`);
      if (t.name) labels.push([x, y, t.name, true]);
    }
    continue;
  }
  for (const ring of rings(e)) {
    const d = path(ring) + (linear ? "" : "Z");
    const style = linear && n === "ride" ? 'fill="none" stroke="#b44d36" stroke-width="3" stroke-dasharray="2 5"' : STYLE[n];
    layers[n].push(`<path d="${d}" ${style}/>`);
  }
  if (t.name && (n === "ride" || (n === "building" && W > 0))) {
    const pts = points(e);
    const c = pts.reduce((a, p) => [a[0] + p.lat / pts.length, a[1] + p.lon / pts.length], [0, 0]);
    const [x, y] = xy({ lat: c[0], lon: c[1] });
    labels.push([x, y, t.name, n === "ride"]);
  }
}

function closed(g) {
  return g.length > 2 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = labels.map(([x, y, s, ride]) =>
  `<text x="${x}" y="${y}" font-size="${ride ? 15 : 12}" font-weight="${ride ? 700 : 400}" fill="${ride ? "#7a2e1d" : "#5d5248"}" text-anchor="middle" paint-order="stroke" stroke="#fffdf9" stroke-width="4">${esc(s)}</text>`
).join("\n");

const bar = 100 * S;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 40}" width="${W}" height="${H + 40}" font-family="system-ui, sans-serif">
<rect width="100%" height="100%" fill="#f4f1ea"/>
${ORDER.map((n) => layers[n].join("\n")).join("\n")}
${text}
<g transform="translate(20 ${H + 20})"><rect width="${bar}" height="8" fill="#362223"/><text x="${bar + 10}" y="9" font-size="14" fill="#362223">100 m · north up · OpenStreetMap contributors (ODbL)</text></g>
</svg>`;
writeFileSync(output, svg);
console.log(`wrote ${output}: ${W}x${H} px at ${S} px/m, ${elements.length} elements, ${labels.length} labels`);
