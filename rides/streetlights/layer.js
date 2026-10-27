// Street lights on Beach Street: 13 slim modern LED poles painted into the street in the painting's style
// (gpt-image-2.5 edits of sketched poles; only the poles are kept, the painting's own pixels everywhere else).
//
// - plate_<R>.webp: the poles, laid in the plate slot (ctx.addPatch), so the painting and site/park stay untouched.
//   North poles (shop side) stand behind every lane: cars pass in front of them, and the plate alone is right.
// - front_<R>.webp: the south poles (park side) again, cut to the pole itself, in the front slot: cars on the road
//   are behind them. The crowd never reaches the street (its deck starts at park y 1115), so nothing walks in front.
// - Night: lights.json (one record per pole: LED head, ground point of the pool; also written to
//   tests/night-lights/lights_streetlights.json for the lights module). Group "photocell".
// Made by tools/build.py; see RESULTS.md.
export async function mount(ctx) {
  const url = (f) => new URL(f, ctx.dir).href;
  const data = await fetch(url("streetlights.json")).then((r) => r.json());
  for (const p of data.plates) ctx.addPatch(url(p.file), p.rect);
  const fronts = data.fronts.map(({ file, rect: [x, y, w, h] }) => {
    const img = new Image();
    img.src = url(file);
    img.alt = "";
    img.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;visibility:hidden`;
    ctx.slots.front.append(img);
    return img;
  });
  await Promise.all(fronts.map((img) => img.decode().catch(() => {})));
  for (const img of fronts) img.style.visibility = "";
  window.__streetlights = data.poles;
  return {};
}
