// Draw every instruction's junction as a small diagram: grey = streets, dashed = one-way against us
// or no entry, blue = route in, green = route out (arrow), label = instruction.  Writes an HTML sheet.
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare, pointAt, angleDiff } from '../js/core.js';
const [gpxPath, netPath, outPath, filter = 'all', limit = '2000'] = process.argv.slice(2);
const { route, net } = prepare(readFileSync(gpxPath, 'utf8'), JSON.parse(readFileSync(netPath, 'utf8')));
const R = 70, S = 220, k = S / (2 * R);
let items = route.maneuvers.map((m, idx) => ({ m, idx }));
if (filter === 'silent') {
  // junctions where the route bends >= 30 deg but no instruction is given
  const said = new Set(route.maneuvers.map(m => m.i));
  items = [];
  for (let i = 1; i < route.X.length - 1; i++) {
    const nd = route.node[i];
    if (nd < 0 || net.deg[nd] < 3 || said.has(i)) continue;
    const p = pointAt(route, route.along[i] - 10), q = pointAt(route, route.along[i] + 10);
    const a = angleDiff(Math.atan2(route.X[i] - p[0], route.Y[i] - p[1]) * 180 / Math.PI, Math.atan2(q[0] - route.X[i], q[1] - route.Y[i]) * 180 / Math.PI);
    if (Math.abs(a) >= 30) items.push({ m: { i, along: route.along[i], kind: 'SILENT', a, name: '' }, idx: -1 });
  }
} else if (filter !== 'all') items = items.filter(({ m }) => filter.split(',').includes(m.kind));
items = items.slice(0, +limit);
const cards = items.map(({ m, idx }) => {
  const cx = route.X[m.i], cy = route.Y[m.i];
  const tx = x => ((x - cx) * k + S / 2).toFixed(1), ty = y => (S / 2 - (y - cy) * k).toFixed(1);
  let g = '';
  net.forCells(cx, cy, R, s => {
    const a = net.sA[s], b = net.sB[s];
    if (Math.hypot(net.X[a] - cx, net.Y[a] - cy) > R * 1.5 && Math.hypot(net.X[b] - cx, net.Y[b] - cy) > R * 1.5) return;
    const f = net.wFlags[net.sW[s]], oneway = ((f >> 4) & 3) - 1, minor = f & 256, denied = f & 128;
    const col = denied ? '#e57373' : minor ? '#cfcfcf' : '#8a8a8a';
    g += `<line x1="${tx(net.X[a])}" y1="${ty(net.Y[a])}" x2="${tx(net.X[b])}" y2="${ty(net.Y[b])}" stroke="${col}" stroke-width="${minor ? 2 : 4}"/>`;
    if (oneway) {   // small tick showing the legal direction
      const [fx, fy, gx, gy] = oneway === 1 ? [net.X[a], net.Y[a], net.X[b], net.Y[b]] : [net.X[b], net.Y[b], net.X[a], net.Y[a]];
      const mx = (fx + gx) / 2, my = (fy + gy) / 2, L = Math.hypot(gx - fx, gy - fy) || 1;
      const ux = (gx - fx) / L, uy = (gy - fy) / L;
      g += `<polyline points="${tx(mx - ux * 3 - uy * 2.5)},${ty(my - uy * 3 + ux * 2.5)} ${tx(mx)},${ty(my)} ${tx(mx - ux * 3 + uy * 2.5)},${ty(my - uy * 3 - ux * 2.5)}" fill="none" stroke="#555" stroke-width="1.5"/>`;
    }
  });
  const line = (a0, a1, col, w) => {
    const pts = [];
    for (let a = a0; a <= a1; a += 2) { const p = pointAt(route, a); pts.push(`${tx(p[0])},${ty(p[1])}`); }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
  };
  const endAlong = Math.min(route.total, m.along + (m.kind === 'roundabout' ? Math.min(120, route.along[m.exitAt] - m.along + 30) : 45));
  const e1 = pointAt(route, endAlong), e0 = pointAt(route, endAlong - 4);
  const ang = Math.atan2(e1[0] - e0[0], e1[1] - e0[1]);
  const head = [[0, 0], [-7, -12], [7, -12]].map(([u, v]) => {
    const x = e1[0] + (u * Math.cos(ang) + v * Math.sin(ang)) / k, y = e1[1] + (-u * Math.sin(ang) + v * Math.cos(ang)) / k;
    return `${tx(x)},${ty(y)}`;
  }).join(' ');
  const svg = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="background:#fff">${g}${line(Math.max(0, m.along - 50), m.along, '#1a73e8', 5)}${line(m.along, endAlong, '#0b8043', 5)}<polygon points="${head}" fill="#0b8043"/><circle cx="${S / 2}" cy="${S / 2}" r="4" fill="#d93025"/></svg>`;
  return `<div class="c"><div class="t"><b>#${idx}</b> ${(m.along / 1000).toFixed(3)} km · <b>${m.kind}${m.exit ? ' ' + m.exit : ''}</b> ${Math.round(m.a)}°</div>${svg}<div class="n">${m.name || m.ref || '—'}</div></div>`;
});
writeFileSync(outPath, `<!doctype html><meta charset="utf-8"><style>body{margin:8px;font:12px -apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:6px;width:${6 * (S + 8)}px}.c{border:1px solid #ddd;width:${S}px}.t,.n{padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>${cards.join('')}`);
console.log(items.length, 'cards ->', outPath);
