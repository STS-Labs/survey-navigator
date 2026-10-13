// Print the route around given km marks: vertex, node degree, street, flags
import { readFileSync } from 'node:fs';
import { prepare, indexAt } from '../js/core.js';
const [gpxPath, netPath, ...kms] = process.argv.slice(2);
const { route, net } = prepare(readFileSync(gpxPath, 'utf8'), JSON.parse(readFileSync(netPath, 'utf8')));
for (const km of kms) {
  const [c, span = '60'] = km.split(':');
  const a = +c * 1000, i0 = indexAt(route, a - +span), i1 = indexAt(route, a + +span);
  console.log(`--- around ${c} km`);
  for (let i = i0; i <= i1 + 1 && i < route.X.length; i++) {
    const h = i < route.half.length ? route.half[i] : -1, nd = route.node[i];
    const w = h >= 0 ? net.way(h) : -1, f = w >= 0 ? net.wFlags[w] : 0;
    console.log(String(i).padStart(5), (route.along[i] / 1000).toFixed(4), `node ${nd} deg ${nd >= 0 ? net.deg[nd] : '-'}`.padEnd(18),
      `lat ${route.lat[i].toFixed(6)} lon ${route.lon[i].toFixed(6)}`, h >= 0 ? `-> h${h} b${route.segB[i].toFixed(0)} ${net.nameOf(w) || '(no name)'} cls${f & 15} ow${((f >> 4) & 3) - 1}${f & 64 ? ' ROUND' : ''}${f & 128 ? ' DENIED' : ''}${f & 256 ? ' MINOR' : ''}` : '-> (no street)');
  }
}
