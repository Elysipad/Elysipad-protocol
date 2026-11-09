// Marquee ticker fed by the same live rows as the board (all ten, untouched by CA state).
import { DASH, fmtPrice, fmtPct } from './format.js';
import { reduced } from './motion.js';

function item(r) {
  const s = document.createElement('span'); s.className = 'tick';
  const b = document.createElement('b'); b.textContent = r.symbol || r.name || DASH;
  const p = document.createElement('span'); p.textContent = fmtPrice(r.price);
  const c = document.createElement('span'); c.textContent = fmtPct(r.change);
  c.className = r.change > 0 ? 'up' : r.change < 0 ? 'down' : '';
  s.append(b, p, c); return s;
}

export function createTicker(track) {
  function paint(nodes) {
    track.replaceChildren(...nodes);
    const half = nodes.length;
    // Duplicate once for a seamless loop; the copy is hidden from assistive tech.
    nodes.forEach((n) => { const d = n.cloneNode(true); d.classList.add('dup'); d.setAttribute('aria-hidden', 'true'); track.appendChild(d); });
    requestAnimationFrame(() => {
      const w = track.scrollWidth / 2;
      track.style.setProperty('--dur', Math.max(24, w / 55).toFixed(1) + 's'); // about 55px per second
    });
    return half;
  }
  return {
    update(m) {
      if (m.rows.length) { paint(m.rows.map(item)); return; }
      if (m.status === 'loading') return;
      const e = document.createElement('span'); e.className = 'tick err';
      e.textContent = DASH + '  pair feed ' + (m.status === 'pending' ? 'pending' : 'unreachable');
      paint([e, e.cloneNode(true), e.cloneNode(true)]);
    },
    get reduced() { return reduced(); },
  };
}
