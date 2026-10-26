// Debug layer: marks the rides of this slice (S2_dipper) on the stage from tests/layout/layout.json.
// Filled ring: the official map's ride base carried onto the stage through the measured registration (a thin-plate
// spline through the landmarks in layout.json's stage_registration). Hollow dot + dashed line: the same point through
// the plain crop transform (pdf - [780, 430]) * 2.56, to show how far the painted stage drifted from the map.
// ?tests=layout&layout=crop shows only the crop transform; &layout=labels-off hides the names.
const NS = "http://www.w3.org/2000/svg";
const COLOR = { kiddie: "#e07818", family: "#6e3c8c", thrill: "#148778", attraction: "#d71455", building: "#5a5a5a" };

export async function mount({ camera, slots, dir, params }) {
  const layout = await (await fetch(new URL("layout.json", dir))).json();
  const reg = layout.stage_registration;
  const mode = params.get("layout") || "";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${camera.W} ${camera.H}`);
  svg.setAttribute("width", camera.W);
  svg.setAttribute("height", camera.H);
  svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;overflow:visible";
  slots.debug.append(svg);

  const el = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  const inside = ([x, y]) => x >= -40 && x <= camera.W + 40 && y >= -40 && y <= camera.H + 40;

  for (const it of reg.items_on_stage) {
    const col = COLOR[it.group] || "#333";
    const a = it.crop_px;
    const b = mode === "crop" ? it.crop_px : it.registered_px;
    if (!inside(a) && !inside(b)) continue;
    const g = el("g", {});
    if (mode !== "crop") {
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: col, "stroke-width": 2, "stroke-dasharray": "6 5", opacity: 0.7 }, g);
      el("circle", { cx: a[0], cy: a[1], r: 6, fill: "#fff", stroke: col, "stroke-width": 2, opacity: 0.8 }, g);
    }
    el("circle", { cx: b[0], cy: b[1], r: 13, fill: "none", stroke: "#fff", "stroke-width": 7 }, g);
    el("circle", { cx: b[0], cy: b[1], r: 13, fill: "none", stroke: col, "stroke-width": 3.5 }, g);
    el("circle", { cx: b[0], cy: b[1], r: 3.5, fill: col }, g);
    if (mode !== "labels-off") {
      const t = el("text", { x: b[0] + 18, y: b[1] - 10, fill: col, "font-size": 22, "font-weight": 700,
        "font-family": "system-ui, sans-serif", stroke: "#fffdf9", "stroke-width": 6, "paint-order": "stroke" }, g);
      t.textContent = `${it.num ? it.num + " " : ""}${it.name.replace(" (one way)", "")} · ${it.motion}`;
    }
  }
  window.__layout = { items: reg.items_on_stage.length, mode };
  console.log("layout", JSON.stringify(window.__layout));
  return { update() {} };
}
