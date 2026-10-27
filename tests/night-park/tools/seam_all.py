"""Seam check for the whole park: for every pair of neighbouring pieces, the dE between the two harmonised piece
fields applied to the day painting in their overlap (raw fields too, for comparison).

  uv run -q --no-project --with pillow --with numpy --with scipy python -I tools/seam_all.py [TIME...]
"""
import sys, os, json
sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image
from build import read_field, sample
from field import lab
Image.MAX_IMAGE_PIXELS = None
day = np.asarray(Image.open('gen/park_day_3840.png').convert('RGB')).astype(np.float32) / 255
XS, YS, TW, TH = [0, 1152, 2304], [0, 768, 1536], 1536, 1024
out = {}
for T in (sys.argv[1:] or ['night', 'dusk', 'golden', 'dawn']):
    rows = []
    for r in range(3):
        for c in range(3):
            for dr, dc in [(0, 1), (1, 0)]:
                r2, c2 = r + dr, c + dc
                if r2 > 2 or c2 > 2: continue
                x0, y0 = max(XS[c], XS[c2]), max(YS[r], YS[r2])
                x1, y1 = min(XS[c] + TW, XS[c2] + TW), min(YS[r] + TH, YS[r2] + TH)
                ov = [x0, y0, x1 - x0, y1 - y0]
                d = day[y0:y1, x0:x1]
                res = {}
                for kind, suf in [('raw', ''), ('harmonised', '_h')]:
                    a, b = f'gen/fields/pieces/r{r}c{c}_{T}{suf}', f'gen/fields/pieces/r{r2}c{c2}_{T}{suf}'
                    if not (os.path.exists(a + '.json') and os.path.exists(b + '.json')): continue
                    g = []
                    for p in (a, b):
                        info, A, B = read_field(p)
                        g.append(np.clip(d * sample(info, A, ov, ov[2], ov[3]) + sample(info, B, ov, ov[2], ov[3]), 0, 1))
                    res[kind] = float(np.linalg.norm(lab(g[0]) - lab(g[1]), axis=-1).mean())
                if res: rows.append({'pair': f'r{r}c{c}-r{r2}c{c2}', **{k: round(v, 2) for k, v in res.items()}})
    out[T] = rows
    if rows:
        m = lambda k: np.mean([x[k] for x in rows if k in x])
        print(f"{T}: {len(rows)} overlaps, dE raw {m('raw'):.1f}, harmonised {m('harmonised'):.1f}; worst harmonised "
              + ", ".join(f"{x['pair']} {x['harmonised']}" for x in sorted(rows, key=lambda x: -x.get('harmonised', 0))[:2]))
json.dump(out, open('gen/fields/seams.json', 'w'), indent=1)
