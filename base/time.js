export const KEYS = [
  { hour: 0, name: "night", tint: "#4a5a8c", exposure: 0.62, saturation: 0.8, lights: 1, sky: "#1c2440", sea: "#21456b" },
  { hour: 5.5, name: "night", tint: "#4a5a8c", exposure: 0.62, saturation: 0.8, lights: 1, sky: "#1c2440", sea: "#21456b" },
  { hour: 6.5, name: "morning", tint: "#f4dccb", exposure: 0.97, saturation: 0.92, lights: 0.2, sky: "#f0cdb0", sea: "#6aa8cf" },
  { hour: 9, name: "morning", tint: "#fff3e6", exposure: 1, saturation: 0.97, lights: 0, sky: "#cfe3f0", sea: "#5eaed9" },
  { hour: 11, name: "midday", tint: "#ffffff", exposure: 1, saturation: 1, lights: 0, sky: "#bcdcf0", sea: "#54b3d9" },
  { hour: 16, name: "midday", tint: "#ffffff", exposure: 1, saturation: 1, lights: 0, sky: "#bcdcf0", sea: "#54b3d9" },
  { hour: 18, name: "golden", tint: "#ffd2a8", exposure: 0.95, saturation: 1.06, lights: 0.25, sky: "#f6c08e", sea: "#5d9cc4" },
  { hour: 19.3, name: "golden", tint: "#f0a98c", exposure: 0.82, saturation: 1.02, lights: 0.7, sky: "#d9897a", sea: "#4a7fae" },
  { hour: 20.5, name: "night", tint: "#4a5a8c", exposure: 0.62, saturation: 0.8, lights: 1, sky: "#1c2440", sea: "#21456b" },
  { hour: 24, name: "night", tint: "#4a5a8c", exposure: 0.62, saturation: 0.8, lights: 1, sky: "#1c2440", sea: "#21456b" },
];

export const NAMED = { morning: 8, midday: 13, golden: 18.6, night: 22 };

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => a + (b - a) * t;
const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => mix(v, hex(b)[i], t)));

export function look(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = b.hour === a.hour ? 0 : (h - a.hour) / (b.hour - a.hour);
  const s = t * t * (3 - 2 * t);
  return {
    hour: h,
    name: s < 0.5 ? a.name : b.name,
    tint: mixHex(a.tint, b.tint, s),
    exposure: mix(a.exposure, b.exposure, s),
    saturation: mix(a.saturation, b.saturation, s),
    lights: mix(a.lights, b.lights, s),
    sky: mixHex(a.sky, b.sky, s),
    sea: mixHex(a.sea, b.sea, s),
  };
}

export function createTime(search = location.search) {
  const q = new URLSearchParams(search).get("time");
  const listeners = new Set();
  let fixed = q == null ? null : q in NAMED ? NAMED[q] : Number(q);
  if (fixed != null && !Number.isFinite(fixed)) fixed = null;
  const clockHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  let current = look(fixed ?? clockHour());

  function set(hour) {
    fixed = hour;
    current = look(hour);
    listeners.forEach((f) => f(current));
  }

  setInterval(() => { if (fixed == null) { current = look(clockHour()); listeners.forEach((f) => f(current)); } }, 30000);

  return {
    get look() { return current; },
    get following() { return fixed == null; },
    set,
    follow() { fixed = null; current = look(clockHour()); listeners.forEach((f) => f(current)); },
    onChange(f) { listeners.add(f); f(current); return () => listeners.delete(f); },
  };
}
