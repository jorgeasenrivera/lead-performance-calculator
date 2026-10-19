// Isolated real-React lifecycle proof. No app entry, sign-in or report service.
// Run with FEEL_PLAYWRIGHT pointing to a supported installed Playwright package.
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {createServer} from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwright = process.env.FEEL_PLAYWRIGHT
  ? await import(pathToFileURL(path.join(process.env.FEEL_PLAYWRIGHT, 'index.mjs')).href)
  : await import('playwright');
const engine = process.env.FEEL_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'Use Chromium or WebKit');

async function exercise(React, createRoot, flushSync, useReportedMonth) {
  const {createElement: h, StrictMode, Suspense} = React;
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const until = async (predicate, message) => {
    const deadline = performance.now() + 2500;
    while (!predicate() && performance.now() < deadline) await tick();
    check(predicate(), message);
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
  };
  const payload = (storeId, month, count = 0) => {
    const [year, m] = month.split('-').map(Number);
    return {storeId, month, days: Array.from({length: new Date(Date.UTC(year, m, 0)).getUTCDate()}, (_, index) => ({
      date: `${month}-${String(index + 1).padStart(2, '0')}`, status: index ? 'missing' : 'provisional',
      count: index ? null : count, vehicles: {new: null, used: null},
      asOf: index ? null : {timestamp: '2026-10-01T00:15:00.000Z', basis: 'report_received'},
    }))};
  };
  const response = (store = 'store-a', month = '2026-09', count = 0) => ({status: 200, json: async () => payload(store, month, count)});
  function fakeAuth() {
    let snapshot = Object.freeze({principalEpoch: 0, disposed: false});
    const listeners = new Set();
    const result = {token: 'synthetic.first', calls: [], disposedCalls: 0, getter: null,
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      getAccessToken(options) { result.calls.push(options); return result.getter ? result.getter(options) : Promise.resolve(result.token); },
      change(disposed = false) {
        snapshot = Object.freeze({principalEpoch: snapshot.principalEpoch + 1, disposed});
        [...listeners].forEach(listener => listener());
      },
      refresh() { result.token = 'synthetic.rotated'; },
      dispose() { result.disposedCalls++; },
      get listeners() { return listeners.size; },
    };
    return result;
  }
  function mount(options = {}) {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host), records = [], requests = [];
    const auth = options.auth || fakeAuth();
    const settings = {timeoutMs: options.timeoutMs ?? 1000};
    const state = {auth, storeId: 'store-a', loadedStoreId: 'store-a', month: '2026-09', active: true};
    let handler = options.handler || (async url => {
      const query = new URL(url, location.origin).searchParams;
      return response(query.get('store'), query.get('month'));
    });
    const fetchImpl = (...args) => { requests.push(args); return handler(...args); };
    let current, suspend = false, closed = false;
    const never = new Promise(() => {});
    function View() {
      current = useReportedMonth(state, {fetchImpl, timeoutMs: settings.timeoutMs});
      records.push({store: state.storeId, month: state.month, active: state.active, ...current});
      if (suspend) throw never;
      return h('output', null, current.status);
    }
    const render = () => flushSync(() => root.render(h(StrictMode, null,
      h(Suspense, {fallback: h('span', null, 'suspended')}, h(View)))));
    const close = () => {
      if (closed) return;
      closed = true; flushSync(() => root.unmount()); host.remove();
    };
    if (options.suspend) suspend = true;
    render();
    return {auth, state, records, requests, render, close,
      get value() { return current; },
      set handler(fn) { handler = fn; },
      update(next) { Object.assign(state, next); render(); },
      configure(next) { Object.assign(settings, next); render(); },
      suspend(value) { suspend = value; render(); },
    };
  }
  const checks = [];
  const run = async (name, fn) => { await fn(); checks.push(name); };
  const ready = fixture => until(() => fixture.value.status === 'ready', 'ready state did not settle');
  const noOldDays = (fixture, from) => check(fixture.records.slice(from).every(record =>
    record.days.length === 0), 'stale days appeared in a changed-scope render');

  await run('StrictMode mounts, zero/unknown projection, refresh retention and unmount ownership', async () => {
    const f = mount();
    try {
      await ready(f);
      check(f.value.days[0].count === 0 && f.value.days[1].count === null, 'zero/unknown changed');
      check(f.value.days[0].asOf.basis === 'report_received', 'timestamp basis changed');
      check(f.auth.listeners === 2, 'StrictMode leaked an auth subscription');
      const before = f.requests.length, days = f.value.days;
      f.auth.refresh(); f.render(); await tick();
      check(f.requests.length === before && f.value.days === days, 'routine refresh reread data');
    } finally { f.close(); }
    check(f.auth.listeners === 0 && f.auth.disposedCalls === 0, 'unmount disposed shared auth or leaked listeners');
  });
  await run('store/month/loaded-store changes mask every render before layout effects', async () => {
    const f = mount();
    try {
      await ready(f);
      for (const next of [{storeId: 'store-b', loadedStoreId: 'store-b'}, {month: '2026-10'}]) {
        const pending = deferred(), from = f.records.length;
        f.handler = () => pending.promise;
        f.update(next); noOldDays(f, from);
        await until(() => f.requests.at(-1)?.[0].includes(f.state.month), 'new request missing');
        pending.resolve(response(f.state.storeId, f.state.month)); await ready(f);
      }
      const from = f.records.length, before = f.requests.length;
      f.update({loadedStoreId: null}); noOldDays(f, from);
      check(f.value.status === 'idle', 'unloaded context was not idle');
      await tick(); check(f.requests.length === before, 'unloaded context fetched');
      f.handler = async () => response('store-b', '2026-10');
      f.update({loadedStoreId: 'store-b'}); await ready(f);
    } finally { f.close(); }
  });
  await run('same-store epoch and equal-epoch adapter replacement clear visible data', async () => {
    const f = mount();
    try {
      await ready(f);
      let pending = deferred(), from = f.records.length;
      f.handler = () => pending.promise;
      flushSync(() => f.auth.change()); noOldDays(f, from);
      pending.resolve(response()); await ready(f);
      const next = fakeAuth(); next.change();
      check(next.getSnapshot().principalEpoch === f.auth.getSnapshot().principalEpoch, 'replacement epochs must match');
      pending = deferred(); from = f.records.length;
      f.update({auth: next}); noOldDays(f, from);
      check(f.auth.listeners === 0 && f.auth.disposedCalls === 0, 'old shared adapter leaked or was disposed');
      pending.resolve(response()); await ready(f);
      f.close(); check(next.listeners === 0 && next.disposedCalls === 0, 'replacement adapter leaked');
    } finally { f.close(); }
  });
  for (const phase of ['lookup', 'fetch', 'decode']) await run(`close/reopen abandons pending ${phase} and stale retry`, async () => {
    const pending = deferred(), auth = fakeAuth();
    if (phase === 'lookup') auth.getter = () => pending.promise;
    const f = mount({auth, handler: phase === 'fetch' ? () => pending.promise
      : phase === 'decode' ? async () => ({status: 200, json: () => pending.promise}) : undefined});
    try {
      await until(() => phase === 'lookup' ? auth.calls.length > 0 : f.requests.length > 0, 'pending attempt not started');
      await tick();
      const staleRetry = f.value.retry;
      f.update({active: false}); check(f.value.status === 'idle' && !f.value.days.length, 'close retained data');
      check(auth.calls.at(-1).signal.aborted, 'close did not abort attempt');
      auth.getter = null; auth.token = 'synthetic.reopened';
      f.handler = async () => response('store-a', '2026-09', 7);
      f.update({active: true}); await ready(f);
      const before = f.requests.length;
      staleRetry(); await tick(); check(f.requests.length === before, 'stale retry restarted old scope');
      pending.resolve(phase === 'lookup' ? 'synthetic.old' : phase === 'fetch' ? response() : payload('store-a', '2026-09'));
      await tick(); check(f.value.days[0].count === 7, 'late result replaced reopened values');
      check(f.requests.at(-1)[1].headers.Authorization === 'Bearer synthetic.reopened', 'reopen used old credentials');
    } finally { f.close(); }
  });
  await run('retry obtains current token, clears ready state and masks late failure', async () => {
    const f = mount();
    try {
      await ready(f);
      const pending = deferred(), from = f.records.length;
      f.handler = () => pending.promise; f.auth.refresh();
      flushSync(() => f.value.retry()); noOldDays(f, from);
      await until(() => f.requests.at(-1)[1].headers.Authorization === 'Bearer synthetic.rotated', 'retry missed current token');
      f.update({active: false}); f.handler = async () => response('store-a', '2026-09', 8);
      f.update({active: true}); await ready(f);
      pending.reject(Error('private failure')); await tick();
      check(f.value.days[0].count === 8, 'late failure overwrote ready state');
    } finally { f.close(); }
  });
  await run('unmount cancels pending work without disposing a second hook shared adapter', async () => {
    const auth = fakeAuth(), pending = deferred();
    const first = mount({auth, handler: () => pending.promise}), second = mount({auth});
    try {
      await ready(second); await until(() => first.requests.length > 0, 'first request missing');
      const signal = first.requests[0][1].signal; first.close();
      check(signal.aborted && auth.listeners === 2 && auth.disposedCalls === 0, 'shared ownership failed');
      pending.reject(Error('private late failure')); await tick();
      flushSync(() => second.value.retry()); await ready(second);
    } finally { first.close(); second.close(); }
    check(auth.listeners === 0, 'shared auth listeners leaked');
  });
  await run('discarded suspended render creates no controller or request', async () => {
    const f = mount({suspend: true});
    try {
      await tick(); check(f.auth.listeners === 0 && f.auth.calls.length === 0 && !f.requests.length, 'discarded render had effects');
    } finally { f.close(); }
  });
  await run('committed suspension cleans up and reappearance acquires a new reader', async () => {
    const f = mount();
    try {
      await ready(f);
      f.suspend(true);
      check(f.auth.listeners <= 1 && !f.auth.disposedCalls, 'suspension retained a reader or disposed shared auth');
      const pending = deferred(), from = f.records.length;
      f.handler = () => pending.promise;
      f.suspend(false); noOldDays(f, from);
      pending.resolve(response('store-a', '2026-09', 9)); await ready(f);
      check(f.value.days[0].count === 9 && f.auth.listeners === 2, 'reappearance reused a disposed reader');
    } finally { f.close(); }
  });
  await run('disposed shared auth masks values and prevents retries', async () => {
    const f = mount();
    try {
      await ready(f);
      const before = f.requests.length, from = f.records.length;
      flushSync(() => f.auth.change(true)); noOldDays(f, from);
      check(f.value.status === 'idle', 'disposed auth did not become idle');
      f.value.retry(); await tick();
      check(f.requests.length === before, 'disposed auth fetched');
    } finally { f.close(); }
  });
  for (const status of [401, 403, 503]) await run(`HTTP ${status} remains private-safe`, async () => {
    let decoded = false;
    const f = mount({handler: async () => ({status, json() { decoded = true; throw Error('private'); }})});
    try {
      await until(() => f.value.status === (status === 503 ? 'unavailable' : 'denied'), 'wrong error status');
      check(!decoded && !f.value.days.length && Object.keys(f.value).sort().join() === 'days,retry,status', 'private error exposed');
    } finally { f.close(); }
  });
  await run('one deadline bounds a hung attempt without automatic retry', async () => {
    const f = mount({timeoutMs: 30, handler: () => new Promise(() => {})});
    try {
      await until(() => f.value.status === 'unavailable', 'deadline did not settle');
      const before = f.requests.length;
      await tick(); check(f.requests.length === before && f.requests.every(([, options]) => options.signal.aborted), 'deadline retried or failed to abort');
    } finally { f.close(); }
  });
  await run('invalid configuration settles unavailable and recovers with a fresh reader', async () => {
    const f = mount({timeoutMs: -1});
    try {
      await until(() => f.value.status === 'unavailable', 'constructor failure did not settle');
      check(f.requests.length === 0 && !f.value.days.length, 'invalid configuration fetched or retained data');
      f.configure({timeoutMs: 1000}); await ready(f);
      check(f.auth.listeners === 2, 'configuration recovery leaked a reader');
    } finally { f.close(); }
  });
  return checks;
}

const server = await createServer({root, configFile: false,
  server: {host: '127.0.0.1', port: 0, hmr: false},
  optimizeDeps: {include: ['react', 'react-dom/client', 'react-dom']}});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await playwright[engine].launch({headless: true,
    ...(process.env.REPORTED_HOOK_EXECUTABLE ? {executablePath: process.env.REPORTED_HOOK_EXECUTABLE} : {})});
  const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
  const errors = [], blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      blocked.push(url.origin + url.pathname); return route.abort();
    }
    if (url.pathname === '/__reported_hook_test__') return route.fulfill({contentType: 'text/html', body:
      '<!doctype html><html><body><script type="module" src="/__reported_hook_test__.mjs"></script></body></html>'});
    if (url.pathname === '/__reported_hook_test__.mjs') return route.fulfill({contentType: 'text/javascript', body:
      `import React from '/node_modules/.vite/deps/react.js';
       import {createRoot} from '/node_modules/.vite/deps/react-dom_client.js';
       import {flushSync} from '/node_modules/.vite/deps/react-dom.js';
       import {useReportedMonth} from '/src/use-reported-month.mjs';
       window.probe = (${exercise.toString()})(React, createRoot, flushSync, useReportedMonth)
         .then(checks => ({checks, react: React.version}), error => ({error: error.stack}));`});
    return route.continue();
  });
  await page.goto(origin + '/__reported_hook_test__');
  await page.waitForFunction(() => Boolean(window.probe));
  const result = await page.evaluate(() => window.probe);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(blocked, [], 'Unexpected service request was blocked');
  assert.match(result.react, /^18\./, 'This probe requires the app React 18 runtime');
  console.log(JSON.stringify({engine, browser: browser.version(), react: result.react, strictMode: true, checks: result.checks,
    externalRequests: 0, liveAuth: false, liveEndpoint: false}, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
