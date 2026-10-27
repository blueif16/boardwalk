"""Picks the smallest passing candidate per asset from score.py's output and prints the ASSETS.md tables.

  $PY tests/perf/tools/pick.py scores.jsonl [--json picks.json]

Per asset, four picks:
  same px, WebP   the current pixels re-encoded, WebP only (no code change at all: same URL, same size)
  WebP            any density, WebP only, indistinguishable (display >= 88, zoomed >= 85)
  AVIF ok         any density, any format, indistinguishable
  display only    any density, any format, display >= 88 (may soften under 2x pinch zoom)
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import ROOT, lookup  # noqa: E402


def best(rows, ok):
    rs = [r for r in rows if ok(r)]
    return min(rs, key=lambda r: r["bytes"]) if rs else None


def fmt(r):
    if not r:
        return "-", ""
    d = r["density"]
    return f"{r['variant'].replace('_', ' ')} @{d:g}" if d else r["variant"].replace("_", " "), f"{r['bytes'] / 1e3:.0f}"


def main():
    rows = [json.loads(l) for l in open(sys.argv[1])]
    by = {}
    for r in rows:
        by.setdefault(r["asset"], []).append(r)
    picks = {}
    print("| file | now kB | density now / drawn | same px, WebP | kB | WebP, right-sized | kB | score (display / zoomed) | AVIF allowed | kB | score | display-only pick | kB |")
    print("|---|---:|---|---|---:|---|---:|---|---|---:|---|---|---:|")
    tot = [0, 0, 0, 0, 0]
    for path in sorted(by, key=lambda p: -os.path.getsize(os.path.join(ROOT, p))):
        rs = by[path]
        kind, dens, rule, _s, _n = lookup(path)
        now = os.path.getsize(os.path.join(ROOT, path))
        good = lambda r: r["display"] >= 88 and r["zoomed"] >= 85  # noqa: E731
        same = best(rs, lambda r: good(r) and r["fmt"] == "webp" and (r["density"] == dens))
        webp = best(rs, lambda r: good(r) and r["fmt"] == "webp")
        anyf = best(rs, good)
        disp = best(rs, lambda r: r["display"] >= 88)
        picks[path] = {"now": now, "same_webp": same, "webp": webp, "any": anyf, "display": disp}
        for i, p in enumerate([None, same, webp, anyf, disp]):
            tot[i] += now if p is None else p["bytes"]
        s = lambda p: f"{p['display']:.1f} / {p['zoomed']:.1f}" if p else ""  # noqa: E731
        print(f"| {path} | {now / 1e3:.0f} | {dens or '-'} / {rule} | {fmt(same)[0]} | {fmt(same)[1]} | {fmt(webp)[0]} | {fmt(webp)[1]} | {s(webp)} | {fmt(anyf)[0]} | {fmt(anyf)[1]} | {s(anyf)} | {fmt(disp)[0]} | {fmt(disp)[1]} |")
    print(f"| **total ({len(by)} files)** | **{tot[0] / 1e3:.0f}** | | | **{tot[1] / 1e3:.0f}** | | **{tot[2] / 1e3:.0f}** | | | **{tot[3] / 1e3:.0f}** | | | **{tot[4] / 1e3:.0f}** |")
    if "--json" in sys.argv:
        json.dump(picks, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
