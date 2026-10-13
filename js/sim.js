// A simulated car for the demo mode and the tests. It drives whatever guidance the navigator is
// showing (the route, or the way back to it) and can be told to miss the next turn on purpose.
import { pointAt, angleDiff, bearing, indexAt, findWayBack } from './core.js';

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Seeded random numbers, so a test run can be repeated exactly
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Polyline helpers for the car's own private path
function lineAt(pts, cum, a) {
  if (a <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= a) {
      const t = (a - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
    }
  }
  return pts[pts.length - 1];
}
function projectNear(path, x, y, a0, a1) {
  let best = Infinity, at = a0;
  for (let i = indexAt(path, a0); i < path.X.length - 1 && path.along[i] <= a1; i++) {
    const dx = path.X[i + 1] - path.X[i], dy = path.Y[i + 1] - path.Y[i], L2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - path.X[i]) * dx + (y - path.Y[i]) * dy) / L2));
    const d = Math.hypot(x - (path.X[i] + u * dx), y - (path.Y[i] + u * dy));
    if (d < best) { best = d; at = path.along[i] + u * Math.sqrt(L2); }
  }
  return at;
}
const cumOf = (pts) => pts.reduce((c, p, i) => (c.push(i ? c[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), c), []);

export class SimCar {
  constructor(nav, { speed = 10, noise = 0, seed = 1, startAlong = null } = {}) {
    this.nav = nav; this.speed = speed; this.noise = noise; this.rng = seeded(seed);
    this.t = 0; this.mode = 'route';
    this.along = startAlong ?? nav.along;   // the car's true position on the route
    this.missNext = false; this.wrong = null; this.backSerial = -1; this.backPos = 0;
    const p = pointAt(nav.r, this.along);
    this.x = p[0]; this.y = p[1]; this.heading = nav.r.segB[0];
    this.driven = 0;
  }

  // Leave the route at the next instruction: carry straight on for `meters`
  planMiss(meters = 160) {
    const R = this.nav.r, net = this.nav.net, M = this.nav.man;
    const k = this.nav.nextManeuverIndex(this.along);
    for (let j = k; j < M.length - 1; j++) {
      const m = M[j], nd = R.node[m.i];
      if (nd < 0 || m.kind === 'uturn' || m.kind === 'roundabout' || m.along - this.along < 25) continue;
      const inB = R.segB[Math.max(0, m.i - 1)], outH = R.half[m.i];
      const pts = [[net.X[nd], net.Y[nd]]];
      let cur = nd, b = inB, run = 0, prev = R.half[m.i - 1], avoid = outH;
      while (run < meters) {
        let best = -1, bestD = 1e9;
        for (let q = net.adjStart[cur]; q < net.adjStart[cur + 1]; q++) {
          const h = net.adj[q];
          if (!net.allowed(h) || h === avoid || (prev >= 0 && h === (prev ^ 1))) continue;
          const d = Math.abs(angleDiff(b, net.halfBearing(h)));
          if (d < bestD) { bestD = d; best = h; }
        }
        if (best < 0) break;
        avoid = -1; cur = net.head(best); prev = best; b = net.halfBearing(best);
        pts.push([net.X[cur], net.Y[cur]]); run += net.sLen[best >> 1];
      }
      if (run < 40) continue;              // nowhere to go wrong here; try the next instruction
      this.missAt = m; this.wrongPts = pts;
      return m;
    }
    return null;
  }

  // Ignore the guidance: drive a legal path of our own to a point further along the route, then carry on
  detourTo(targetAlong) {
    const nav = this.nav, R = nav.r;
    let j = indexAt(R, targetAlong);
    while (j < R.X.length - 1 && !(R.node[j] >= 0 && R.half[j] >= 0)) j++;
    const path = findWayBack(nav.net, nav.proj, [this.x, this.y], this.heading, R.half[j]);
    if (!path) return false;
    const pts = [];
    for (let i = 0; i < path.X.length; i++) pts.push([path.X[i], path.Y[i]]);
    this.wrong = { pts, cum: cumOf(pts), pos: 0 }; this.mode = 'wrong';
    this.afterWrong = { along: R.along[j] + (path.total - path.along[path.X.length - 2]) };
    return true;
  }

  step(dt) {
    this.t += dt * 1000;
    const nav = this.nav, R = nav.r, d = this.speed * dt;
    const ox = this.x, oy = this.y;
    if (this.mode === 'route' && this.missAt && this.along + d >= this.missAt.along) {
      this.along = this.missAt.along;
      this.wrong = { pts: this.wrongPts, cum: cumOf(this.wrongPts), pos: 0 };
      this.mode = 'wrong'; this.missAt = null;
    }
    if (this.mode === 'route') {
      this.along = Math.min(R.total, this.along + d);
      [this.x, this.y] = pointAt(R, this.along);
    } else if (this.mode === 'wrong') {
      const w = this.wrong;
      w.pos += d;
      [this.x, this.y] = lineAt(w.pts, w.cum, w.pos);
      if (w.pos >= w.cum[w.cum.length - 1]) {
        if (this.afterWrong) { this.mode = 'route'; this.along = this.afterWrong.along; this.afterWrong = null; }
        else this.mode = 'follow';
      }
    } else if (this.mode === 'follow') {
      // Follow the navigator's way back; once it says we are on the route again, drive the route
      if (nav.mode === 'route') {
        // Carry on along the route from where the car really is (near the navigator's estimate)
        this.mode = 'route'; this.along = projectNear(R, this.x, this.y, nav.along - 80, nav.along + 80);
        [this.x, this.y] = pointAt(R, this.along);
      } else if (nav.back && nav.back.path) {
        const p = nav.back.path;
        if (p.serial !== this.backSerial) {        // a new way back: start from where the car really is
          this.backSerial = p.serial; this.backPos = 0;
          let best = Infinity;
          for (let i = 0; i < p.X.length - 1; i++) {
            const dx = p.X[i + 1] - p.X[i], dy = p.Y[i + 1] - p.Y[i], L2 = dx * dx + dy * dy || 1;
            const u = Math.max(0, Math.min(1, ((this.x - p.X[i]) * dx + (this.y - p.Y[i]) * dy) / L2));
            const d = Math.hypot(this.x - (p.X[i] + u * dx), this.y - (p.Y[i] + u * dy));
            if (d < best) { best = d; this.backPos = p.along[i] + u * Math.sqrt(L2); }
          }
        }
        this.backPos = Math.min(p.total, this.backPos + d);
        [this.x, this.y] = pointAt(p, this.backPos);
        if (this.backPos >= p.total) {            // end of the way back = on the route at the target
          this.mode = 'route'; this.along = nav.back.target.along + (p.total - p.along[p.X.length - 2]);
        }
      }
    }
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.driven += moved;
    if (moved > 0.3) this.heading = bearing(ox, oy, this.x, this.y);
    const n = this.noise;
    return {
      x: this.x + (n ? gauss(this.rng) * n : 0), y: this.y + (n ? gauss(this.rng) * n : 0), t: this.t,
      acc: n ? Math.max(4, n * 1.5) : 3, speed: this.speed,
      heading: (this.heading + (n ? gauss(this.rng) * 4 : 0) + 360) % 360,
    };
  }
}
