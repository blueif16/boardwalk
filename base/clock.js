export function createClock(search = location.search) {
  const q = new URLSearchParams(search).get("t");
  const frozen = q == null ? null : Number(q);
  const start = performance.now();
  let rate = 1, offset = 0, last = start;
  return {
    get frozen() { return frozen != null; },
    now() {
      if (frozen != null) return frozen;
      const n = performance.now();
      offset += ((n - last) / 1000) * rate;
      last = n;
      return offset;
    },
    setRate(r) { this.now(); rate = r; },
  };
}
