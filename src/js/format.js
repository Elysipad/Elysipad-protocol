export const DASH = '—';

export function fmtPrice(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return '$0.00';
  const a = Math.abs(n);
  if (a >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
  if (a >= 1) return '$' + n.toFixed(2);
  if (a >= 0.01) return '$' + n.toFixed(4);
  const d = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(a))));
  return '$' + n.toFixed(d);
}

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function fmtPct(n) {
  if (!Number.isFinite(n)) return DASH;
  const arrow = n > 0 ? '▲ ' : n < 0 ? '▼ ' : '';
  return arrow + (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(2) + '%';
}

export function toNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : NaN;
}

export function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || ''; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}
