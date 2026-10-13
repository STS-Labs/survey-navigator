// Drive a whole day in simulation and check the guidance never loses its place.
//   node tests/drive_test.mjs <day.gpx> data/tbilisi-net.json
import { readFileSync } from 'node:fs';
import { prepare, Navigator } from '../js/core.js';
import { SimCar } from '../js/sim.js';

const [gpxPath, netPath] = process.argv.slice(2);
const { route, net, proj } = prepare(readFileSync(gpxPath, 'utf8'), JSON.parse(readFileSync(netPath, 'utf8')));
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

// The guarantee that matters: every piece of the route was either really driven (car within 8 m, going the
// same way) or is on the missed list. Returns metres that are neither (silently lost) and metres listed as
// missed although they were driven (harmless, they just get driven again).
function audit(trace, missed, from = 0, to = route.total) {
  const C = 20, grid = new Map();
  trace.forEach((p, i) => { const k = Math.floor(p[0] / C) + ',' + Math.floor(p[1] / C); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const inMissed = (a) => missed.some(([x, y]) => a >= x - 5 && a <= y + 5);
  let lost = 0, over = 0; const lostAt = [];
  for (let i = 0; i < route.X.length - 1; i++) {
    const a = (route.along[i] + route.along[i + 1]) / 2, L = route.along[i + 1] - route.along[i];
    if (a < from || a > to || L < 0.5) continue;
    const mx = (route.X[i] + route.X[i + 1]) / 2, my = (route.Y[i] + route.Y[i + 1]) / 2, b = route.segB[i];
    let driven = false;
    for (let gx = Math.floor(mx / C) - 1; gx <= Math.floor(mx / C) + 1 && !driven; gx++)
      for (let gy = Math.floor(my / C) - 1; gy <= Math.floor(my / C) + 1 && !driven; gy++)
        for (const j of grid.get(gx + ',' + gy) || []) {
          const p = trace[j];
          if (Math.hypot(p[0] - mx, p[1] - my) <= 8 && Math.abs(((p[2] - b + 540) % 360) - 180) <= 50) { driven = true; break; }
        }
    if (!driven && !inMissed(a)) { lost += L; if (!lostAt.length || a - lostAt[lostAt.length - 1][1] > 30) lostAt.push([a, a]); else lostAt[lostAt.length - 1][1] = a; }
    if (driven && inMissed(a)) over += L;
  }
  return { lost, over, lostAt };
}

function drive({ noise = 4, speed = 10, seed = 7, missEvery = 0, maxSteps = 60000, onStep = null } = {}) {
  const nav = new Navigator(route, net, proj);
  nav.start(0);
  const car = new SimCar(nav, { speed, noise, seed });
  const stats = { maxLag: 0, lagAt: 0, off: 0, rejoin: 0, skip: 0, prompts: 0, steps: 0, misses: [], done: false, trace: [] };
  let pendingMiss = null;
  const tried = new Set();
  for (let s = 0; s < maxSteps; s++) {
    if (missEvery && car.mode === 'route' && !car.missAt && !pendingMiss) {
      const k = nav.nextManeuverIndex(car.along);
      if (k % missEvery === missEvery - 1 && !tried.has(k)) {
        tried.add(k);
        const m = car.planMiss();
        if (m) pendingMiss = { m, at: m.along, events: [] };
      }
    }
    // Move the car in quarter-second steps (its true path, for the audit); the phone gets one fix a second
    let fix;
    for (let q = 0; q < 4; q++) {
      const lp = [car.x, car.y];
      fix = car.step(0.25);
      if (Math.hypot(car.x - lp[0], car.y - lp[1]) > 0.2) stats.trace.push([car.x, car.y, (Math.atan2(car.x - lp[0], car.y - lp[1]) * 180 / Math.PI + 360) % 360]);
    }
    if (onStep) onStep(s, car, nav);
    const snap = nav.update(fix);
    stats.steps++;
    for (const e of snap.events) {
      if (e.type === 'off') stats.off++;
      if (e.type === 'rejoin') stats.rejoin++;
      if (e.type === 'skip') stats.skip++;
      if (e.type === 'prompt') stats.prompts++;
      if (pendingMiss) pendingMiss.events.push(e.type === 'prompt' ? null : e.type);
    }
    if (pendingMiss && snap.events.some((e) => e.type === 'rejoin' || e.type === 'skip')) {
      pendingMiss.backAt = nav.along;
      // Back on the route before or at the missed junction: everything after it is still driven
      pendingMiss.ok = snap.events.some((e) => e.type === 'rejoin') && nav.along >= pendingMiss.at - 150 && nav.along <= pendingMiss.at + 120;
      pendingMiss.events = pendingMiss.events.filter(Boolean);
      stats.misses.push(pendingMiss);
      pendingMiss = null;
    }
    if (car.mode === 'route' && nav.mode === 'route') {
      const lag = car.along - nav.along;
      if (Math.abs(lag) > Math.abs(stats.maxLag)) { stats.maxLag = lag; stats.lagAt = car.along; }
    }
    if (snap.mode === 'done') { stats.done = true; break; }
  }
  stats.audit = audit(stats.trace, nav.coverage().missed);
  stats.missedReport = nav.coverage().missedMeters;
  return { stats, nav, car };
}

// 1. A perfect day with ordinary phone-GPS noise
{
  const t0 = performance.now();
  const { stats } = drive({ noise: 4 });
  const ms = performance.now() - t0;
  console.log(`clean drive: ${stats.steps} fixes in ${ms.toFixed(0)} ms (${(ms / stats.steps).toFixed(2)} ms per fix)`);
  check(stats.done, 'reaches the end of the route');
  check(stats.off === 0, `never thinks it left the route (off events: ${stats.off})`);
  check(Math.abs(stats.maxLag) < 30, `position along the route stays within 30 m of the truth (worst ${stats.maxLag.toFixed(1)} m at ${(stats.lagAt / 1000).toFixed(2)} km)`);
  check(stats.prompts >= route.maneuvers.length * 0.9, `spoken prompts: ${stats.prompts} for ${route.maneuvers.length} instructions`);
  check(stats.audit.lost < 1, `coverage audit: every metre of the route driven (${stats.audit.lost.toFixed(0)} m unaccounted ${JSON.stringify(stats.audit.lostAt.map(([a, b]) => [Math.round(a), Math.round(b)]))})`);
  check(stats.missedReport === 0, `coverage report after a clean day lists nothing as missed (${stats.missedReport} m)`);
}

// 2. Heavier noise (urban canyon) at walking-pace survey speed
{
  const { stats } = drive({ noise: 9, speed: 6, seed: 3 });
  check(stats.done, 'noisy GPS (9 m) at 22 km/h: reaches the end');
  check(stats.skip === 0, `noisy GPS: never skips ahead (skips: ${stats.skip})`);
  check(Math.abs(stats.maxLag) < 45, `noisy GPS: worst position error ${stats.maxLag.toFixed(1)} m at ${(stats.lagAt / 1000).toFixed(2)} km`);
  console.log(`   (false off-route alarms with 9 m noise: ${stats.off})`);
  check(stats.audit.lost < 1, `noisy GPS coverage audit: ${stats.audit.lost.toFixed(0)} m unaccounted, ${stats.audit.over.toFixed(0)} m listed as missed though driven`);
}

// 3. Missing a turn on purpose every 20 instructions
{
  const { stats, car, nav } = drive({ noise: 4, missEvery: 20, maxSteps: 90000 });
  const bad = stats.misses.filter((m) => !m.ok);
  check(stats.done, 'with missed turns: still reaches the end');
  check(stats.misses.length >= 30, `missed ${stats.misses.length} turns on purpose`);
  // A driver who ignores the way back and follows a later part of the route through one of its turns may be
  // let go (the skipped stretch goes on the missed list); everyone else must be brought back to the spot
  check(bad.length <= Math.ceil(stats.misses.length * 0.05) && bad.every((b) => b.events.includes('skip')),
    `missed turns lead back to the exact spot (${stats.misses.length - bad.length}/${stats.misses.length}; others logged as skips)`);
  for (const b of bad.slice(0, 8)) console.log(`   miss at ${(b.at / 1000).toFixed(3)} km (${b.m.kind}): back at ${(b.backAt / 1000).toFixed(3)} km, events ${b.events.join(' ')}`);
  const cov = nav.coverage();
  console.log(`   coverage report: ${(cov.driven / 1000).toFixed(2)} km driven, ${cov.missed.length} missed stretches (${cov.missedMeters} m), ${stats.audit.over.toFixed(0)} m listed though driven`);
  check(stats.audit.lost < 1, `coverage audit with ${stats.misses.length} missed turns: ${stats.audit.lost.toFixed(0)} m unaccounted ${JSON.stringify(stats.audit.lostAt.map(([a, b]) => [Math.round(a), Math.round(b)]))}`);
  console.log(`   extra driving for ${stats.misses.length} misses: ${((car.driven - route.total) / 1000).toFixed(1)} km`);
}

// 4. The phone was off for two minutes while the car kept driving the route
{
  const nav = new Navigator(route, net, proj);
  nav.start(0);
  const car = new SimCar(nav, { speed: 10, noise: 4, seed: 11 });
  let okResume = true, offs = 0, worst = 0;
  for (let s = 0; s < 4000; s++) {
    const fix = car.step(1);
    if (s % 600 > 0 && s % 600 < 120) continue;         // 2 minutes without fixes every 10 minutes
    const snap = nav.update(fix);
    offs += snap.events.filter((e) => e.type === 'off').length;
    if (s % 600 === 120) { const err = Math.abs(car.along - nav.along); worst = Math.max(worst, err); if (err > 40) okResume = false; }
  }
  check(okResume && offs === 0, `after 2-minute gaps it picks up the right place (worst ${worst.toFixed(1)} m, off events ${offs})`);
}

// 5. The driver misses a turn, ignores the way back and joins the route 800 m further on
{
  const runs = [];
  for (const at of [9000, 31000, 52000, 77000, 101000]) {
    const nav = new Navigator(route, net, proj);
    nav.start(at - 300);
    const car = new SimCar(nav, { speed: 10, noise: 3, seed: 5, startAlong: at - 300 });
    const events = [], trace = [];
    let detoured = false, last = [car.x, car.y];
    car.planMiss();
    const missAt = car.missAt && car.missAt.along;
    for (let s = 0; s < 900; s++) {
      if (car.mode === 'follow' && !detoured) { detoured = car.detourTo(missAt + 800); }
      let fix;
      for (let q = 0; q < 4; q++) {
        const lp = [car.x, car.y];
        fix = car.step(0.25);
        if (Math.hypot(car.x - lp[0], car.y - lp[1]) > 0.2) trace.push([car.x, car.y, (Math.atan2(car.x - lp[0], car.y - lp[1]) * 180 / Math.PI + 360) % 360]);
      }
      const snap = nav.update(fix);
      events.push(...snap.events.filter((e) => e.type !== 'prompt').map((e) => e.type + (e.meters ? ':' + e.meters : '')));
    }
    const a = audit(trace, nav.coverage().missed, at - 300, Math.min(car.along, nav.along) - 20); if (a.lost >= 1) console.log("   unaccounted at", JSON.stringify(a.lostAt.map(([x, y]) => [Math.round(x), Math.round(y)])));
    const tracks = Math.abs(car.along - nav.along) < 40 && nav.mode === 'route';
    runs.push({ missAt, events, missed: nav.coverage().missed.filter(([x, y]) => y > at - 300).map(([x, y]) => [Math.round(x), Math.round(y)]), a, ok: detoured && tracks && a.lost < 1, err: car.along - nav.along });
  }
  for (const r of runs) console.log(`   left at ${(r.missAt / 1000).toFixed(2)} km: ${r.events.join(', ')}; missed ${JSON.stringify(r.missed)}; unaccounted ${r.a.lost.toFixed(0)} m; listed-but-driven ${r.a.over.toFixed(0)} m; final error ${r.err.toFixed(1)} m`);
  check(runs.every((r) => r.ok), `joining further on: navigator follows the car and nothing goes unaccounted (${runs.filter((r) => r.ok).length}/${runs.length})`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
