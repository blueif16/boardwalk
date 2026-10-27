"""Seam check for the prototype: night fields of two overlapping pieces, raw and harmonised (see RESULTS.md)."""
import sys
sys.path.insert(0, 'tools')
import numpy as np
from PIL import Image
from build import read_field, sample
from field import lab
Image.MAX_IMAGE_PIXELS = None
ov = [1682, 638, 384, 1024]
hd = Image.open('../../gen/park/world_v2_hd.png').convert('RGB')
day = np.asarray(hd.crop((1682 * 2.5, 638 * 2.5, (1682 + 384) * 2.5, (638 + 1024) * 2.5)).resize((384, 1024), Image.LANCZOS)).astype(np.float32) / 255
def g(n):
    info, A, B = read_field('gen/fields/' + n); return np.clip(day * sample(info, A, ov, 384, 1024) + sample(info, B, ov, 384, 1024), 0, 1)
for a, b in [('piece_night', 'left_night'), ('piece_night_h', 'left_night_h')]:
    d = np.linalg.norm(lab(g(a)) - lab(g(b)), axis=-1)
    print(a, 'vs', b, 'overlap dE mean %.1f p95 %.1f; town band %.1f, park %.1f, sand %.1f' % (d.mean(), np.percentile(d, 95), d[:362].mean(), d[362:762].mean(), d[762:].mean()))
d = np.linalg.norm(lab(g('piece_night')) - lab(g('piece_night_h')), axis=-1); print('piece raw vs harmonised: dE mean %.1f' % d.mean())
u = [530, 638, 2688, 1024]
dayu = np.asarray(hd.crop((530 * 2.5, 638 * 2.5, (530 + 2688) * 2.5, (638 + 1024) * 2.5)).resize((2688, 1024), Image.LANCZOS)).astype(np.float32) / 255
for n in ['union_night_raw', 'union_night_harm', 'night_park']:
    info, A, B = read_field('gen/fields/' + n)
    o = np.clip(dayu * sample(info, A, u, 2688, 1024) + sample(info, B, u, 2688, 1024), 0, 1)
    Image.fromarray((o * 255 + .5).astype(np.uint8)).save('gen/union_' + n + '.png')
