// Make a drivable test route through given places and save it as GPX (one-way streets and turn bans respected).
//   node tools/make_route.mjs places.json out.gpx [data/tbilisi-net.json]
// places.json: { "name": "...", "points": [ { "name": "...", "lat": 41.7, "lon": 44.7, "street": "optional OSM street name to stop on" }, ... ] }
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projection, Network, findWayBack } from '../js/core.js';

const [specPath, outPath, netPath = fileURLToPath(new URL('../data/tbilisi-net.json', import.meta.url))] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const pts = spec.points;
const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
const proj = projection((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2);
const net = new Network(JSON.parse(readFileSync(netPath, 'utf8')), proj,
  [Math.min(...lats) - 0.03, Math.min(...lons) - 0.04, Math.max(...lats) + 0.03, Math.max(...lons) + 0.04]);

function onSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
  return { t, x: x1 + t * dx, y: y1 + t * dy, d: Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) };
}

// The point on a drivable street nearest to the place (on the named street, if one is given)
function placeOnStreet(p) {
  const [x, y] = proj.toXY(p.lat, p.lon);
  let best = null;
  net.forCells(x, y, 300, (s) => {
    const w = net.sW[s];
    if (net.wFlags[w] & 128) return;                              // no public access
    if (p.street && net.nameOf(w) !== p.street) return;
    if (!net.allowed(2 * s) && !net.allowed(2 * s + 1)) return;
    const a = net.sA[s], b = net.sB[s], q = onSeg(x, y, net.X[a], net.Y[a], net.X[b], net.Y[b]);
    if (!best || q.d < best.d) best = { s, ...q };
  });
  if (!best) throw new Error(`no drivable street near ${p.name}`);
  const L = net.sLen[best.s];
  best.street = net.nameOf(net.sW[best.s]) || '(no name)';
  best.street_en = net.enOf(net.sW[best.s]);
  best.halves = [                                              // both ways along it, where allowed
    { h: 2 * best.s, toPoint: best.t * L, fromPoint: (1 - best.t) * L },
    { h: 2 * best.s + 1, toPoint: (1 - best.t) * L, fromPoint: best.t * L },
  ].filter((v) => net.allowed(v.h));
  return best;
}

const stops = pts.map(placeOnStreet);
stops.forEach((s, i) => console.log(`${pts[i].name}: on ${s.street}${s.street_en ? ` (${s.street_en})` : ''}, ${s.d.toFixed(0)} m from the given point`));

let line = [], starts = stops[0].halves.map((v) => ({ h: v.h, remain: v.fromPoint, x: stops[0].x, y: stops[0].y }));
for (let i = 1; i < stops.length; i++) {
  const goal = new Map(stops[i].halves.map((v) => [v.h, { extra: v.toPoint }]));
  // A planned route should not turn round in the street: a long way round a block is better
  // and keeps to real streets: service roads, yards and parking lanes only where the place itself is
  const leg = findWayBack(net, proj, null, null, goal, 80000, starts, { street: 5000, deadEnd: 3000 }, { service: 8, minor: 12 });
  if (!leg) throw new Error(`no legal route from ${pts[i - 1].name} to ${pts[i].name}`);
  const n = leg.X.length, X = Array.from(leg.X), Y = Array.from(leg.Y);
  X[n - 1] = stops[i].x; Y[n - 1] = stops[i].y;                 // stop at the place, not the end of the street piece
  for (let k = line.length ? 1 : 0; k < n; k++) line.push([X[k], Y[k]]);
  const lastHalf = leg.half[leg.half.length - 1];
  const v = stops[i].halves.find((q) => q.h === lastHalf);
  console.log(`  leg ${i}: ${(leg.total / 1000).toFixed(2)} km`);
  starts = [{ h: lastHalf, remain: v ? v.fromPoint : 0, x: stops[i].x, y: stops[i].y }];   // carry on the same way
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ll = ([x, y]) => { const [la, lo] = proj.toLL(x, y); return `lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"`; };
let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Survey Navigator make_route" xmlns="http://www.topografix.com/GPX/1/1">\n`;
gpx += `<metadata><name>${esc(spec.name)}</name><time>${new Date().toISOString()}</time></metadata>\n`;
stops.forEach((s, i) => { gpx += `<wpt ${ll([s.x, s.y])}><name>${esc(pts[i].name)}</name></wpt>\n`; });
gpx += `<trk><name>${esc(spec.name)}</name><trkseg>\n`;
for (const p of line) gpx += `<trkpt ${ll(p)}/>\n`;
gpx += '</trkseg></trk>\n</gpx>\n';
writeFileSync(outPath, gpx);
let len = 0;
for (let k = 1; k < line.length; k++) len += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
console.log(`saved ${outPath}: ${line.length} points, ${(len / 1000).toFixed(2)} km`);
