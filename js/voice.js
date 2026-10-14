// The recorded Georgian voice: 40 short clips in audio/ka/, joined the way the sentences are built in
// i18n.js (distance + turn, turn + "then" + turn). Recorded and trimmed with the STS NAV recorder, 14 Oct 2026.
import { spokenMeters } from './i18n.js';

export const VOICE_DIR = 'audio/ka/';
export const VOICE_CLIPS = [
  'dist-070', 'dist-080', 'dist-090', 'dist-100', 'dist-150', 'dist-200', 'dist-250', 'dist-300', 'dist-350',
  'turn-right', 'turn-left', 'keep-right', 'keep-left', 'u-turn', 'sharp-left', 'straight-on', 'sharp-right',
  'bear-right', 'bear-left', 'route-ends', 'back-on-route-ahead',
  'roundabout-exit-1', 'roundabout-exit-2', 'roundabout-exit-3', 'roundabout-exit-4', 'roundabout-exit-5',
  'roundabout-exit-6', 'roundabout-exit-7', 'roundabout-exit-8', 'roundabout-other',
  'then',
  'msg-started', 'msg-off-route', 'msg-back-on-route', 'msg-skipped', 'msg-to-start', 'msg-to-where-stopped',
  'msg-paused', 'msg-resumed', 'msg-route-complete',
];

const DIST = [70, 80, 90, 100, 150, 200, 250, 300, 350];
const KIND = {
  left: 'turn-left', right: 'turn-right', 'slight-left': 'bear-left', 'slight-right': 'bear-right',
  'sharp-left': 'sharp-left', 'sharp-right': 'sharp-right', 'keep-left': 'keep-left', 'keep-right': 'keep-right',
  straight: 'straight-on', uturn: 'u-turn', arrive: 'route-ends', rejoin: 'back-on-route-ahead',
};
const MESSAGE = {
  go: 'msg-started', off: 'msg-off-route', rejoin: 'msg-back-on-route', skip: 'msg-skipped', start: 'msg-to-start',
  resume: 'msg-to-where-stopped', done: 'msg-route-complete', paused: 'msg-paused', resumed: 'msg-resumed',
};

function turnClip(m) {
  if (m.kind === 'roundabout') return m.exit >= 1 && m.exit <= 8 ? 'roundabout-exit-' + m.exit : 'roundabout-other';
  return KIND[m.kind] || 'straight-on';
}

// The clips for a navigator event, in order, or null when nothing is said
export function clipsFor(e) {
  if (e.type === 'prompt') {
    if (e.stage === 'far') {
      const d = spokenMeters(e.dist);
      const near = DIST.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
      return ['dist-' + String(near).padStart(3, '0'), turnClip(e.m)];
    }
    return e.then ? [turnClip(e.m), 'then', turnClip(e.then)] : [turnClip(e.m)];
  }
  return MESSAGE[e.type] ? [MESSAGE[e.type]] : null;
}

// Pauses between the pieces, as heard in the recorder's "Hear it in a sentence"
export function gapAfter(names, k) {
  if (names[k].startsWith('dist-')) return 0.08;
  if (names[k] === 'then' || names[k + 1] === 'then') return 0.06;
  return 0.05;
}
