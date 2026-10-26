import { readFileSync, writeFileSync } from "node:fs";
import { createCamera } from "../../../base/camera.js";

const here = new URL("..", import.meta.url);
const stage = JSON.parse(readFileSync(new URL("../../base/stage.json", here)));
const camera = createCamera(stage);
const SAND = -40;
const r1 = (v) => Math.round(v * 10) / 10;

const rail = [[-40, 538], [0, 548], [60, 562], [260, 607], [460, 652], [660, 703], [860, 752], [1060, 797], [1260, 850], [1460, 900], [1536, 918], [1580, 928]];
const wallFoot = [[-40, 586], [60, 612], [260, 657], [460, 705], [660, 754], [860, 803], [1060, 852], [1260, 905], [1460, 955], [1536, 973], [1580, 983]];
const along = (line, x) => {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    if (x <= bx) return ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return line.at(-1)[1];
};

const lamps = [[27, 534], [271, 601], [612, 683], [968, 763], [1131, 601]];
const stairs = [
  { top: [180, 598], bottom: [152, 654] },
  { top: [381, 645], bottom: [356, 702] },
  { top: [659, 714], bottom: [631, 770] },
  { top: [925, 782], bottom: [901, 840] },
  { top: [1319, 877], bottom: [1294, 936] },
];

const railAt = (x) => along(rail, x);
const S = [
  [-40, -4], [0, -4], [60, -4], [120, -4], [180, -4], [230, -4], [271, 8], [320, -4], [381, -4], [440, -4], [490, 7],
  [540, 9], [612, 8], [659, -4], [720, -4], [780, -4], [840, -4], [900, -4], [925, -4], [968, 8], [1010, -4],
  [1060, 8], [1110, 8], [1160, -2], [1206, 6], [1260, -4], [1319, -4], [1380, -4], [1440, -4], [1500, -4], [1580, -4],
].map(([x, o]) => [x, r1(railAt(x) + (o < 0 ? o - 6 : o))]);
const N = [
  [-40, 503], [0, 512], [60, 524], [130, 535], [210, 540], [280, 528], [340, 518], [400, 532], [450, 552], [500, 568],
  [560, 576], [620, 566], [680, 532], [740, 522], [800, 527], [850, 540], [900, 552], [960, 556], [1020, 565],
  [1080, 583], [1140, 592], [1190, 622], [1250, 648], [1290, 690], [1340, 722], [1400, 728], [1460, 735], [1520, 742],
  [1580, 750],
];
const solid = [[448, 600], [641, 819], [859, 1029], [1015, 1165], [1250, 1380]];
const cross = [];
S.forEach((p, i) => {
  if (i % 2) return;
  let j = 0;
  N.forEach((q, k) => { if (Math.abs(q[0] - p[0]) < Math.abs(N[j][0] - p[0])) j = k; });
  const lo = Math.min(p[0], N[j][0]), hi = Math.max(p[0], N[j][0]);
  if (Math.abs(N[j][0] - p[0]) < 45 && !solid.some(([a, b]) => hi > a && lo < b)) cross.push([i, j]);
});

const nodes = [], edges = [], ids = new Map();
function node(id, px, h = 0, kind = "lane") {
  const g = camera.toGround(px, h);
  nodes.push({ id, px: px.map(r1), h, g: g.map(r1), kind });
  ids.set(id, nodes.length - 1);
  return id;
}
const edge = (a, b, kind, dir = 0) => edges.push({ a, b, kind, dir });

S.forEach((p, i) => node(`s${i}`, p));
N.forEach((p, i) => node(`n${i}`, p));
for (let i = 0; i < S.length - 1; i++) edge(`s${i}`, `s${i + 1}`, "lane", 1);
for (let i = 0; i < N.length - 1; i++) edge(`n${i + 1}`, `n${i}`, "lane", 1);
for (const [i, j] of cross) edge(`s${i}`, `n${j}`, "cross");

const nearest = (prefix, list, p) => {
  let best = 0, d = Infinity;
  list.forEach((q, i) => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < d) { d = dd; best = i; } });
  return `${prefix}${best}`;
};

stairs.forEach((s, k) => {
  node(`st${k}`, s.top, 0, "stair_top");
  node(`sb${k}`, s.bottom, SAND, "stair_bottom");
  edge(nearest("s", S, s.top), `st${k}`, "deck");
  edge(`st${k}`, `sb${k}`, "stair");
});
const beachPath = [[-40, 640], ...stairs.map((s) => [s.bottom[0] - 10, s.bottom[1] + 18]), [1580, 1000]];
beachPath.forEach((p, i) => node(`w${i}`, p, SAND, "sand"));
for (let i = 0; i < beachPath.length - 1; i++) edge(`w${i}`, `w${i + 1}`, "sand");
stairs.forEach((s, k) => edge(`sb${k}`, `w${k + 1}`, "sand"));
const bottom = [[160, 1050], [520, 1050], [900, 1050]];
bottom.forEach((p, i) => { node(`x${i}`, p, SAND, "exit"); edge(`x${i}`, `w${[1, 3, 4][i]}`, "sand"); });

const places = [];
function place(p) {
  const from = p.from || p.slots?.[0] || p.center;
  p.node = p.node || node(`p_${p.id}`, p.approach || from, p.h ?? 0, "place");
  if (!p.link) p.link = [nearest(p.lane === "n" ? "n" : "s", p.lane === "n" ? N : S, p.approach || from)];
  for (const l of p.link) edge(l, p.node, "deck");
  places.push(p);
}

const queue = (id, gate, slots, target, approx, cycle, board, lane) =>
  place({ id, kind: "queue", gate, slots, target, approx, cycle, board, approach: slots.at(-1), lane });
queue("dream_wheel", [690, 640], [[693, 651], [706, 654], [719, 656], [732, 656], [745, 655], [758, 653], [771, 650], [783, 646], [795, 641], [805, 635], [814, 628], [821, 620]], [690, 638], false, 34, 4, "s");
queue("sea_swings", [905, 685], [[909, 696], [922, 698], [935, 699], [948, 699], [961, 698], [974, 696], [987, 693], [999, 689], [1010, 684], [1020, 678], [1028, 670], [1034, 661]], [905, 683], false, 40, 5, "s");
queue("fireball", [341, 486], [[333, 492], [320, 493], [307, 492], [294, 489], [282, 485], [271, 480], [260, 474], [250, 468]], [341, 482], true, 44, 3, "n");

const stall = (id, slots, target, lane) => place({ id, kind: "stall", slots, target, approach: [slots[1][0], slots[1][1] + 12], lane });
stall("stall_w1", [[110, 506], [134, 512], [158, 518]], null, "n");
stall("stall_red", [[421, 516], [444, 523], [466, 530]], null, "n");
stall("stall_yellow", [[505, 541], [527, 547], [549, 553]], null, "n");
stall("stall_teal", [[470, 651], [494, 656], [518, 661]], null, "s");
stall("stall_blue", [[1043, 789], [1068, 795], [1093, 800]], null, "s");
stall("stall_red_east", [[1266, 794], [1290, 800], [1314, 806]], null, "s");

const bench = (id, slots, lane) => place({ id, kind: "bench", slots, approach: [slots[0][0] + 10, slots[0][1] + 16], lane });
bench("bench_b", [[1064, 560], [1086, 565]], "n");
bench("bench_a", [[1174, 605], [1198, 610]], "n");

const hangout = (id, center, lane) => place({ id, kind: "hangout", center, slots: [center], lane });
hangout("eat_w", [245, 556], "s");
hangout("eat_fireball", [392, 584], "s");
hangout("eat_mid", [840, 612], "n");
hangout("eat_swings", [1000, 735], "s");
hangout("eat_east", [1232, 700], "n");
hangout("eat_left", [62, 505], "n");

const photo = (id, spot, target, lane) => place({ id, kind: "photo", slots: [spot], target, lane });
photo("photo_wheel", [606, 612], [730, 585], "n");
photo("photo_swings", [850, 650], [944, 625], "s");
photo("photo_coaster", [300, 545], [300, 380], "n");
photo("photo_flume", [1262, 668], [1300, 520], "n");

const watch = (id, spot, target, lane) => place({ id, kind: "watch", slots: [spot], target, lane });
watch("watch_wheel_w", [622, 640], [730, 590], "s");
watch("watch_wheel_e", [812, 676], [730, 600], "s");
watch("watch_wheel_n", [700, 540], [730, 600], "n");
watch("watch_swings_e", [1040, 676], [944, 630], "s");
watch("watch_swings_n", [930, 560], [944, 630], "n");
watch("watch_fireball", [250, 500], [341, 440], "n");
watch("watch_coaster", [800, 512], [800, 380], "n");
watch("watch_flat", [1300, 640], [1402, 650], "n");
watch("watch_flume", [1200, 580], [1290, 480], "n");
watch("watch_coaster_w", [190, 535], [230, 400], "n");
hangout("chat_mid_s", [860, 720], "s");
hangout("chat_west", [130, 545], "s");
hangout("chat_east", [1420, 770], "n");

const railSpots = [];
const blocked = [...stairs.map((s) => [s.top[0], 28]), ...lamps.map((l) => [l[0], 18]), [500, 60], [1080, 75], [1206, 24]];
for (let x = 36; x < 1530; x += 26) {
  if (blocked.some(([bx, r]) => Math.abs(bx - x) < r)) continue;
  railSpots.push([x, r1(along(rail, x) + 11)]);
}
railSpots.forEach((p, i) => place({ id: `rail_${i}`, kind: "rail", slots: [p], approach: [p[0], p[1] - 14], lane: "s" }));

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const beach = [];
for (let tries = 0; tries < 9000 && beach.length < 110; tries++) {
  const x = 20 + rnd() * 1500, y = along(wallFoot, x) + 28 + rnd() * 400;
  if (y > 1008) continue;
  if (beach.some((b) => Math.hypot(b[0] - x, (b[1] - y) * 1.8) < 50)) continue;
  beach.push([r1(x), r1(y)]);
}
const sandLinks = beachPath.map((p, i) => [`w${i}`, p]);
beach.forEach((p, i) => {
  let best = sandLinks[0];
  for (const s of sandLinks) if (Math.hypot(s[1][0] - p[0], s[1][1] - p[1]) < Math.hypot(best[1][0] - p[0], best[1][1] - p[1])) best = s;
  place({ id: `beach_${i}`, kind: "beach", slots: [p], h: SAND, link: [best[0]], approach: p });
});

const exits = ["s0", `s${S.length - 1}`, "n0", `n${N.length - 1}`, "w0", `w${beachPath.length - 1}`, "x0", "x1", "x2"];
const out = {
  about: "Walking network for the characters test, traced by eye on base/stage.png. px are stage pixels (y down); h is the height above the deck (sand is -40: the wall is about 35 px tall on screen); g = camera.toGround(px, h) = [x, y, z] ground units. Lanes: s* runs east (the south lane, nearer the rail), n* runs west (keep right). edges dir 1 = the lane's direction a->b. Places: queue slots run from the gate backwards; stall slots stand at the counter; target = what the slot faces (absent: the stall, north; beach, bench and rail face the sea, south). fireball's gate is approximate (stage.json has none).",
  heights: { deck: 0, sand: SAND },
  rail, wallFoot, lamps,
  nodes, edges, exits,
  places: places.map((p) => ({ ...p, slots: p.slots?.map((s) => s.map(r1)), g: p.slots?.map((s) => camera.toGround(s, p.h ?? 0).map(r1)) })),
};
writeFileSync(new URL("walk.json", here), JSON.stringify(out));
console.log(`walk.json: ${nodes.length} nodes, ${edges.length} edges, ${places.length} places (${railSpots.length} rail, ${beach.length} beach)`);
