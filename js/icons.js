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
