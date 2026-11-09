// Own token row (row 1). Driven by the CA record only; the market feed never reads it.
import { getJson } from './poller.js';
import { toNum } from './format.js';

export const FALLBACK_LOGO = '/assets/logo-192.png';
export const PLACEHOLDER_LOGO = '/brand/elysipad-logo.png';

export function pickPair(json, ca) {
  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  return pairs
    .filter((p) => p?.baseToken?.address === ca)
    .sort((a, b) => (toNum(b.volume?.h24) || 0) - (toNum(a.volume?.h24) || 0))[0] || null;
}

// Liquidity column: pair.liquidity.usd when above zero, otherwise market cap (label via title).
export function liquidityCell(pair) {
  const usd = toNum(pair?.liquidity?.usd);
  const mcap = toNum(pair?.marketCap);
  console.log('[elysipad] own liquidity candidates', { liquidityUsd: usd, marketCap: mcap, fdv: toNum(pair?.fdv) });
  if (Number.isFinite(usd) && usd > 0) return { value: usd, title: 'Liquidity' };
  if (Number.isFinite(mcap) && mcap > 0) return { value: mcap, title: 'Mkt Cap' };
  return { value: NaN, title: 'Liquidity' };
}

export function ownRowFrom(dex, pump, ca) {
  const pair = pickPair(dex, ca);
  const liq = liquidityCell(pair);
  return {
    address: ca,
    name: pair?.baseToken?.name || pump?.name || 'ELYSIPAD',
    symbol: pair?.baseToken?.symbol || pump?.symbol || '',
    logo: pump?.image_uri || FALLBACK_LOGO,
    price: toNum(pair?.priceUsd),
    change: toNum(pair?.priceChange?.h24),
    volume: toNum(pair?.volume?.h24),
    liquidity: liq.value,
    liquidityTitle: liq.title,
    found: !!pair,
  };
}

export function createOwn(ca, record, onChange) {
  const state = { status: 'loading', row: null };
  async function refresh() {
    const dexUrl = record.url.replace('{ca}', encodeURIComponent(ca));
    const metaUrl = record.metaUrl.replace('{ca}', encodeURIComponent(ca));
    const [dex, pump] = await Promise.all([
      getJson(dexUrl, { tries: 3 }).catch(() => null),
      getJson(metaUrl, { tries: 2 }).catch(() => null),
    ]);
    console.log('[elysipad] own token raw response', { dex, pump });
    if (!dex && !pump) {
      state.status = state.row ? 'stale' : 'error'; onChange({ ...state }); throw new Error('Own feeds unreachable');
    }
    state.row = ownRowFrom(dex, pump, ca); state.status = 'ok';
    onChange({ ...state });
  }
  return { state, refresh };
}
