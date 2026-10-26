// Walking network for the whole park (park.json frame: 3840 x 2560 px over gen/park/world_v2_hd), traced by eye on
// gridded crops of site/park/world_3840.webp (tools/grid_crops.py). Writes ../walk.json in the format of
// tests/characters/walk.json, so the same crowd sim runs on it.
//
//   node tests/park-crowd/tools/make_walk.mjs      (from the repo root)
//
// The lanes are computed, not traced: for every x they run in the open band between the front edge of whatever
// stands on the promenade (stalls, rides, lamps, benches) and the rail. Walkers are therefore always in front of the
// things they pass, so this first version needs no cut-outs.
import { readFileSync, writeFileSync } from "node:fs";
import { createCamera } from "../../../base/camera.js";

const here = new URL("..", import.meta.url);
const park = JSON.parse(readFileSync(new URL("park.json", here)));
const camera = createCamera(park);
const SAND = -40;
const r1 = (v) => Math.round(v * 10) / 10;
const along = (line, x) => {
  if (x <= line[0][0]) return line[0][1];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    if (x <= bx) return ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return line.at(-1)[1];
};

// The top of the white rail and the foot of the beach wall, west to east, to the deck's south-east corner.
const rail = [
  [205, 1118], [223, 1133], [300, 1150], [343, 1167], [410, 1180], [447, 1203], [500, 1215], [573, 1233], [653, 1248],
  [753, 1270], [803, 1283], [827, 1297], [900, 1323], [1000, 1330], [1093, 1317], [1130, 1303], [1207, 1297],
  [1307, 1279], [1367, 1261], [1413, 1273], [1487, 1290], [1553, 1301], [1607, 1313], [1707, 1335], [1800, 1355],
  [1920, 1380], [1973, 1393], [2033, 1408], [2133, 1428], [2247, 1455], [2400, 1487], [2497, 1507], [2613, 1533],
  [2733, 1560], [2883, 1590], [2947, 1603], [3027, 1619], [3127, 1640], [3187, 1655], [3307, 1683], [3393, 1707],
  [3480, 1727], [3537, 1737],
];
const wallFoot = [
  [213, 1160], [293, 1183], [400, 1225], [493, 1257], [627, 1283], [800, 1303], [870, 1340], [913, 1363], [1067, 1373],
  [1133, 1347], [1300, 1323], [1367, 1307], [1527, 1343], [1600, 1367], [1767, 1393], [1947, 1433], [2033, 1455],
  [2200, 1493], [2400, 1530], [2600, 1567], [2800, 1607], [2880, 1633], [3100, 1670], [3347, 1743], [3537, 1803],
];
// Where the dry sand ends (foam edge), and the lowest y a 16:9 screen still shows.
const waterline = [[0, 1330], [500, 1470], [1000, 1570], [1500, 1640], [1875, 1712], [2250, 1812], [2625, 1880], [3000, 1980], [3500, 2150], [3840, 2250]];
const VISIBLE_BOTTOM = 2330;

// What stands on the promenade: [x0, x1, front edge y, name].
const objects = [
  [300, 407, 1150, "bandstand"], [440, 850, 1170, "grove arcade"], [453, 560, 1205, "stall"], [415, 431, 1183, "lamp"],
  [590, 665, 1227, "statue"], [687, 793, 1257, "stall"], [802, 818, 1273, "lamp"], [840, 1027, 1297, "pirate ship"],
  [1042, 1058, 1313, "lamp"], [1079, 1095, 1307, "lamp"], [1153, 1250, 1287, "stall"], [1279, 1295, 1240, "lamp"],
  [1320, 1403, 1250, "stall"], [1422, 1438, 1247, "lamp"], [1433, 1530, 1273, "stall"], [1532, 1548, 1267, "lamp"],
  [1577, 1763, 1297, "carousel"], [1765, 1781, 1313, "lamp"], [1797, 1913, 1355, "stall"], [1925, 1941, 1347, "lamp"],
  [1960, 2070, 1365, "ride"], [2110, 2177, 1370, "bench"], [2193, 2253, 1433, "bench"], [2282, 2298, 1447, "lamp"],
  [2317, 2443, 1470, "stall"], [2459, 2475, 1490, "lamp"], [2500, 2680, 1490, "ferris wheel"], [2682, 2698, 1533, "lamp"],
  [2713, 2857, 1537, "carousel"], [2863, 3020, 1570, "stall"], [3019, 3035, 1607, "lamp"], [3059, 3075, 1617, "lamp"],
  [3107, 3317, 1633, "teacups"], [3335, 3351, 1673, "lamp"], [3365, 3381, 1687, "lamp"], [3403, 3553, 1697, "kiosk"],
];
const lamps = objects.filter((o) => o[3] === "lamp").map(([a, b, y]) => [(a + b) / 2, y]);
const frontAt = (x, pad = 10) => Math.max(-Infinity, ...objects.filter(([a, b]) => x >= a - pad && x <= b + pad).map((o) => o[2]));
const stairs = [
  { top: [320, 1163], bottom: [295, 1212] }, { top: [465, 1210], bottom: [440, 1265] },
  { top: [640, 1252], bottom: [612, 1292] }, { top: [1110, 1318], bottom: [1100, 1375] },
  { top: [1585, 1318], bottom: [1560, 1372] }, { top: [2000, 1405], bottom: [1975, 1465] },
  { top: [2585, 1538], bottom: [2570, 1595] }, { top: [3150, 1655], bottom: [3130, 1728] },
];

// Lanes: S (east-bound, by the rail) and N (west-bound, nearer the stalls), one point every 25 px.
const xs = [];
for (let x = 228; x <= 3528; x += 25) xs.push(x);
const sRaw = xs.map((x) => Math.min(along(rail, x) + 8, Math.max(along(rail, x) - 6, frontAt(x) + 4)));
const nRaw = xs.map((x, i) => Math.min(sRaw[i] - 3, Math.max(along(rail, x) - 26, frontAt(x) + 5)));
// Lift N early before an object (max over neighbours), then smooth; never past the S lane.
const nMax = nRaw.map((_, i) => Math.max(...nRaw.slice(Math.max(0, i - 1), i + 2)));
const nY = nMax.map((v, i) => Math.min(sRaw[i] - 3, (nMax[Math.max(0, i - 1)] + 2 * v + nMax[Math.min(nMax.length - 1, i + 1)]) / 4));
const S = xs.map((x, i) => [x, r1(sRaw[i])]);
const N = xs.map((x, i) => [x, r1(Math.max(nY[i], nRaw[i]))]);

const nodes = [], edges = [];
function node(id, px, h = 0, kind = "lane") {
  nodes.push({ id, px: px.map(r1), h, g: camera.toGround(px, h).map(r1), kind });
  return id;
}
const edge = (a, b, kind, dir = 0) => edges.push({ a, b, kind, dir });

S.forEach((p, i) => node(`s${i}`, p));
N.forEach((p, i) => node(`n${i}`, p));
for (let i = 0; i < S.length - 1; i++) edge(`s${i}`, `s${i + 1}`, "lane", 1);
for (let i = 0; i < N.length - 1; i++) edge(`n${i + 1}`, `n${i}`, "lane", 1);
for (let i = 0; i < S.length; i += 2) edge(`s${i}`, `n${i}`, "cross");

// The east end: the deck turns north along the east rail; walkers leave there.
const east = [[3562, 1702], [3608, 1622], [3652, 1548], [3690, 1482]];
east.forEach((p, i) => node(`e${i}`, p));
edge(`s${S.length - 1}`, "e0", "lane"); edge(`n${N.length - 1}`, "e0", "lane");
for (let i = 0; i < east.length - 1; i++) edge(`e${i}`, `e${i + 1}`, "lane");

const nearest = (prefix, list, p) => {
  let best = 0, d = Infinity;
  list.forEach((q, i) => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < d) { d = dd; best = i; } });
  return `${prefix}${best}`;
};

// Stairs down to the sand and a path along the foot of the wall.
const beachPath = [[60, 1255], ...stairs.map((s) => [s.bottom[0] - 10, along(wallFoot, s.bottom[0] - 10) + 26]), [3600, 1850], [3790, 1830]];
stairs.forEach((s, k) => {
  node(`st${k}`, s.top, 0, "stair_top");
  node(`sb${k}`, s.bottom, SAND, "stair_bottom");
  edge(nearest("s", S, s.top), `st${k}`, "deck");
  edge(`st${k}`, `sb${k}`, "stair");
});
beachPath.forEach((p, i) => node(`w${i}`, p, SAND, "sand"));
for (let i = 0; i < beachPath.length - 1; i++) edge(`w${i}`, `w${i + 1}`, "sand");
stairs.forEach((_, k) => edge(`sb${k}`, `w${k + 1}`, "sand"));

const places = [];
function place(p) {
  const from = p.approach || p.slots[0];
  p.node = node(`p_${p.id}`, from, p.h ?? 0, "place");
  if (!p.link) p.link = [nearest(p.lane === "n" ? "n" : "s", p.lane === "n" ? N : S, from)];
  for (const l of p.link) edge(l, p.node, "deck");
  places.push(p);
}

// Stalls: three customers at the counter, facing it.
objects.filter((o) => o[3] === "stall" || o[3] === "kiosk").forEach(([a, b, y], i) => {
  const c = (a + b) / 2;
  place({ id: `stall_${i}`, kind: "stall", slots: [[c - 22, y + 5], [c, y + 6], [c + 22, y + 5]], lane: "n" });
});
const bench = (id, slots) => place({ id, kind: "bench", slots, lane: "n" });
bench("bench_w", [[2128, 1368], [2156, 1371]]);
bench("bench_e", [[2210, 1430], [2238, 1433]]);
const watch = (id, spot, target, lane = "s") => place({ id, kind: "watch", slots: [spot], target, lane });
watch("watch_wheel_w", [2540, 1500], [2590, 1380]);
watch("watch_wheel_e", [2645, 1527], [2590, 1380]);
watch("watch_carousel", [2780, 1550], [2785, 1450]);
watch("watch_teacups", [3205, 1650], [3210, 1560]);
watch("watch_ship", [930, 1312], [930, 1200]);
watch("watch_carousel_w", [1670, 1314], [1670, 1240]);
const photo = (id, spot, target) => place({ id, kind: "photo", slots: [spot], target, lane: "s" });
photo("photo_wheel", [2610, 1525], [2590, 1340]);
photo("photo_coaster", [2470, 1497], [2700, 1250]);
photo("photo_carousel", [1700, 1322], [1670, 1230]);
const hangout = (id, center) => place({ id, kind: "hangout", slots: [center], lane: "s" });
[[600, 1236], [1262, 1293], [2150, 1412], [2705, 1548], [3090, 1626]].forEach((c, i) => hangout(`hang_${i}`, c));

// Rail spots: lean on the rail and look at the sea, one every 34 px, clear of stairs and lamps.
const railSpots = [];
const blocked = [...stairs.map((s) => [s.top[0], 28]), ...lamps.map((l) => [l[0], 16])];
for (let x = 240; x < 3520; x += 34) {
  if (blocked.some(([bx, r]) => Math.abs(bx - x) < r)) continue;
  const y = along(rail, x) - 3;
  if (frontAt(x, 4) > y - 2) continue;
  railSpots.push([x, r1(y)]);
}
railSpots.forEach((p, i) => place({ id: `rail_${i}`, kind: "rail", slots: [p], approach: [p[0], p[1] - 4], lane: "s" }));

// Beach spots: Poisson-sampled on the dry sand between the wall and the foam, on the part every screen shows.
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const beach = [];
for (let tries = 0; tries < 30000 && beach.length < 150; tries++) {
  const x = 80 + rnd() * 3640;
  const top = x > 3537 ? 1835 : along(wallFoot, x) + 34;
  const bottom = Math.min(along(waterline, x) - 28, VISIBLE_BOTTOM);
  if (bottom - top < 10) continue;
  const y = top + rnd() * (bottom - top);
  if (beach.some((b) => Math.hypot(b[0] - x, (b[1] - y) * 1.8) < 62)) continue;
  beach.push([r1(x), r1(y)]);
}
beach.forEach((p, i) => {
  const link = beachPath.reduce((b, q, k) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(beachPath[b][0] - p[0], beachPath[b][1] - p[1]) ? k : b), 0);
  place({ id: `beach_${i}`, kind: "beach", slots: [p], h: SAND, link: [`w${link}`], approach: p });
});

const exits = ["s0", `s${S.length - 1}`, "n0", `n${N.length - 1}`, `e${east.length - 1}`, "w0", `w${beachPath.length - 1}`];
const out = {
  about: "Walking network for the whole park, in park px (3840 x 2560, y down) over gen/park/world_v2_hd; made by tests/park-crowd/tools/make_walk.mjs. h is the height above the deck (sand -40); g = camera.toGround(px, h) with park.json's camera. Lanes: s* runs east by the rail, n* runs west nearer the stalls (keep right), both computed to stay in front of everything on the promenade. Exits: both lane ends, the east end of the deck, both ends of the beach.",
  heights: { deck: 0, sand: SAND },
  rail, wallFoot, lamps, waterline, objects,
  nodes, edges, exits,
  places: places.map((p) => ({ ...p, slots: p.slots.map((s) => s.map(r1)), g: p.slots.map((s) => camera.toGround(s, p.h ?? 0).map(r1)) })),
};
writeFileSync(new URL("walk.json", here), JSON.stringify(out));
const kinds = {};
for (const p of places) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
console.log(`walk.json: ${nodes.length} nodes, ${edges.length} edges, ${places.length} places ${JSON.stringify(kinds)}`);
