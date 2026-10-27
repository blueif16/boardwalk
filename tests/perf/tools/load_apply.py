"""Applies the recommended loading changes (tests/perf/LOADING.md) to a copy of index.html, so the change can be
re-made against whatever index.html looks like by then. Each edit is anchored on a line of today's file and fails
loudly if that line has moved; nothing is written unless every edit applies.

  python3 -I tests/perf/tools/load_apply.py index.html out.html --lqip <world_lqip.txt> [--no-preview] [--cdn]
  diff -u index.html out.html > tests/perf/index_loading.diff

--no-preview  no 960 px preview image between the placeholder and the painting
--cdn         keep three.js and gsap on jsDelivr (adds preconnect + modulepreload) instead of vendor/vendor.js
"""
import argparse, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--lqip", required=True, help="text file with the placeholder's data URI (load_placeholder.py)")
ap.add_argument("--no-preview", action="store_true")
ap.add_argument("--cdn", action="store_true")
a = ap.parse_args()
html = open(a.src).read()
lqip = open(a.lqip).read().strip()
assert lqip.startswith("data:image/"), "the --lqip file should hold a data URI"


def edit(old, new, regex=False, count=1):
    global html
    n = len(re.findall(old, html)) if regex else html.count(old)
    if n != count:
        sys.exit(f"load_apply: expected {count} match(es) of {old[:70]!r}, found {n}; index.html changed, update this edit")
    html = re.sub(old, lambda m: new(m) if callable(new) else new, html) if regex else html.replace(old, new)


# 1. No favicon request (the page has none; every visit fetched /favicon.ico for a 404).
edit("<title>Santa Cruz Boardwalk</title>\n", '<title>Santa Cruz Boardwalk</title>\n<link rel="icon" href="data:,">\n')

# 2. The placeholder under the painting, and no alt-text flash.
edit("  .world > * { position: absolute; inset: 0; width: 3840px; height: 2560px; display: block; }\n",
     "  .world > * { position: absolute; inset: 0; width: 3840px; height: 2560px; display: block; }\n"
     "  /* A 64 px copy of the painting inlined here (about 0.5 KB), blurred, under the painting while it loads */\n"
     "  .world > .lqip { background: var(--lqip) 0 0 / 100% 100%; filter: blur(36px); transform: scale(1.03); }\n"
     "  #painting { color: transparent; }   /* no alt text flashing while the painting loads */\n")

# 3. three.js and gsap: one self-hosted file (tests/perf/tools/load_vendor.mjs builds vendor/vendor.js), fetched in
#    parallel with the title's modules instead of four round trips later.
if a.cdn:
    imports = ('<script type="importmap">\n{ "imports": {\n'
               '  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",\n'
               '  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",\n'
               '  "gsap": "https://cdn.jsdelivr.net/npm/gsap@3.13.0/index.js"\n} }\n</script>\n'
               '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n'
               + "".join(f'<link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/{p}">\n' for p in [
                   "three@0.170.0/build/three.module.min.js", "three@0.170.0/examples/jsm/lines/LineSegments2.js",
                   "three@0.170.0/examples/jsm/lines/LineSegmentsGeometry.js", "three@0.170.0/examples/jsm/lines/LineMaterial.js",
                   "gsap@3.13.0/index.js", "gsap@3.13.0/gsap-core.js", "gsap@3.13.0/CSSPlugin.js"]))
else:
    v = "./vendor/vendor.js"
    imports = ('<script type="importmap">\n{ "imports": {\n'
               f'  "three": "{v}",\n  "gsap": "{v}",\n'
               f'  "three/addons/lines/LineSegments2.js": "{v}",\n  "three/addons/lines/LineSegmentsGeometry.js": "{v}",\n'
               f'  "three/addons/lines/LineMaterial.js": "{v}",\n'
               f'  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js": "{v}"\n'
               '} }\n</script>\n<link rel="modulepreload" href="vendor/vendor.js">\n')
imports += '<link rel="modulepreload" href="site/title/title.js">\n<link rel="modulepreload" href="site/title/glyphs.js">\n'
edit(r'<script type="importmap">[\s\S]*?</script>\n', imports, regex=True)

# 4. Placeholder, preview and painting elements; the painting starts during parse, from a classic script.
preview = "" if a.no_preview else '  <img id="preview" alt="" fetchpriority="high">\n'
edit(r'  <img id="painting" alt="([^"]*)">\n',
     lambda m: f'  <div class="lqip" style="--lqip: url({lqip})"></div>\n{preview}'
               f'  <img id="painting" alt="{m.group(1)}" fetchpriority="high">\n', regex=True)
preview_js = "" if a.no_preview else '  document.getElementById("preview").src = "site/park/world_960.webp";   // a readable park in ~0.4 s on 4G\n'
edit('</div>\n<header class="title"', '</div>\n<script>\n'
     "// During parse, before any module loads: fit the world to the window and start the painting (from the module it\n"
     "// waited three round trips for crowd.js and its imports). The module reuses window.__fit.\n"
     "(() => {\n"
     "  const W = 3840, H = 2560, WIDTHS = [1920, 2560, 3456, 3840, 5120];\n"
     '  const world = document.getElementById("world"), painting = document.getElementById("painting");\n'
     "  const F = window.__fit = { W, H, scale: 1, loaded: 0 };\n"
     "  // The smallest width that covers the window at the screen's pixel density, at most 2x (a 3x phone gets the 2x\n"
     "  // painting: 1.3 MB less), and only ever stepping up.\n"
     "  F.pick = (s) => {\n"
     "    const need = W * s * Math.min(devicePixelRatio || 1, 2);\n"
     "    const w = WIDTHS.find((v) => v >= need * 0.95) ?? WIDTHS.at(-1);\n"
     "    if (w > F.loaded) { F.loaded = w; painting.src = `site/park/world_${w}.webp`; }\n"
     "  };\n"
     "  F.fit = () => {\n"
     "    F.scale = Math.max(innerWidth / W, innerHeight / H);\n"
     "    F.pick(F.scale);\n"
     "    world.style.transform = `translate(${(innerWidth - W * F.scale) / 2}px, ${(innerHeight - H * F.scale) / 2}px) scale(${F.scale})`;\n"
     "  };\n"
     "  F.fit();\n" + preview_js +
     "})();\n</script>\n<header class=\"title\"")

# 5. The module: the crowd's code loads when the crowd mounts, not before the painting.
edit('import { mountCrowd } from "./tests/park-crowd/crowd.js";\n', "")
edit(r'// The painting \(gen/park/world_v2_hd[\s\S]*?addEventListener\("resize", fit\);\n',
     "// The painting (gen/park/world_v2_hd, 9600 x 6400) ships in five widths; the classic script above picks one and\n"
     "// steps up on resize (window.__fit).\n"
     "const F = window.__fit;\n"
     'const painting = document.getElementById("painting");\n'
     "let scale = F.scale;\n"
     "function fit() {\n  F.fit();\n  scale = F.scale;\n  crowd?.resize(scale);\n}\n"
     "let crowd = null;\nconst rides = [];\n"
     'addEventListener("resize", fit);\n'
     "// The painting is on screen once it is decoded; the placeholders go then.\n"
     "const shown = painting.decode().catch(() => {});\n"
     'shown.then(() => { document.getElementById("preview")?.remove(); document.querySelector(".world > .lqip")?.remove(); });\n',
     regex=True)
# (The title block is left as it is: it waits for painting.decode() itself, the same moment as `shown`.)

# 6. The frame loop starts before the rides (today it starts after the last layer, so nothing moves until all of it
#    has loaded), and the rides load by a plan instead of one after another.
m = re.search(r'\nconst panel = document\.getElementById\("panel"\);[\s\S]*?\nrequestAnimationFrame\(frame\);\n', html)
if not m:
    sys.exit("load_apply: frame loop block not found")
loop = m.group(0)
html = html.replace(loop, "\n")
loop = loop.replace("painting ${loaded} px", "painting ${F.loaded} px")
m = re.search(r'\nconst wanted = params\.has\("layers"\)[\s\S]*?\nif \(params\.get\("crowd"\) !== "0"\) \{\n[\s\S]*?\n\}\n', html)
if not m:
    sys.exit("load_apply: ride loop / crowd block not found")
old_loop = m.group(0)
crowd_call = re.search(r"crowd = await mountCrowd\((.*)\);", old_loop)
if not crowd_call:
    sys.exit("load_apply: mountCrowd call not found")
occl = "occluders" in old_loop
plan = loop + '''
// Rides: once the painting is on screen, the ones the window shows, AT_ONCE at a time, in ORDER (what a visitor looks
// at first); the crowd after that first wave (it takes their riders and occluders); rides off screen (phones) load
// when a resize brings them on screen.
const ORDER = ["sea", "coaster", "wheel", "swings", "carousel", "teacups", "pirate", "thrill", "flume", "traffic"]; // rides not listed load last
const BOXES = { // each ride's box in park px [x0, y0, x1, y1] (from its layer.js); a ride not listed counts as on screen
  sea: [0, 1187, 3840, 2560], traffic: [0, 440, 3840, 1150], coaster: [1990, 900, 3240, 1262], wheel: [2452, 1176, 2708, 1484],
  teacups: [3080, 1428, 3340, 1650], flume: [3010, 890, 3740, 1400], pirate: [690, 1035, 1180, 1305],
  carousel: [1555, 1095, 1790, 1315], thrill: [895, 725, 1415, 1240], swings: [2680, 1335, 2892, 1542],
};
const AT_ONCE = 3;
const wanted = params.has("layers") ? params.get("layers").split(",").filter(Boolean) : RIDES;
const queue = [...ORDER.filter((n) => wanted.includes(n)), ...wanted.filter((n) => !ORDER.includes(n))];
const riderBlocks = []''' + (", occluders = []" if occl else "") + ''', state = {};
let running = 0, started = false, waveDone = () => {};
function onScreen(name) {
  const b = BOXES[name];
  if (!b) return true;
  const m = 40, hw = innerWidth / (2 * scale), hh = innerHeight / (2 * scale);
  return b[0] < W / 2 + hw + m && b[2] > W / 2 - hw - m && b[1] < H / 2 + hh + m && b[3] > H / 2 - hh - m;
}
async function mountRide(name) {
  // Plate patches (the painting with the ride erased) stay hidden until the ride is ready, so the painted ride never
  // disappears before the live one shows.
  const patches = [];
  let mounting = true;
  const rideCtx = { ...ctx, name, dir: new URL(`./rides/${name}/`, location.href),
    addPatch(url, rect) { const img = ctx.addPatch(url, rect); if (mounting) { img.style.visibility = "hidden"; patches.push(img); } return img; } };
  try {
    const mod = await import(`./rides/${name}/layer.js`);
    const layer = (await mod.mount(rideCtx)) || {};
    mounting = false;
    await Promise.all(patches.map((img) => img.decode().catch(() => {})));
    for (const img of patches) img.style.visibility = "";
    layer.resize?.(scale);
    rides.push(layer);
    performance.mark(`alive:${name}`);   // milestones for measuring (tests/perf/tools), free in production
    if (layer.riders) riderBlocks.push({ ...layer.riders, name });
''' + ("    if (layer.occluders) occluders.push({ name, occluders: layer.occluders });\n" if occl else "") + '''  } catch (err) {
    console.error(`ride layer ${name} failed`, err);
  }
}
function schedule() {
  for (const name of queue) {
    if (running >= AT_ONCE) break;
    if (state[name] || !onScreen(name)) continue;
    state[name] = "loading";
    running++;
    mountRide(name).finally(() => { state[name] = "alive"; running--; schedule(); waveDone(); });
  }
}
addEventListener("resize", () => { if (started) schedule(); });
const firstWave = queue.filter(onScreen);
await shown;
started = true;
// The layers' code is small: ask for every first-wave module now, so the later ones skip a round trip.
for (const n of firstWave) document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href: `rides/${n}/layer.js` }));
await new Promise((done) => { waveDone = () => { if (firstWave.every((n) => state[n] === "alive")) done(); }; schedule(); waveDone(); });

if (params.get("crowd") !== "0") {
  const { mountCrowd } = await import("./tests/park-crowd/crowd.js");
  crowd = await mountCrowd(''' + crowd_call.group(1) + ''');
  crowd.resize(scale);
  performance.mark("alive:crowd");
}
performance.mark("alive:all");
'''
html = html.replace(old_loop, plan)
edit("await painting.decode().catch(() => {});\nrequestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = \"1\"; }));",
     "await shown;\nrequestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = \"1\"; }));")
for gone in ["function pick(s)", "let loaded = 0;"]:
    if gone in html:
        sys.exit(f"load_apply: {gone!r} still in the output")
open(a.out, "w").write(html)
print(f"wrote {a.out}")
