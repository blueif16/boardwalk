"""What the JSON data costs on the wire, as is and after minifying / rounding coordinates, raw, gzip -9 and brotli 11
(what a static host such as Vercel, Netlify or Cloudflare Pages sends for text).

  $PY tests/perf/tools/data.py [files...]       (default: every .json the page loads, from shots/inventory.json)

Rounding: every float to 1 decimal (0.1 park px = 0.1-0.25 device px at the densities used) and to whole park px.
Point lists sampled at 1 px of arc length could also be stored as every 4th point and interpolated (ASSETS.md);
'every4' estimates that for the lists of [x, y] pairs.
"""
import gzip, json, os, sys

import brotli

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import ROOT  # noqa: E402


def rounded(v, nd):
    if isinstance(v, float):
        r = round(v, nd)
        return int(r) if nd == 0 or r == int(r) else r
    if isinstance(v, list):
        return [rounded(x, nd) for x in v]
    if isinstance(v, dict):
        return {k: rounded(x, nd) for k, x in v.items()}
    return v


def thinned(v):
    if isinstance(v, list) and len(v) > 200 and all(isinstance(p, list) and len(p) >= 2 and all(isinstance(c, (int, float)) for c in p) for p in v[:50]):
        return v[::4]
    if isinstance(v, list):
        return [thinned(x) for x in v]
    if isinstance(v, dict):
        return {k: thinned(x) for k, x in v.items()}
    return v


def sizes(b):
    return len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11))


def main():
    files = sys.argv[1:]
    if not files:
        inv = json.load(open(os.path.join(ROOT, "tests/perf/shots/inventory.json")))
        files = [r["path"] for r in inv if r["path"].endswith(".json")]
    print("| file | as shipped raw / gz / br | minified br | rounded 0.1 br | rounded 1 br | every 4th point, 0.1, br |")
    print("|---|---|---:|---:|---:|---:|")
    tot = [0, 0, 0, 0, 0, 0]
    for f in sorted(files, key=lambda f: -os.path.getsize(os.path.join(ROOT, f))):
        raw = open(os.path.join(ROOT, f), "rb").read()
        j = json.loads(raw)
        mini = json.dumps(j, separators=(",", ":")).encode()
        r1 = json.dumps(rounded(j, 1), separators=(",", ":")).encode()
        r0 = json.dumps(rounded(j, 0), separators=(",", ":")).encode()
        t4 = json.dumps(rounded(thinned(j), 1), separators=(",", ":")).encode()
        s = sizes(raw)
        row = [s[0], s[1], s[2], sizes(mini)[2], sizes(r1)[2], sizes(r0)[2], sizes(t4)[2]]
        for i, v in enumerate([s[0], s[2], row[3], row[4], row[5], row[6]]):
            tot[i] += v
        if s[0] > 2000:
            print(f"| {f} | {s[0]:,} / {s[1]:,} / {s[2]:,} | {row[3]:,} | {row[4]:,} | {row[5]:,} | {row[6]:,} |")
    print(f"| **all {len(files)} JSON files** | {tot[0]:,} raw, {tot[1]:,} br | {tot[2]:,} | {tot[3]:,} | {tot[4]:,} | {tot[5]:,} |")


if __name__ == "__main__":
    main()
