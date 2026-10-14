// Survey Navigator: the phone app around js/core.js (screens, map, GPS, voice, saving progress).
import { prepare, Navigator, slice, pointAt, hashText, bearing, angleDiff } from './core.js';
import { SimCar } from './sim.js';
import { STR, speech } from './i18n.js';
import { arrowSvg } from './icons.js';
import { SURVEY_DAYS, loadSurveyDay } from './days.js';

const APP_VERSION = '1.3 (14 Oct 2026)';
const NET_URL = 'data/tbilisi-net.json';
const STYLE = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const NEAR = 320, AHEAD = 1500;          // metres of route drawn bold / drawn at all ahead of the car

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ saved state (this phone only) */

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const K = { route: 'sn1.route', settings: 'sn1.settings', prog: (h) => 'sn1.prog.' + h, trace: (h) => 'sn1.trace.' + h };

const settings = Object.assign({
  lang: (navigator.language || '').toLowerCase().startsWith('ka') ? 'ka' : 'en',
  voice: 'en', showAll: false, muted: false,
}, store.get(K.settings, {}));
const saveSettings = () => store.set(K.settings, settings);
let T = STR[settings.lang] || STR.en;
const dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;

/* ------------------------------------------------------------------ app state */

let netPromise = null;
let day = null;                 // { text, hash, name, proj, net, route }
let nav = null;
let map = null, mapLoaded = null, mapReady = false, carMarker = null;
let screen = 'home', follow = true, followTimer = null;
let watchId = null, wakeLock = null, gpsBlocked = false;
let sim = null, simTimer = null, simMult = 4, simClock = 0, simFed = -1, simBackup = null;
let lastSnap = null, lastRawFix = null, lastFixReal = 0, cov = null, covAt = 0, saveAt = 0, traceAt = 0;
let trace = [], moving = { secs: 0, dist: 0, prev: null };
let previewIdx = 0, toastTimer = null;
let dayPickerOpen = false;

/* ------------------------------------------------------------------ street map + route */

function loadNetwork() {
  if (!netPromise) {
    netPromise = fetch(NET_URL)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch((e) => { console.warn('street network not available', e); netPromise = null; return null; });
  }
  return netPromise;
}

async function openDay(text, persist = true) {
  const netDoc = await loadNetwork();
  const p = prepare(text, netDoc);
  day = { text, hash: hashText(text), name: p.gpx.name || T.appName, proj: p.proj, net: p.net, route: p.route };
  nav = null; trace = store.get(K.trace(day.hash), []) || [];
  if (persist) store.set(K.route, { text, at: Date.now() });
  warmOffline(day.route.bbox);
  return day;
}

function savedProgress() { return day ? store.get(K.prog(day.hash), null) : null; }

function makeNav(restore = true) {
  const n = new Navigator(day.route, day.net, day.proj);
  if (restore) n.restore(savedProgress());
  return n;
}

/* ------------------------------------------------------------------ start screen */

function settingsBlock() {
  const voices = availableVoiceLangs();
  const opts = ['en', 'ru', ...(voices.has('ka') ? ['ka'] : []), 'beep', 'off'];
  return `<div class="card">
    <div class="label">${T.language}</div>
    <div class="seg" data-set="lang">${['ka', 'en'].map((l) => `<button data-v="${l}" class="${settings.lang === l ? 'on' : ''}">${l === 'ka' ? 'ქართული' : 'English'}</button>`).join('')}</div>
    <div class="label">${T.voice}</div>
    <div class="seg" data-set="voice">${opts.map((v) => `<button data-v="${v}" class="${settings.voice === v ? 'on' : ''}">${T.voiceOpts[v]}</button>`).join('')}</div>
  </div>`;
}

function wireSettings(root, after) {
  root.querySelectorAll('.seg[data-set] button').forEach((b) => {
    b.onclick = () => {
      const key = b.parentElement.dataset.set;
      settings[key] = b.dataset.v; saveSettings();
      if (key === 'lang') { T = STR[settings.lang]; setLabelLang(); document.documentElement.lang = settings.lang; }
      if (key === 'voice' && b.dataset.v !== 'off' && b.dataset.v !== 'beep') say(speech(settings.voice, { type: 'go' }), true);
      if (key === 'voice' && b.dataset.v === 'beep') beep(2);
      after();
    };
  });
}

function renderHome(msg = '') {
  screen = 'home';
  const h = $('home');
  h.hidden = false; $('navUi').hidden = true; $('previewUi').hidden = true;
  const brand = `<div class="brand"><img src="icons/icon.svg" alt=""><div><h1>${T.appName}</h1><p>${T.tagline}</p></div></div>`;
  const how = `<div class="card"><b>${T.howTitle}</b><ol class="how">${T.how.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><div class="note">${T.keepOn}</div></div>`;
  const err = msg ? `<div class="err" role="alert">${esc(msg)}</div>` : '';
  const dayPicker = dayPickerMarkup();
  if (!day) {
    h.innerHTML = `<div class="wrap">${brand}<div class="card">${dayPicker}<button class="btn" id="hOpen">${T.openFile}</button>${err}</div>${how}${settingsBlock()}<p class="note">${T.about} · ${T.version} ${APP_VERSION}</p></div>`;
  } else {
    const r = day.route, prog = savedProgress();
    const started = prog && prog.along > 20;
    let progHtml = '';
    if (started) {
      const n = makeNav(), c = n.coverage();
      progHtml = `<div class="prog meta">${T.progress((prog.along / 1000).toFixed(1), (r.total / 1000).toFixed(1), Math.round(prog.along / r.total * 100))}<br>${T.missedSummary(c.missed.length, T.dist(c.missedMeters))}</div>`;
    }
    h.innerHTML = `<div class="wrap">${brand}
      <div class="card">
        <h2>${esc(day.name)}</h2>
        <div class="meta">${T.stats((r.total / 1000).toFixed(1), r.maneuvers.length - 1)}</div>
        <div class="meta">${day.net ? T.matched((r.matched * 100).toFixed(1)) : `<span class="warn">${T.notMatched}</span>`}</div>
        <canvas class="mini-map" id="miniMap"></canvas>
        ${progHtml}
        <button class="btn primary" id="hStart">${started ? T.continueNav : T.start}</button>
        <button class="btn" id="hPreview">${T.preview}</button>
        ${started ? `<button class="btn quiet" id="hRestart">${T.restart}</button>` : ''}
        ${dayPicker}
        <button class="btn quiet" id="hOpen">${T.openAnother}</button>
        ${err}
      </div>${settingsBlock()}${how}<p class="note">${T.about} · ${T.version} ${APP_VERSION}</p></div>`;
    drawMiniMap($('miniMap'));
    $('hStart').onclick = () => startNav({});
    $('hPreview').onclick = () => openPreview(0);
    if (started) $('hRestart').onclick = () => { if (confirm(T.restartConfirm)) startNav({ restart: true }); };
  }
  $('hOpen').onclick = () => $('file').click();
  $('hChooseDay').onclick = () => {
    dayPickerOpen = !dayPickerOpen;
    $('dayChoices').hidden = !dayPickerOpen;
    $('hChooseDay').setAttribute('aria-expanded', String(dayPickerOpen));
  };
  h.querySelectorAll('[data-day]').forEach((button) => {
    button.onclick = () => chooseSurveyDay(Number(button.dataset.day));
  });
  wireSettings(h, () => renderHome());
}

function dayPickerMarkup() {
  return `<button class="btn ${day ? '' : 'primary'}" id="hChooseDay" aria-expanded="${dayPickerOpen}" aria-controls="dayChoices">${T.chooseDay}</button>
    <div class="day-picker" id="dayChoices" role="group" aria-label="${T.chooseDay}" ${dayPickerOpen ? '' : 'hidden'}>
      ${SURVEY_DAYS.map(({ number }) => `<button class="btn day-option" data-day="${number}">${T.dayNumber(number)}</button>`).join('')}
    </div>`;
}

async function chooseSurveyDay(number) {
  $('home').innerHTML = `<div class="wrap"><div class="card" role="status"><span class="spinner"></span>${T.loadingDay(number)}</div></div>`;
  try {
    const text = await loadSurveyDay(number);
    await openDay(text, true);
    dayPickerOpen = false;
    renderHome();
  } catch (e) {
    console.error(e);
    dayPickerOpen = true;
    renderHome(T.dayLoadError(number));
  }
}

function drawMiniMap(cv) {
  const r = day.route, w = cv.clientWidth || 320, hgt = cv.clientHeight || 190, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = hgt * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.X.length; i++) { x0 = Math.min(x0, r.X[i]); x1 = Math.max(x1, r.X[i]); y0 = Math.min(y0, r.Y[i]); y1 = Math.max(y1, r.Y[i]); }
  const s = Math.min((w - 20) / (x1 - x0 || 1), (hgt - 20) / (y1 - y0 || 1));
  const ox = (w - (x1 - x0) * s) / 2, oy = (hgt - (y1 - y0) * s) / 2;
  const P = (i) => [ox + (r.X[i] - x0) * s, hgt - (oy + (r.Y[i] - y0) * s)];
  g.lineWidth = 1.6; g.lineJoin = 'round'; g.strokeStyle = dark ? '#5fd3a8' : '#0b6e4f';
  g.beginPath();
  for (let i = 0; i < r.X.length; i++) { const [x, y] = P(i); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  const prog = savedProgress();
  if (prog && prog.along > 0) {
    g.strokeStyle = dark ? '#9ca3af' : '#94a3b8'; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i < r.X.length && r.along[i] <= prog.along; i++) { const [x, y] = P(i); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  const dot = (i, col) => { const [x, y] = P(i); g.fillStyle = col; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); };
  dot(r.X.length - 1, '#dc2626'); dot(0, '#1d4ed8');
}

$('file').addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  $('home').innerHTML = `<div class="wrap"><div class="card"><span class="spinner"></span>${T.loading}</div></div>`;
  try {
    const text = await f.text();
    await openDay(text, true);
    renderHome();
  } catch (e) {
    console.error(e);
    renderHome(e && e.message === 'no-points' ? T.noPoints : T.readError);
  }
});

/* ------------------------------------------------------------------ the map */

function ensureMap() {
  if (map) return mapLoaded;
  const r = day.route, [lat, lon] = day.proj.toLL(r.X[0], r.Y[0]);
  map = new maplibregl.Map({
    container: 'map', style: dark ? STYLE.dark : STYLE.light, center: [lon, lat], zoom: 16,
    attributionControl: { compact: true }, maxPitch: 60, fadeDuration: 0, pitchWithRotate: false,
  });
  let done;
  mapLoaded = new Promise((res) => { done = res; });
  let ready = false;
  const finish = () => { if (ready) return; ready = true; addRouteLayers(); mapReady = true; calmMap(); setLabelLang(); applyPadding(); done(); };
  map.on('load', finish);
  // No internet and no saved map: draw our own street map so navigation still works
  setTimeout(() => { if (!ready) { map.setStyle(blankStyle()); map.once('styledata', () => { addOwnStreets(); finish(); }); } }, 12000);
  map.on('dragstart', () => setFollow(false));
  map.on('wheel', () => setFollow(false));
  for (const ev of ['zoomstart', 'rotatestart', 'pitchstart']) map.on(ev, (e) => { if (e.originalEvent) setFollow(false); });
  map.on('error', (e) => console.warn('map:', e && e.error && e.error.message));
  const el = document.createElement('div');
  el.className = 'car';
  el.innerHTML = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#1a73e8" stroke="#fff" stroke-width="4"/><path d="M24 10 L34 33 L24 27.5 L14 33 Z" fill="#fff"/></svg>';
  carMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([lon, lat]).addTo(map);
  window.addEventListener('resize', applyPadding);
  requestAnimationFrame(tick);
  return mapLoaded;
}

function blankStyle() {
  return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#10161d' : '#eef1f4' } }] };
}

function addOwnStreets() {
  const net = day.net;
  if (!net) return;
  const lines = [];
  for (let s = 0; s < net.segCount; s++) {
    const [la1, lo1] = day.proj.toLL(net.X[net.sA[s]], net.Y[net.sA[s]]);
    const [la2, lo2] = day.proj.toLL(net.X[net.sB[s]], net.Y[net.sB[s]]);
    lines.push([[lo1, la1], [lo2, la2]]);
  }
  map.addSource('own-streets', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines } } });
  map.addLayer({ id: 'own-streets', type: 'line', source: 'own-streets', paint: { 'line-color': dark ? '#3a4656' : '#c4ccd6', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 7] } });
}

function makeIcon(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return { width: size, height: size, data: g.getImageData(0, 0, size, size).data };
}

function addRouteLayers() {
  map.addImage('chev', makeIcon((g, s) => {
    g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#ffffff';
    g.beginPath(); g.moveTo(s * 0.32, s * 0.24); g.lineTo(s * 0.62, s * 0.5); g.lineTo(s * 0.32, s * 0.76); g.stroke();
  }, 32), { pixelRatio: 2 });
  map.addImage('head', makeIcon((g, s) => {
    g.beginPath(); g.moveTo(s * 0.5, s * 0.08); g.lineTo(s * 0.9, s * 0.86); g.lineTo(s * 0.1, s * 0.86); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#0b3d91'; g.lineJoin = 'round'; g.stroke();
  }, 64), { pixelRatio: 2 });
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['all', 'missed', 'far', 'near', 'back', 'man', 'manhead']) map.addSource(id, { type: 'geojson', data: empty });
  // Above the roads, below the street names (map styles order their layers differently)
  const layers = map.getStyle().layers;
  const firstLabel = (layers.find((l) => l.type === 'symbol' && l['source-layer'] === 'transportation_name')
    || layers.find((l) => l.type === 'symbol' && l['source-layer'] === 'place') || {}).id;
  const line = (id, src, color, width, extra = {}) => map.addLayer({
    id, type: 'line', source: src, layout: { 'line-join': 'round', 'line-cap': 'round', ...(extra.layout || {}) },
    paint: { 'line-color': color, 'line-width': width, ...(extra.paint || {}) },
  }, extra.top ? undefined : firstLabel);
  const zw = (a, b) => ['interpolate', ['exponential', 1.6], ['zoom'], 13, a, 18, b];
  line('all', 'all', dark ? '#8392a6' : '#6b7a90', zw(1.5, 5), { paint: { 'line-opacity': 0.55 }, layout: { visibility: settings.showAll ? 'visible' : 'none' } });
  line('missed', 'missed', '#e11d48', zw(3, 9), { paint: { 'line-dasharray': [1.2, 1.2], 'line-opacity': 0.9 } });
  line('far-case', 'far', '#ffffff', zw(4, 13), { paint: { 'line-opacity': 0.8 } });
  line('far', 'far', '#5b9bf0', zw(2.5, 9), { paint: { 'line-opacity': 0.85 } });
  line('near-case', 'near', '#ffffff', zw(6, 18));
  line('near', 'near', '#1a73e8', zw(4, 12));
  line('back-case', 'back', '#ffffff', zw(6, 18));
  line('back', 'back', '#f59e0b', zw(4, 12));
  const chev = (id, src) => map.addLayer({
    id, type: 'symbol', source: src,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 46, 'icon-image': 'chev', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.55, 18, 1.1], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-keep-upright': false },
  }, firstLabel);
  chev('near-chev', 'near'); chev('far-chev', 'far'); chev('back-chev', 'back');
  line('man-case', 'man', '#0b3d91', zw(8, 22), { top: true });
  line('man', 'man', '#ffffff', zw(4, 13), { top: true });
  map.addLayer({ id: 'manhead', type: 'symbol', source: 'manhead', layout: { 'icon-image': 'head', 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 18, 1] } });
}

// A driving map: no 3D buildings, no shop and cafe icons; streets, one-way arrows and names stay
function calmMap() {
  for (const l of map.getStyle().layers) {
    if (l.type === 'fill-extrusion' || (l.type === 'symbol' && l['source-layer'] === 'poi')) map.setLayoutProperty(l.id, 'visibility', 'none');
  }
}

// Street and place names in one language only
function setLabelLang() {
  if (!map || !mapReady) return;
  const field = settings.lang === 'ka'
    ? ['coalesce', ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin']]
    : ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];
  for (const l of map.getStyle().layers) {
    if (l.type !== 'symbol' || !['transportation_name', 'place', 'water_name', 'waterway'].includes(l['source-layer'])) continue;
    const tf = l.layout && l.layout['text-field'];
    if (tf && JSON.stringify(tf).includes('name')) {
      map.setLayoutProperty(l.id, 'text-field', field);
      map.setLayoutProperty(l.id, 'text-transform', 'none');     // capitals would turn Georgian into Mtavruli
    }
  }
}

const lineData = (coords) => (coords && coords.length > 1
  ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
  : { type: 'FeatureCollection', features: [] });
function setLine(id, coords) { if (mapReady) map.getSource(id).setData(lineData(coords)); }
function setHead(coords) {
  if (!mapReady) return;
  if (!coords || coords.length < 2) { map.getSource('manhead').setData({ type: 'FeatureCollection', features: [] }); return; }
  const a = coords[coords.length - 2], b = coords[coords.length - 1];
  const [x1, y1] = day.proj.toXY(a[1], a[0]), [x2, y2] = day.proj.toXY(b[1], b[0]);
  map.getSource('manhead').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: b }, properties: { b: bearing(x1, y1, x2, y2) } });
}

function applyPadding() {
  if (!map) return;
  const land = innerWidth > innerHeight && innerHeight < 560;
  const bottomH = ($('bottom') && !$('navUi').hidden) ? $('bottom').offsetHeight + 16 : 20;
  const pad = land
    ? { top: Math.round(innerHeight * 0.45), bottom: 20, left: Math.min(446, innerWidth * 0.48 + 16), right: 0 }
    : { top: Math.round(innerHeight * 0.44), bottom: bottomH, left: 0, right: 0 };
  map.setPadding(pad);
}

function setFollow(on) {
  follow = on;
  $('recenter').hidden = on || screen !== 'nav';
  clearTimeout(followTimer);
  if (!on) followTimer = setTimeout(() => setFollow(true), 20000);
  else applyPadding();
}

/* ------------------------------------------------------------------ smooth car + camera */

const view = { from: null, to: null, cur: null, t0: 0, dur: 1000 };
function moveTo(lon, lat, brg, zoom, dur) {
  view.from = view.cur || { lon, lat, brg, zoom };
  view.to = { lon, lat, brg, zoom };
  view.t0 = performance.now(); view.dur = dur;
}
function tick(now) {
  if (view.to && map) {
    const k = clamp((now - view.t0) / view.dur, 0, 1), f = view.from, t = view.to;
    const cur = { lon: f.lon + (t.lon - f.lon) * k, lat: f.lat + (t.lat - f.lat) * k, brg: (f.brg + angleDiff(f.brg, t.brg) * k + 360) % 360, zoom: f.zoom + (t.zoom - f.zoom) * k };
    view.cur = cur;
    carMarker.setLngLat([cur.lon, cur.lat]).setRotation(cur.brg);
    if (follow && screen === 'nav') map.jumpTo({ center: [cur.lon, cur.lat], bearing: cur.brg, zoom: cur.zoom, pitch: 50 });
  }
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ driving */

function startNav({ restart = false, along = null }) {
  unlockSound();
  say(speech(settings.voice, { type: 'go' }), true);
  if (restart) { store.del(K.prog(day.hash)); store.del(K.trace(day.hash)); trace = []; nav = makeNav(false); }
  else if (!nav) nav = makeNav(true);
  nav.start(along ?? nav.along);
  screen = 'nav';
  $('home').hidden = true; $('previewUi').hidden = true; $('navUi').hidden = false;
  renderWaiting(T.waitingGps);
  keepAwake();
  const loaded = ensureMap();                       // creates the map and the car at once
  carMarker.getElement().style.display = '';
  if (!sim) startGps();                             // GPS starts with the tap, not after the map
  loaded.then(() => {
    setFollow(true);
    if (settings.showAll) showWholeDay();
    refreshCoverage(true);
  });
}

function stopNav() {
  stopGps(); stopSim(false); saveProgress(); saveTrace();
  hideGpsHelp();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  renderHome();
}

/* ------------------------------------------------------------------ GPS */

const UA = navigator.userAgent || '';
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_COMPUTER = !IS_IOS && !/Android|Mobile/i.test(UA);
const GOOD_ACC = 80;                                // metres; rougher fixes are shown but not navigated on
const gps = { started: 0, lastAt: 0, lastGoodAt: 0, acc: null, err: 0, restartAt: 0, timer: null, problem: null };

function startGps() {
  stopGps();
  gpsBlocked = false;
  if (!('geolocation' in navigator)) { showGpsHelp('nofix'); return; }
  if (!gps.started) gps.started = Date.now();
  // No time limit: a phone standing still may not report for a while, and that is not an error
  watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, { enableHighAccuracy: true, maximumAge: 1000 });
  // A quick first answer (often rough) so the screen reacts while the GPS locks on
  navigator.geolocation.getCurrentPosition(onPosition, () => {}, { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 });
  if (!gps.timer) gps.timer = setInterval(gpsWatchdog, 3000);
}

function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (gps.timer) clearInterval(gps.timer);
  gps.timer = null;
}

function onGpsError(e) {
  gps.err = e.code;
  if (e.code === 1) { gpsBlocked = true; stopGps(); showGpsHelp('denied'); return; }
  // 2 = no position available, 3 = slow: keep listening, restart the watch now and then
  if (Date.now() - gps.restartAt > 10000) {
    gps.restartAt = Date.now();
    setTimeout(() => { if (screen === 'nav' && !sim && !gpsBlocked) startGps(); }, 2000);
  }
}

function onPosition(p) {
  if (!day || !p || !p.coords) return;
  if (p.timestamp && Date.now() - p.timestamp > 30000) return;      // an old remembered position
  const c = p.coords;
  gps.lastAt = Date.now(); gps.acc = c.accuracy;
  if (c.accuracy <= GOOD_ACC) gps.lastGoodAt = gps.lastAt;
  const [x, y] = day.proj.toXY(c.latitude, c.longitude);
  const speed = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null;
  const heading = Number.isFinite(c.heading) && c.heading >= 0 && (speed == null || speed > 0.8) ? c.heading : null;
  handleFix({ x, y, t: p.timestamp || Date.now(), acc: c.accuracy, speed, heading, lat: c.latitude, lon: c.longitude });
  gpsWatchdog();
}

// Decide what (if anything) the driver needs to be told about the location
function gpsWatchdog() {
  if (screen !== 'nav' || sim) { hideGpsHelp(); return; }
  const now = Date.now(), running = now - gps.started;
  let problem = null;
  if (gpsBlocked) problem = 'denied';
  else if (!gps.lastAt && running > 20000) problem = 'nofix';
  else if (gps.lastAt && (!gps.lastGoodAt || now - gps.lastGoodAt > 30000) && gps.acc > GOOD_ACC && running > 15000) problem = 'coarse';
  if (problem) showGpsHelp(problem); else hideGpsHelp();
  renderGpsChip();
}

function showGpsHelp(kind) {
  gps.problem = kind;
  const where = IS_COMPUTER ? 'computer' : 'phone';
  $('ghTitle').textContent = kind === 'coarse' ? T.gpsTitle.coarse(T.dist(gps.acc || 0)) : T.gpsTitle[kind];
  $('ghText').textContent = T.gpsHelp[`${kind}_${where}`];
  $('ghRetry').textContent = T.retry;
  $('ghPractice').textContent = T.practice;
  $('gpsHelp').hidden = false;
  if (!nav || nav.mode === 'acquire' || !nav.lastFix) renderWaiting(kind === 'coarse' ? T.waitingPrecise(T.dist(gps.acc || 0)) : T.gpsTitle[kind]);
}
function hideGpsHelp() { gps.problem = null; $('gpsHelp').hidden = true; }
$('ghRetry').onclick = () => { hideGpsHelp(); gps.started = Date.now(); gps.lastAt = 0; gps.lastGoodAt = 0; startGps(); };
$('ghPractice').onclick = () => { hideGpsHelp(); startSim(); };

function renderGpsChip() {
  const el = $('gpsChip');
  if (!el) return;
  if (sim) { el.className = 'gpschip sim'; el.textContent = T.practice; return; }
  // A phone standing still may report rarely: a reading from the last minute still counts
  const fresh = gps.lastAt && Date.now() - gps.lastAt < 60000;
  const acc = gps.acc;
  el.className = 'gpschip ' + (!gps.lastAt ? 'none' : !fresh ? 'none' : acc <= 20 ? 'good' : acc <= GOOD_ACC ? 'fair' : 'poor');
  el.textContent = !gps.lastAt ? T.gpsNone : !fresh ? T.gpsWait
    : T.gpsAcc(acc < 1000 ? Math.round(acc) : (acc / 1000).toFixed(1) + (settings.lang === 'ka' ? ' კ' : ' k'));
}

function handleFix(fix) {
  if (!nav || screen !== 'nav') return;
  const snap = nav.update(fix);
  lastSnap = snap; lastRawFix = fix;
  const nowReal = performance.now(), gap = lastFixReal ? nowReal - lastFixReal : 1000;
  lastFixReal = nowReal;
  // the driven track, for sending back to the office
  trace.push([Math.round(fix.t / 1000), +fix.lat.toFixed(6), +fix.lon.toFixed(6), Math.round(fix.acc || 0),
    fix.speed == null ? null : Math.round(fix.speed * 10) / 10, fix.heading == null ? null : Math.round(fix.heading)]);
  if (moving.prev && nav.speed > 1.5) {
    const d = Math.hypot(fix.x - moving.prev.x, fix.y - moving.prev.y), dt = (fix.t - moving.prev.t) / 1000;
    if (dt > 0 && dt < 10 && d < 200) { moving.secs += dt; moving.dist += d; }
  }
  moving.prev = fix;
  for (const e of snap.events) onEvent(e);
  render(snap, fix, clamp(gap, 250, 1200));
  const now = Date.now();
  if (now - covAt > 10000) refreshCoverage();
  if (now - saveAt > 8000) saveProgress();
  if (now - traceAt > 60000) saveTrace();
}

function onEvent(e) {
  const text = speech(settings.voice, e);
  if (e.type === 'prompt') { if (settings.voice === 'beep') beep(e.stage === 'near' ? 2 : 1); else say(text); return; }
  if (e.type === 'off' || e.type === 'start' || e.type === 'resume') { say(text); beep(1); }
  if (e.type === 'rejoin') { say(text); toast(T.rejoined); refreshCoverage(true); }
  if (e.type === 'skip') {
    say(text);
    toast(T.skipped(T.dist(e.meters)), T.goBack, () => { if (nav.undoSkip()) rerender(nav.snapshot()); });
    refreshCoverage(true);
  }
  if (e.type === 'done') { say(text); refreshCoverage(true); saveProgress(); setTimeout(openMenu, 1500); }
}

function kindText(m) {
  if (m.kind === 'roundabout') return T.kind.roundabout(m.exit);
  if (m.kind === 'uturn' && m.deadEnd) return T.uturnEnd;
  return T.kind[m.kind] || T.kind.straight;
}
function streetText(m) {
  return settings.lang === 'ka' ? (m.name || m.ref || m.en) : (m.en || m.name || m.ref);
}

function renderWaiting(msg) {
  const b = $('banner');
  b.className = 'banner wait';
  $('bIcon').innerHTML = '';
  $('bDist').textContent = '';
  $('bInstr').textContent = msg;
  $('bStreet').textContent = day ? day.name : '';
  $('thenChip').hidden = true;
}

// Draw again without a new GPS reading (after a setting change, a skip, the coverage refresh)
function rerender(snap) { if (lastRawFix) render(snap, lastRawFix, 300); }

function render(snap, fix, dur) {
  const R = day.route, P = day.proj;
  // Banner
  const b = $('banner');
  let cls = '', icon = '', dist = '', instr = '', street = '';
  if (snap.mode === 'done') {
    icon = arrowSvg('arrive'); instr = T.done;
    const c = nav.coverage();
    street = T.report((c.driven / 1000).toFixed(1), c.missed.length, T.dist(c.missedMeters));
  } else if (snap.mode === 'back') {
    cls = snap.back.why === 'off' ? 'back' : 'start';
    const headline = snap.back.why === 'off' ? T.offRoute : snap.back.why === 'start' ? T.toStart : T.toResume;
    if (snap.next) {
      icon = arrowSvg(snap.next.m.kind, snap.next.m.a, snap.next.m.exit);
      dist = T.dist(snap.next.dist); instr = kindText(snap.next.m); street = headline;
    } else {
      const tp = pointAt(R, snap.back.target.along), brg = bearing(fix.x, fix.y, tp[0], tp[1]);
      icon = arrowSvg('direction', angleDiff(nav.heading ?? brg, brg));
      dist = T.dist(Math.hypot(tp[0] - fix.x, tp[1] - fix.y)); instr = T.noWayBack; street = headline;
    }
  } else if (snap.mode === 'acquire') {
    cls = 'wait'; street = day.name;
    instr = fix && fix.acc > GOOD_ACC ? T.waitingPrecise(T.dist(fix.acc)) : T.waitingGps;
  } else if (snap.next) {
    const m = snap.next.m;
    icon = arrowSvg(m.kind, m.a, m.exit); dist = T.dist(snap.next.dist); instr = kindText(m); street = streetText(m);
  }
  b.className = 'banner ' + cls;
  $('bIcon').innerHTML = icon; $('bDist').textContent = dist; $('bInstr').textContent = instr; $('bStreet').textContent = street || '';
  const th = snap.then;
  const showThen = th && snap.next && snap.mode !== 'done' && th.gap < 120 && snap.next.dist < 450;
  $('thenChip').hidden = !showThen;
  if (showThen) { $('thenLabel').textContent = T.then; $('thenIcon').innerHTML = arrowSvg(th.m.kind, th.m.a, th.m.exit); }

  // Route on the map: only what is ahead
  if (mapReady) {
    if (snap.mode === 'back' && snap.back.path) {
      const p = snap.back.path;
      setLine('back', slice(p, P, snap.back.pos, p.total));
      setLine('near', []);
      setLine('far', slice(R, P, snap.back.target.along, snap.back.target.along + 700));
    } else if (snap.mode === 'back') {
      setLine('back', []); setLine('near', []);
      setLine('far', slice(R, P, snap.back.target.along, snap.back.target.along + 700));
    } else {
      setLine('back', []);
      setLine('near', slice(R, P, snap.along, snap.along + NEAR));
      setLine('far', slice(R, P, snap.along + NEAR - 3, snap.along + AHEAD));
    }
    const n = snap.next;
    if (n && n.dist < 700 && n.m.kind !== 'arrive' && n.m.kind !== 'rejoin') {
      const path = snap.mode === 'back' && snap.back.path ? snap.back.path : R;
      const a1 = n.m.kind === 'roundabout' && n.m.exitAt != null ? path.along[n.m.exitAt] + 14 : n.m.along + 20;
      const coords = slice(path, P, Math.max(0, n.m.along - 22), Math.min(path.total, a1));
      setLine('man', coords); setHead(coords);
    } else { setLine('man', []); setHead(null); }
  }

  // Car and camera: on the line while on the route, the raw fix otherwise
  let cx = fix.x, cy = fix.y, brg = nav.heading ?? (view.cur ? view.cur.brg : 0);
  if (snap.mode === 'route' || snap.mode === 'done') {
    [cx, cy] = pointAt(R, snap.along);
    const a = pointAt(R, Math.max(0, snap.along - 6)), c = pointAt(R, Math.min(R.total, snap.along + 14));
    brg = bearing(a[0], a[1], c[0], c[1]);
  } else if (snap.mode === 'back' && snap.back.path && nav.speed < 2) {
    const p = snap.back.path, a = pointAt(p, snap.back.pos), c = pointAt(p, Math.min(p.total, snap.back.pos + 15));
    brg = bearing(a[0], a[1], c[0], c[1]);
  }
  const [lat, lon] = P.toLL(cx, cy);
  const kmh = (nav.speed || 0) * 3.6;
  let zoom = 17.4 - clamp((kmh - 15) / 45, 0, 1) * 1.1;
  if (snap.next && snap.next.dist < 150) zoom += 0.3;
  moveTo(lon, lat, brg, zoom, dur);
  carMarker.getElement().classList.toggle('off', snap.mode === 'back');

  // Bottom bar
  const pct = Math.round(snap.along / R.total * 100);
  $('statKm').textContent = T.progress((snap.along / 1000).toFixed(1), (R.total / 1000).toFixed(1), pct);
  $('barFill').style.width = (snap.along / R.total * 100).toFixed(2) + '%';
  const avg = moving.secs > 120 ? moving.dist / moving.secs : 6;
  const left = Math.max(0, R.total - snap.along) / Math.max(2, avg);
  let eta = T.eta(Math.floor(left / 3600), Math.round((left % 3600) / 60));
  if (cov && cov.missed.length) eta += ' · ' + T.missedSummary(cov.missed.length, T.dist(cov.missedMeters));
  $('statEta').textContent = eta;
  renderGpsChip();
}

function refreshCoverage(now = false) {
  if (!nav) return;
  covAt = Date.now();
  cov = nav.coverage();
  const R = day.route, P = day.proj;
  if (mapReady) {
    const lines = cov.missed.map(([a, b]) => slice(R, P, a, b)).filter((l) => l.length > 1);
    map.getSource('missed').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: {} });
  }
  $('barMissed').innerHTML = cov.missed.map(([a, b]) => `<i style="left:${(a / R.total * 100).toFixed(2)}%;width:${((b - a) / R.total * 100).toFixed(2)}%"></i>`).join('');
  if (now && lastSnap) rerender(lastSnap);
}

function showWholeDay() {
  if (!mapReady) return;
  map.setLayoutProperty('all', 'visibility', settings.showAll ? 'visible' : 'none');
  if (settings.showAll) map.getSource('all').setData(lineData(slice(day.route, day.proj, 0, day.route.total)));
}

/* ------------------------------------------------------------------ buttons while driving */

$('recenter').onclick = () => setFollow(true);
$('btnOverview').onclick = () => {
  if (!mapReady || !nav) return;
  const s = lastSnap || nav.snapshot(), R = day.route, P = day.proj;
  const coords = s.mode === 'back' && s.back && s.back.path
    ? slice(s.back.path, P, s.back.pos, s.back.path.total).concat(slice(R, P, s.back.target.along, s.back.target.along + 600))
    : slice(R, P, s.along, s.along + AHEAD);
  if (view.cur) coords.push([view.cur.lon, view.cur.lat]);
  if (coords.length < 2) return;
  const bb = coords.reduce((b, c) => [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])], [180, 90, -180, -90]);
  setFollow(false);
  map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: { top: $('top').offsetHeight + 40, bottom: $('bottom').offsetHeight + 40, left: 40, right: 40 }, bearing: 0, pitch: 0, duration: 600, maxZoom: 17.5 });
};
function renderMute() {
  const off = settings.muted || settings.voice === 'off';
  $('btnMute').innerHTML = off
    ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
$('btnMute').onclick = () => { settings.muted = !settings.muted; saveSettings(); renderMute(); if (!settings.muted) { unlockSound(); beep(1); } };
$('btnMenu').onclick = () => openMenu();
renderMute();

function toast(text, btnText, onBtn) {
  $('toastText').textContent = text;
  const b = $('toastBtn');
  b.hidden = !btnText;
  if (btnText) { b.textContent = btnText; b.onclick = () => { $('toast').hidden = true; onBtn(); }; }
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, btnText ? 15000 : 4000);
}

function closeMenu() { $('sheet').hidden = true; $('sheetBack').hidden = true; }
$('sheetBack').onclick = closeMenu;

function openMenu() {
  if (!nav) return;
  const c = nav.coverage();
  cov = c;
  const sh = $('sheet');
  sh.innerHTML = `<div class="grab"></div>
    <button class="item" id="mSkip">${T.skipTurn}</button>
    <button class="item" id="mBack">${T.backTurn}</button>
    <button class="item" id="mHere">${T.fromHere}</button>
    <h3>${T.missedTitle}</h3>
    ${c.missed.length ? `<ul class="missed-list">${c.missed.map(([a, b], i) => `<li><b>${i + 1}.</b> ${T.missedAt((a / 1000).toFixed(2), T.dist(b - a))}</li>`).join('')}</ul>` : `<div class="note">${T.missedNone}</div>`}
    <button class="item" id="mShareMissed" ${c.missed.length ? '' : 'disabled'}>${T.shareMissed}</button>
    <button class="item" id="mShareTrack">${T.shareTrack}</button>
    ${settingsBlock().replace(/^<div class="card">|<\/div>\s*$/g, '')}
    <button class="item" id="mAll">${settings.showAll ? '✓ ' : ''}${T.showAll}</button>
    <button class="item" id="mSim">${sim ? T.stopSim : T.simulate}</button>
    <button class="item danger" id="mEnd">${T.endNav}</button>
    <button class="item" id="mClose">${T.close}</button>`;
  sh.hidden = false; $('sheetBack').hidden = false;
  wireSettings(sh, () => { renderMute(); openMenu(); if (lastSnap) rerender(lastSnap); });
  $('mSkip').onclick = () => { const from = nav.along, to = nav.jump(1); closeMenu(); toast(T.jumped(T.dist(to - from))); refreshCoverage(true); };
  $('mBack').onclick = () => { nav.jump(-1); closeMenu(); refreshCoverage(true); };
  $('mHere').onclick = () => { const moved = nav.continueHere(); closeMenu(); if (moved != null && moved > 10) toast(T.jumped(T.dist(moved))); refreshCoverage(true); };
  $('mShareMissed').onclick = () => shareGpx(missedGpx(c.missed), 'missed');
  $('mShareTrack').onclick = () => shareGpx(trackGpx(), 'driven');
  $('mAll').onclick = () => { settings.showAll = !settings.showAll; saveSettings(); showWholeDay(); openMenu(); };
  $('mSim').onclick = () => { closeMenu(); if (sim) stopSim(true); else startSim(); };
  $('mEnd').onclick = () => { closeMenu(); stopNav(); };
  $('mClose').onclick = closeMenu;
}

/* ------------------------------------------------------------------ files to send back */

const gpxHead = (name) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Survey Navigator" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>\n`;

function missedGpx(missed) {
  const R = day.route, P = day.proj;
  let out = gpxHead(`${day.name}: missed stretches`);
  missed.forEach(([a, b], i) => {
    out += `<trk><name>Missed ${i + 1}: ${(a / 1000).toFixed(2)} km, ${Math.round(b - a)} m</name><trkseg>\n`;
    for (const [lo, la] of slice(R, P, a, b)) out += `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>\n`;
    out += '</trkseg></trk>\n';
  });
  return out + '</gpx>\n';
}

function trackGpx() {
  let out = gpxHead(`${day.name}: driven track`) + '<trk><name>Driven</name><trkseg>\n';
  for (const [t, la, lo, acc, sp, hd] of trace) {
    out += `<trkpt lat="${la}" lon="${lo}"><time>${new Date(t * 1000).toISOString()}</time><hdop>${(acc / 5).toFixed(1)}</hdop>${sp != null ? `<extensions><speed>${sp}</speed>${hd != null ? `<course>${hd}</course>` : ''}</extensions>` : ''}</trkpt>\n`;
  }
  return out + '</trkseg></trk>\n</gpx>\n';
}

async function shareGpx(text, kind) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = (day.name || 'route').replace(/[^\w\-]+/g, '_').slice(0, 40);
  const name = `${base}_${kind}_${stamp}.gpx`;
  const file = new File([text], name, { type: 'application/gpx+xml' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ------------------------------------------------------------------ saving progress on this phone */

function saveProgress() { if (nav && day && !sim) { saveAt = Date.now(); store.set(K.prog(day.hash), { ...nav.serialize(), at: saveAt }); } }
function saveTrace() {
  if (!day || sim) return;
  traceAt = Date.now();
  if (!store.set(K.trace(day.hash), trace)) store.set(K.trace(day.hash), trace.slice(-20000));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveProgress(); saveTrace(); }
  else if (screen === 'nav') keepAwake();
});
window.addEventListener('pagehide', () => { saveProgress(); saveTrace(); });

async function keepAwake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch { /* not allowed now */ }
}

/* ------------------------------------------------------------------ sound */

let audioCtx = null, voiceList = [];
function loadVoices() { try { voiceList = speechSynthesis.getVoices() || []; } catch { voiceList = []; } }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function availableVoiceLangs() { return new Set(voiceList.map((v) => (v.lang || '').slice(0, 2).toLowerCase())); }
function pickVoice(code) {
  const list = voiceList.filter((v) => (v.lang || '').toLowerCase().startsWith(code));
  return list.find((v) => /enhanced|premium/i.test(v.name)) || list.find((v) => v.default) || list[0] || null;
}

function unlockSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}

function beep(n = 1) {
  if (settings.muted || settings.voice === 'off' || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < n; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = i ? 660 : 880; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t0 + i * 0.22); g.gain.exponentialRampToValueAtTime(0.5, t0 + i * 0.22 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.2);
  }
}

function say(text, force = false) {
  if (!text || !('speechSynthesis' in window)) return;
  if (!force && (settings.muted || settings.voice === 'off' || settings.voice === 'beep')) return;
  if (settings.voice === 'off' || settings.voice === 'beep') return;
  const code = settings.voice;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(code);
    if (v) u.voice = v;
    u.lang = v ? v.lang : { en: 'en-US', ru: 'ru-RU', ka: 'ka-GE' }[code];
    u.rate = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* speech not available */ }
}

/* ------------------------------------------------------------------ practice drive */

function startSim() {
  stopGps();
  // A practice drive never touches the real day: keep the real progress aside and put it back afterwards
  saveProgress(); saveTrace();
  simBackup = { prog: nav.serialize(), trace };
  trace = [];
  sim = new SimCar(nav, { speed: 9, noise: 3, seed: (Date.now() & 0xffff) + 1, startAlong: nav.along });
  simClock = 0; simFed = -1;
  hideGpsHelp();
  $('simBar').hidden = false;
  renderSimBar(); applyPadding();
  simTimer = setInterval(() => {
    const dt = 0.1 * simMult;
    const fx = sim.step(dt);
    simClock += dt;
    if (simClock - simFed >= 1) {
      simFed = simClock;
      const [lat, lon] = day.proj.toLL(fx.x, fx.y);
      handleFix({ ...fx, lat, lon, t: Math.round(simClock * 1000) + 1e12 });
    }
  }, 100);
}
function stopSim(restartGps = false) {
  if (simTimer) clearInterval(simTimer);
  const wasSim = !!sim;
  simTimer = null; sim = null;
  $('simBar').hidden = true;
  applyPadding();
  if (wasSim && simBackup) {
    nav = makeNav(false); nav.restore(simBackup.prog); trace = simBackup.trace; simBackup = null;
    if (screen === 'nav') nav.start(nav.along);
    refreshCoverage(false);
  }
  if (restartGps && screen === 'nav') startGps();
}
function renderSimBar() {
  const bar = $('simBar');
  bar.querySelectorAll('[data-mult]').forEach((b) => { b.classList.toggle('on', +b.dataset.mult === simMult); b.onclick = () => { simMult = +b.dataset.mult; renderSimBar(); }; });
  $('simMiss').textContent = T.simMissShort; $('simMiss').onclick = () => sim && sim.planMiss();
  $('simStop').textContent = T.simStopShort; $('simStop').onclick = () => stopSim(true);
}

/* ------------------------------------------------------------------ checking the turns before driving */

function openPreview(i) {
  screen = 'preview';
  $('home').hidden = true; $('navUi').hidden = true; $('previewUi').hidden = false;
  ensureMap().then(() => { if (carMarker) carMarker.getElement().style.display = 'none'; showPreview(i); });
}

function showPreview(i) {
  const R = day.route, P = day.proj, M = R.maneuvers;
  previewIdx = clamp(i, 0, M.length - 1);
  const m = M[previewIdx];
  setLine('back', []); setLine('missed', []);
  setLine('near', slice(R, P, m.along - 160, m.along + 60));
  setLine('far', slice(R, P, m.along + 57, m.along + 450));
  const a1 = m.kind === 'roundabout' && m.exitAt != null ? R.along[m.exitAt] + 14 : m.along + 20;
  const arrow = m.kind === 'arrive' ? [] : slice(R, P, Math.max(0, m.along - 22), Math.min(R.total, a1));
  setLine('man', arrow); setHead(arrow.length ? arrow : null);
  const p = pointAt(R, m.along), q = pointAt(R, Math.max(0, m.along - 30));
  const [lat, lon] = P.toLL(p[0], p[1]);
  map.easeTo({ center: [lon, lat], bearing: bearing(q[0], q[1], p[0], p[1]), zoom: 17.6, pitch: 45, duration: 650,
    padding: { top: 60, bottom: $('previewUi').querySelector('.preview-card').offsetHeight + 40, left: 0, right: 0 } });
  $('pIcon').innerHTML = arrowSvg(m.kind, m.a, m.exit);
  $('pInstr').textContent = kindText(m);
  $('pStreet').textContent = streetText(m) || '';
  $('pMeta').textContent = `${(m.along / 1000).toFixed(2)} km · ${T.of(previewIdx + 1, M.length)}`;
  $('pPrev').textContent = T.prev; $('pNext').textContent = T.next; $('pStart').textContent = T.startHere; $('pClose').textContent = T.close;
}
$('pPrev').onclick = () => showPreview(previewIdx - 1);
$('pNext').onclick = () => showPreview(previewIdx + 1);
$('pClose').onclick = () => renderHome();
$('pStart').onclick = () => {
  const m = day.route.maneuvers[previewIdx];
  nav = makeNav(true);
  startNav({ along: Math.max(0, m.along - 80) });
};

/* ------------------------------------------------------------------ offline: keep this route's map */

async function warmOffline(bbox) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  try {
    const tj = await (await fetch(TILEJSON)).json();
    const tpl = tj.tiles[0], maxz = Math.min(14, tj.maxzoom || 14);
    const urls = [];
    const pad = 0.012;
    const [w, s, e, n] = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];
    const tx = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
    const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
    for (let z = 10; z <= maxz; z++) {
      for (let x = tx(w, z); x <= tx(e, z); x++) for (let y = ty(n, z); y <= ty(s, z); y++) urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
    const style = dark ? STYLE.dark : STYLE.light;
    urls.push(style);
    for (const font of ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']) {
      for (const range of ['0-255', '256-511', '4096-4351', '8192-8447']) urls.push(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(font)}/${range}.pbf`);
    }
    let i = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; try { await fetch(u, { mode: 'cors' }); } catch { /* offline */ } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } catch { /* offline now; the map still works where it has been seen */ }
}

/* ------------------------------------------------------------------ start up */

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}

(async function boot() {
  document.documentElement.lang = settings.lang;
  const saved = store.get(K.route, null);
  if (saved && saved.text) {
    $('home').innerHTML = `<div class="wrap"><div class="card"><span class="spinner"></span>${T.loadingMap}</div></div>`;
    try { await openDay(saved.text, false); } catch (e) { console.error(e); day = null; }
  } else loadNetwork();
  renderHome();
})();

// For the automated checks: drive the app without touching it
window.__sn = {
  openText: async (text) => { await openDay(text, true); renderHome(); },
  start: (opts = {}) => startNav(opts),
  sim: (mult = 4) => { simMult = mult; startSim(); },
  miss: () => sim && sim.planMiss(),
  stopSim: () => stopSim(false),
  preview: (i) => openPreview(i),
  menu: () => openMenu(),
  snap: () => lastSnap && { mode: lastSnap.mode, along: lastSnap.along, next: lastSnap.next && { kind: lastSnap.next.m.kind, dist: lastSnap.next.dist }, back: !!lastSnap.back },
  coverage: () => nav && nav.coverage(),
  feed: (fix) => handleFix(fix),
  get nav() { return nav; }, get map() { return map; }, get day() { return day; },
};
