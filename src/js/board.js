// Market board: row 1 is the own-token slot (pinned), rows 2-10 are the live trending set.
import { DASH, fmtPrice, fmtCompact, fmtPct, copyText } from './format.js';
import { countTo } from './motion.js';
import { FALLBACK_LOGO, PLACEHOLDER_LOGO } from './own.js';

const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DOTS = '· · · · ·';
const TRENDING_ROWS = 9;

function letterOf(r) {
  const m = String(r.symbol || r.name || '').match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '?';
}
export function letterTile(r) {
  const t = document.createElement('span'); t.className = 'logo-t';
  const l = document.createElement('span'); l.className = 'tile-letter'; l.setAttribute('aria-hidden', 'true'); l.textContent = letterOf(r);
  t.appendChild(l); return t;
}
function logoTile(src, r, fallbackSrc) {
  if (!src) return letterTile(r);
  const t = document.createElement('span'); t.className = 'logo-t';
  const img = document.createElement('img');
  img.alt = ''; img.width = 40; img.height = 40; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    if (fallbackSrc && img.getAttribute('src') !== fallbackSrc) { img.src = fallbackSrc; return; }
    t.replaceWith(letterTile(r));
  }, { once: false });
  img.src = src; t.appendChild(img); return t;
}

function shell(kind) {
  const el = document.createElement('div');
  el.className = 'row-b' + (kind === 'own' ? ' own' : ' spot');
  el.setAttribute('role', 'row');
  el.innerHTML = '<div class="cell asset" role="cell"><span class="rk"></span><span class="slot-logo"></span><span class="who"><b class="nm"></b><span class="sym"></span></span></div>'
    + '<div class="cell num price" role="cell" data-label="Price"></div>'
    + '<div class="cell num chg" role="cell" data-label="Day"></div>'
    + '<div class="cell num vol" role="cell" data-label="Volume"></div>'
    + '<div class="cell num liq" role="cell" data-label="Liquidity"></div>'
    + '<div class="cell act" role="cell"></div>';
  return el;
}

function copyButton(address, label) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'copy'; b.dataset.address = address;
  b.setAttribute('aria-label', 'Clip address of ' + label); b.title = 'Clip address'; b.innerHTML = COPY_SVG;
  b.addEventListener('click', async () => {
    const ok = await copyText(address);
    b.classList.toggle('copied', ok); b.title = ok ? 'Clipped' : 'Clip blocked';
    b.setAttribute('aria-label', (ok ? 'Clipped address of ' : 'Clip blocked for ') + label);
    setTimeout(() => { b.classList.remove('copied'); b.title = 'Clip address'; b.setAttribute('aria-label', 'Clip address of ' + label); }, 1500);
  });
  return b;
}

function setLogo(el, node) { el.querySelector('.slot-logo').replaceWith(node); node.classList.add('slot-logo-done'); }

function fillText(el, rank, r) {
  el.querySelector('.rk').textContent = String(rank);
  el.querySelector('.nm').textContent = r.name || DASH;
  el.querySelector('.sym').textContent = r.symbol || '';
}

function fillNumbers(el, r) {
  const set = (sel, v, fmt) => countTo(el.querySelector(sel), v, fmt);
  set('.price', r.price, fmtPrice);
  set('.vol', r.volume, fmtCompact);
  set('.liq', r.liquidity, fmtCompact);
  const chg = el.querySelector('.chg');
  chg.classList.toggle('up', r.change > 0); chg.classList.toggle('down', r.change < 0);
  set('.chg', r.change, fmtPct);
}

export function createBoard({ body, note, caRecord, tabs, filter }) {
  const ca = caRecord?.state === 'stated' ? caRecord.value : null;
  const nodes = new Map();
  const view = { market: { status: 'loading', rows: [], error: '' }, own: { status: 'loading', row: null }, sort: 'volume', q: '' };
  let revealed = false;

  const cmp = {
    volume: (a, b) => (Number.isFinite(b.volume) ? b.volume : -1) - (Number.isFinite(a.volume) ? a.volume : -1),
    change: (a, b) => (Number.isFinite(b.change) ? b.change : -1e9) - (Number.isFinite(a.change) ? a.change : -1e9),
    liquidity: (a, b) => (Number.isFinite(b.liquidity) ? b.liquidity : -1) - (Number.isFinite(a.liquidity) ? a.liquidity : -1),
  };

  function skeletonRow(i) {
    const el = document.createElement('div'); el.className = 'row-b'; el.setAttribute('role', 'row'); el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="cell asset"><span class="rk"></span><span class="skel l"></span><span class="who" style="flex:1"><span class="skel t"></span></span></div><div class="cell num"><span class="skel v"></span></div><div class="cell num"><span class="skel v"></span></div><div class="cell num"><span class="skel v"></span></div><div class="cell num"><span class="skel v"></span></div><div class="cell act"></div>';
    el.querySelector('.rk').textContent = String(i);
    return el;
  }

  function dashRow(i) {
    const el = shell('t'); el.removeAttribute('aria-hidden');
    fillText(el, i, { name: DASH, symbol: '' });
    setLogo(el, letterTile({ name: DASH }));
    for (const s of ['.price', '.chg', '.vol', '.liq']) el.querySelector(s).textContent = DASH;
    return el;
  }

  function placeholderRow() {
    const el = shell('own'); el.classList.add('is-placeholder');
    el.setAttribute('aria-label', 'ELYSIPAD, awaiting its CA');
    el.querySelector('.rk').textContent = '1';
    el.querySelector('.nm').textContent = 'ELYSIPAD';
    el.querySelector('.sym').innerHTML = DOTS;
    const img = document.createElement('img');
    img.src = PLACEHOLDER_LOGO; img.alt = ''; img.width = 40; img.height = 40;
    const t = document.createElement('span'); t.className = 'logo-t'; t.appendChild(img);
    setLogo(el, t);
    el.querySelector('.price').textContent = '$0.00';
    for (const s of ['.chg', '.vol', '.liq']) { const c = el.querySelector(s); c.textContent = DOTS; c.classList.add('dots'); }
    return el;
  }

  function memo(key, make) {
    let el = nodes.get(key), fresh = false;
    if (!el) { el = make(); nodes.set(key, el); fresh = true; }
    return { key, el, fresh };
  }

  function buildOwn(r) {
    const el = shell('own'); el.dataset.ca = ca;
    el.querySelector('.rk').textContent = '1';
    el.querySelector('.nm').textContent = r.name || 'ELYSIPAD';
    el.querySelector('.act').appendChild(copyButton(ca, r.name || 'ELYSIPAD'));
    setLogo(el, logoTile(r.logo || FALLBACK_LOGO, r, FALLBACK_LOGO));
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Ours';
    el.querySelector('.nm').after(tag);
    return el;
  }
  function ownRow(r) {
    const w = memo('own', () => buildOwn(r));
    const el = w.el;
    el.querySelector('.nm').firstChild.textContent = r.name || 'ELYSIPAD';
    el.querySelector('.sym').textContent = r.symbol || '';
    el.querySelectorAll('.liq').forEach((c) => { c.title = r.liquidityTitle || 'Liquidity'; });
    fillNumbers(el, r);
    return w;
  }

  function trendingRow(r, rank) {
    const w = memo('t:' + r.address, () => {
      const el = shell('t'); el.dataset.address = r.address;
      el.querySelector('.act').appendChild(copyButton(r.address, r.name || r.symbol || 'asset'));
      setLogo(el, logoTile(r.imageUrl, r));
      return el;
    });
    fillText(w.el, rank, r);
    fillNumbers(w.el, r);
    w.text = (r.name + ' ' + r.symbol + ' ' + r.address).toLowerCase();
    return w;
  }

  function desired() {
    const out = [];
    const m = view.market;
    if (!ca) out.push(memo('own:ph', placeholderRow));
    else if (view.own.row) out.push(ownRow(view.own.row));
    else if (view.own.status === 'loading') out.push(memo('sk:own', () => skeletonRow(1)));
    else out.push(ownRow({ name: 'ELYSIPAD', symbol: '', logo: FALLBACK_LOGO, price: NaN, change: NaN, volume: NaN, liquidity: NaN }));
    if (m.rows.length) {
      m.rows.filter((r) => r.address !== ca).sort(cmp[view.sort]).slice(0, TRENDING_ROWS)
        .forEach((r, i) => out.push(trendingRow(r, i + 2)));
    } else if (m.status === 'loading') {
      for (let i = 0; i < TRENDING_ROWS; i++) out.push(memo('sk:' + i, () => skeletonRow(i + 2)));
    } else {
      for (let i = 0; i < TRENDING_ROWS; i++) out.push(memo('dash:' + i, () => dashRow(i + 2)));
    }
    return out;
  }

  function render() {
    const want = desired();
    const keep = new Set(want.map((w) => w.key));
    for (const [k, el] of nodes) if (!keep.has(k)) { el.remove(); nodes.delete(k); }
    want.forEach((w, i) => {
      if (w.fresh) { w.el.style.setProperty('--i', String(i)); w.el.classList.add('row-in'); }
      if (body.children[i] !== w.el) body.insertBefore(w.el, body.children[i] || null);
      if (w.text !== undefined) w.el.hidden = !!view.q && !w.text.includes(view.q);
    });
    revealed = true;
    updateNote();
  }

  function updateNote() {
    const m = view.market;
    let msg = '';
    if (m.status === 'pending') msg = 'The pair feed is still pending, so rows remain empty.';
    else if (m.status === 'error') msg = 'The pair feed did not answer (' + m.error + '). Retrying with backoff.';
    else if (m.status === 'stale') msg = 'That refresh missed. Showing the last good reading while we retry.';
    note.hidden = !msg; note.textContent = msg;
  }

  tabs.forEach((b) => b.addEventListener('click', () => {
    view.sort = b.dataset.sort;
    tabs.forEach((t) => { const on = t === b; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
    render();
  }));
  filter.addEventListener('input', () => { view.q = filter.value.trim().toLowerCase(); render(); });

  render();
  return {
    setMarket(s) { view.market = s; render(); },
    setOwn(s) { view.own = s; render(); },
    get revealed() { return revealed; },
  };
}
