// Live market data. The only input is the market-source register record; CA state plays no part.
import { getJson } from './poller.js';
import { toNum } from './format.js';

const CHUNK = 30;

export function boostedSolanaAddresses(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const seen = new Set(), out = [];
  for (const b of list) {
    if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string' && !seen.has(b.tokenAddress)) {
      seen.add(b.tokenAddress); out.push(b.tokenAddress);
    }
  }
  return out;
}

// One row per base token: the pair with the highest 24h volume represents it.
export function rowsFromPairs(pairs, limit = 10) {
  const best = new Map(), images = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const a = p?.baseToken?.address;
    if (!a || p.chainId !== 'solana') continue;
    if (p.info?.imageUrl && !images.has(a)) images.set(a, p.info.imageUrl);
    const v = toNum(p.volume?.h24);
    const cur = best.get(a);
    if (!cur || (Number.isFinite(v) ? v : -1) > (cur._v)) best.set(a, Object.assign({}, p, { _v: Number.isFinite(v) ? v : -1 }));
  }
  const rows = [...best.values()].map((p) => ({
    address: p.baseToken.address,
    name: p.baseToken.name || p.baseToken.symbol || '',
    symbol: p.baseToken.symbol || '',
    imageUrl: p.info?.imageUrl || images.get(p.baseToken.address) || '',
    price: toNum(p.priceUsd),
    change: toNum(p.priceChange?.h24),
    volume: toNum(p.volume?.h24),
    liquidity: toNum(p.liquidity?.usd),
  }));
  rows.sort((a, b) => (Number.isFinite(b.volume) ? b.volume : -1) - (Number.isFinite(a.volume) ? a.volume : -1));
  return rows.slice(0, limit);
}

export function createMarket(record, onChange) {
  const state = { status: record?.state === 'stated' ? 'loading' : 'pending', rows: [], error: '' };
  const emit = () => onChange({ ...state, rows: state.rows.slice() });

  async function refresh() {
    if (record?.state !== 'stated') { state.status = 'pending'; emit(); return; }
    try {
      const boosts = await getJson(record.url);
      const addrs = boostedSolanaAddresses(boosts).slice(0, 60);
      if (!addrs.length) throw new Error('No Solana entries in the feed');
      const chunks = [];
      for (let i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
      const parts = await Promise.all(chunks.map((c) => getJson(record.pairsUrl.replace('{addresses}', c.join(',')))));
      const rows = rowsFromPairs(parts.flat(), 10);
      if (!rows.length) throw new Error('No pairs returned');
      state.rows = rows; state.status = 'ok'; state.error = '';
      emit();
    } catch (e) {
      state.error = e && e.message ? e.message : 'Feed unreachable';
      state.status = state.rows.length ? 'stale' : 'error'; // last good rows are kept
      emit();
      throw e; // lets the poller back off
    }
  }
  return { state, refresh, emit };
}
