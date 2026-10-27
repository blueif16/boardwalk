"""Every place a car on the loop passes an occluder piece: rides/traffic/gen/crossings.json, a list of
[loop index, piece index, kind, sortY, [x, y]] (one per piece per pass, at the car centre nearest the piece's middle).

  uv run -q --no-project --with numpy python -I rides/traffic/tools/crossings.py
"""
import json, os
import numpy as np

RIDE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
l = json.load(open(os.path.join(RIDE, "lanes.json")))
occ = json.load(open(os.path.join(RIDE, "occ.json")))
lp = np.array(l["loop"])
out = []
for i, p in enumerate(occ["pieces"]):
    x, y, w, h = p["at"]
    ok = (lp[:, 0] + 44 > x) & (lp[:, 0] - 44 < x + w) & (lp[:, 1] - 50 < y + h) & (lp[:, 1] + 22 > y)
    idx = np.where(ok)[0]
    if not len(idx):
        continue
    for run in np.split(idx, np.where(np.diff(idx) > 5)[0] + 1):
        s = int(run[np.argmin(np.abs(lp[run, 0] - (x + w / 2)))])
        out.append([s, i, p["kind"], round(p["sortY"]), [round(v) for v in lp[s]]])
out.sort()
json.dump(out, open(os.path.join(RIDE, "gen/crossings.json"), "w"))
front = sum(1 for c in out if c[3] > c[4][1])
print(f"{len(out)} crossings: {front} with the piece in front of the car, {len(out) - front} behind it")
