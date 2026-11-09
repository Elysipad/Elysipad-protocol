// REGISTER PATTERN: every external fact is one record with a state: stated | absent | unconfirmed.
import fs from 'node:fs';

export const STATES = ['stated', 'absent', 'unconfirmed'];
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM = /^0x[0-9a-fA-F]{40}$/;
const INERT_FORBIDDEN = ['value', 'url', 'pairsUrl', 'metaUrl', 'handle', 'href'];

export function loadRegister(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function validateRegister(reg) {
  const errors = [];
  for (const [id, r] of Object.entries(reg.records || {})) {
    if (!STATES.includes(r.state)) errors.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of INERT_FORBIDDEN) if (k in r) errors.push(`${id}: inert record carries "${k}"`);
    } else if (!r.value && !r.url) errors.push(`${id}: stated record has neither value nor url`);
    if (r.state === 'stated' && r.kind === 'address' && !(BASE58.test(r.value || '') || EVM.test(r.value || ''))) errors.push(`${id}: stated address is not address-shaped`);
    if (r.state === 'stated' && r.kind === 'social') {
      let u; try { u = new URL(r.url); } catch { errors.push(`${id}: bad url`); continue; }
      if (u.protocol !== 'https:') errors.push(`${id}: social url must be https`);
      if (!deriveHandle(id, r.url)) errors.push(`${id}: cannot derive a handle from ${r.url}`);
    }
  }
  return errors;
}

// LINK RULE: only the URL is stored; the visible handle is derived from it.
export function deriveHandle(id, url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  if (id === 'x') return ['x.com', 'twitter.com'].includes(host) && seg[0] ? '@' + seg[0] : null;
  if (id === 'github') return host === 'github.com' && seg[0] ? seg.slice(0, 2).join('/') : null;
  return null;
}

// What reaches the browser: no dates, no source notes. Inert records keep label + state only.
export function runtimeView(reg) {
  const out = {};
  for (const [id, r] of Object.entries(reg.records)) {
    const v = { label: r.label, state: r.state, kind: r.kind };
    if (r.state === 'stated') for (const k of ['value', 'url', 'pairsUrl', 'metaUrl']) if (r[k]) v[k] = r[k];
    out[id] = v;
  }
  return out;
}

export function addressValues(reg) {
  const set = new Set();
  for (const r of Object.values(reg.records)) if (r.state === 'stated' && r.kind === 'address' && r.value) set.add(r.value);
  return set;
}
