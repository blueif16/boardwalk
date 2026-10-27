"""Pole positions (park px) from the traffic lanes' traced lines: north poles stand on the north sidewalk just behind
the north kerb, south poles on the south sidewalk just in front of the south kerb (east of the kerb line's end, the
eastbound wheel line + an offset). Writes rides/streetlights/positions.json."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from base import ROOT

lanes = json.load(open(os.path.join(ROOT, "rides/traffic/lanes.json")))
L = lanes["lines"]
def line_y(name, x):
    p = np.array(L[name], float)
    return float(np.interp(x, p[:, 0], p[:, 1]))
loop = np.array(lanes["loop"], float)
eb = loop[: lanes["turn"][0]]            # eastbound part of the loop
def eb_y(x):
    o = np.argsort(eb[:, 0]); return float(np.interp(x, eb[o, 0], eb[o, 1]))

ey = 0.877                  # screen px per unit of height (camera pitch 28.7)
ez = (-0.408, 0.437)        # screen px per ground unit toward the viewer (south)
HEIGHT = 112                # pole height in ground units (about 7 m at a car = 4.5 m = 74 units)
ARM = 34                    # arm reach in ground units, out over the road

NORTH = [215, 585, 930, 1425, 1770, 2350, 2775]
SOUTH = [405, 655, 1655, 2170, 2490, 3285]
FOOT_Y = {"n1": 586}            # where the traced line is off the painted kerb
OFF_N, OFF_S = -6, 8        # foot offset from the kerb line (screen px)
poles = []
for i, x in enumerate(NORTH):
    fy = FOOT_Y.get(f"n{i + 1}", line_y("north", x) + OFF_N)
    top = fy - HEIGHT * ey
    # arm toward the viewer, out over the stalls: 54 units out (-22, +24 on screen) rising 16 (-14): (-22, +8)
    poles.append({"id": f"n{i + 1}", "side": "north", "foot": [x, round(fy, 1)], "top": [x, round(top, 1)],
                  "head": [x - 22, round(top + 8, 1)]})
for i, x in enumerate(SOUTH):
    fy = (line_y("kerb", x) if x <= 2440 else eb_y(x) + 34) + OFF_S
    top = fy - HEIGHT * ey
    # arm away from the viewer, over the road; drawn as the model paints it (v1 edits): (+30, -16)
    poles.append({"id": f"s{i + 1}", "side": "south", "foot": [x, round(fy, 1)], "top": [x, round(top, 1)],
                  "head": [x + 30, round(top - 16, 1)]})
json.dump({"about": "Street-light poles on Beach Street, park px. foot = where the pole meets the sidewalk; top = top of the shaft; head = the LED head at the end of the arm. side: north (cars pass in front: plate only) or south (cars pass behind: also a front cut-out). Made by tools/make_positions.py; adjusted to the painted poles by tools/measure.py.",
           "height_units": HEIGHT, "arm_units": ARM, "poles": poles}, open(os.path.join(ROOT, "rides/streetlights/positions.json"), "w"), indent=1)
for p in poles: print(p)
