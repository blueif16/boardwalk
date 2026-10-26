import sys, numpy as np
from PIL import Image
def kmeans(x, k, it=30, seed=0):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)].astype(float)
    for _ in range(it):
        d = ((x[:, None, :] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        for j in range(k):
            m = x[lab == j]
            if len(m): c[j] = m.mean(0)
    return c, lab
out = sys.argv[1]
for p in sys.argv[2:]:
    im = Image.open(p).convert('RGB')
    a = np.asarray(im).reshape(-1, 3)
    rng = np.random.default_rng(1)
    s = a[rng.choice(len(a), 40000, replace=False)].astype(float)
    c, lab = kmeans(s, 18)
    share = np.bincount(lab, minlength=len(c)) / len(lab)
    order = np.argsort(-share)
    print(p.split('/')[-1])
    for j in order:
        r, g, b = c[j].astype(int)
        print(f"  #{r:02x}{g:02x}{b:02x}  {share[j]*100:5.1f}%  lum {0.2126*r+0.7152*g+0.0722*b:5.0f}")
    dark = a[(a.astype(int).sum(1) < 150)]
    print(f"  darkest-pixel mean (outline ink): #{''.join(f'{v:02x}' for v in dark.mean(0).astype(int))}  share {len(dark)/len(a)*100:.1f}%")
    sw = Image.new('RGB', (18*40, 40))
    for i, j in enumerate(order):
        sw.paste(tuple(c[j].astype(int)), (i*40, 0, i*40+40, 40))
    sw.save(f"{out}/{p.split('/')[-1].split('.')[0]}_swatch.png")
