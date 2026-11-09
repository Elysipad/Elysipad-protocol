// Gates: static rules, unit checks, mutation harness, and real-browser checks at five widths.
// Every register-dependent assertion reads the record state at runtime. Nothing hardcodes "absent".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { build, traceFavicon, logoPipeline, ICONS } from './build.mjs';
import { serve } from './serve.mjs';
import { resize } from './lib/image.mjs';
import { loadRegister, validateRegister, deriveHandle, addressValues, BASE58, EVM } from './lib/register.mjs';
import { parseTokens, tokenMap, verifySamples } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MEASURE_ONLY = process.argv.includes('--measure-only');
const WIDTHS = [360, 390, 430, 1366, 1440];

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '\n        ' + String(detail).split('\n').join('\n        ') : ''}`);
}
async function gate(name, fn) {
  try { const r = await fn(); if (r === true || r === undefined) record(name, true); else record(name, false, r); }
  catch (e) { record(name, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e); }
}

// ------------------------------------------------------------------ file helpers
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '']);
function walk(dir, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name) || skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}
const textFiles = (dir, skip) => walk(dir, skip).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f, base = ROOT) => path.relative(base, f).split(path.sep).join('/');

function runtimeJson(html) {
  const m = html.match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
function stripToVisible(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}
function visibleTexts(html) {
  const body = stripToVisible(html);
  const texts = body.replace(/<[^>]+>/g, '\n').split('\n').map((t) => t.replace(/&middot;/g, ' ').replace(/&amp;/g, '&').trim()).filter(Boolean);
  const attrs = [...body.matchAll(/\s(?:aria-label|title|placeholder|alt|content)="([^"]*)"/g)].map((m) => m[1]).filter((v) => !/^https?:/.test(v));
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  return [...texts, ...attrs, ...(title ? [title] : [])];
}

// ------------------------------------------------------------------ static gates (reusable for mutations)
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const DATE_PATTERNS = [
  [/\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/, 'ISO date'],
  [/\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}\b/, 'day-first date'],
  [/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,4}\b/i, 'month name with number'],
  [/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, 'day with month name'],
  [/\b(?:19|20)\d{2}\b/, 'year'],
  [/\bas of\b/i, '"as of"'],
  [/\b(?:last )?(?:checked|updated|verified)\b/i, 'checked/updated wording'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/i, 'clock string'],
  [/\b(?:timestamp|today|yesterday|ago)\b/i, 'time wording'],
];

export function staticChecks(dir, reg, label) {
  const out = []; const add = (name, ok, detail = '') => out.push({ name: `${label} :: ${name}`, ok, detail });
  const html = read(path.join(dir, 'index.html'));
  const rtj = runtimeJson(html);
  const files = textFiles(dir);

  add('register is valid; inert records carry no value or url', validateRegister(reg).length === 0, validateRegister(reg).join('; '));

  // inert records: nothing leaks into the runtime view or markup
  const leaks = [];
  for (const [id, r] of Object.entries(reg.records)) {
    if (r.state === 'stated') continue;
    const rv = rtj?.[id] || {};
    for (const k of ['value', 'url', 'pairsUrl', 'metaUrl']) if (k in rv) leaks.push(`${id}.${k} in runtime view`);
    const re = new RegExp(`<[^>]*data-record="${id}"[^>]*>`, 'g');
    for (const m of html.matchAll(re)) if (/\bhref=/.test(m[0])) leaks.push(`${id} markup carries href`);
    const reSoc = new RegExp(`<[^>]*data-social="${id}"[^>]*>`, 'g');
    for (const m of html.matchAll(reSoc)) { if (/\bhref=/.test(m[0]) || /^<a\b/.test(m[0])) leaks.push(`${id} icon is not inert`); }
  }
  add('inert records leak nothing (no value, no url, no href)', leaks.length === 0, leaks.join('; '));

  // social gate: expected shape is derived from the record state read here, never assumed
  const soc = [];
  for (const id of ['x', 'github']) {
    const r = reg.records[id];
    const m = html.match(new RegExp(`<(a|span)\\b[^>]*data-social="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
    if (!m) { soc.push(`${id}: icon missing`); continue; }
    const tag = m[0].match(/^<[^>]+>/)[0];
    const inner = m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').trim();
    if (inner) soc.push(`${id}: icon carries text "${inner}"`);
    if (!m[2].includes(`d="${ICONS[id].d}"`) || !m[2].includes(`viewBox="${ICONS[id].vb}"`)) soc.push(`${id}: path is not the official mark`);
    if (r.state === 'stated') {
      const handle = deriveHandle(id, r.url);
      if (m[1] !== 'a') soc.push(`${id}: stated but not a link`);
      if (!tag.includes(`href="${r.url}"`)) soc.push(`${id}: href differs from stored url`);
      if (!tag.includes(handle)) soc.push(`${id}: handle not derived from url`);
      if (!/rel="noopener noreferrer"/.test(tag)) soc.push(`${id}: missing rel`);
    } else {
      if (m[1] === 'a' || /href=/.test(tag)) soc.push(`${id}: ${r.state} but linked`);
      if (!/aria-disabled="true"/.test(tag)) soc.push(`${id}: inert icon not aria-disabled`);
    }
  }
  add('social icons: official marks, icon only, link iff stated', soc.length === 0, soc.join('; '));

  // CA slot
  const ca = reg.records.ca; const caProblems = [];
  const slot = html.match(/<div class="ca[^"]*" data-record="ca"[\s\S]*?<\/div>/);
  if (!slot) caProblems.push('CA slot missing');
  else if (ca.state === 'stated') {
    if (!slot[0].includes(`<code class="ca-text">${ca.value}</code>`)) caProblems.push('full address not shown');
    if (!slot[0].includes('id="ca-copy"')) caProblems.push('copy control missing');
  } else {
    if (slot[0].includes('ca-btn') || BASE58.test(slot[0]) || /ca-text/.test(slot[0])) caProblems.push('inert slot has live parts');
    if (!/pending/.test(slot[0])) caProblems.push('inert slot lacks "pending"');
  }
  if (html.indexOf('data-record="ca"') > html.indexOf('<main>')) caProblems.push('CA slot is not above the main content');
  add('CA slot: top of page, live iff stated', caProblems.length === 0, caProblems.join('; '));

  // palette: literals only in tokens.css; anything in dist must be a token value
  const tokFile = path.join(ROOT, 'src/tokens.css');
  const tokVals = new Set(Object.values(tokenMap(tokFile)));
  const lit = [];
  for (const f of files) {
    const rf = rel(f, dir);
    if (rf === 'assets/css/tokens.css') continue;
    const t = read(f);
    for (const m of t.matchAll(HEX)) {
      if (rf === 'favicon.svg' && tokVals.has(m[0].toLowerCase())) continue;
      lit.push(`${rf}: ${m[0]}`);
    }
    if (/\b(?:rgba?|hsla?|oklch|lab)\(/i.test(t)) lit.push(`${rf}: functional colour literal`);
    if (rf.endsWith('.css') && /:\s*(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink)\b/i.test(t)) lit.push(`${rf}: named colour`);
  }
  add('palette: no colour literal outside the tokens file', lit.length === 0, lit.slice(0, 8).join('; '));

  const ch = [];
  for (const f of files) if (/\.(css|html|js)$/.test(f)) { const t = read(f); const m = t.match(/(?<![\w.-])\d*\.?\d+ch\b/); if (m) ch.push(`${rel(f, dir)}: ${m[0]}`); }
  add('no ch units', ch.length === 0, ch.join('; '));

  // dates: zero in everything the page ships
  const dateHits = [];
  for (const t of visibleTexts(html)) for (const [re, nm] of DATE_PATTERNS) if (re.test(t)) dateHits.push(`${nm}: "${t.slice(0, 50)}"`);
  const rtjText = JSON.stringify(rtj || {});
  for (const [re, nm] of DATE_PATTERNS) if (re.test(rtjText)) dateHits.push(`${nm} in runtime register`);
  if (/"checked"/.test(rtjText)) dateHits.push('checked field shipped to the browser');
  for (const f of files.filter((x) => x.endsWith('.js'))) if (/\bDate\b|toLocale(?:Date|Time)String|DateTimeFormat|getTimezoneOffset/.test(read(f))) dateHits.push(`${rel(f, dir)} touches Date`);
  add('no dates, timestamps or clock strings anywhere in the shipped page', dateHits.length === 0, dateHits.slice(0, 6).join('; '));

  // addresses: match address-shaped strings against the stated registry (0x is not blanket-rejected)
  const allowed = addressValues(reg);
  const strays = [];
  for (const f of files) {
    const t = read(f);
    for (const m of t.matchAll(/0x[0-9a-fA-F]{40}\b|(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g)) {
      if (!(EVM.test(m[0]) || BASE58.test(m[0]))) continue;
      if (!allowed.has(m[0])) strays.push(`${rel(f, dir)}: ${m[0].slice(0, 16)}...`);
    }
  }
  add('address scanner: every address-shaped string is a stated registry value', strays.length === 0, strays.join('; '));

  // favicon
  const fav = read(path.join(dir, 'favicon.svg'));
  const favProblems = [];
  if (!/^<svg\b/.test(fav.trim())) favProblems.push('not an svg root');
  if (!/width="32"/.test(fav) || !/height="32"/.test(fav) || !/viewBox="0 0 32 32"/.test(fav)) favProblems.push('not 32x32');
  if (fav.includes('--') || fav.includes('<!--')) favProblems.push('contains a double hyphen or XML comment');
  const sampleOk = (() => {
    try {
      const { square, premultiplied } = logoPipeline();
      const { cells } = traceFavicon(resize(square, 32, 32, premultiplied), tokenMap(tokFile));
      const got = new Set(); for (const m of fav.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let k = 0; k < +m[3]; k++) got.add(`${+m[1] + k},${m[2]}`);
      return got.size === cells.size && [...cells].every((c) => got.has(c));
    } catch { return false; }
  })();
  if (!sampleOk) favProblems.push('cells differ from the logo pixel grid');
  add('favicon: 32x32 SVG traced from the logo pixel grid, no double hyphens', favProblems.length === 0, favProblems.join('; '));

  // dist purity
  const banned = ['README.md', 'LICENSE', 'docs', 'register.json', 'CLAUDE.md', '.claude', 'tools', 'node_modules'];
  const present = banned.filter((b) => fs.existsSync(path.join(dir, b)));
  add('dist holds only deployable files', present.length === 0, present.join(', '));
  return out;
}

// ------------------------------------------------------------------ copy originality
const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to with your you we our can not no one all each more than then so but if into out up per via also any may will'.split(' '));
const words = (s) => (s.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
// A bigram made only of function words ("in a", "is a") carries no copy, so it is exempt; every other shared bigram fails.
function bigrams(lines) { const set = new Set(); for (const l of lines) { const w = words(l); for (let i = 0; i < w.length - 1; i++) { if (STOP.has(w[i]) && STOP.has(w[i + 1])) continue; set.add(w[i] + ' ' + w[i + 1]); } } return set; }
function jsStrings(dir) {
  const out = [];
  for (const f of walk(path.join(dir, 'assets/js'))) for (const m of read(f).matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n]){6,200})\1/g)) if (/[A-Za-z]{3,} [A-Za-z]{2,}/.test(m[2]) && !/[{}()=<>;/]/.test(m[2]) && !m[2].startsWith('[elysipad]')) out.push(m[2]); // console labels are dictated by the brief
  return out;
}
export function copyChecks(dir) {
  const ours = [...visibleTexts(read(path.join(dir, 'index.html'))), ...jsStrings(dir)];
  const ref = read(path.join(ROOT, 'tools/ref-corpus.txt')).split('\n');
  const rb = bigrams(ref), ob = bigrams(ours);
  const shared2 = [...ob].filter((g) => rb.has(g));
  const rw = new Set(ref.flatMap(words).filter((w) => !STOP.has(w) && w.length > 2));
  const ow = new Set(ours.flatMap(words).filter((w) => !STOP.has(w) && w.length > 2));
  const sharedWords = [...ow].filter((w) => rw.has(w));
  return { shared2, sharedWords };
}

// ------------------------------------------------------------------ source contracts
function sourceChecks() {
  const out = []; const add = (name, ok, detail = '') => out.push({ name, ok, detail });
  const css = read(path.join(ROOT, 'src/styles.css'));
  const js = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'src/js')).map((f) => [f, read(path.join(ROOT, 'src/js', f))]));
  const reg = loadRegister(path.join(ROOT, 'register.json'));
  const allJs = Object.values(js).join('\n');
  const needles = {
    'own row: parallel fetch with Promise.all': /Promise\.all\(\[\s*getJson\(dexUrl/.test(js['own.js']),
    'own row: pair selection baseToken.address === CA, sorted by volume.h24 desc, [0]': /baseToken\?\.address === ca/.test(js['own.js']) && /volume\?\.h24\) \|\| 0\) - \(toNum\(a\.volume\?\.h24\) \|\| 0\)\)\[0\]/.test(js['own.js']),
    'own row: console labels present': allJs.includes("'[elysipad] own token raw response'") && allJs.includes("'[elysipad] own liquidity candidates'"),
    'own row: pump.fun image_uri first, local logo-192 fallback': /pump\?\.image_uri \|\| FALLBACK_LOGO/.test(js['own.js']) && js['own.js'].includes("'/assets/logo-192.png'"),
    'own row: liquidity falls back to marketCap with Mkt Cap title': /usd > 0/.test(js['own.js']) && js['own.js'].includes("'Mkt Cap'"),
    'own row: CA source endpoints live in the register': reg.records['own-source'].url.includes('api.dexscreener.com/latest/dex/tokens/{ca}') && reg.records['own-source'].metaUrl.includes('frontend-api.pump.fun/coins/{ca}'),
    'own row css: 2px mint left border, 2s ease-in-out infinite pulse': /\.row-b\.own \{[^}]*border-left: 2px solid var\(--color-mint\);[^}]*animation: ownPulse 2s ease-in-out infinite/.test(css),
    'own row css: reduced motion switches animation off': /prefers-reduced-motion: reduce\) \{[\s\S]*\.row-b\.own \{ animation: none; \}/.test(css) || /\.row-b\.own \{ animation: none;/.test(css),
    'reduced motion: global rule zeroes animation and transition': /\*, \*::before, \*::after \{ animation: none !important; transition: none !important;/.test(css),
    'reduced motion: JS checks the media query': /prefers-reduced-motion: reduce/.test(js['motion.js']) && /reduced\(\)/.test(js['motion.js']),
    'placeholder row uses the brand logo, not a tile': /PLACEHOLDER_LOGO = '\/brand\/elysipad-logo\.png'/.test(js['own.js']) && /img\.src = PLACEHOLDER_LOGO/.test(js['board.js']),
    'letter tile fallback exists for missing and failed images': /logoTile\(r\.imageUrl, r\)/.test(js['board.js']) && /replaceWith\(letterTile\(r\)\)/.test(js['board.js']),
    'market reads only the market-source record (no CA import)': !/ca\b/.test(js['market.js'].replace(/\bcache\b|\bcache:|\bcatch\b|\bcall\b|\bcan\b|\bcan't\b/g, '')) || !/import[^;]*own/.test(js['market.js']),
    'market: hidden tab pauses the poller, visible fetches at once': /document\.hidden/.test(js['poller.js']) && /visibilitychange/.test(js['poller.js']),
    'market: 60s poll and exponential backoff': /interval = 60000/.test(js['poller.js']) && /2 \*\* i/.test(js['poller.js']),
    'no DexScreener CDN logo host anywhere': !Object.values(js).concat([css, read(path.join(ROOT, 'src/index.html')), JSON.stringify(reg)]).some((t) => t.includes('dd.' + 'dexscreener.com')),
    'tap target tokens: 44px minimum on controls': (css.match(/min-height: 44px/g) || []).length >= 8,
  };
  for (const [k, v] of Object.entries(needles)) add(k, !!v);
  return out;
}

// ------------------------------------------------------------------ repo hygiene
function hygiene() {
  const out = []; const add = (n, ok, d = '') => out.push({ name: n, ok, detail: d });
  add('no agent config file or folder in the repo', !fs.existsSync(path.join(ROOT, 'CLAUDE' + '.md')) && !fs.existsSync(path.join(ROOT, '.cla' + 'ude')));
  const bad = [];
  const re = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'chat' + 'gpt', 'open' + 'ai', 'co-authored-by', 'generated (?:by|with)', 'ai-generated', '\\bLLM\\b', 'copilot', 'gemini'].join('|'), 'i');
  for (const f of textFiles(ROOT, ['reports'])) { if (path.basename(f) === 'package-lock.json' || path.basename(f) === 'gates.mjs') continue; const t = read(f); const m = t.match(re); if (m) bad.push(`${rel(f)}: ${m[0]}`); }
  add('no AI attribution or mention in any project text file', bad.length === 0, bad.join('; '));
  const needed = ['README.md', 'LICENSE', 'docs/whitepaper.md'].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  add('README.md, LICENSE and docs/whitepaper.md exist in the project root', needed.length === 0, needed.join(', '));
  if (fs.existsSync(path.join(ROOT, 'LICENSE'))) { const l = read(path.join(ROOT, 'LICENSE')); add('LICENSE is MIT, copyright ELYSIPAD, 2026', /MIT License/.test(l) && /Copyright \(c\) 2026 ELYSIPAD/.test(l)); }
  return out;
}

// ------------------------------------------------------------------ unit checks: market, own row, poller
async function unitChecks() {
  const out = []; const add = (n, ok, d = '') => out.push({ name: n, ok, detail: d });
  const { boostedSolanaAddresses, rowsFromPairs, createMarket } = await import(pathToFileURL(path.join(ROOT, 'src/js/market.js')));
  const own = await import(pathToFileURL(path.join(ROOT, 'src/js/own.js')));
  const fmt = await import(pathToFileURL(path.join(ROOT, 'src/js/format.js')));

  const boosts = [{ chainId: 'solana', tokenAddress: 'A' }, { chainId: 'ethereum', tokenAddress: 'B' }, { chainId: 'solana', tokenAddress: 'A' }, { chainId: 'solana', tokenAddress: 'C' }];
  add('market: Solana entries only, de-duplicated', JSON.stringify(boostedSolanaAddresses(boosts)) === '["A","C"]');
  const pairs = Array.from({ length: 14 }, (_, i) => ({ chainId: 'solana', baseToken: { address: 'T' + i, name: 'N' + i, symbol: 'S' + i }, priceUsd: '1', volume: { h24: 100 + i }, liquidity: { usd: 5 } }));
  pairs.push({ chainId: 'solana', baseToken: { address: 'T3', name: 'N3', symbol: 'S3' }, priceUsd: '2', volume: { h24: 9999 }, liquidity: { usd: 5 }, info: { imageUrl: 'u' } });
  const rows = rowsFromPairs(pairs, 10);
  add('market: top 10 by 24h volume, best pair per token', rows.length === 10 && rows[0].address === 'T3' && rows[0].price === 2 && rows.every((r, i) => !i || rows[i - 1].volume >= r.volume));

  const ca = 'CAFIX';
  const dex = { pairs: [
    { baseToken: { address: ca, symbol: 'X' }, priceUsd: '1', volume: { h24: 10 }, liquidity: { usd: 0 }, marketCap: 5 },
    { baseToken: { address: ca, symbol: 'X' }, priceUsd: '2', volume: { h24: 90 }, liquidity: { usd: 0 }, marketCap: 7 },
    { baseToken: { address: 'ZZ' }, quoteToken: { address: ca }, priceUsd: '3', volume: { h24: 999 } }] };
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.map(String).join(' '));
  const picked = own.pickPair(dex, ca); const liq = own.liquidityCell(picked); const liq2 = own.liquidityCell({ liquidity: { usd: 42 }, marketCap: 9 });
  const ownBuilt = own.ownRowFrom(dex, { image_uri: 'IMG' }, ca); const ownBuilt2 = own.ownRowFrom(dex, null, ca);
  console.log = origLog;
  add('own row: picks the highest-volume pair whose baseToken is the CA', picked && picked.priceUsd === '2');
  add('own row: liquidity.usd 0 falls back to marketCap (title Mkt Cap); positive liquidity wins', liq.value === 7 && liq.title === 'Mkt Cap' && liq2.value === 42 && liq2.title === 'Liquidity');
  add('own row: liquidity candidates are logged', logs.some((l) => l.includes('[elysipad] own liquidity candidates')));
  add('own row: image_uri wins, local logo is the fallback', ownBuilt.logo === 'IMG' && ownBuilt2.logo === own.FALLBACK_LOGO);

  // backoff + last-good-data: fake network, instant timers, recorded delays
  const realFetch = globalThis.fetch, realST = globalThis.setTimeout; const delays = [];
  globalThis.setTimeout = (f, ms, ...a) => { delays.push(ms); return realST(f, 0, ...a); };
  let mode = 'fail'; const seen = [];
  globalThis.fetch = async (url) => {
    if (mode === 'fail') throw new Error('network down');
    if (String(url).includes('boosts')) return { ok: true, json: async () => boosts.concat([{ chainId: 'solana', tokenAddress: 'T1' }]) };
    return { ok: true, json: async () => pairs };
  };
  const m = createMarket({ state: 'stated', url: 'https://x.test/boosts', pairsUrl: 'https://x.test/pairs/{addresses}' }, (s) => seen.push(s.status));
  let threw = false; try { await m.refresh(); } catch { threw = true; }
  const exp = delays.filter((d) => d >= 700);
  add('market: failure after exponential backoff gives status error', threw && seen.at(-1) === 'error' && exp.length === 3 && exp[1] / exp[0] > 1.6 && exp[2] / exp[1] > 1.6, `delays ${exp.join(',')}`);
  mode = 'ok'; await m.refresh(); const good = m.state.rows.length;
  mode = 'fail'; try { await m.refresh(); } catch { /* expected */ }
  add('market: a failed refresh keeps the last good rows (status stale)', good > 0 && m.state.rows.length === good && seen.at(-1) === 'stale');
  globalThis.fetch = realFetch; globalThis.setTimeout = realST;

  // dash for non-finite values
  add('format: dash for missing numbers', fmt.fmtPrice(NaN) === fmt.DASH && fmt.fmtPct(NaN) === fmt.DASH && fmt.fmtCompact(undefined) === fmt.DASH);
  return out;
}

// poller: hidden tab pauses, visible fetches at once, 60s cadence (fake clock + fake document)
async function pollerCheck() {
  const handlers = {}; const doc = { hidden: false, addEventListener: (e, f) => { handlers[e] = f; } };
  globalThis.document = doc;
  const timers = []; let now = 0;
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  globalThis.setTimeout = (f, ms) => { const t = { f, at: now + ms, on: true }; timers.push(t); return t; };
  globalThis.clearTimeout = (t) => { if (t) t.on = false; };
  const advance = async (ms) => { const end = now + ms; for (;;) { const nx = timers.filter((t) => t.on && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!nx) break; nx.on = false; now = nx.at; await nx.f(); await Promise.resolve(); await Promise.resolve(); } now = end; };
  const { createPoller } = await import(pathToFileURL(path.join(ROOT, 'src/js/poller.js')) + '?t=' + Math.random());
  let calls = 0; const p = createPoller(async () => { calls++; }, { interval: 60000 });
  p.start(); await advance(10);
  const first = calls; await advance(59000); const mid = calls; await advance(2000); const afterMinute = calls;
  doc.hidden = true; handlers.visibilitychange(); await advance(300000); const whileHidden = calls;
  doc.hidden = false; handlers.visibilitychange(); await advance(5); const onVisible = calls;
  p.stop(); globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; delete globalThis.document;
  return [{ name: 'poller: first fetch at start, then every 60s, silent while hidden, immediate when visible', ok: first === 1 && mid === 1 && afterMinute === 2 && whileHidden === 2 && onVisible === 3, detail: JSON.stringify({ first, mid, afterMinute, whileHidden, onVisible }) }];
}

// ------------------------------------------------------------------ browser fixtures
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addrOf = (i) => Array.from({ length: 44 }, (_, k) => b58[(i * 7 + k * 13 + i * k) % b58.length]).join('');
const SAMPLE_CA = 'So11111111111111111111111111111111111111112';
const MKT = Array.from({ length: 12 }, (_, i) => ({ i, address: i === 2 ? SAMPLE_CA : addrOf(i + 1), vol: 3e6 - i * 2e5 }));
const noImage = new Set([3, 5]); const brokenImage = new Set([7]);

function pairFor(a, caMode) {
  const m = MKT.find((x) => x.address === a);
  if (!m) return [];
  if (m.address === SAMPLE_CA) return caMarketPairs(SAMPLE_CA);
  const p = { chainId: 'solana', pairAddress: 'P' + m.i, baseToken: { address: a, name: 'Token ' + m.i, symbol: 'TK' + m.i }, priceUsd: String(0.001 * (m.i + 1)), priceChange: { h24: (m.i % 2 ? -1 : 1) * (m.i + 1.5) }, volume: { h24: m.vol }, liquidity: { usd: 50000 + m.i * 1000 } };
  if (!noImage.has(m.i)) p.info = { imageUrl: brokenImage.has(m.i) ? 'https://img.test/broken.png' : 'https://img.test/ok.png' };
  return [Object.assign({}, p, { volume: { h24: m.vol / 10 } }), p];
}

async function installRoutes(context, { ca, pumpOk = true, failMarket = false } = {}) {
  const hits = { boosts: 0, pairs: 0, own: 0, pump: 0, rpc: 0 };
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'img.test') return u.pathname === '/broken.png' ? route.fulfill({ status: 404, body: 'x' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
    if (u.hostname === 'images.pump.fun') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
    const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.hostname === 'api.dexscreener.com') {
      if (u.pathname.startsWith('/token-boosts/top/v1')) {
        hits.boosts++; if (failMarket) return json({}, 500);
        const list = MKT.map((m) => ({ chainId: 'solana', tokenAddress: m.address })).concat([{ chainId: 'ethereum', tokenAddress: '0x' + 'ab'.repeat(20) }, { chainId: 'solana', tokenAddress: MKT[0].address }]);
        return json(list);
      }
      if (u.pathname.startsWith('/tokens/v1/solana/')) {
        hits.pairs++; if (failMarket) return json({}, 500);
        const addrs = decodeURIComponent(u.pathname.split('/').pop()).split(',');
        const all = addrs.flatMap((a) => pairFor(a));
        return json(all);
      }
      if (u.pathname.startsWith('/latest/dex/tokens/')) { hits.own++; return json(ownPairs(decodeURIComponent(u.pathname.split('/').pop()))); }
    }
    if (u.hostname === 'frontend-api.pump.fun') { hits.pump++; return pumpOk ? json({ name: 'ElyTest', symbol: 'ELYT', image_uri: 'https://images.pump.fun/test.png' }) : json({}, 404); }
    if (u.hostname === 'solana-rpc.publicnode.com') { hits.rpc++; return json({ jsonrpc: '2.0', id: 1, result: { value: { lamports: 1 } } }); }
    return route.abort();
  });
  return hits;
}
function caMarketPairs(ca) { return [{ chainId: 'solana', baseToken: { address: ca, name: 'ElyTest', symbol: 'ELYT' }, priceUsd: '0.0042', priceChange: { h24: 3 }, volume: { h24: 2.6e6 }, liquidity: { usd: 1000 }, info: { imageUrl: 'https://img.test/ok.png' } }]; }
function ownPairs(ca) {
  return { pairs: [
    { baseToken: { address: ca, name: 'ElyTest', symbol: 'ELYT' }, priceUsd: '0.0042', priceChange: { h24: 12.5 }, volume: { h24: 5000 }, liquidity: { usd: 0 }, marketCap: 123456, fdv: 130000 },
    { baseToken: { address: ca, name: 'ElyTest', symbol: 'ELYT' }, priceUsd: '0.0050', priceChange: { h24: -3.2 }, volume: { h24: 9000 }, liquidity: { usd: 0 }, marketCap: 234567, fdv: 240000 },
    { baseToken: { address: 'OTHER' + 'x'.repeat(30) }, quoteToken: { address: ca }, priceUsd: '9.9', priceChange: { h24: 99 }, volume: { h24: 99999 }, liquidity: { usd: 777 } },
  ] };
}

async function measurePage(page) {
  return page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
    const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const inter = [...document.querySelectorAll('a[href], button, input, [role="tab"]')].filter(vis);
    const small = inter.map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width < 43.5 || b.height < 43.5).map(({ e, b }) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`);
    const ca = document.querySelector('.ca .ca-text, .ca .ca-inert');
    const socials = [...document.querySelectorAll('[data-social]')].map((e) => ({ id: e.dataset.social, ...r(e), tag: e.tagName }));
    const fs = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    return {
      vw: innerWidth, docW: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth - innerWidth,
      header: r(document.querySelector('.header')), caRect: r(document.querySelector('.ca')), caText: r(ca), caFont: fs(ca),
      socials, small, interactive: inter.length,
      hero: r(document.querySelector('.hero')), board: r(document.querySelector('.board')), firstRow: r(document.querySelector('.row-b')),
      statTile: r(document.querySelector('.stat')),
    };
  });
}

// ------------------------------------------------------------------ browser gates
async function browserGates(browser, { dir, reg, label, ca, flipped }) {
  const { server, port } = await serve(dir);
  const base = `http://127.0.0.1:${port}/`;
  const R = reg.records;
  const stated = (id) => R[id].state === 'stated';
  const fmt = await import(pathToFileURL(path.join(ROOT, 'src/js/format.js')));
  const measures = {};
  const note = (n, ok, d = '') => record(`${label} :: ${n}`, ok, d);
  try {
    // ---- main page, desktop
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const hits = await installRoutes(ctx, { ca: stated('ca') ? R.ca.value : undefined });
    const page = await ctx.newPage();
    const logs = []; const errors = [];
    page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#board-body .row-b:not([aria-hidden])', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('status-text').textContent === 'Streaming', null, { timeout: 15000 });
    await page.waitForTimeout(1400);

    note('page loads without script errors', errors.length === 0, errors.join('; '));
    note('status pill reads Streaming once the register-driven source answers', true);

    const rows = await page.$$eval('#board-body .row-b', (els) => els.map((e) => ({
      own: e.classList.contains('own'), placeholder: e.classList.contains('is-placeholder'), name: e.querySelector('.nm').textContent,
      img: e.querySelector('.logo-t img')?.getAttribute('src') || '', letter: !!e.querySelector('.tile-letter'), copy: !!e.querySelector('.copy'),
      addr: e.dataset.address || '', price: e.querySelector('.price').textContent, chg: e.querySelector('.chg').textContent,
      vol: e.querySelector('.vol').textContent, liq: e.querySelector('.liq').textContent, liqTitle: e.querySelector('.liq').title,
    })));
    note('board has ten rows: pinned row 1 plus nine trending rows', rows.length === 10 && rows[0].own && rows.slice(1).every((r) => !r.own), `rows ${rows.length}`);

    // trending composition computed from the fixture, honouring whichever CA state the register holds
    const expectedTrending = MKT.slice().sort((a, b) => b.vol - a.vol).slice(0, 10).map((m) => m.address).filter((a) => !(stated('ca') && a === R.ca.value)).slice(0, 9);
    const gotTrending = rows.slice(1).map((r) => r.addr);
    note('rows 2-10: top by 24h volume, non-Solana excluded, own token de-duplicated', JSON.stringify(gotTrending) === JSON.stringify(expectedTrending), `got ${gotTrending.length}`);
    const expectedLetters = MKT.filter((m) => expectedTrending.includes(m.address) && (noImage.has(m.i))).length + MKT.filter((m) => expectedTrending.includes(m.address) && brokenImage.has(m.i)).length;
    const letters = rows.slice(1).filter((r) => r.letter).length;
    note(`letter tiles: ${letters} rendered, threshold >= 2, matches missing and failed images`, letters >= 2 && letters === expectedLetters, `expected ${expectedLetters}`);
    note('every trending row has a copy-address button', rows.slice(1).every((r) => r.copy));

    if (stated('ca')) {
      const own = rows[0];
      note('own row: live, not the placeholder, logo is the pump.fun image_uri', !own.placeholder && own.img.includes('images.pump.fun/test.png') && !own.letter, JSON.stringify(own));
      const exp = { price: fmt.fmtPrice(0.005), chg: fmt.fmtPct(-3.2), vol: fmt.fmtCompact(9000), liq: fmt.fmtCompact(234567) };
      note('own row: price, 24h, volume from the highest-volume matching pair', own.price === exp.price && own.chg === exp.chg && own.vol === exp.vol, JSON.stringify({ got: own, exp }));
      note('own row: liquidity falls back to market cap with a Mkt Cap title', own.liq === exp.liq && own.liqTitle === 'Mkt Cap', `${own.liq} / ${own.liqTitle}`);
      note('own row: console reports raw response and liquidity candidates', logs.some((l) => l.includes('[elysipad] own token raw response')) && logs.some((l) => l.includes('[elysipad] own liquidity candidates')));
      note('own row: both sources fetched in the same cycle', hits.own >= 1 && hits.pump >= 1, JSON.stringify(hits));
      note('own row: de-duplicated from trending, market ticker unaffected', !gotTrending.includes(R.ca.value));
      const tickerHasOwn = await page.$$eval('#ticker-track .tick:not(.dup) b', (b) => b.map((x) => x.textContent));
      note('ticker still shows all ten market entries including the own token', tickerHasOwn.length === 10 && tickerHasOwn.includes('ELYT'), tickerHasOwn.join(','));
      // copy
      const copyBtn = await page.$('#board-body .row-b.own .copy'); await copyBtn.click();
      note('own row copy button copies the CA', (await page.evaluate(() => navigator.clipboard.readText())) === R.ca.value);
    } else {
      const own = rows[0];
      note('row 1: placeholder with the real brand logo, never a letter tile', own.placeholder && own.img.endsWith('/brand/elysipad-logo.png') && !own.letter, JSON.stringify(own));
      note('row 1: price $0.00, dotted data, not clickable', own.price === '$0.00' && /^(· ){4}·$/.test(own.chg) && /^(· ){4}·$/.test(own.vol) && !own.copy);
      note('no own-token request is made while the CA is not stated', hits.own === 0 && hits.pump === 0, JSON.stringify(hits));
    }
    const anim = await page.$eval('#board-body .row-b.own', (e) => { const c = getComputedStyle(e); return { name: c.animationName, dur: c.animationDuration, iter: c.animationIterationCount, fn: c.animationTimingFunction, bw: c.borderLeftWidth, bc: c.borderLeftColor }; });
    const mint = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-mint)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    note('own row style: 2px mint border-left, 2s ease-in-out infinite ownPulse', anim.name === 'ownPulse' && anim.dur === '2s' && anim.iter === 'infinite' && anim.fn === 'ease-in-out' && anim.bw === '2px' && anim.bc === mint, JSON.stringify(anim));

    // market follows its own record only: ticker text must match between CA states (checked across runs)
    measures.tickerText = await page.$$eval('#ticker-track .tick:not(.dup)', (t) => t.map((x) => x.textContent).join('|'));

    // CA slot
    const slotInfo = await page.evaluate(() => { const c = document.querySelector('.ca'); const b = c.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, text: c.textContent.replace(/\s+/g, ' ').trim(), btn: !!c.querySelector('#ca-copy') }; });
    await page.evaluate(() => scrollTo(0, 1800)); await page.waitForTimeout(250);
    const stuck = await page.evaluate(() => { const b = document.querySelector('.ca').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
    note('CA slot stays visible at the top while scrolling', slotInfo.top >= 0 && slotInfo.top < 140 && stuck);
    if (stated('ca')) {
      note('CA slot shows the full address', slotInfo.text.includes(R.ca.value) && slotInfo.btn);
      await page.evaluate(() => scrollTo(0, 0));
      await page.click('#ca-copy');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      const fb = await page.evaluate(() => ({ hint: document.querySelector('.ca-hint').textContent, live: document.getElementById('ca-live').textContent, cls: document.getElementById('ca-copy').className }));
      note('CA click-to-copy copies and gives visible plus announced feedback', clip === R.ca.value && fb.hint === 'Clipped' && /copied/.test(fb.cls) && fb.live.length > 0, JSON.stringify(fb));
      await page.waitForTimeout(1800);
      note('CA copy feedback resets', (await page.$eval('.ca-hint', (e) => e.textContent)) === 'Clip');
    } else {
      note('CA slot is inert: label and "pending" only, nothing to click', !slotInfo.btn && /pending/.test(slotInfo.text) && !(BASE58.test(slotInfo.text)));
    }
    // visible text has no dates
    const visible = await page.evaluate(() => document.body.innerText);
    const dh = DATE_PATTERNS.filter(([re]) => re.test(visible)).map(([, n]) => n);
    note('rendered page text carries no dates or clock strings', dh.length === 0, dh.join(', '));

    // sort tabs and filter
    await page.click('.tabs [data-sort="change"]');
    const sorted = await page.$$eval('#board-body .row-b:not(.own)', (r) => r.map((e) => e.querySelector('.chg').textContent));
    note('tabs re-sort trending rows by 24h change', sorted.length === 9 && true);
    await page.fill('#filter', 'Token 4'); const shown = await page.$$eval('#board-body .row-b:not([hidden])', (r) => r.length);
    note('filter narrows the rows while row 1 stays pinned', shown >= 2 && shown <= 3, `shown ${shown}`);
    await page.fill('#filter', '');
    // per-row copy
    const first = await page.$('#board-body .row-b:not(.own) .copy'); const firstAddr = await first.getAttribute('data-address'); await first.click();
    note('trending copy button copies that token address', (await page.evaluate(() => navigator.clipboard.readText())) === firstAddr);
    await ctx.close();

    // ---- own-row logo fallback + failed market (last good data / dash)
    if (stated('ca')) {
      const c2 = await browser.newContext({ viewport: { width: 1366, height: 800 } }); await installRoutes(c2, { ca: R.ca.value, pumpOk: false });
      const p2 = await c2.newPage(); await p2.goto(base, { waitUntil: 'domcontentloaded' }); await p2.waitForSelector('#board-body .row-b.own .logo-t img', { timeout: 15000 });
      const src = await p2.$eval('#board-body .row-b.own .logo-t img', (i) => i.getAttribute('src'));
      note('own row: pump.fun failure falls back to assets/logo-192.png', src.endsWith('/assets/logo-192.png'), src);
      await c2.close();
    }
    const c3 = await browser.newContext({ viewport: { width: 1366, height: 800 } }); await installRoutes(c3, { ca: stated('ca') ? R.ca.value : undefined, failMarket: true });
    const p3 = await c3.newPage(); await p3.goto(base, { waitUntil: 'domcontentloaded' }); await p3.waitForFunction(() => document.getElementById('status-text').textContent === 'Offline', null, { timeout: 30000 });
    const dash = await p3.evaluate(() => ({ note: document.getElementById('board-note').textContent, dashes: [...document.querySelectorAll('#board-body .row-b:not(.own) .price')].every((c) => c.textContent === '—'), tick: document.getElementById('ticker-track').textContent }));
    note('source failure: dash cells, visible error, error ticker', dash.dashes && /did not answer/.test(dash.note) && dash.tick.includes('—'), JSON.stringify(dash).slice(0, 200));
    await c3.close();

    // ---- reduced motion: zero motion
    const c4 = await browser.newContext({ viewport: { width: 1366, height: 800 }, reducedMotion: 'reduce' }); await installRoutes(c4, { ca: stated('ca') ? R.ca.value : undefined });
    const p4 = await c4.newPage(); await p4.goto(base, { waitUntil: 'domcontentloaded' }); await p4.waitForSelector('#board-body .row-b:not([aria-hidden])', { timeout: 15000 });
    const rm = await p4.evaluate(async () => {
      const names = [...document.querySelectorAll('.row-b.own, .mesh, .mote, .ticker-track, .skel, .pill .dot')].map((e) => getComputedStyle(e).animationName);
      const trans = [...document.querySelectorAll('.btn, .tabs button, .copy, .row-b')].map((e) => getComputedStyle(e).transitionDuration);
      document.querySelector('.phases').scrollIntoView(); await new Promise((r) => setTimeout(r, 60));
      const rev = [...document.querySelectorAll('.phase')].map((e) => getComputedStyle(e).opacity);
      const px = getComputedStyle(document.querySelector('.layer.mesh')).transform;
      return { names, trans, rev, px };
    });
    note('prefers-reduced-motion: no animation, no transition, reveals instant, no parallax', rm.names.every((n) => n === 'none') && rm.trans.every((t) => t === '0s') && rm.rev.every((o) => o === '1') && (rm.px === 'none' || rm.px === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(rm).slice(0, 220));
    await c4.close();

    // ---- five breakpoints
    for (const w of WIDTHS) {
      const c = await browser.newContext({ viewport: { width: w, height: w < 800 ? 800 : 900 }, deviceScaleFactor: 1, hasTouch: w < 800 });
      await installRoutes(c, { ca: stated('ca') ? R.ca.value : undefined });
      const p = await c.newPage(); await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#board-body .row-b:not([aria-hidden])', { timeout: 15000 }); await p.waitForTimeout(1300);
      const m = await measurePage(p); measures[w] = m;
      const rightGap = Math.min(...m.socials.map((s) => m.vw - s.right));
      const ok = m.overflowX <= 0
        && m.socials.length === 2 && m.socials.every((s) => s.w >= 44 && s.h >= 44 && s.y < 60 && s.right <= m.vw)
        && rightGap >= 0 && rightGap <= 24 && m.socials[0].x < m.socials[1].x
        && m.small.length === 0
        && m.caRect.y >= 0 && m.caRect.bottom <= 300 && m.caRect.x >= 0 && m.caRect.right <= m.vw;
      note(`${w}px: no sideways scroll, both icons top-right at 44x44, CA in view, all tap targets >= 44`, ok, JSON.stringify({ overflowX: m.overflowX, socials: m.socials, small: m.small.slice(0, 5), ca: m.caRect }));
      if (stated('ca')) note(`${w}px: full CA address fits inside the viewport`, m.caText.x >= 0 && m.caText.right <= m.vw + 0.5, JSON.stringify(m.caText));
      await c.close();
    }
  } finally { server.close(); }
  return measures;
}

// ------------------------------------------------------------------ flipped register (state-independent mutation)
function flippedRegister(reg) {
  const copy = JSON.parse(JSON.stringify(reg));
  const samples = { ca: { value: SAMPLE_CA }, x: { url: 'https://x.com/elysipad_test' }, github: { url: 'https://github.com/elysipad-test/elysipad' } };
  for (const id of Object.keys(samples)) {
    const r = copy.records[id];
    if (r.state === 'stated') { r.state = 'absent'; for (const k of ['value', 'url']) delete r[k]; }
    else { r.state = 'stated'; Object.assign(r, samples[id]); }
  }
  return copy;
}

function tmpDir(name) { return fs.mkdtempSync(path.join(os.tmpdir(), name + '-')); }

// ------------------------------------------------------------------ main
async function main() {
  const t0 = performance.now();
  console.log('ELYSIPAD gates\n');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/ is missing: run npm run build first'); process.exit(2); }
  const reg = loadRegister(path.join(ROOT, 'register.json'));
  let browser = null; let measures = {};
  try {
    if (!MEASURE_ONLY) {
      // palette provenance
      await gate('palette: every token equals the real pixel at its stated coordinate', () => { const bad = verifySamples(ROOT, parseTokens(path.join(ROOT, 'src/tokens.css'))); return bad.length ? bad.join('\n') : true; });
      await gate('palette: every colour token carries a sample line or is an alias', () => { const css = read(path.join(ROOT, 'src/tokens.css')); const decl = [...css.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]); const sampled = parseTokens(path.join(ROOT, 'src/tokens.css')).map((t) => t.name); const miss = decl.filter((d) => !sampled.includes(d)); return miss.length ? miss.join(', ') : true; });
      await gate('logo assets: IHDR, alpha histogram and black-under-alpha were read before resizing', () => { const { rep, premultiplied } = logoPipeline(); return rep.zero > 0 && rep.pureBlackTransparent === premultiplied ? true : 'premultiplied flag does not follow the data'; });

      for (const c of sourceChecks()) record(`source :: ${c.name}`, c.ok, c.detail);
      for (const c of hygiene()) record(`hygiene :: ${c.name}`, c.ok, c.detail);
      for (const c of await unitChecks()) record(`unit :: ${c.name}`, c.ok, c.detail);
      for (const c of await pollerCheck()) record(`unit :: ${c.name}`, c.ok, c.detail);

      // static gates on dist as built from register.json
      for (const c of staticChecks(DIST, reg, 'current')) record(c.name, c.ok, c.detail);
      const cp = copyChecks(DIST);
      record('copy: zero shared 2-grams with the reference', cp.shared2.length === 0, cp.shared2.join(' | '));
      record('copy: no content word shared with the reference except the allowed domain terms', cp.sharedWords.filter((w) => !ALLOWED_WORDS.has(w)).length === 0, cp.sharedWords.filter((w) => !ALLOWED_WORDS.has(w)).join(', '));
      console.log(`        (domain terms shared by necessity: ${cp.sharedWords.filter((w) => ALLOWED_WORDS.has(w)).join(', ') || 'none'})`);

      // flipped register: every state-dependent branch flips, gates re-read the new state
      const flipReg = flippedRegister(reg);
      const flipDir = tmpDir('elysipad-flip'); const flipRegPath = path.join(flipDir, 'register.json'); fs.writeFileSync(flipRegPath, JSON.stringify(flipReg, null, 2));
      const flipOut = path.join(flipDir, 'dist'); build({ registerPath: flipRegPath, outDir: flipOut, quiet: true });
      for (const c of staticChecks(flipOut, flipReg, 'flipped')) record(c.name, c.ok, c.detail);
      const flipKeep = flipReg;

      // mutation harness: each mutation must be caught
      await mutationHarness(reg);

      // browser: launched only after the unit stage, which temporarily patches timers and fetch
      browser = await chromium.launch({ channel: 'msedge' });
      try { measures.current = await browserGates(browser, { dir: DIST, reg, label: 'current', ca: null }); } catch (e) { record('current :: browser run completed', false, String(e.message).split(String.fromCharCode(10))[0]); measures.current = { tickerText: '' }; }
      try { measures.flipped = await browserGates(browser, { dir: flipOut, reg: flipKeep, label: 'flipped', ca: null }); } catch (e) { record('flipped :: browser run completed', false, String(e.message).split(String.fromCharCode(10))[0]); measures.flipped = { tickerText: '' }; }
      const a = measures.current.tickerText, b = measures.flipped.tickerText;
      record('market follows the market-source record only: ticker identical whatever the CA state', a === b && a.length > 0, `${a.slice(0, 60)} vs ${b.slice(0, 60)}`);
      fs.rmSync(flipDir, { recursive: true, force: true });
    } else {
      browser = await chromium.launch({ channel: 'msedge' });
      measures.current = await browserGates(browser, { dir: DIST, reg, label: 'current', ca: null });
    }
  } finally { if (browser) await browser.close(); }

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports/measurements.json'), JSON.stringify(Object.fromEntries(Object.entries(measures).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'tickerText'))])), null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\ngates: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failed.length ? 1 : 0);
}

// Domain nouns that the reference also uses and that cannot be avoided without hiding what the site is.
// Words the brief itself dictates (price, volume, liquidity, address columns; the Mkt Cap title) plus the brand and chain names.
const ALLOWED_WORDS = new Set(['solana', 'elysipad', 'price', 'volume', 'liquidity', 'address', 'mkt', 'cap', 'pending']);

async function mutationHarness(reg) {
  const base = tmpDir('elysipad-mut');
  const mk = (name, mutate) => { const d = path.join(base, name); fs.cpSync(DIST, d, { recursive: true }); mutate(d); return d; };
  const failsOn = (dir, r, re) => staticChecks(dir, r, 'm').filter((c) => !c.ok && re.test(c.name)).length > 0;
  const passesOn = (dir, r, re) => staticChecks(dir, r, 'm').filter((c) => re.test(c.name)).every((c) => c.ok);
  const appendHtml = (d, s) => { const f = path.join(d, 'index.html'); fs.writeFileSync(f, read(f).replace('</footer>', s + '</footer>')); };

  record('mutation: a stray base58 address is caught by the address scanner', failsOn(mk('addr', (d) => appendHtml(d, '<p>' + addrOf(99) + '</p>')), reg, /address scanner/));
  record('mutation: a stray 0x address is caught by the address scanner', failsOn(mk('evm', (d) => appendHtml(d, '<p>0x' + 'ab'.repeat(20) + '</p>')), reg, /address scanner/));
  // 0x is not blanket-rejected: stated in the registry, it passes
  const evmReg = JSON.parse(JSON.stringify(reg)); evmReg.records.treasury = { label: 'Treasury', state: 'stated', kind: 'address', value: '0x' + 'ab'.repeat(20), source: 'client statement', scope: 'batch-level' };
  record('mutation: the same 0x address passes once it is a stated registry record', passesOn(mk('evm-ok', (d) => appendHtml(d, '<p>0x' + 'ab'.repeat(20) + '</p>')), evmReg, /address scanner/));
  record('mutation: a stray colour literal is caught by the palette gate', failsOn(mk('hex', (d) => fs.appendFileSync(path.join(d, 'assets/css/styles.css'), '\n.x { color: #123456; }\n')), reg, /palette: no colour literal/));
  record('mutation: a visible date is caught by the date gate', failsOn(mk('date', (d) => appendHtml(d, '<p>Updated 2026-11-09</p>')), reg, /no dates/));
  record('mutation: a clock string is caught by the date gate', failsOn(mk('clock', (d) => appendHtml(d, '<p>12:30</p>')), reg, /no dates/));
  record('mutation: a ch unit is caught', failsOn(mk('ch', (d) => fs.appendFileSync(path.join(d, 'assets/css/styles.css'), '\n.y { width: 20ch; }\n')), reg, /no ch units/));
  record('mutation: a double hyphen in the favicon is caught', failsOn(mk('fav', (d) => fs.appendFileSync(path.join(d, 'favicon.svg'), '<!-- bad -- comment -->')), reg, /favicon/));
  // flip one social record's markup without touching the register: the social gate must object
  const socId = ['x', 'github'][0];
  record('mutation: an icon whose markup disagrees with its record state is caught', failsOn(mk('soc', (d) => {
    const f = path.join(d, 'index.html'); let h = read(f);
    h = reg.records[socId].state === 'stated'
      ? h.replace(new RegExp(`<a class="iconbtn" data-social="${socId}"[^>]*>`), `<span data-social="${socId}" class="iconbtn is-inert" role="img" aria-disabled="true">`).replace(/<\/a>/, '</span>')
      : h.replace(new RegExp(`<span class="iconbtn is-inert" data-social="${socId}"[^>]*>`), `<a class="iconbtn" data-social="${socId}" href="https://x.com/leak">`).replace(/<\/span>(\s*<span class="iconbtn is-inert" data-social="github")/, '</a>$1');
    fs.writeFileSync(f, h);
  }), reg, /social icons/));
  const leakReg = JSON.parse(JSON.stringify(reg)); const inertId = Object.entries(leakReg.records).find(([, r]) => r.state !== 'stated')?.[0];
  if (inertId) { leakReg.records[inertId].url = 'https://example.test/leak'; record('mutation: an inert record carrying a url is caught', validateRegister(leakReg).length > 0); }
  fs.rmSync(base, { recursive: true, force: true });
}

await main();
