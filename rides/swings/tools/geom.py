"""The Sea Swings' geometry (rides/swings/geom.json) for the tools: the projection, rings, bands and cones in park px.

A point (X, Y, z) round the ride's axis (park px; X right, Y towards the viewer, z up from the deck) is drawn at
screen (hub.x + X, hub.y + k(z) * Y - z) with k(z) = k0 - kz * z. phi = 90 degrees is the front.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
RIDE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(RIDE))
G = json.load(open(os.path.join(RIDE, "geom.json")))
HUB = G["hub"]


def k(z):
    return G["k0"] - G["kz"] * z


def P(X, Y, z):
    return (HUB[0] + X, HUB[1] + k(z) * Y - z)


def polar(r, phi_deg, z):
    p = math.radians(phi_deg)
    return P(r * math.cos(p), r * math.sin(p), z)


def ring(r, z, a0=0, a1=360, n=144):
    return [polar(r, a0 + (a1 - a0) * i / n, z) for i in range(n + 1)]


def band(r, z0, z1, a0=0, a1=180, n=96):
    """The outer face of a cylinder r between heights z0 and z1, over phi a0..a1 (front half by default)."""
    return ring(r, z0, a0, a1, n) + ring(r, z1, a0, a1, n)[::-1]


def hull(pts):
    pts = sorted(set((round(x, 3), round(y, 3)) for x, y in pts))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def half(ps):
        h = []
        for p in ps:
            while len(h) >= 2 and cross(h[-2], h[-1], p) <= 0:
                h.pop()
            h.append(p)
        return h[:-1]
    return half(pts) + half(pts[::-1])


def canopy_z(hc):
    """Heights of the canopy's parts when its rim (where the chains hang) is at hc."""
    c = G["canopy"]
    z_band1 = hc + c["band"]
    z_collar = z_band1 + c["cone"]
    z_cup = z_collar + c["cupola_h"]
    return {"band0": hc, "band1": z_band1, "collar": z_collar, "cupola": z_cup, "top": z_cup + c["finial"]}
