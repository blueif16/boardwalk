"""Small fitting helpers shared by build_layout.py and render_shots.py."""
import math

import numpy as np

LAT0, LON0 = 36.9645, -122.0170
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110540.0


def en(lat, lon):
    """lat/lon -> ground metres (E, N) on the tangent plane at (LAT0, LON0)."""
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def ll(e, n):
    return (LAT0 + n / KY, LON0 + e / KX)


def fit_affine(src, dst, w=None):
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    w = np.ones(len(src)) if w is None else np.asarray(w, float)
    X = np.hstack([src, np.ones((len(src), 1))])
    sw = np.sqrt(w)[:, None]
    M, *_ = np.linalg.lstsq(X * sw, dst * sw, rcond=None)
    return M.T  # 2 x 3


def apply_affine(M, pts):
    pts = np.atleast_2d(np.asarray(pts, float))
    return pts @ M[:, :2].T + M[:, 2]


class TPS:
    """Thin-plate spline R^2 -> R^2 with per-point regularisation lam / w."""

    def __init__(self, src, dst, w=None, lam=0.02):
        src, dst = np.asarray(src, float), np.asarray(dst, float)
        self.mu = src.mean(0)
        self.sc = src.std(0).mean()
        p = (src - self.mu) / self.sc
        n = len(p)
        w = np.ones(n) if w is None else np.asarray(w, float)
        K = self._U(np.linalg.norm(p[:, None] - p[None], axis=-1)) + np.diag(lam / w)
        P = np.hstack([np.ones((n, 1)), p])
        L = np.zeros((n + 3, n + 3))
        L[:n, :n], L[:n, n:], L[n:, :n] = K, P, P.T
        Y = np.vstack([dst, np.zeros((3, 2))])
        self.coef = np.linalg.solve(L, Y)
        self.p = p

    @staticmethod
    def _U(r):
        with np.errstate(divide="ignore", invalid="ignore"):
            u = r * r * np.log(r)
        return np.nan_to_num(u)

    def __call__(self, pts):
        q = (np.atleast_2d(np.asarray(pts, float)) - self.mu) / self.sc
        n = len(self.p)
        K = self._U(np.linalg.norm(q[:, None] - self.p[None], axis=-1))
        P = np.hstack([np.ones((len(q), 1)), q])
        return K @ self.coef[:n] + P @ self.coef[n:]


