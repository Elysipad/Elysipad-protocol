// Motion layer: damped-spring solver, scroll reveal, parallax, progress bar, spotlight.
// Every effect checks reduced() and falls back to the final state with zero motion.
export const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reducedQuery.matches;

const jobs = new Set();
let raf = 0, lastT = 0;
function frame(t) {
  const dt = Math.min(0.034, (t - lastT) / 1000 || 0.016);
  lastT = t;
  for (const j of [...jobs]) if (j(dt, t) === false) jobs.delete(j);
  raf = jobs.size ? requestAnimationFrame(frame) : 0;
}
export function loop(fn) {
  jobs.add(fn);
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); }
  return () => jobs.delete(fn);
}

// Damped harmonic oscillator: x'' = -k (x - to) - c x'. Integrated with fixed 1/240s substeps.
// k=170, c=22 gives a gentle single overshoot (damping ratio about 0.84).
export function spring({ from = 0, to = 1, k = 170, c = 22, delay = 0, onUpdate, onDone }) {
  let x = from, v = 0, wait = delay / 1000;
  loop((dt) => {
    if (wait > 0) { wait -= dt; return true; }
    let rem = dt;
    while (rem > 0) {
      const h = Math.min(rem, 1 / 240);
      v += (-k * (x - to) - c * v) * h;
      x += v * h; rem -= h;
    }
    const done = Math.abs(x - to) < 0.0008 && Math.abs(v) < 0.01;
    onUpdate(done ? to : x);
    if (done) { onDone && onDone(); return false; }
    return true;
  });
}

export function initReveal() {
  const groups = new Map();
  const items = [...document.querySelectorAll('[data-reveal]')];
  const reveal = (el, index) => {
    if (reduced()) { el.classList.add('revealed'); return; }
    spring({
      delay: index * 70,
      onUpdate: (p) => {
        el.style.opacity = String(Math.max(0, Math.min(1, p)));
        el.style.transform = `translateY(${(1 - p) * 28}px)`;
        if (!el.classList.contains('revealed')) el.classList.add('revealed');
      },
      onDone: () => { el.style.opacity = ''; el.style.transform = ''; },
    });
  };
  items.forEach((el) => {
    const g = el.closest('[data-reveal-group]') || document.body;
    const i = groups.get(g) || 0; groups.set(g, i + 1); el.dataset.ri = String(i);
  });
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('revealed')); return; }
  const queue = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const g = e.target.closest('[data-reveal-group]') || document.body;
      const n = queue.get(g) || 0; queue.set(g, n + 1);
      reveal(e.target, Math.min(n, 6));
      setTimeout(() => queue.set(g, Math.max(0, (queue.get(g) || 1) - 1)), 400);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((el) => io.observe(el));
}

export function initParallax() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  const layers = [...hero.querySelectorAll('.layer[data-depth]')];
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let heroOn = true;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width - 0.5; target.y = (e.clientY - r.top) / r.height - 0.5;
  });
  hero.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; });
  new IntersectionObserver((es) => { heroOn = es[0].isIntersecting; }).observe(hero);
  loop(() => {
    if (reduced()) { layers.forEach((l) => { l.style.transform = ''; }); return true; }
    if (!heroOn) return true;
    cur.x += (target.x - cur.x) * 0.08; cur.y += (target.y - cur.y) * 0.08;
    const sy = window.scrollY;
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${(cur.x * d * 900).toFixed(2)}px, ${(cur.y * d * 600 - sy * d * 5).toFixed(2)}px, 0)`;
    }
    return true;
  });
}

export function initMotes() {
  const host = document.getElementById('motes');
  if (!host) return;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const m = document.createElement('i'); m.className = 'mote';
    const s = 2 + rnd() * 3;
    m.style.cssText = `left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 100).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;--d:${(6 + rnd() * 8).toFixed(1)}s;animation-delay:${(-rnd() * 8).toFixed(1)}s`;
    host.appendChild(m);
  }
}

export function initProgress() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  const set = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  addEventListener('scroll', set, { passive: true }); addEventListener('resize', set); set();
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', e.clientX - r.left + 'px'); el.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
}

// Count-up with flash. Text is set directly when reduced motion is on.
export function countTo(cell, next, fmt, { first } = {}) {
  const prev = cell._v;
  cell._v = next;
  if (cell._stop) cell._stop();
  if (!Number.isFinite(next)) { cell.textContent = fmt(next); return; }
  const from = Number.isFinite(prev) ? prev : 0;
  if (reduced() || from === next) { cell.textContent = fmt(next); return; }
  if (Number.isFinite(prev)) {
    const cls = next > prev ? 'flash-up' : 'flash-down';
    cell.classList.remove('flash-up', 'flash-down'); void cell.offsetWidth; cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), 950);
  }
  const dur = first ? 900 : 600; let t0 = null;
  cell._stop = loop((dt, t) => {
    if (t0 === null) t0 = t;
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    cell.textContent = fmt(from + (next - from) * e);
    if (p >= 1) { cell.textContent = fmt(next); return false; }
    return true;
  });
}
