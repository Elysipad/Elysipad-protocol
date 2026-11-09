// Fetch helpers: exponential backoff, a poller that pauses while the tab is hidden.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { tries = 4, base = 700, init } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', ...init });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(base * 2 ** i + Math.random() * 250);
    }
  }
  throw last;
}

// Polls every `interval` ms. Hidden tab: no timer, no requests. Visible again: fetch at once.
// After a failed cycle the next attempt backs off exponentially, capped at the normal interval.
export function createPoller(task, { interval = 60000, firstDelay = 0 } = {}) {
  let timer = 0, running = false, fails = 0, stopped = false;
  const schedule = (ms) => { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(run, ms); };
  async function run() {
    if (running || document.hidden || stopped) return;
    running = true;
    try { await task(); fails = 0; } catch { fails++; }
    running = false;
    schedule(fails ? Math.min(interval, 4000 * 2 ** (fails - 1)) : interval);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer); else run();
  });
  return { start() { stopped = false; schedule(firstDelay); }, stop() { stopped = true; clearTimeout(timer); } };
}
