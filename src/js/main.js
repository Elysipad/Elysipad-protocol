import { copyText } from './format.js';
import { initReveal, initParallax, initMotes, initProgress, initSpotlight } from './motion.js';
import { createPoller, getJson } from './poller.js';
import { createMarket } from './market.js';
import { createOwn } from './own.js';
import { createBoard } from './board.js';
import { createTicker } from './ticker.js';

const reg = JSON.parse(document.getElementById('register').textContent);

initMotes(); initProgress(); initSpotlight(); initParallax(); initReveal();

// ---- contract slot: click to copy, only when the record is stated
const caBtn = document.getElementById('ca-copy');
if (caBtn && reg.ca?.state === 'stated') {
  const hint = caBtn.querySelector('.ca-hint'), live = document.getElementById('ca-live');
  caBtn.addEventListener('click', async () => {
    const ok = await copyText(reg.ca.value);
    caBtn.classList.toggle('copied', ok);
    hint.textContent = ok ? 'Clipped' : 'Blocked';
    live.textContent = ok ? 'CA clipped' : 'Clip blocked';
    setTimeout(() => { caBtn.classList.remove('copied'); hint.textContent = 'Clip'; live.textContent = ''; }, 1600);
  });
  // The RPC record confirms the account exists on chain. Cosmetic, never blocks anything.
  const chip = document.getElementById('ca-chip');
  if (chip && reg.rpc?.state === 'stated') {
    getJson(reg.rpc.url, { tries: 2, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [reg.ca.value, { encoding: 'base64' }] }) } })
      .then((j) => { if (j?.result?.value) { chip.textContent = 'On-chain'; chip.hidden = false; } })
      .catch(() => {});
  }
}

// ---- status pill
const pill = document.getElementById('status-pill'), pillText = document.getElementById('status-text');
function setPill(status) {
  const map = { loading: ['busy', 'Syncing'], ok: ['good', 'Streaming'], stale: ['busy', 'Retrying'], error: ['bad', 'Offline'], pending: ['bad', 'Pending'] };
  const [cls, label] = map[status] || map.loading;
  pill.className = 'pill ' + cls; pillText.textContent = label;
}

// ---- board, ticker, market (market follows its own register record only)
const board = createBoard({
  body: document.getElementById('board-body'),
  note: document.getElementById('board-note'),
  caRecord: reg.ca,
  tabs: [...document.querySelectorAll('.tabs [data-sort]')],
  filter: document.getElementById('filter'),
});
const ticker = createTicker(document.getElementById('ticker-track'));

const market = createMarket(reg['market-source'], (s) => { setPill(s.status); board.setMarket(s); ticker.update(s); });
const marketPoller = createPoller(() => market.refresh(), { interval: 60000 });
if (reg['market-source']?.state === 'stated') marketPoller.start(); else market.refresh();

// ---- own token row: only when the CA record is stated
if (reg.ca?.state === 'stated') {
  if (reg['own-source']?.state === 'stated') {
    const own = createOwn(reg.ca.value, reg['own-source'], (s) => board.setOwn(s));
    createPoller(() => own.refresh(), { interval: 60000 }).start();
  } else {
    board.setOwn({ status: 'error', row: null });
  }
}
