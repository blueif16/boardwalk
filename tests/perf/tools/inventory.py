"""Inventory of what the page loads: format, size, pixels, decoded bytes, density, and for text what gzip and brotli
make of it (the dev server sends everything raw; any real host compresses text).

  PY=/tmp/claude-1000/boardwalk-assets/py   (uv run --no-project --with pillow,numpy,brotli,... python -I)
  $PY tests/perf/tools/inventory.py [measure.json] > tests/perf/shots/inventory.md

measure.json comes from measure.mjs; without it every image under site/park, rides/*/ and tests/park-crowd is listed.
"""
import glob, gzip, io, json, os, struct, sys

import brotli
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assets import ROOT, lookup  # noqa: E402


def webp_chunks(data):
    """The RIFF chunk names of a WebP: VP8 (lossy), VP8L (lossless), ALPH (lossy's alpha plane), VP8X."""
    out, i = [], 12
    while i + 8 <= len(data):
        name, size = data[i:i + 4].decode("latin1").strip(), struct.unpack("<I", data[i + 4:i + 8])[0]
        extra = ""
        if name == "ALPH":
            b = data[i + 8]
            extra = f"(c{b & 3},f{(b >> 2) & 3},p{(b >> 4) & 3})"  # compression 1 = lossless, filter, pre-processing
        out.append(name + extra)
        i += 8 + size + (size & 1)
    return out


def describe(path):
    data = open(os.path.join(ROOT, path), "rb").read()
    info = {"path": path, "bytes": len(data)}
    ext = path.rsplit(".", 1)[-1]
    if ext in ("webp", "png", "avif", "jpg"):
        im = Image.open(io.BytesIO(data))
        info.update(w=im.width, h=im.height, mode=im.mode, decoded=im.width * im.height * 4)
        if ext == "webp":
            ch = webp_chunks(data)
            info["format"] = "webp " + ("lossless" if "VP8L" in ch else "lossy") + (" +alpha" if any(c.startswith("ALPH") for c in ch) or ("VP8L" in ch and im.mode == "RGBA") else "")
        else:
            info["format"] = f"png {im.mode}" + (" palette" if im.mode == "P" else "")
        info["bpp"] = round(len(data) * 8 / (im.width * im.height), 2)
        meta = lookup(path)
        if meta:
            info.update(kind=meta[0], density=meta[1], draw=meta[2], note=meta[4])
    elif ext in ("json", "js", "mjs", "html", "css"):
        text = data
        info["format"] = ext
        info["gzip"] = len(gzip.compress(text, 9))
        info["br"] = len(brotli.compress(text, quality=11))
        if ext == "json":
            mini = json.dumps(json.loads(text), separators=(",", ":")).encode()
            info["minified"] = len(mini)
            info["minified_br"] = len(brotli.compress(mini, quality=11))
    else:
        info["format"] = ext
    return info


def main():
    if len(sys.argv) > 1:
        runs = json.load(open(sys.argv[1]))
        paths = []
        for r in runs:
            for f in r["files"]:
                u = f["url"]
                if "localhost" in u or "127.0.0.1" in u:
                    p = u.split("/", 3)[-1].split("?")[0]
                    if p and p not in paths and f["status"] == 200:
                        paths.append(p)
    else:
        paths = sorted(glob.glob("site/park/*.webp", root_dir=ROOT) + glob.glob("rides/*/*.webp", root_dir=ROOT)
                       + glob.glob("rides/*/*.png", root_dir=ROOT) + glob.glob("tests/park-crowd/*.png", root_dir=ROOT))
    rows = [describe(p) for p in paths if os.path.exists(os.path.join(ROOT, p))]
    json.dump(rows, open(os.path.join(ROOT, "tests/perf/shots/inventory.json"), "w"), indent=1)
    img = [r for r in rows if "w" in r]
    txt = [r for r in rows if "gzip" in r]
    print("| file | bytes | format | px | bits/px | decoded MB | kind | density | drawn |")
    print("|---|---:|---|---|---:|---:|---|---:|---|")
    for r in sorted(img, key=lambda r: -r["bytes"]):
        print(f"| {r['path']} | {r['bytes']:,} | {r['format']} | {r['w']}x{r['h']} | {r['bpp']} | {r['decoded'] / 1e6:.1f} | {r.get('kind', '')} | {r.get('density') or ''} | {r.get('draw', '')} |")
    print(f"\nimages: {len(img)} files, {sum(r['bytes'] for r in img):,} bytes, decoded {sum(r['decoded'] for r in img) / 1e6:.1f} MB\n")
    print("| file | raw | gzip -9 | brotli 11 | minified | minified + br |")
    print("|---|---:|---:|---:|---:|---:|")
    for r in sorted(txt, key=lambda r: -r["bytes"]):
        print(f"| {r['path']} | {r['bytes']:,} | {r['gzip']:,} | {r['br']:,} | {r.get('minified', ''):,} | {r.get('minified_br', ''):,} |" if "minified" in r else
              f"| {r['path']} | {r['bytes']:,} | {r['gzip']:,} | {r['br']:,} | | |")
    print(f"\ntext: {len(txt)} files, raw {sum(r['bytes'] for r in txt):,}, gzip {sum(r['gzip'] for r in txt):,}, brotli {sum(r['br'] for r in txt):,}")


if __name__ == "__main__":
    main()
