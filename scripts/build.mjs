// Build: register -> HTML, assets from real pixels, favicon traced from the logo grid. Output: dist/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readImage, alphaReport, bbox, cropSquare, resize, encodePng, hexToRgb } from './lib/image.mjs';
import { loadRegister, validateRegister, runtimeView, deriveHandle } from './lib/register.mjs';
import { tokenMap, parseTokens, verifySamples } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGO_SRC = 'brand/LOGO ELYSIPAD PNG...png'; // RGBA, transparent field

const X_PATH = 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z';
const GH_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
export const ICONS = {
  x: { vb: '0 0 24 24', d: X_PATH },
  github: { vb: '0 0 16 16', d: GH_PATH },
};
const svgIcon = (id) => `<svg viewBox="${ICONS[id].vb}" aria-hidden="true" focusable="false"><path d="${ICONS[id].d}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function socialIcon(id, rec) {
  if (rec.state === 'stated') {
    const h = deriveHandle(id, rec.url);
    return `        <a class="iconbtn" data-social="${id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(rec.label)}, ${esc(h)}" title="${esc(rec.label)} ${esc(h)}">${svgIcon(id)}</a>`;
  }
  return `        <span class="iconbtn is-inert" data-social="${id}" data-state="${rec.state}" role="img" aria-disabled="true" aria-label="${esc(rec.label)}, pending" title="${esc(rec.label)}, pending">${svgIcon(id)}</span>`;
}

function caSlot(rec) {
  if (rec.state === 'stated') {
    return `    <div class="ca" data-record="ca" data-state="stated">
      <span class="ca-label">${esc(rec.label.split(' ')[0].toUpperCase())}</span>
      <button class="ca-btn" id="ca-copy" type="button" aria-label="Clip the CA"><code class="ca-text">${esc(rec.value)}</code><span class="ca-hint">Clip</span></button>
      <span class="chip" id="ca-chip" hidden></span>
      <span class="sr-only" id="ca-live" aria-live="polite"></span>
    </div>`;
  }
  return `    <div class="ca is-inert" data-record="ca" data-state="${rec.state}">
      <span class="ca-label">${esc(rec.label.split(' ')[0].toUpperCase())}</span>
      <span class="ca-inert">pending</span>
    </div>`;
}

function statTiles(records) {
  return Object.entries(records).filter(([, r]) => r.kind === 'stat').map(([id, r]) => {
    const val = r.state === 'stated'
      ? `<b>${esc(r.value)}</b>`
      : '<b class="is-pending">pending</b>';
    return `  <div class="stat spot" data-reveal data-record="${id}" data-state="${r.state}"><span class="muted small stat-l">${esc(r.label)}</span>${val}</div>`;
  }).join('\n');
}

function chips(records) {
  const out = [];
  const chip = (id, r, icon, text) => {
    const body = `${icon}<span class="lc-t"><b>${esc(r.label)}</b><span class="lc-v">${text}</span></span>`;
    if (r.state === 'stated' && r.url) {
      return `    <a class="link-chip spot" data-reveal data-record="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
    }
    return `    <div class="link-chip is-inert" data-reveal data-record="${id}" data-state="${r.state}">${body}</div>`;
  };
  const x = records.x, gh = records.github, ca = records.ca, ch = records.chain;
  out.push(chip('x', x, svgIcon('x'), x.state === 'stated' ? esc(deriveHandle('x', x.url)) : 'pending'));
  out.push(chip('github', gh, svgIcon('github'), gh.state === 'stated' ? esc(deriveHandle('github', gh.url)) : 'pending'));
  out.push(`    <div class="link-chip ${ca.state === 'stated' ? '' : 'is-inert'}" data-reveal data-record="ca" data-state="${ca.state}"><span class="lc-t"><b>${esc(ca.label)}</b><span class="lc-v">${ca.state === 'stated' ? 'pinned at the top' : 'pending'}</span></span></div>`);
  out.push(`    <div class="link-chip" data-reveal data-record="chain" data-state="${ch.state}"><span class="lc-t"><b>${esc(ch.label)}</b><span class="lc-v">${esc(ch.value)}</span></span></div>`);
  return out.join('\n');
}

export function renderHtml(reg, tpl) {
  const r = reg.records;
  const json = JSON.stringify(runtimeView(reg)).replace(/</g, '\\u003c');
  return tpl
    .replace('<!--@SOCIAL-->', socialIcon('x', r.x) + '\n' + socialIcon('github', r.github))
    .replace('<!--@CA_SLOT-->', caSlot(r.ca))
    .replace('<!--@STATS-->', statTiles(r))
    .replace('<!--@CHIPS-->', chips(r))
    .replace('<!--@REGISTER_JSON-->', json);
}

// Favicon: 32x32 pixel grid of the real logo (premultiplied resize), each cell snapped to the
// nearest token colour, runs merged into one path per colour. No XML comments are emitted.
export function traceFavicon(grid, tokens) {
  const pal = ['--color-panel', '--color-gold', '--color-gold-hi', '--color-gold-deep'].map((n) => ({ n, rgb: hexToRgb(tokens[n]) }));
  const runs = Object.fromEntries(pal.map((p) => [p.n, []]));
  const cells = new Set();
  for (let y = 0; y < 32; y++) {
    let x = 0;
    while (x < 32) {
      const i = (y * 32 + x) * 4;
      if (grid.data[i + 3] < 0.45 * 255) { x++; continue; }
      const px = [grid.data[i], grid.data[i + 1], grid.data[i + 2]];
      const best = pal.reduce((a, p) => { const d = p.rgb.reduce((s, v, k) => s + (v - px[k]) ** 2, 0); return d < a.d ? { d, n: p.n } : a; }, { d: Infinity }).n;
      let w = 1;
      while (x + w < 32) {
        const j = (y * 32 + x + w) * 4;
        if (grid.data[j + 3] < 0.45 * 255) break;
        const q = [grid.data[j], grid.data[j + 1], grid.data[j + 2]];
        const b2 = pal.reduce((a, p) => { const d = p.rgb.reduce((s, v, k) => s + (v - q[k]) ** 2, 0); return d < a.d ? { d, n: p.n } : a; }, { d: Infinity }).n;
        if (b2 !== best) break; w++;
      }
      runs[best].push(`M${x} ${y}h${w}v1h-${w}z`);
      for (let k = 0; k < w; k++) cells.add(`${x + k},${y}`);
      x += w;
    }
  }
  const body = pal.filter((p) => runs[p.n].length).map((p) => `<path fill="${tokens[p.n]}" d="${runs[p.n].join('')}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" rx="6" fill="${tokens['--color-ink']}"/>${body}</svg>\n`;
  return { svg, cells };
}

export function logoPipeline(root = ROOT) {
  const src = readImage(path.join(root, LOGO_SRC));
  const rep = alphaReport(src);
  const box = bbox(src);
  const square = cropSquare(src, box, 0.06);
  return { src, rep, box, square, premultiplied: rep.pureBlackTransparent };
}

export function build({ registerPath = path.join(ROOT, 'register.json'), outDir = path.join(ROOT, 'dist'), quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const reg = loadRegister(registerPath);
  const errs = validateRegister(reg);
  if (errs.length) throw new Error('Register invalid:\n - ' + errs.join('\n - '));

  const tokFile = path.join(ROOT, 'src/tokens.css');
  const tokenList = parseTokens(tokFile);
  const bad = verifySamples(ROOT, tokenList);
  if (bad.length) throw new Error('Palette provenance mismatch:\n - ' + bad.join('\n - '));
  const tokens = tokenMap(tokFile);

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ['assets/css', 'assets/js', 'brand']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

  // assets
  const { rep, box, square, premultiplied } = logoPipeline();
  log(`logo: ${rep.zero} transparent px, pure-black RGB under alpha 0: ${rep.pureBlackTransparent}; bbox ${box.x0},${box.y0}-${box.x1},${box.y1}; premultiplied resize: ${premultiplied}`);
  const out = (rel, buf) => fs.writeFileSync(path.join(outDir, rel), buf);
  out('brand/elysipad-logo.png', encodePng(resize(square, 512, 512, premultiplied)));
  out('assets/logo-192.png', encodePng(resize(square, 192, 192, premultiplied)));
  out('assets/apple-touch-icon.png', encodePng(resize(square, 180, 180, premultiplied)));
  const { svg } = traceFavicon(resize(square, 32, 32, premultiplied), tokens);
  out('favicon.svg', svg);

  // code
  fs.copyFileSync(tokFile, path.join(outDir, 'assets/css/tokens.css'));
  fs.copyFileSync(path.join(ROOT, 'src/styles.css'), path.join(outDir, 'assets/css/styles.css'));
  for (const f of fs.readdirSync(path.join(ROOT, 'src/js'))) fs.copyFileSync(path.join(ROOT, 'src/js', f), path.join(outDir, 'assets/js', f));

  out('index.html', renderHtml(reg, fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8')));
  out('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=3600\n');
  log('built ->', outDir);
  return { outDir, reg };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { build(); } catch (e) { console.error(e.message); process.exit(1); }
}
