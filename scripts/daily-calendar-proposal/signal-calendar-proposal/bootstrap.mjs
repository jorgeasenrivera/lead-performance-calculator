// Freeze only the isolated study clock before importing actual Sage components.
const RealDate = Date, now = Date.parse('2026-09-22T16:00:00.000Z');
globalThis.Date = class FixtureDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
globalThis.__blockedFixtureRequests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const method = init.method || input?.method || 'GET';
  if (method === 'GET' && url.origin === 'http://fixture.invalid' && url.pathname === '/rest/v1/app_data') {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  globalThis.__blockedFixtureRequests.push({ path: url.pathname, method });
  throw new Error('Network and mutation are disabled in this isolated fixture');
};
await import('./entry.jsx');
