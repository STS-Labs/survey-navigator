import { readFileSync } from 'node:fs';
import { prepare, indexAt, pointAt, bearing, angleDiff } from '../js/core.js';
const [gpxPath, netPath, ...kms] = process.argv.slice(2);
const { route: R, net } = prepare(readFileSync(gpxPath, 'utf8'), JSON.parse(readFileSync(netPath, 'utf8')));
for (const km of kms) {
  let i = indexAt(R, +km * 1000);
  // nearest junction vertex
  let best = -1;
  for (let k = Math.max(1, i - 5); k < Math.min(R.X.length - 1, i + 6); k++) if (R.node[k] >= 0 && net.deg[R.node[k]] >= 3 && (best < 0 || Math.abs(R.along[k] - km * 1000) < Math.abs(R.along[best] - km * 1000))) best = k;
  i = best;
  const nd = R.node[i], inH = R.half[i - 1], outH = R.half[i];
  const p = pointAt(R, R.along[i] - 12), q = pointAt(R, R.along[i] + 12);
  const inB = bearing(p[0], p[1], R.X[i], R.Y[i]), outB = bearing(R.X[i], R.Y[i], q[0], q[1]);
  console.log(`--- ${km} km: vertex ${i} node ${nd} deg ${net.deg[nd]} in ${inB.toFixed(0)} (${net.nameOf(net.way(inH))}) out ${outB.toFixed(0)} (${net.nameOf(net.way(outH))}) a=${angleDiff(inB, outB).toFixed(0)}`);
  for (let k = net.adjStart[nd]; k < net.adjStart[nd + 1]; k++) {
    const h = net.adj[k], b = net.branchBearing(h, 12), f = net.flags(h), m = net.head(h);
    console.log(`   h${h} -> node ${m} (deg ${net.deg[m]}, ${net.sLen[h >> 1].toFixed(1)} m) bearing ${b.toFixed(0)} ang ${angleDiff(inB, b).toFixed(0)} ${h === outH ? 'ROUTE-OUT' : ''}${inH >= 0 && h === (inH ^ 1) ? 'ROUTE-IN(rev)' : ''} legal=${net.allowed(h)} minor=${net.isMinor(h)} cls=${f & 15} ow=${((f >> 4) & 3) - 1} ${net.nameOf(net.way(h))}`);
  }
}
