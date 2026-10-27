// The park's lights at night, as a layer of the park page (rides/lights; design and measurements in
// tests/night-lights/RESULTS.md).
//
// What it draws: every light painted in the picture (lights*.json: lamps, stall fronts, windows, signs, floods, bulb
// strings, made by tests/night-lights/tools/build_lights.py) and the lights of the live layers mounted before it
// (the Dream Wheel's LEDs, the Giant Dipper's chaser bulbs, the cars, the west carousel, the Sea Swings), switched by
// behaviour.js: the promenade lamps in a wave out from the Dipper at dusk, rides and stalls until 22:45 (+25 min),
// town windows on and off through the night, photocells at dusk.
//
// The hour and darkness come from ctx.sky (base/sky.js: hour, dark, dusk, sun). Until the base gives it, from
// base/sky.js if it is there, else from &hour= or the visitor's own clock through base/time.js. By day it draws
// nothing.
//
// Where: in ctx.slots.pool and ctx.slots.lights when the page has them, else appended to the front slot. Either way
// it must sit above the base's night grade: mount it after the grade, last in RIDES.
import { mountLights } from "./lights.js";
import { skyFromLook } from "./behaviour.js";
import { wheelLights, coasterLights, trafficLights, carouselLights, swingsLights } from "./adapters.js";

async function skySource(ctx) {
  if (ctx.sky) return () => ctx.sky;
  try {
    // Our own sky until the page shares one: the visitor's clock (the user's choice) unless &hour= or &clock= says.
    const m = await import("../../base/sky.js");
    const params = new URLSearchParams(ctx.params);
    if (!params.has("hour") && !params.has("clock")) params.set("clock", "local");
    const sky = m.getSky ? m.getSky({ params }) : m.createSky({ params }); // the page's one sky (rides/sky uses it too)
    return () => { sky.tick?.(); return sky; };
  } catch {}
  const { look } = await import("../../base/time.js");
  const fixed = ctx.params.has("hour") ? Number(ctx.params.get("hour")) : null;
  const clockHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  return () => skyFromLook(look(fixed ?? clockHour()));
}

export async function mount(ctx) {
  if (ctx.params.get("lights") === "0") return {};
  const sky = await skySource(ctx);
  const front = ctx.slots.front;
  const parents = { pool: ctx.slots.pool ?? front, lights: ctx.slots.lights ?? front };
  const here = (f) => new URL(f, ctx.dir).href;
  const night = new URL("../../tests/night-lights/", ctx.dir);
  // lights.json is the merged park (tests/night-lights/tools/merge.py: west, centre, east and the street lights,
  // one atlas). The street lights' own file is read too, so poles added after the last merge still light; a record
  // already in the merge wins (same id).
  const inventories = [
    here("lights.json"),
    new URL("../streetlights/lights.json", ctx.dir).href,
    new URL("lights_streetlights.json", night).href,
  ];
  const density = () => Math.min(1.5, Math.max(0.5, ctx.scale() * (devicePixelRatio || 1)));
  const live = ["wheel", "coaster", "traffic", "carousel", "swings"].filter((n) => window[`__${n}`]);
  const lights = await mountLights(ctx, { inventories, parents, density: density(), skip: new Set(live.includes("coaster") ? ["coaster"] : []) });
  const adapters = { wheel: wheelLights, coaster: (c) => coasterLights(c, lights.inventory), traffic: trafficLights, carousel: carouselLights, swings: swingsLights };
  for (const n of live) {
    try { for (const p of [].concat((await adapters[n](ctx)) ?? [])) lights.register(p); }
    catch (err) { console.error(`lights for ${n} failed`, err); }
  }
  window.__lights = lights;
  return {
    update(t) { lights.update(t, sky()); },
    resize() { lights.resize(density()); },
  };
}
