// Checks on the plan itself: wrong-way driving, banned turns, U-turns, stretches off the street map.
import { readFileSync } from 'node:fs';
import { prepare, angleDiff } from '../js/core.js';
const [gpxPath, netPath] = process.argv.slice(2);
const { route: R, net } = prepare(readFileSync(gpxPath, 'utf8'), JSON.parse(readFileSync(netPath, 'utf8')));
const km = (a) => (a / 1000).toFixed(2);
const wrongWay = [], denied = [], banned = [];
for (let i = 0; i < R.half.length; i++) {
  const h = R.half[i];
  if (h < 0) continue;
  const f = net.flags(h), L = R.along[i + 1] - R.along[i];
  if (f & 128) denied.push([R.along[i], L, net.nameOf(net.way(h)) || '(no name)']);
  else if (!net.allowed(h)) wrongWay.push([R.along[i], L, net.nameOf(net.way(h)) || '(no name)']);
  if (i > 0 && R.half[i - 1] >= 0 && R.half[i - 1] !== h && net.head(R.half[i - 1]) === net.tail(h) && net.banned(R.half[i - 1], h)) {
    banned.push([R.along[i], net.nameOf(net.way(R.half[i - 1])) || '(no name)', net.nameOf(net.way(h)) || '(no name)']);
  }
}
const merge = (list) => { const out = []; for (const [a, L, n] of list) { const last = out[out.length - 1]; if (last && a - last[1] < 30 && last[2] === n) last[1] = a + L; else out.push([a, a + L, n]); } return out; };
const ww = merge(wrongWay), dn = merge(denied);
console.log(`wrong-way stretches (one-way street driven against its direction): ${ww.length}, ${ww.reduce((t, [a, b]) => t + b - a, 0).toFixed(0)} m`);
for (const [a, b, n] of ww) console.log(`   ${km(a)}–${km(b)} km  ${Math.round(b - a)} m  ${n}`);
console.log(`stretches on streets marked no access / private: ${dn.length}, ${dn.reduce((t, [a, b]) => t + b - a, 0).toFixed(0)} m`);
for (const [a, b, n] of dn) console.log(`   ${km(a)}–${km(b)} km  ${Math.round(b - a)} m  ${n}`);
console.log(`turns that a turn restriction forbids: ${banned.length}`);
for (const [a, f, t] of banned) console.log(`   ${km(a)} km  ${f} → ${t}`);
const u = R.maneuvers.filter((m) => m.kind === 'uturn');
console.log(`U-turns in the plan: ${u.length} (${u.filter((m) => m.deadEnd).length} at dead ends, ${u.filter((m) => !m.deadEnd).length} elsewhere)`);
for (const m of u.filter((m) => !m.deadEnd)) console.log(`   ${km(m.along)} km  ${m.name || '(no name)'}`);
let off = 0; for (let i = 0; i < R.half.length; i++) if (R.half[i] < 0) off += R.along[i + 1] - R.along[i];
console.log(`route not on any mapped street: ${off.toFixed(0)} m`);
