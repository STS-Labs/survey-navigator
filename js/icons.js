// Instruction arrows, drawn at the real angle of the turn (a sharp right looks sharp).
const DEG = Math.PI / 180;
const f = (n) => n.toFixed(1);

function head(x, y, dx, dy, s = 11) {          // filled arrowhead with its tip just past (x, y)
  const px = -dy, py = dx;
  return `<path d="M${f(x + dx * s)} ${f(y + dy * s)} L${f(x + px * s)} ${f(y + py * s)} L${f(x - px * s)} ${f(y - py * s)} Z" fill="currentColor"/>`;
}

function turn(a, opacity = 1) {
  const r = 12, L = 30, dx = Math.sin(a * DEG), dy = -Math.cos(a * DEG);
  const p2 = [50 + r * dx, 50 + r * dy], e = [50 + L * dx, 50 + L * dy];
  return `<g opacity="${opacity}"><path d="M50 94 L50 ${50 + r} Q50 50 ${f(p2[0])} ${f(p2[1])} L${f(e[0])} ${f(e[1])}" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>${head(e[0], e[1], dx, dy)}</g>`;
}

export function arrowSvg(kind, a = 0, exit = 1) {
  let body;
  switch (kind) {
    case 'uturn':
      body = `<path d="M64 94 L64 46 A19 19 0 0 0 26 46 L26 58" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>${head(26, 60, 0, 1)}`;
      break;
    case 'keep-left':
      body = turn(32, 0.32) + turn(Math.min(-18, a < 0 ? a : -25));
      break;
    case 'keep-right':
      body = turn(-32, 0.32) + turn(Math.max(18, a > 0 ? a : 25));
      break;
    case 'straight':
      body = turn(0);
      break;
    case 'roundabout': {
      const dx = Math.sin(a * DEG), dy = -Math.cos(a * DEG), cx = 50, cy = 46, R = 15;
      const s = [cx + R * dx, cy + R * dy], e = [cx + 36 * dx, cy + 36 * dy];
      body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="currentColor" stroke-width="8" opacity=".55"/>`
        + `<path d="M50 94 L50 ${cy + R}" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>`
        + `<path d="M${f(s[0])} ${f(s[1])} L${f(e[0])} ${f(e[1])}" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>${head(e[0], e[1], dx, dy)}`
        + `<text x="${cx}" y="${cy + 5}" font-size="15" font-weight="700" text-anchor="middle" fill="currentColor" font-family="-apple-system,Segoe UI,sans-serif">${exit}</text>`;
      break;
    }
    case 'arrive':
      body = `<path d="M30 94 L30 14" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>`
        + `<path d="M34 16 H76 L68 30 L76 44 H34 Z" fill="currentColor"/>`;
      break;
    case 'rejoin':
      body = `<path d="M18 30 H82" stroke="currentColor" stroke-width="9" stroke-linecap="round" opacity=".55"/>`
        + `<path d="M50 94 L50 46" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>${head(50, 42, 0, -1)}`;
      break;
    case 'pause':
      body = '<rect x="27" y="22" width="16" height="56" rx="5" fill="currentColor"/><rect x="57" y="22" width="16" height="56" rx="5" fill="currentColor"/>';
      break;
    case 'direction': {             // no street path available: point towards the target
      const dx = Math.sin(a * DEG), dy = -Math.cos(a * DEG);
      body = `<path d="M${f(50 - 30 * dx)} ${f(50 - 30 * dy)} L${f(50 + 22 * dx)} ${f(50 + 22 * dy)}" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>${head(50 + 22 * dx, 50 + 22 * dy, dx, dy, 13)}`;
      break;
    }
    default:
      body = turn(a);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}

// Night design buttons and marks (24 x 24, drawn in the text colour)
const ui = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
export const UI = {
  menu: ui('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  soundOn: ui('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 010 7M19 5.9a8.6 8.6 0 010 12.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  soundOff: ui('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  recentre: ui('<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  pause: ui('<rect x="6" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.3" fill="currentColor"/>'),
  play: ui('<path d="M7 5.2v13.6L18.5 12z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'),
  gps: ui('<path d="M12 2.8l7.5 17.7-7.5-3.9-7.5 3.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  skip: ui('<path d="M5 5.5v13l9.5-6.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="16.2" y="5.5" width="3" height="13" rx="1.2" fill="currentColor"/>'),
};

// The car on the map: a ring with an arrow (the ring's colour comes from the stylesheet)
export const CAR_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring" cx="24" cy="24" r="20.25" fill="#1d1b31" stroke-width="3.5"/><path d="M24 12.5L32.5 32 24 27.5 15.5 32z" fill="#f2f3f7" stroke="#f2f3f7" stroke-width="1.5" stroke-linejoin="round"/></svg>';
