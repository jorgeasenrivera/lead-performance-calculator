// Track the fixture requests before routing delays them. Browser networkidle can
// already be satisfied while Playwright is still holding an intercepted request.
export function watchFeelReloads(page, { quietMs = 500, timeoutMs = 10000 } = {}) {
  const active = new Set();
  let changed = Date.now();
  const isMock = request => new URL(request.url()).origin === 'http://127.0.0.1:5433';
  const start = request => { if (isMock(request)) { active.add(request); changed = Date.now(); } };
  const finish = request => { if (active.delete(request)) changed = Date.now(); };
  page.on('request', start);
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return async () => {
    const began = Date.now();
    // Require a fresh quiet window, including requests not yet emitted when
    // the caller finishes its preceding browser action.
    changed = began;
    while (active.size || Date.now() - changed < quietMs) {
      if (Date.now() - began >= timeoutMs) throw Error('Mock requests did not settle before the feel reload');
      await new Promise(resolve => setTimeout(resolve, Math.min(quietMs, 50)));
    }
  };
}
