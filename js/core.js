// Survey Navigator core: GPX -> route on the street network -> turn list -> live guidance.
// No DOM in this file, so the same code runs on the phone and in the Node tests.

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ geometry */

export function projection(lat0, lon0) {
  const p = lat0 * DEG;
  const ky = 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  return {
    lat0, lon0, kx, ky,
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLL: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}

export function bearing(x1, y1, x2, y2) {
  const b = Math.atan2(x2 - x1, y2 - y1) / DEG;
  return b < 0 ? b + 360 : b;
}

// Signed turn from heading a to heading b, in (-180, 180]; positive = clockwise = right.
export function angleDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

function onSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return { t, d: Math.hypot(px - qx, py - qy), x: qx, y: qy };
}

/* ------------------------------------------------------------------ GPX */

export function parseGpx(text) {
  const grab = (tag) => {
    const out = [];
    const re = new RegExp('<(?:[\\w-]+:)?' + tag + '\\b([^>]*)>', 'g');
    for (let m; (m = re.exec(text)); ) {
      const la = /\blat\s*=\s*["']\s*([-+0-9.eE]+)/.exec(m[1]);
      const lo = /\blon\s*=\s*["']\s*([-+0-9.eE]+)/.exec(m[1]);
      if (la && lo && Number.isFinite(+la[1]) && Number.isFinite(+lo[1])) out.push([+la[1], +lo[1]]);
    }
    return out;
  };
  let points = grab('trkpt');
  if (points.length < 2) points = grab('rtept');
  if (points.length < 2) throw new Error('no-points');
  const nm = /<(?:[\w-]+:)?name>\s*([\s\S]*?)\s*<\/(?:[\w-]+:)?name>/.exec(text);
  return { name: nm ? decodeXml(nm[1]) : '', points };
}

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function hashText(s) {          // FNV-1a, enough to tell one day's file from another
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ street network */

// Flag bits written by tools/build_network.py
const F_CLASS = 15, F_ROUND = 64, F_DENIED = 128, F_MINOR = 256;
const oneway = (f) => ((f >> 4) & 3) - 1;
const MINOR_CLASSES = new Set([8]);            // service

export class Network {
  // doc: parsed tbilisi-net.json; box: [minLat, minLon, maxLat, maxLon] to keep (null = all)
  constructor(doc, proj, box) {
    this.proj = proj;
    this.names = doc.names;
    const flat = doc.nodes, nAll = flat.length >> 1;
    const lat = new Float64Array(nAll), lon = new Float64Array(nAll);
    for (let i = 0, x = 0, y = 0; i < nAll; i++) {
      x += flat[2 * i]; y += flat[2 * i + 1];
      lon[i] = x / 1e6; lat[i] = y / 1e6;
    }
    const local = new Int32Array(nAll).fill(-1);
    const wayLocal = new Int32Array(doc.ways.length).fill(-1);
    const X = [], Y = [], wFlags = [], wName = [], wEn = [], wRef = [], wStart = [0], wNodes = [];
    doc.ways.forEach((row, wi) => {
      const refs = [];
      for (let k = 4, prev = 0; k < row.length; k++) { prev += row[k]; refs.push(prev); }
      let keep = !box;
      if (box) for (const r of refs) {
        if (lat[r] >= box[0] && lat[r] <= box[2] && lon[r] >= box[1] && lon[r] <= box[3]) { keep = true; break; }
      }
      if (!keep) return;
      wayLocal[wi] = wFlags.length;
      wFlags.push(row[0]); wName.push(row[1]); wEn.push(row[2]); wRef.push(row[3]);
      for (const r of refs) {
        if (local[r] < 0) {
          local[r] = X.length;
          const [x, y] = proj.toXY(lat[r], lon[r]);
          X.push(x); Y.push(y);
        }
        wNodes.push(local[r]);
      }
      wStart.push(wNodes.length);
    });
    this.X = Float64Array.from(X); this.Y = Float64Array.from(Y);
    this.wFlags = Uint16Array.from(wFlags); this.wName = Int32Array.from(wName);
    this.wEn = Int32Array.from(wEn); this.wRef = Int32Array.from(wRef);
    const nN = X.length;

    // Segments: consecutive node pairs of every way. Half-edge h = 2*s (A->B) or 2*s+1 (B->A).
    const sA = [], sB = [], sW = [];
    for (let w = 0; w < wFlags.length; w++) {
      for (let k = wStart[w]; k < wStart[w + 1] - 1; k++) {
        const a = wNodes[k], b = wNodes[k + 1];
        if (a === b) continue;
        sA.push(a); sB.push(b); sW.push(w);
      }
    }
    const nS = sA.length;
    this.sA = Int32Array.from(sA); this.sB = Int32Array.from(sB); this.sW = Int32Array.from(sW);
    this.sLen = new Float64Array(nS);
    for (let s = 0; s < nS; s++) this.sLen[s] = Math.hypot(X[sB[s]] - X[sA[s]], Y[sB[s]] - Y[sA[s]]);

    // Node -> leaving half-edges (CSR)
    const deg = new Int32Array(nN + 1);
    for (let s = 0; s < nS; s++) { deg[sA[s]]++; deg[sB[s]]++; }
    const start = new Int32Array(nN + 1);
    for (let i = 0; i < nN; i++) start[i + 1] = start[i] + deg[i];
    const fill = start.slice(0, nN), adj = new Int32Array(start[nN]);
    for (let s = 0; s < nS; s++) { adj[fill[sA[s]]++] = 2 * s; adj[fill[sB[s]]++] = 2 * s + 1; }
    this.adjStart = start; this.adj = adj;
    // Junction degree = number of distinct neighbouring nodes
    this.deg = new Uint8Array(nN);
    for (let n = 0; n < nN; n++) {
      const seen = new Set();
      for (let k = start[n]; k < start[n + 1]; k++) seen.add(this.head(adj[k]));
      this.deg[n] = Math.min(255, seen.size);
    }

    // Spatial grid over segments (CSR), 40 m cells
    const C = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nN; i++) {
      if (X[i] < minX) minX = X[i]; if (X[i] > maxX) maxX = X[i];
      if (Y[i] < minY) minY = Y[i]; if (Y[i] > maxY) maxY = Y[i];
    }
    this.C = C; this.minX = minX; this.minY = minY;
    this.ncx = Math.max(1, Math.ceil((maxX - minX) / C) + 1);
    this.ncy = Math.max(1, Math.ceil((maxY - minY) / C) + 1);
    const cells = (s, cb) => {
      const x0 = Math.floor((Math.min(X[sA[s]], X[sB[s]]) - minX) / C), x1 = Math.floor((Math.max(X[sA[s]], X[sB[s]]) - minX) / C);
      const y0 = Math.floor((Math.min(Y[sA[s]], Y[sB[s]]) - minY) / C), y1 = Math.floor((Math.max(Y[sA[s]], Y[sB[s]]) - minY) / C);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) cb(cy * this.ncx + cx);
    };
    const gcount = new Int32Array(this.ncx * this.ncy + 1);
    for (let s = 0; s < nS; s++) cells(s, (c) => gcount[c + 1]++);
    for (let c = 0; c < this.ncx * this.ncy; c++) gcount[c + 1] += gcount[c];
    const gfill = gcount.slice(0, this.ncx * this.ncy), gl = new Int32Array(gcount[this.ncx * this.ncy]);
    for (let s = 0; s < nS; s++) cells(s, (c) => { gl[gfill[c]++] = s; });
    this.gStart = gcount; this.gList = gl;

    // Turn restrictions keyed by via node
    this.restr = new Map();
    for (const [f, v, t, kind] of doc.restrictions || []) {
      const fw = wayLocal[f], tw = wayLocal[t], vn = local[v];
      if (fw < 0 || tw < 0 || vn < 0) continue;
      if (!this.restr.has(vn)) this.restr.set(vn, []);
      this.restr.get(vn).push({ from: fw, to: tw, kind });
    }
    this.nodeCount = nN; this.segCount = nS;
  }

  tail(h) { return h & 1 ? this.sB[h >> 1] : this.sA[h >> 1]; }
  head(h) { return h & 1 ? this.sA[h >> 1] : this.sB[h >> 1]; }
  way(h) { return this.sW[h >> 1]; }
  flags(h) { return this.wFlags[this.sW[h >> 1]]; }
  isRound(h) { return (this.flags(h) & F_ROUND) !== 0; }
  isMinor(h) { const f = this.flags(h); return (f & F_MINOR) !== 0; }
  isService(h) { return MINOR_CLASSES.has(this.flags(h) & F_CLASS); }
  allowed(h) {
    const f = this.flags(h);
    if (f & F_DENIED) return false;
    const o = oneway(f);
    return o === 0 || (o === 1 ? (h & 1) === 0 : (h & 1) === 1);
  }
  halfBearing(h) {
    const a = this.tail(h), b = this.head(h);
    return bearing(this.X[a], this.Y[a], this.X[b], this.Y[b]);
  }
  nameOf(w) { return this.names[this.wName[w]] || ''; }
  enOf(w) { return this.names[this.wEn[w]] || ''; }
  refOf(w) { return this.names[this.wRef[w]] || ''; }

  // Next half-edge continuing the same way through a node (or -1)
  continueWay(h) {
    const n = this.head(h), w = this.way(h);
    for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
      const g = this.adj[k];
      if (g !== (h ^ 1) && this.way(g) === w) return g;
    }
    return -1;
  }

  // Bearing of a branch leaving a junction, measured `dist` metres along it
  branchBearing(h, dist) {
    const n0 = this.tail(h);
    let g = h, run = 0, x = this.X[n0], y = this.Y[n0];
    for (let guard = 0; guard < 50 && g >= 0; guard++) {
      const s = g >> 1, b = this.head(g), L = this.sLen[s];
      if (run + L >= dist) {
        const t = (dist - run) / L;
        x = this.X[this.tail(g)] + t * (this.X[b] - this.X[this.tail(g)]);
        y = this.Y[this.tail(g)] + t * (this.Y[b] - this.Y[this.tail(g)]);
        break;
      }
      run += L; x = this.X[b]; y = this.Y[b];
      if (this.deg[b] >= 3 && run >= 4) break;
      g = this.continueWay(g);
    }
    return bearing(this.X[n0], this.Y[n0], x, y);
  }

  forCells(x, y, r, cb) {
    const C = this.C;
    const x0 = Math.max(0, Math.floor((x - r - this.minX) / C)), x1 = Math.min(this.ncx - 1, Math.floor((x + r - this.minX) / C));
    const y0 = Math.max(0, Math.floor((y - r - this.minY) / C)), y1 = Math.min(this.ncy - 1, Math.floor((y + r - this.minY) / C));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = cy * this.ncx + cx;
      for (let k = this.gStart[c]; k < this.gStart[c + 1]; k++) cb(this.gList[k]);
    }
  }

  // Exact position of a GPX vertex on the network: a node, a point inside a segment, or null
  snap(x, y, nodeTol = 1.2, segTol = 4) {
    let bestN = -1, bestNd = nodeTol, bestS = -1, bestSd = segTol, bestT = 0, bx = 0, by = 0;
    this.forCells(x, y, segTol, (s) => {
      for (const n of [this.sA[s], this.sB[s]]) {
        const d = Math.hypot(this.X[n] - x, this.Y[n] - y);
        if (d < bestNd) { bestNd = d; bestN = n; }
      }
      const q = onSeg(x, y, this.X[this.sA[s]], this.Y[this.sA[s]], this.X[this.sB[s]], this.Y[this.sB[s]]);
      if (q.d < bestSd) { bestSd = q.d; bestS = s; bestT = q.t; bx = q.x; by = q.y; }
    });
    if (bestN >= 0) return { node: bestN, x: this.X[bestN], y: this.Y[bestN] };
    if (bestS >= 0) {
      if (bestT < 1e-6) return { node: this.sA[bestS], x: this.X[this.sA[bestS]], y: this.Y[this.sA[bestS]] };
      if (bestT > 1 - 1e-6) return { node: this.sB[bestS], x: this.X[this.sB[bestS]], y: this.Y[this.sB[bestS]] };
      return { node: -1, s: bestS, t: bestT, x: bx, y: by };
    }
    return null;
  }

  // Nearest drivable half-edge for a moving car (heading in degrees or null)
  snapCar(x, y, heading, maxD = 45) {
    let best = null;
    this.forCells(x, y, maxD, (s) => {
      const q = onSeg(x, y, this.X[this.sA[s]], this.Y[this.sA[s]], this.X[this.sB[s]], this.Y[this.sB[s]]);
      if (q.d > maxD) return;
      for (const h of [2 * s, 2 * s + 1]) {
        if (!this.allowed(h)) continue;
        let pen = 0;
        if (heading != null) {
          const diff = Math.abs(angleDiff(heading, this.halfBearing(h)));
          pen = diff > 100 ? 80 : diff > 60 ? 30 : diff > 35 ? 8 : 0;
        }
        if (this.isMinor(h)) pen += 6;
        const score = q.d + pen;
        if (!best || score < best.score) {
          const t = h & 1 ? 1 - q.t : q.t;   // fraction travelled along the half-edge
          best = { h, score, d: q.d, x: q.x, y: q.y, remain: (1 - t) * this.sLen[s] };
        }
      }
    });
    return best;
  }

  // Is the turn h1 -> h2 (through head(h1)) banned by a turn restriction?
  banned(h1, h2) {
    const list = this.restr.get(this.head(h1));
    if (!list) return false;
    const w1 = this.way(h1), w2 = this.way(h2), isU = h2 === (h1 ^ 1);
    for (const r of list) {
      if (r.from !== w1) continue;
      if (r.from === r.to && !isU) continue;            // a from=to rule only ever means the U-turn
      if (r.kind >= 5 && r.kind <= 7) { if (r.to !== w2) return true; }
      else if (r.to === w2) return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ min-heap */

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, topK = k[0], topV = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK;
    return topV;
  }
}

/* ------------------------------------------------------------------ GPX -> route on the network */

// Shortest path between two snapped positions, ignoring one-way rules (the GPX is the truth here).
function connect(net, a, b, maxCost) {
  const steps = [];
  const segPoint = (s, t) => [net.X[net.sA[s]] + t * (net.X[net.sB[s]] - net.X[net.sA[s]]), net.Y[net.sA[s]] + t * (net.Y[net.sB[s]] - net.Y[net.sA[s]])];
  if (a.node < 0 && b.node < 0 && a.s === b.s) {
    steps.push({ h: b.t > a.t ? 2 * b.s : 2 * b.s + 1, x: b.x, y: b.y, node: -1 });
    return steps;
  }
  if (a.node >= 0 && b.node >= 0 && a.node === b.node) return steps;
  // sources: node -> {cost, firstHalf}; targets: node -> {cost, lastHalf}
  const src = a.node >= 0 ? [[a.node, 0, -1]] : [[net.sA[a.s], a.t * net.sLen[a.s], 2 * a.s + 1], [net.sB[a.s], (1 - a.t) * net.sLen[a.s], 2 * a.s]];
  const dst = b.node >= 0 ? [[b.node, 0, -1]] : [[net.sA[b.s], b.t * net.sLen[b.s], 2 * b.s], [net.sB[b.s], (1 - b.t) * net.sLen[b.s], 2 * b.s + 1]];
  const dstMap = new Map(dst.map(([n, c, h]) => [n, { c, h }]));
  const dist = new Map(), prev = new Map(), heap = new Heap();
  for (const [n, c, h] of src) {
    if (!dist.has(n) || c < dist.get(n)) { dist.set(n, c); prev.set(n, { h, from: -1 }); heap.push(c, n); }
  }
  let best = Infinity, bestNode = -1;
  while (heap.size) {
    const n = heap.pop(), c = heap.lastKey;
    if (c > dist.get(n) || c > maxCost || c >= best) { if (c >= best || c > maxCost) break; continue; }
    const t = dstMap.get(n);
    if (t && c + t.c < best) { best = c + t.c; bestNode = n; }
    for (let k = net.adjStart[n]; k < net.adjStart[n + 1]; k++) {
      const h = net.adj[k], m = net.head(h), nc = c + net.sLen[h >> 1];
      if (nc < (dist.has(m) ? dist.get(m) : Infinity)) { dist.set(m, nc); prev.set(m, { h, from: n }); heap.push(nc, m); }
    }
  }
  if (bestNode < 0) return null;
  const chain = [];
  for (let n = bestNode; n >= 0; ) {
    const p = prev.get(n);
    if (p.from < 0) { if (p.h >= 0) chain.push({ h: p.h, x: net.X[n], y: net.Y[n], node: n }); break; }
    chain.push({ h: p.h, x: net.X[n], y: net.Y[n], node: n });
    n = p.from;
  }
  chain.reverse();
  steps.push(...chain);
  const t = dstMap.get(bestNode);
  if (t.h >= 0) steps.push({ h: t.h, x: b.x, y: b.y, node: -1 });
  return steps;
}

export function buildRoute(gpx, net, proj) {
  const P = [];
  for (const [la, lo] of gpx.points) {
    const [x, y] = proj.toXY(la, lo);
    const last = P[P.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) > 0.3) P.push([x, y]);
  }
  if (P.length < 2) throw new Error('no-points');
  const snaps = P.map(([x, y]) => (net ? net.snap(x, y) : null));
  const X = [], Y = [], node = [], half = [];
  const push = (x, y, nd, h) => {
    const n = X.length;
    if (n && Math.hypot(x - X[n - 1], y - Y[n - 1]) < 0.3) {    // same spot: keep the better label
      if (nd >= 0) node[n - 1] = nd;
      return;
    }
    if (n) half.push(h);
    X.push(x); Y.push(y); node.push(nd);
  };
  push(snaps[0] ? snaps[0].x : P[0][0], snaps[0] ? snaps[0].y : P[0][1], snaps[0] ? snaps[0].node : -1, -1);
  let matchedLen = 0, totalLen = 0;
  for (let i = 1; i < P.length; i++) {
    const a = snaps[i - 1], b = snaps[i];
    const straight = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    totalLen += straight;
    const steps = a && b ? connect(net, a, b, straight * 3 + 40) : null;
    if (steps) {
      matchedLen += straight;
      for (const st of steps) push(st.x, st.y, st.node, st.h);
    } else {
      push(P[i][0], P[i][1], b ? b.node : -1, -1);
    }
  }
  const n = X.length;
  const r = {
    name: gpx.name || '',
    X: Float64Array.from(X), Y: Float64Array.from(Y), node: Int32Array.from(node),
    half: Int32Array.from(half), along: new Float64Array(n), segB: new Float32Array(Math.max(0, n - 1)),
    lat: new Float64Array(n), lon: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const [la, lo] = proj.toLL(X[i], Y[i]);
    r.lat[i] = la; r.lon[i] = lo;
    if (i) r.along[i] = r.along[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
    if (i < n - 1) r.segB[i] = bearing(X[i], Y[i], X[i + 1], Y[i + 1]);
  }
  r.total = r.along[n - 1];
  r.matched = totalLen ? matchedLen / totalLen : 0;
  return r;
}

// Same fields as a route, from an ordered list of half-edges (used for the way back to the route)
function pathFromHalves(net, proj, startXY, halves) {
  const X = [startXY[0]], Y = [startXY[1]], node = [-1], half = [];
  for (const h of halves) {
    const m = net.head(h);
    X.push(net.X[m]); Y.push(net.Y[m]); node.push(m); half.push(h);
  }
  const n = X.length;
  const r = { X: Float64Array.from(X), Y: Float64Array.from(Y), node: Int32Array.from(node), half: Int32Array.from(half),
    along: new Float64Array(n), segB: new Float32Array(Math.max(0, n - 1)), lat: new Float64Array(n), lon: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const [la, lo] = proj.toLL(r.X[i], r.Y[i]);
    r.lat[i] = la; r.lon[i] = lo;
    if (i) r.along[i] = r.along[i - 1] + Math.hypot(r.X[i] - r.X[i - 1], r.Y[i] - r.Y[i - 1]);
    if (i < n - 1) r.segB[i] = bearing(r.X[i], r.Y[i], r.X[i + 1], r.Y[i + 1]);
  }
  r.total = r.along[n - 1];
  return r;
}

/* ------------------------------------------------------------------ path helpers */

export function indexAt(path, a) {           // segment index containing along-distance a
  const A = path.along;
  let lo = 0, hi = A.length - 1;
  if (a <= 0) return 0;
  if (a >= A[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (A[mid] <= a) lo = mid; else hi = mid; }
  return lo;
}

export function pointAt(path, a) {
  const i = indexAt(path, a), A = path.along;
  const L = A[i + 1] - A[i] || 1, t = clamp((a - A[i]) / L, 0, 1);
  return [path.X[i] + t * (path.X[i + 1] - path.X[i]), path.Y[i] + t * (path.Y[i + 1] - path.Y[i])];
}

// [[lon, lat], ...] between two along-distances
export function slice(path, proj, a0, a1) {
  a0 = clamp(a0, 0, path.total); a1 = clamp(a1, 0, path.total);
  if (a1 - a0 < 0.5) return [];
  const out = [];
  const add = ([x, y]) => { const [la, lo] = proj.toLL(x, y); out.push([lo, la]); };
  add(pointAt(path, a0));
  for (let i = indexAt(path, a0) + 1; i < path.X.length && path.along[i] < a1; i++) out.push([path.lon[i], path.lat[i]]);
  add(pointAt(path, a1));
  return out;
}

/* ------------------------------------------------------------------ turn list */

function turnKind(a) {
  const m = Math.abs(a), side = a < 0 ? 'left' : 'right';
  if (m < 15) return 'straight';
  if (m < 40) return 'slight-' + side;
  if (m < 130) return side;
  if (m < 170) return 'sharp-' + side;
  return 'uturn';
}

// Where the route turns back on itself: the same street segment reversed, or a near-180 degree flip
function apexes(path) {
  const n = path.X.length, out = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    const hi = path.half[i - 1], ho = path.half[i];
    if ((hi >= 0 && ho === (hi ^ 1)) || Math.abs(angleDiff(path.segB[i - 1], path.segB[i])) >= 165) out[i] = 1;
  }
  return out;
}

export function detectManeuvers(path, net, { arrive = true } = {}) {
  const n = path.X.length, A = path.along, out = [];
  const isJ = (i) => !!net && path.node[i] >= 0 && net.deg[path.node[i]] >= 3;
  const apex = apexes(path);
  // Bearings look up to 12 m either side, but never across another junction or turn-back point
  const stops = [];
  for (let i = 0; i < n; i++) if (isJ(i) || apex[i]) stops.push(A[i]);
  const prevStop = (a) => { let lo = 0, hi = stops.length - 1, r = -Infinity; while (lo <= hi) { const m = (lo + hi) >> 1; if (stops[m] < a - 0.01) { r = stops[m]; lo = m + 1; } else hi = m - 1; } return r; };
  const nextStop = (a) => { let lo = 0, hi = stops.length - 1, r = Infinity; while (lo <= hi) { const m = (lo + hi) >> 1; if (stops[m] > a + 0.01) { r = stops[m]; hi = m - 1; } else lo = m + 1; } return r; };
  const bearingsAt = (i) => {
    const a = A[i];
    const dIn = clamp(a - prevStop(a), 3, 12), dOut = clamp(nextStop(a) - a, 3, 12);
    const p = pointAt(path, Math.max(0, a - dIn)), q = pointAt(path, Math.min(path.total, a + dOut));
    return [bearing(p[0], p[1], path.X[i], path.Y[i]), bearing(path.X[i], path.Y[i], q[0], q[1])];
  };
  const segName = (k) => (path.half[k] >= 0 ? net.wName[net.way(path.half[k])] : 0);
  const isRoundSeg = (k) => path.half[k] >= 0 && net.isRound(path.half[k]);

  // Roundabouts: one instruction at the entry, with the exit number
  const inRound = new Uint8Array(n);
  const rounds = [];
  if (net) {
    let s = 0;
    while (s < n - 1) {
      if (!isRoundSeg(s)) { s++; continue; }
      let e = s;
      for (;;) {
        while (e + 1 < n - 1 && isRoundSeg(e + 1)) e++;
        // OSM sometimes tags a ring in pieces: bridge a short untagged stretch of the same ring
        const name = segName(e);
        let g = e + 1;
        while (g < n - 1 && !isRoundSeg(g) && path.half[g] >= 0 && A[g + 1] - A[e + 1] <= 60
               && ((name && segName(g) === name) || A[g + 1] - A[e + 1] <= 25)) g++;
        if (g > e + 1 && g < n - 1 && isRoundSeg(g)) { e = g; continue; }
        break;
      }
      if (s > 0) rounds.push([s, e + 1]);
      for (let v = s; v <= e + 1; v++) inRound[v] = 1;
      s = e + 1;
    }
  }
  for (const [i0, i1] of rounds) {
    const ring = new Set();
    for (let k = i0; k < i1; k++) if (path.half[k] >= 0) ring.add(net.way(path.half[k]));
    let exits = 0;
    for (let v = i0 + 1; v < i1; v++) {
      const nd = path.node[v];
      if (nd < 0) continue;
      for (let k = net.adjStart[nd]; k < net.adjStart[nd + 1]; k++) {
        const h = net.adj[k];
        if (h === path.half[v] || h === (path.half[v - 1] ^ 1)) continue;
        if (net.isRound(h) || ring.has(net.way(h))) continue;
        if (net.allowed(h) && !net.isMinor(h)) exits++;
      }
    }
    const [inB] = bearingsAt(i0), [, outB] = bearingsAt(i1);
    out.push({ i: i0, kind: 'roundabout', exit: exits + 1, a: angleDiff(inB, outB), exitAt: i1 });
  }

  for (let i = 1; i < n - 1; i++) {
    if (inRound[i]) continue;
    const nd = path.node[i];
    if (apex[i]) { out.push({ i, kind: 'uturn', a: 180, deadEnd: nd >= 0 && !!net && net.deg[nd] === 1 }); continue; }
    const [inB, outB] = bearingsAt(i);
    const a = angleDiff(inB, outB);
    if (!isJ(i)) {
      if (!net && Math.abs(a) >= 40) out.push({ i, kind: turnKind(a), a });   // no street data: geometry only
      continue;
    }
    const inH = path.half[i - 1], outH = path.half[i];
    // Every other street leaving this junction that a driver would see (driveways and parking aisles aside)
    const others = [];
    for (let k = net.adjStart[nd]; k < net.adjStart[nd + 1]; k++) {
      const h = net.adj[k];
      if (h === outH || (inH >= 0 && h === (inH ^ 1)) || net.isMinor(h)) continue;
      const b = net.branchBearing(h, 12);
      if (outH < 0 && Math.abs(angleDiff(outB, b)) < 20) continue;
      if (inH < 0 && Math.abs(angleDiff(inB + 180, b)) < 20) continue;
      others.push({ h, b, ang: angleDiff(inB, b), legal: net.allowed(h) });
    }
    const inName = inH >= 0 ? net.wName[net.way(inH)] : 0;
    const outName = outH >= 0 ? net.wName[net.way(outH)] : 0;
    const fwd = others.filter((o) => Math.abs(o.ang) < 135);          // streets a driver could take instead
    let say = null;
    if (Math.abs(a) >= 40) {
      // A real turn: say it whenever another street leaves here (even a one-way the wrong way: it is visible)
      if (fwd.length || Math.abs(a) >= 120) say = turnKind(a);
    } else {
      // Nearly straight: say it when the obvious choice is a different street, or the choice is not obvious
      let def = null;
      for (const o of fwd) if (!def || Math.abs(o.ang) < Math.abs(def.ang)) def = o;
      const rivals = fwd.filter((o) => Math.abs(Math.abs(o.ang) - Math.abs(a)) < 20 && Math.abs(angleDiff(outB, o.b)) < 90);
      if (def && Math.abs(def.ang) < Math.abs(a)) {
        say = a < def.ang ? 'keep-left' : 'keep-right';
      } else if (rivals.length) {
        const angs = rivals.map((o) => o.ang).concat(a).sort((p, q) => p - q);
        say = a === angs[0] ? 'keep-left' : a === angs[angs.length - 1] ? 'keep-right' : 'straight';
      } else if (inName && inName !== outName && fwd.some((o) => o.legal && net.wName[net.way(o.h)] === inName)) {
        say = turnKind(a);                                          // the named street carries on elsewhere
      }
    }
    if (say) out.push({ i, kind: say, a, inB, deliberate: fwd.some((o) => o.legal && Math.abs(o.ang) + 15 < Math.abs(a)) });
  }
  out.sort((p, q) => p.i - q.i);

  // Two same-side turns a few metres apart (through the gap of a divided road) are one U-turn, but only
  // if the car then really drives back the way it came (not a hook round a corner into another street)
  const drivesBack = (first, second) => {
    if (first.inB == null) return false;
    const p = [path.X[second.i], path.Y[second.i]], q = pointAt(path, Math.min(path.total, A[second.i] + 35));
    return Math.abs(angleDiff(first.inB + 180, bearing(p[0], p[1], q[0], q[1]))) <= 35;
  };
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && A[m.i] - A[last.i] < 30 && last.kind !== 'roundabout' && m.kind !== 'roundabout' && m.kind !== 'uturn'
        && last.kind !== 'uturn' && Math.sign(last.a) === Math.sign(m.a) && Math.abs(last.a) >= 60 && Math.abs(m.a) >= 60
        && Math.abs(last.a + m.a) >= 150 && Math.abs(last.a + m.a) <= 215 && drivesBack(last, m)) {
      last.kind = 'uturn'; last.a = last.a + m.a; last.mergedTo = m.i;
      continue;
    }
    merged.push(m);
  }
  if (arrive) merged.push({ i: n - 1, kind: 'arrive', a: 0 });

  for (const m of merged) {
    m.along = A[m.i];
    const from = m.kind === 'roundabout' ? m.exitAt : m.mergedTo ?? m.i;
    m.name = ''; m.en = ''; m.ref = '';
    if (net) {
      for (let s = from; s < n - 1 && A[s] - A[from] < 150; s++) {
        const h = path.half[s];
        if (h < 0) continue;
        const w = net.way(h), nm = net.nameOf(w);
        if (nm || net.refOf(w)) { m.name = nm; m.en = net.enOf(w); m.ref = net.refOf(w); break; }
      }
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ the way back to the route */

// Edge-based Dijkstra on legal moves: one-way streets, turn restrictions, U-turns discouraged.
// `goals` maps route half-edges the car may finish on to an extra cost (re-driving or skipping a bit);
// a single half-edge number is also accepted.
// `starts` (optional) replaces the snapped car with given start half-edges: [{h, remain, x, y}].
export function findWayBack(net, proj, car, heading, goals, maxCost = 8000, starts = null, uturn = { street: 600, deadEnd: 200 }, avoid = { service: 1.6, minor: 4 }) {
  if (typeof goals === 'number') goals = new Map([[goals, { extra: 0 }]]);
  const s0 = starts ? starts[0] : net.snapCar(car[0], car[1], heading);
  if (!s0) return null;
  const nH = net.segCount * 2;
  const dist = new Float64Array(nH).fill(Infinity), prev = new Int32Array(nH).fill(-1);
  const heap = new Heap();
  const turnCost = (h1, h2) => {
    if (h2 === (h1 ^ 1)) return net.deg[net.head(h1)] <= 1 ? uturn.deadEnd : uturn.street;   // turning round: rather a block
    const a = angleDiff(net.halfBearing(h1), net.halfBearing(h2)), m = Math.abs(a);
    if (m < 30) return 0;
    if (m > 120) return 60;
    return a < 0 ? 25 : 10;
  };
  const cost = (h) => net.sLen[h >> 1] * (net.isMinor(h) ? avoid.minor : net.isService(h) ? avoid.service : 1);
  for (const st of starts || [s0]) { if (st.remain < dist[st.h]) { dist[st.h] = st.remain; heap.push(st.remain, st.h); } }
  let found = -1, best = Infinity;
  while (heap.size) {
    const h = heap.pop(), c = heap.lastKey;
    if (c > dist[h]) continue;
    if (c >= best || c > maxCost) break;
    const goal = goals.get(h);
    if (goal && c + goal.extra < best) { best = c + goal.extra; found = h; }
    const v = net.head(h);
    for (let k = net.adjStart[v]; k < net.adjStart[v + 1]; k++) {
      const g = net.adj[k];
      if (!net.allowed(g) && !goals.has(g)) continue;
      if (net.banned(h, g)) continue;
      const nc = c + turnCost(h, g) + (goals.has(g) ? 0 : cost(g));
      if (nc < dist[g]) { dist[g] = nc; prev[g] = h; heap.push(nc, g); }
    }
  }
  if (found < 0) return null;
  const halves = [];
  for (let h = found; h >= 0; h = prev[h]) halves.push(h);
  halves.reverse();
  const first = (starts || [s0]).find((st) => st.h === halves[0]) || s0;
  const path = pathFromHalves(net, proj, [first.x, first.y], halves);
  path.maneuvers = detectManeuvers(path, net, { arrive: false });
  path.goal = goals.get(found);
  return path;
}

/* ------------------------------------------------------------------ live guidance */

const ON_TOL = 28;           // metres from the line that still count as "on the route"

// Best place on `path` for a GPS fix, looking only between `from` and `to`. Places far from where the
// car should be by now (`predicted`) cost extra, so a later pass of the same street never wins on noise.
function matchPath(path, x, y, from, to, heading, speed, predicted, k = 0.15) {
  let best = null;
  const i0 = indexAt(path, from), A = path.along;
  for (let i = i0; i < path.X.length - 1 && A[i] <= to; i++) {
    const q = onSeg(x, y, path.X[i], path.Y[i], path.X[i + 1], path.Y[i + 1]);
    const al = A[i] + q.t * (A[i + 1] - A[i]);
    if (al < from || al > to) continue;
    let pen = 0;
    if (heading != null && speed > 2.5) {
      const diff = Math.abs(angleDiff(heading, path.segB[i]));
      pen = diff > 100 ? 60 : diff > 60 ? 25 : diff > 35 ? 8 : 0;
    }
    const off = Math.abs(al - predicted) - 25;
    const score = q.d + pen + (off > 0 ? k * off : 0);
    if (!best || score < best.score) best = { score, d: q.d, along: al, i, pen };
  }
  return best;
}

// Every separate stretch of `path` the fix could be on (heading must agree), in route order
function matchCandidates(path, x, y, from, to, heading, maxD) {
  const out = [], A = path.along;
  let run = null;
  for (let i = indexAt(path, from); i < path.X.length - 1 && A[i] <= to; i++) {
    const q = onSeg(x, y, path.X[i], path.Y[i], path.X[i + 1], path.Y[i + 1]);
    const al = A[i] + q.t * (A[i + 1] - A[i]);
    const ok = q.d <= maxD && al >= from && al <= to && (heading == null || Math.abs(angleDiff(heading, path.segB[i])) <= 35);
    if (ok) {
      if (run && run.i === i - 1) { run.i = i; if (q.d < run.d) { run.d = q.d; run.along = al; } }
      else { run = { i, d: q.d, along: al }; out.push(run); }
    }
  }
  return out;
}

const PIECE = 10;                      // coverage is kept in 10 m pieces of the route
const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

export class Navigator {
  constructor(route, net, proj) {
    this.r = route; this.net = net; this.proj = proj;
    this.man = route.maneuvers || [];
    this.along = 0; this.mode = 'idle'; this.skips = [];
    this.lastFix = null; this.offCount = 0; this.back = null; this.prompted = new Map();
    this.wayBackSerial = 0; this.skipRun = null; this.events = [];
    // What has really been driven: a flag per 10 m piece, set from the car's own GPS track
    this.pieces = Math.ceil(route.total / PIECE);
    this.cov = new Uint8Array(this.pieces);
    this.maxProgress = 0; this.markFrom = null; this.startAlong = null;
    this.cells = new Map();
    const R = route, C = 25, Mg = 15;
    for (let i = 0; i < R.X.length - 1; i++) {
      const x0 = Math.floor((Math.min(R.X[i], R.X[i + 1]) - Mg) / C), x1 = Math.floor((Math.max(R.X[i], R.X[i + 1]) + Mg) / C);
      const y0 = Math.floor((Math.min(R.Y[i], R.Y[i + 1]) - Mg) / C), y1 = Math.floor((Math.max(R.Y[i], R.Y[i + 1]) + Mg) / C);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = cellKey(cx, cy);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(i);
      }
    }
  }

  markRange(a, b) {
    for (let k = Math.max(0, Math.floor(a / PIECE)); k < this.pieces && k * PIECE < b; k++) {
      const mid = (k + 0.5) * PIECE;
      if (mid >= a && mid <= b) this.cov[k] = 1;
    }
  }

  // Tick off every stretch of the route (any pass) the car is driving right now, in the route's direction
  markNear(fix, heading, speed) {
    if (heading == null || speed < 2) return;
    const R = this.r, tolC = clamp(fix.acc || 8, 6, 12);
    const list = this.cells.get(cellKey(Math.floor(fix.x / 25), Math.floor(fix.y / 25)));
    if (!list) return;
    for (const i of list) {
      if (Math.abs(angleDiff(heading, R.segB[i])) > 40) continue;
      const q = onSeg(fix.x, fix.y, R.X[i], R.Y[i], R.X[i + 1], R.Y[i + 1]);
      if (q.d > tolC) continue;
      const al = R.along[i] + q.t * (R.along[i + 1] - R.along[i]);
      this.markRange(al - 6, al + 6);
    }
  }

  // Driven metres and the stretches behind the car that were not driven
  coverage() {
    const out = [], lim = this.maxProgress, total = this.r.total, from = this.startAlong ?? 0;
    let driven = 0;
    for (let k = 0; k < this.pieces; k++) {
      const a = k * PIECE, b = Math.min(total, a + PIECE);
      if (this.cov[k]) { driven += b - a; continue; }
      if (b > lim || a < from) continue;
      const last = out[out.length - 1];
      if (last && a - last[1] <= PIECE) last[1] = b;
      else out.push([a, b]);
    }
    return { driven, missed: out, missedMeters: out.reduce((t, [a, b]) => t + b - a, 0) };
  }

  start(along = 0) {
    this.along = clamp(along, 0, this.r.total);
    if (this.startAlong == null) this.startAlong = this.along;
    this.lastGood = this.along;
    this.mode = 'acquire'; this.back = null; this.offCount = 0; this.forkCount = 0; this.skipRun = null; this.jumped = false;
  }

  restore(state) {
    if (!state) return;
    this.along = clamp(state.along || 0, 0, this.r.total);
    this.maxProgress = clamp(state.maxProgress || this.along, 0, this.r.total);
    if (state.startAlong != null) this.startAlong = state.startAlong;
    this.skips = Array.isArray(state.skips) ? state.skips : [];
    if (typeof state.cov === 'string') {
      const bin = typeof atob === 'function' ? atob(state.cov) : Buffer.from(state.cov, 'base64').toString('binary');
      for (let k = 0; k < this.pieces; k++) this.cov[k] = (bin.charCodeAt(k >> 3) >> (k & 7)) & 1;
    }
  }

  serialize() {
    const bytes = new Uint8Array(Math.ceil(this.pieces / 8));
    for (let k = 0; k < this.pieces; k++) if (this.cov[k]) bytes[k >> 3] |= 1 << (k & 7);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const cov = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return { along: Math.round(this.along * 10) / 10, maxProgress: Math.round(this.maxProgress), startAlong: this.startAlong, skips: this.skips, cov };
  }

  // Move the target one instruction forward or back (closures, or a wrong guess)
  jump(dir) {
    const i = this.nextManeuverIndex(this.along);
    let target;
    if (dir > 0) {
      const m = this.man[Math.min(i, this.man.length - 1)];
      target = Math.min(this.r.total, m.along + 5);
      if (target > this.along + 1) this.addMissed(this.along, target);
      this.maxProgress = Math.max(this.maxProgress, target);
    } else {
      const m = this.man[Math.max(0, i - 2)];
      target = i >= 2 ? m.along + 5 : 0;
    }
    this.along = target; this.lastGood = target; this.markFrom = null;
    this.mode = 'acquire'; this.back = null; this.offCount = 0; this.forkCount = 0;
    this.jumped = dir > 0;          // if the car is not there, the way to it is "to the route", not "to where you stopped"
    return this.along;
  }

  // "Continue from where I am": the earliest part of the route the car is on now (ahead of us if possible)
  continueHere() {
    const f = this.lastFix;
    if (!f) return null;
    const moving = this.speed > 2.5 ? this.heading : null;
    const c = matchCandidates(this.r, f.x, f.y, 0, this.r.total, moving, Math.max(20, Math.min(45, (f.acc || 10) * 1.5)));
    const ahead = c.filter((q) => q.along >= this.along - 100);
    const pick = (ahead.length ? ahead : c)[0];
    if (!pick) return null;
    const from = this.along;
    if (pick.along > from + 10) this.addMissed(from, pick.along);
    this.maxProgress = Math.max(this.maxProgress, pick.along);
    this.resume(pick.along, 'rejoin');
    return pick.along - from;
  }

  // Undo the last skip: go back for the stretch that was skipped
  undoSkip() {
    const last = this.skips.pop();
    if (!last || !this.lastFix) return false;
    this.along = last[0]; this.lastGood = last[0];
    this.leave(this.lastFix, this.heading, 'off');
    return true;
  }

  addMissed(a, b) {        // a log of skips for the notes; the missed list itself comes from coverage()
    if (b - a < 10) return;
    this.skips.push([Math.round(a), Math.round(b)]);
  }

  // Did the route between a and b make a turn a driver only takes on purpose (a straighter street was there)?
  turnBetween(a, b) {
    for (let i = this.nextManeuverIndex(a - 2); i < this.man.length && this.man[i].along < b; i++) {
      if (this.man[i].deliberate) return true;
    }
    return false;
  }

  // Is the car on the same street (and direction) as the route where it matched? Settles forks,
  // where two roads stay within GPS error of each other for a while.
  onRouteStreet(fix, heading, m) {
    if (!this.net || m.d <= 6) return true;
    const s = this.net.snapCar(fix.x, fix.y, heading, 40);
    if (!s) return true;
    const R = this.r, net = this.net, w = net.sW[s.h >> 1];
    for (let k = Math.max(0, m.i - 3); k <= Math.min(R.half.length - 1, m.i + 3); k++) {
      const rh = R.half[k];
      if (rh < 0 || rh === s.h || (net.sW[rh >> 1] === w && (rh & 1) === (s.h & 1))) return true;
    }
    return false;
  }

  // Where to send the car back to: the last junction at or before the last place it was surely on the
  // route, so the street it turned away from is driven from its start
  targetFor(a) {
    const R = this.r, net = this.net, n = R.X.length;
    const ok = (k) => R.node[k] >= 0 && R.half[k] >= 0;
    const isJ = (k) => ok(k) && net && net.deg[R.node[k]] >= 3;
    const i0 = indexAt(R, a);
    // a junction just behind (within 25 m), else the one just ahead (within 25 m): where the car left
    for (let k = Math.min(n - 2, i0 + 1); k >= 0 && R.along[k] >= a - 25; k--) if (R.along[k] <= a + 3 && isJ(k)) return k;
    for (let k = i0 + 1; k < n - 1 && R.along[k] <= a + 25; k++) if (isJ(k)) return k;
    // otherwise the last junction before, within 150 m, else the nearest street point
    for (let k = i0; k >= 0 && R.along[k] >= a - 150; k--) if (isJ(k)) return k;
    for (let k = i0; k >= 0; k--) if (ok(k)) return k;
    for (let k = i0; k < n - 1; k++) if (ok(k)) return k;
    return 0;
  }

  nextManeuverIndex(along) {
    const M = this.man;
    let lo = 0, hi = M.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (M[mid].along <= along + 2) lo = mid + 1; else hi = mid; }
    return lo;
  }

  update(fix) {
    // fix: {x, y, t (ms), acc, speed (m/s|null), heading (deg|null)}
    this.events = [];
    // A rough fix (network location, Precise Location off) is not acted on, and not kept as the last
    // fix either: a jump from it to the first precise fix would look like fast driving in some direction
    if (fix.acc != null && fix.acc > 80) return this.snapshot();
    const prev = this.lastFix;
    let heading = fix.heading, speed = fix.speed;
    if (prev) {
      const moved = Math.hypot(fix.x - prev.x, fix.y - prev.y), dt = Math.max(0.2, (fix.t - prev.t) / 1000);
      // Only work out heading and speed from two close, recent, sharp fixes
      const usable = dt <= 6 && moved < 200 && (prev.acc == null || prev.acc <= 35) && (fix.acc == null || fix.acc <= 35);
      if ((heading == null || Number.isNaN(heading)) && moved > 4 && usable) heading = bearing(prev.x, prev.y, fix.x, fix.y);
      if (speed == null || Number.isNaN(speed)) speed = usable ? moved / dt : 0;
    }
    if (heading != null && Number.isNaN(heading)) heading = null;
    speed = speed || 0;
    const dt = prev ? Math.max(0.2, (fix.t - prev.t) / 1000) : 1;
    this.lastFix = { ...fix, heading, speed };
    this.heading = heading; this.speed = speed;
    if (this.mode === 'idle' || this.mode === 'done') return this.snapshot();

    const tol = clamp(fix.acc ? fix.acc * 1.3 : ON_TOL, ON_TOL, 55);
    if (this.mode === 'acquire') {
      const m = matchPath(this.r, fix.x, fix.y, this.along - 60, this.along + 250, heading, speed, this.along, 0.05);
      if (m && m.d <= tol && m.pen < 25 && this.onRouteStreet(fix, heading, m)) {
        this.along = Math.max(this.along, m.along); this.lastGood = this.along; this.mode = 'route'; this.offCount = 0;
        this.markFrom = this.along < 10 ? 0 : this.along;
      }
      else this.leave(fix, heading, this.jumped ? 'next' : this.along < 1 ? 'start' : 'resume');
      this.jumped = false;
    } else if (this.mode === 'route') {
      // Only places the car could have reached since the last fix; after a long gap, look further
      const gap = dt > 4, v = Math.max(speed, gap ? 8 : 0);
      const ahead = gap ? clamp(v * dt * 1.6 + 200, 250, 6000) : Math.max(80, v * dt * 2 + 60);
      const m = matchPath(this.r, fix.x, fix.y, this.along - 40, this.along + ahead, heading, speed, this.along + v * dt, gap ? 0.01 : 0.15);
      if (m && m.d <= tol && m.pen < 60) {
        if (gap) this.along = Math.max(this.along, m.along);
        else {
          // Smooth along the route: trust the car's speed, move part of the way towards the fix
          const predicted = this.along + speed * dt, innov = m.along - predicted;
          const g = speed < 1 ? 0.1 : Math.abs(innov) > 30 ? 0.3 : m.d < 6 ? 0.8 : 0.6;
          this.along = Math.max(this.along, predicted + g * innov);
        }
        // The last place the car surely drove the route (not a parallel street a few metres away)
        // (the fix itself, not the smoothed estimate, which runs a little ahead when the car turns off)
        if (m.d <= 8 && (m.d <= 4 || this.onRouteStreet(fix, heading, m))) {
          const sure = Math.min(this.along, m.along);
          this.lastGood = Math.max(this.lastGood, sure);
          if (this.markFrom != null && sure - this.markFrom <= 120) this.markRange(this.markFrom, sure);
          this.markFrom = Math.max(this.markFrom ?? sure, sure);
        }
        this.offCount = 0;
      } else if (++this.offCount >= 2) {
        this.leave(fix, heading, 'off');
      }
    } else if (this.mode === 'back') {
      this.followBack(fix, heading, speed, dt, tol);
    }
    this.markNear(fix, heading, speed);
    if (this.mode === 'route') this.maxProgress = Math.max(this.maxProgress, this.along);
    if (this.mode === 'route' && this.along >= this.r.total - 10) {
      this.markRange(this.lastGood, this.r.total);
      this.mode = 'done'; this.events.push({ type: 'done' });
    }
    this.schedulePrompts(speed);
    return this.snapshot();
  }

  // Places the car may rejoin: the route within 150 m behind the last sure point (driving that again costs
  // its length) or a little ahead of it (skipping street costs ten times its length)
  goalsFor(a) {
    const R = this.r, goals = new Map();
    for (let k = Math.max(0, indexAt(R, a - 150)); k < R.X.length - 1 && R.along[k] <= a + 30; k++) {
      if (R.node[k] < 0 || R.half[k] < 0 || R.along[k] < a - 150) continue;
      const extra = R.along[k] <= a ? a - R.along[k] : (R.along[k] - a) * 10;
      const old = goals.get(R.half[k]);
      if (!old || extra < old.extra) goals.set(R.half[k], { extra, k });
    }
    return goals;
  }

  leave(fix, heading, why) {
    const R = this.r;
    const anchor = why === 'off' ? this.lastGood : this.along;
    const ti = this.targetFor(anchor);
    const target = { i: ti, along: R.along[ti] };
    this.mode = 'back'; this.offCount = 0; this.forkCount = 0; this.skipRun = null; this.markFrom = null;
    this.back = { why, target, anchor, leftAt: target.along, path: null, pos: 0, offPath: 0, computedAt: 0, rejoinRun: 0, replans: -1,
      trail: this.along, trailRun: 0, trailMiss: 0, trailBroken: why !== 'off', lastGood: why === 'off' ? this.lastGood : 0 };
    this.planBack(fix, heading);
    this.events.push({ type: why === 'off' ? 'off' : why });
  }

  planBack(fix, heading) {
    const b = this.back, R = this.r;
    b.computedAt = fix.t; b.offPath = 0; b.pos = 0; b.replans++;
    let path = null;
    if (this.net) path = findWayBack(this.net, this.proj, [fix.x, fix.y], heading, this.goalsFor(b.anchor));
    if (path) {
      b.target = { i: path.goal.k, along: R.along[path.goal.k] };   // where this way back meets the route
      path.serial = ++this.wayBackSerial;
      const last = path.maneuvers[path.maneuvers.length - 1];
      if (!last || last.i < path.X.length - 2) path.maneuvers.push({ i: path.X.length - 2, kind: 'rejoin', a: 0, along: path.along[path.X.length - 2], name: '', en: '', ref: '' });
    }
    b.path = path;
  }

  followBack(fix, heading, speed, dt, tol) {
    const b = this.back, R = this.r;
    // 0) A false alarm (a GPS jump)? If the car keeps matching the route where it was, carry on as before
    if (!b.trailBroken) {
      const t = matchPath(R, fix.x, fix.y, b.trail - 20, b.trail + Math.max(80, speed * dt * 2 + 60), heading, speed, b.trail + speed * dt, 0.15);
      if (t && t.d <= 15 && t.pen < 25) {
        b.trail = Math.max(b.trail, t.along); b.trailMiss = 0;
        if (++b.trailRun >= 2) { this.resume(b.trail, 'rejoin'); return; }
      } else if (++b.trailMiss >= 2) b.trailBroken = true;
    }
    // Progress along the way back
    let onBack = false;
    if (b.path) {
      const m = matchPath(b.path, fix.x, fix.y, b.pos - 30, b.pos + 400, heading, speed, b.pos + speed * dt, 0.05);
      if (m && m.d <= 30 && m.pen < 60) { b.pos = Math.max(b.pos, m.along); b.offPath = 0; onBack = true; }
      else b.offPath++;
    }
    // 1) Back on the route near the junction we were sent to
    const T = b.target.along, driven = Math.max(T, b.lastGood);   // everything before `driven` was driven
    const near = matchPath(R, fix.x, fix.y, T - 60, Math.max(T + 150, driven + 60), heading, speed, T, 0.05);
    const reachedT = b.passedT || (b.path && b.pos >= b.path.along[b.path.X.length - 2] - 10);
    // While the car follows the way back, a stretch of the route it happens to use further on doesn't count
    const usable = near && near.d <= 20 && near.pen < 25 && (near.along <= driven + 30 || reachedT || !onBack);
    if (usable && this.onRouteStreet(fix, heading, near)) {
      if (near.along <= driven + 30) b.passedT = true;
      if (++b.rejoinRun >= 2 || near.d <= 8) {
        // Came in where the car left, or through the junction we sent it to? If not, the piece of street
        // between where it left and this point was not driven
        if (b.passedT || reachedT) this.resume(Math.max(near.along, T - 60), 'rejoin');
        else { this.addMissed(driven, near.along); this.resume(near.along, 'skip', Math.round(near.along - driven)); }
        return;
      }
    } else b.rejoinRun = 0;
    // 2) Driving the route further on instead: accept only with clear evidence, and log what was missed
    if (heading != null && speed > 2.5) {
      const cands = matchCandidates(R, fix.x, fix.y, Math.max(T + 150, driven + 60), T + 3000, heading, 15);
      const s = this.skipRun, c = s && cands.find((q) => q.along >= s.last - 5 && q.along <= s.last + 120);
      if (c) { s.last = c.along; s.n++; if (!onBack) s.offBack++; }
      else this.skipRun = cands.length ? { first: cands[0].along, last: cands[0].along, n: 1, offBack: onBack ? 0 : 1 } : null;
      const run = this.skipRun;
      // They kept leaving the way back we gave them, and followed the later part of the route through one
      // of its turns (or along it for 500 m)
      if (run && run.n >= 4 && run.last - run.first >= 150 && run.offBack >= 3
          && (this.turnBetween(run.first + 5, run.last - 30) || run.last - run.first >= 500)) {
        this.addMissed(driven, run.first);
        this.resume(run.last, 'skip', Math.round(run.first - driven));
        return;
      }
    } else this.skipRun = null;
    // 3) Lost the way back: plan it again from here
    if (!b.path || b.offPath >= 2 || (!onBack && fix.t - b.computedAt > 12000)) this.planBack(fix, heading);
  }

  resume(along, type, meters) {
    this.mode = 'route'; this.along = along; this.lastGood = along; this.markFrom = along;
    this.back = null; this.skipRun = null; this.offCount = 0;
    this.events.push(meters != null ? { type, meters } : { type });
  }

  schedulePrompts(speed) {
    const g = this.guidance();
    if (!g.next) return;
    const { m, dist, key } = g.next;
    const v = Math.max(speed, 5);
    const far = clamp(v * 14, 120, 350), near = clamp(v * 5, 30, 90);
    const done = this.prompted.get(key) || 0;
    if (dist <= near && !(done & 2)) {
      this.prompted.set(key, 3);
      const then = g.then && g.then.gap < 80 ? g.then.m : null;
      if (then) this.prompted.set(g.then.key, 1);
      this.events.push({ type: 'prompt', stage: 'near', m, dist, then });
    } else if (dist <= far && dist > near + 40 && !(done & 1)) {
      this.prompted.set(key, done | 1);
      this.events.push({ type: 'prompt', stage: 'far', m, dist });
    }
  }

  guidance() {
    if (this.mode === 'back' && this.back && this.back.path) {
      const p = this.back.path, M = p.maneuvers, pos = this.back.pos;
      const k = M.findIndex((m) => m.along > pos + 2);
      if (k < 0) return { next: null, then: null };
      const next = { m: M[k], dist: M[k].along - pos, key: 'b' + p.serial + ':' + k };
      let then = null;
      if (k + 1 < M.length) then = { m: M[k + 1], gap: M[k + 1].along - M[k].along, key: 'b' + p.serial + ':' + (k + 1) };
      else {
        const ri = this.nextManeuverIndex(this.back.target.along);
        if (ri < this.man.length) then = { m: this.man[ri], gap: (p.total - M[k].along) + (this.man[ri].along - this.back.target.along), key: 'r' + ri };
      }
      return { next, then };
    }
    if (this.mode !== 'route' && this.mode !== 'acquire' && this.mode !== 'done') return { next: null, then: null };
    const i = this.nextManeuverIndex(this.along);
    if (i >= this.man.length) return { next: null, then: null };
    const next = { m: this.man[i], dist: this.man[i].along - this.along, key: 'r' + i };
    const then = i + 1 < this.man.length ? { m: this.man[i + 1], gap: this.man[i + 1].along - this.man[i].along, key: 'r' + (i + 1) } : null;
    return { next, then };
  }

  snapshot() {
    const g = this.guidance();
    const f = this.lastFix;
    return {
      mode: this.mode, along: this.along, total: this.r.total,
      car: f ? { x: f.x, y: f.y, heading: this.heading, speed: this.speed, acc: f.acc } : null,
      next: g.next, then: g.then,
      back: this.back ? { why: this.back.why, path: this.back.path, pos: this.back.pos, target: this.back.target } : null,
      events: this.events,
    };
  }
}

/* ------------------------------------------------------------------ one call to prepare a day */

export function prepare(gpxText, netDoc) {
  const gpx = parseGpx(gpxText);
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const [la, lo] of gpx.points) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
  }
  const proj = projection((minLat + maxLat) / 2, (minLon + maxLon) / 2);
  let net = null;
  if (netDoc) {
    const [W, S, E, N] = netDoc.bbox;
    const inside = minLat >= S && maxLat <= N && minLon >= W && maxLon <= E;
    if (inside) net = new Network(netDoc, proj, [minLat - 0.025, minLon - 0.033, maxLat + 0.025, maxLon + 0.033]);
  }
  const route = buildRoute(gpx, net, proj);
  route.maneuvers = detectManeuvers(route, net);
  route.bbox = [minLon, minLat, maxLon, maxLat];
  return { gpx, proj, net, route };
}
