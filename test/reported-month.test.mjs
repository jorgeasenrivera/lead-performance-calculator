import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReportedMonthReader, projectReportedMonth, easternBusinessMonth} from '../src/reported-month.mjs';
import {createReportedAuthAdapter} from '../src/reported-auth.mjs';

const context = {storeId: 'store-a', loadedStoreId: 'store-a', month: '2026-09', active: true};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const payload = (storeId = 'store-a', month = '2026-09') => {
  const [y, m] = month.split('-').map(Number), length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {storeId, month, days: Array.from({length}, (_, i) => ({date: `${month}-${String(i + 1).padStart(2, '0')}`,
    status: 'missing', count: null, vehicles: {new: null, used: null}, asOf: null}))};
};
const known = (count = 0, basis = 'report_sent') => ({status: 'provisional', count, vehicles: {new: count, used: 0},
  asOf: {timestamp: '2026-10-01T00:15:00.000Z', basis}});
const response = (value = payload(), status = 200) => ({status, json: async () => value});
function fakeAuth(getter = async () => 'synthetic.token') {
  let snapshot = {principalEpoch: 0, disposed: false}, unsubscribes = 0;
  const listeners = new Set();
  return {getSnapshot: () => snapshot, getAccessToken: getter,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); unsubscribes++; }; },
    change(disposed = false) { snapshot = {principalEpoch: snapshot.principalEpoch + 1, disposed}; [...listeners].forEach(fn => fn()); },
    get unsubscribes() { return unsubscribes; }};
}
function setup(t, options = {}) {
  const calls = [], auth = options.auth || fakeAuth();
  const reader = createReportedMonthReader({...options, auth, fetchImpl: async (...args) => {
    calls.push(args); return options.fetchImpl ? options.fetchImpl(...args) : response();
  }});
  t.after(() => reader.dispose());
  return {reader, calls, auth};
}
async function settles(reader, status) {
  for (let i = 0; i < 20 && reader.getSnapshot().status !== status; i++) await tick();
  assert.equal(reader.getSnapshot().status, status);
  return reader.getSnapshot();
}

test('projects a complete month, zero, unknown, splits and original timestamp basis only', () => {
  const p = payload();
  Object.assign(p.days[0], known(), {sourceId: 'private-source', diagnostics: {secret: 'private'}});
  Object.assign(p.days[1], known(4, 'report_received'), {vehicles: {new: null, used: null}});
  p.days[2].status = 'incomplete'; p.days[3].status = 'conflict';
  p.days.reverse();
  const days = projectReportedMonth(p, context);
  assert.equal(days.length, 30); assert.equal(days[0].count, 0); assert.equal(days[2].count, null);
  assert.deepEqual(days[0].asOf, known().asOf);
  assert.equal(days[1].asOf.basis, 'report_received'); assert.equal(days[1].vehicles.new, null);
  assert.deepEqual(Object.keys(days[0]), ['date', 'status', 'count', 'vehicles', 'asOf']);
  assert.ok(Object.isFrozen(days) && Object.isFrozen(days[0]) && Object.isFrozen(days[0].asOf));
  assert.equal(JSON.stringify(days).includes('private'), false);
});

test('full-month dates include leap day and reject omitted or duplicate days', () => {
  const leap = payload('store-a', '2028-02');
  assert.equal(projectReportedMonth(leap, {...context, month: '2028-02'}).at(-1).date, '2028-02-29');
  for (const edit of [p => p.days.pop(), p => p.days.push(p.days[0]), p => { p.days[1].date = p.days[0].date; }]) {
    const p = payload(); edit(p); assert.throws(() => projectReportedMonth(p, context), /Reported month unavailable/);
  }
});

test('rejects identity, date, state, count, split and timestamp contract faults', () => {
  const edits = [p => { p.storeId = 'store-b'; }, p => { p.month = '2026-10'; }, p => { p.days = []; },
    p => { p.days[0].date = '2026-09-31'; }, p => { p.days[0].date = '2026-10-01'; },
    p => { p.days[0].status = 'final'; }, p => { p.days[0].count = 0; },
    p => { p.days[0].asOf = known().asOf; }, p => { p.days[0].vehicles.new = 0; },
    p => { Object.assign(p.days[0], known()); p.days[0].count = '0'; },
    p => { Object.assign(p.days[0], known()); p.days[0].count = NaN; },
    p => { Object.assign(p.days[0], known()); p.days[0].count = Infinity; },
    p => { Object.assign(p.days[0], known()); p.days[0].count = -1; },
    p => { Object.assign(p.days[0], known()); p.days[0].vehicles = {new: null, used: 0}; },
    p => { Object.assign(p.days[0], known()); p.days[0].vehicles = {new: 1, used: 0}; },
    p => { Object.assign(p.days[0], known()); p.days[0].asOf = '2026-10-01T00:15:00.000Z'; },
    p => { Object.assign(p.days[0], known()); p.days[0].asOf.basis = 'fetched'; },
    p => { Object.assign(p.days[0], known()); p.days[0].asOf.timestamp = '2026-02-30T00:15:00.000Z'; },
    p => { Object.assign(p.days[0], known()); p.days[0].asOf.timestamp = '2026-10-01T24:00:00.000Z'; }];
  for (const edit of edits) { const p = payload(); edit(p); assert.throws(() => projectReportedMonth(p, context), /Reported month unavailable/); }
});

test('business month follows Eastern midnight and daylight savings, not fixture or UTC month', () => {
  assert.equal(easternBusinessMonth(new Date('2026-10-01T03:59:59Z')), '2026-09');
  assert.equal(easternBusinessMonth(new Date('2026-10-01T04:00:00Z')), '2026-10');
  assert.equal(easternBusinessMonth(new Date('2026-02-01T04:59:59Z')), '2026-01');
  assert.equal(easternBusinessMonth(new Date('2026-02-01T05:00:00Z')), '2026-02');
});

test('GET is relative, no-store, current bearer only, abortable and never redirects', async t => {
  const {reader, calls} = setup(t);
  reader.setContext(context); assert.equal(reader.getSnapshot().status, 'loading');
  await settles(reader, 'ready');
  const [url, options] = calls[0];
  assert.equal(url, '/api/daily-deliveries?store=store-a&month=2026-09');
  assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin');
  assert.deepEqual(options.headers, {Authorization: 'Bearer synthetic.token'});
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(reader.getSnapshot()).includes('token'), false);
});

test('inactive, unloaded and invalid contexts issue no token or HTTP request', async t => {
  let tokens = 0;
  const {reader, calls} = setup(t, {auth: fakeAuth(async () => { tokens++; return 'synthetic.token'; })});
  for (const next of [{...context, active: false}, {...context, loadedStoreId: 'store-b'},
    {...context, loadedStoreId: null}, {...context, storeId: '../a', loadedStoreId: '../a'},
    {...context, month: '2026-13'}]) reader.setContext(next);
  await tick(); assert.equal(tokens, 0); assert.equal(calls.length, 0);
});

test('still-current signed-out session is denied, not an empty ready month', async t => {
  const {reader, calls} = setup(t, {auth: fakeAuth(async () => null)});
  reader.setContext(context); await settles(reader, 'denied');
  assert.equal(calls.length, 0); assert.equal(reader.getSnapshot().days.length, 0);
});

test('malformed token or private SDK error is unavailable with no request or diagnostic', async t => {
  for (const getter of [async () => 'bad\r\nheader', async () => undefined, async () => { throw Error('private SDK details'); }]) {
    const {reader, calls} = setup(t, {auth: fakeAuth(getter)});
    reader.setContext(context); await settles(reader, 'unavailable');
    assert.equal(calls.length, 0); assert.equal(JSON.stringify(reader.getSnapshot()).includes('private'), false);
  }
});

for (const status of [401, 403, 404, 503, 500, 204]) test(`HTTP ${status} preserves denied/unavailable without decoding diagnostics`, async t => {
  let decodes = 0;
  const {reader} = setup(t, {fetchImpl: async () => ({status, json() { decodes++; throw Error('private response'); }})});
  reader.setContext(context); await settles(reader, [401, 403].includes(status) ? 'denied' : 'unavailable');
  assert.equal(decodes, 0); assert.equal(reader.getSnapshot().days.length, 0);
});

test('network, malformed JSON, redirected and mismatched successful responses stay unavailable', async t => {
  for (const fetchImpl of [async () => { throw Error('private network info'); },
    async () => ({status: 200, json: async () => { throw Error('private syntax'); }}),
    async () => ({...response(), redirected: true}), async () => response(payload('store-b'))]) {
    const {reader} = setup(t, {fetchImpl}); reader.setContext(context); await settles(reader, 'unavailable');
    assert.equal(reader.getSnapshot().days.length, 0);
  }
});

test('store switch during delayed token lookup cannot issue an old request', async t => {
  const old = deferred(), requested = [];
  const auth = fakeAuth(() => { requested.push(true); return requested.length === 1 ? old.promise : Promise.resolve('new.token'); });
  const calls = [];
  const {reader} = setup(t, {auth, fetchImpl: async (url, options) => { calls.push([url, options]); return response(payload('store-b')); }});
  reader.setContext(context);
  reader.setContext({...context, storeId: 'store-b', loadedStoreId: 'store-b'});
  old.resolve('old.token'); await settles(reader, 'ready');
  assert.equal(calls.length, 1); assert.ok(calls[0][0].includes('store-b'));
  assert.equal(calls[0][1].headers.Authorization, 'Bearer new.token');
});

test('loaded-store mismatch clears ready values synchronously and does not refetch', async t => {
  const {reader, calls} = setup(t); reader.setContext(context); await settles(reader, 'ready');
  reader.setContext({...context, loadedStoreId: 'store-b'});
  assert.equal(reader.getSnapshot().status, 'idle'); assert.equal(reader.getSnapshot().days.length, 0);
  assert.equal(calls.length, 1);
});

test('month switch aborts fetch; its late error cannot replace the newer month', async t => {
  const old = deferred(), calls = [];
  const {reader} = setup(t, {fetchImpl: (url, options) => { calls.push([url, options]); return calls.length === 1 ? old.promise : Promise.resolve(response(payload('store-a', '2026-10'))); }});
  reader.setContext(context); await tick();
  reader.setContext({...context, month: '2026-10'});
  assert.equal(calls[0][1].signal.aborted, true); assert.equal(reader.getSnapshot().days.length, 0);
  old.reject(Error('private abandoned network error')); await settles(reader, 'ready');
  assert.equal(reader.getSnapshot().month, '2026-10');
});

test('same-store retry and close/reopen discard older delayed decodes', async t => {
  const pending = [deferred(), deferred()], calls = [];
  const {reader} = setup(t, {fetchImpl: async (_, options) => { const n = calls.length; calls.push(options); return n < 2 ? {status: 200, json: () => pending[n].promise} : response(); }});
  reader.setContext(context); await tick(); reader.retry(); await tick();
  reader.setContext({...context, active: false}); assert.equal(reader.getSnapshot().status, 'idle');
  reader.setContext(context); await settles(reader, 'ready');
  pending[0].resolve(payload('store-b')); pending[1].resolve(payload('store-b')); await tick();
  assert.equal(reader.getSnapshot().status, 'ready'); assert.equal(reader.getSnapshot().storeId, 'store-a');
  assert.ok(calls[0].signal.aborted && calls[1].signal.aborted);
});

test('account replacement invalidates ready counts immediately, with a fresh token', async t => {
  let token = 'first.token';
  const {reader, auth, calls} = setup(t, {auth: fakeAuth(async () => token)});
  reader.setContext(context); await settles(reader, 'ready');
  token = 'second.token'; auth.change();
  assert.equal(reader.getSnapshot().status, 'loading'); assert.equal(reader.getSnapshot().days.length, 0);
  await settles(reader, 'ready'); assert.equal(calls[1][1].headers.Authorization, 'Bearer second.token');
  assert.equal(reader.getSnapshot().principalEpoch, 1);
});

test('real adapter sign-out during token lookup issues zero fetches', async t => {
  const old = deferred(); let authEvent, lookups = 0, fetches = 0, token = 'old.token';
  const auth = createReportedAuthAdapter({auth: {onAuthStateChange(fn) { authEvent = fn; return {data: {subscription: {unsubscribe() {}}}}; },
    getSession() { lookups++; return lookups === 1 ? old.promise : Promise.resolve({data: {session: token ? {access_token: token} : null}}); }}});
  t.after(() => auth.dispose());
  const {reader} = setup(t, {auth, fetchImpl: async () => { fetches++; return response(); }});
  reader.setContext(context);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(lookups, 1);
  token = null; authEvent('SIGNED_OUT'); old.resolve({data: {session: {access_token: 'old.token'}}});
  await new Promise(resolve => setTimeout(resolve, 5)); await settles(reader, 'denied'); assert.equal(fetches, 0);
});

test('account replacement during decoding rejects the previous principal response', async t => {
  const old = deferred(); let fetches = 0;
  const {reader, auth} = setup(t, {fetchImpl: async () => ++fetches === 1 ? {status: 200, json: () => old.promise} : response()});
  reader.setContext(context); await tick(); auth.change();
  old.resolve(payload('store-b')); await settles(reader, 'ready');
  assert.equal(reader.getSnapshot().principalEpoch, 1); assert.equal(reader.getSnapshot().storeId, 'store-a');
});

test('one deadline covers hung lookup, fetch and decode with late completion ignored', async t => {
  for (const phase of ['lookup', 'fetch', 'decode']) {
    const late = deferred(); let signal, calls = 0;
    const auth = fakeAuth(({signal: value}) => { signal = value; return phase === 'lookup' ? late.promise : Promise.resolve('synthetic.token'); });
    const {reader} = setup(t, {auth, timeoutMs: 15, fetchImpl: async () => { calls++; return phase === 'fetch' ? late.promise : {status: 200, json: () => late.promise}; }});
    reader.setContext(context); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reader.getSnapshot().status, 'unavailable'); assert.equal(signal.aborted, true);
    late.resolve(phase === 'lookup' ? 'late.token' : phase === 'fetch' ? response() : payload()); await tick();
    assert.equal(reader.getSnapshot().status, 'unavailable'); if (phase === 'lookup') assert.equal(calls, 0);
  }
});

test('monotonic deadline cannot be restarted after lookup or beaten by an overdue callback', async t => {
  let clock = 0, requests = 0;
  const {reader} = setup(t, {timeoutMs: 5000, now: () => clock,
    auth: fakeAuth(async () => { clock = 4999; return 'synthetic.token'; }),
    fetchImpl: async () => { requests++; clock = 5001; return response(); }});
  reader.setContext(context); await settles(reader, 'unavailable'); assert.equal(requests, 1);
});

test('failure never retries automatically; explicit retry gets current credentials', async t => {
  let calls = 0, tokens = 0;
  const {reader} = setup(t, {auth: fakeAuth(async () => `synthetic.${++tokens}`),
    fetchImpl: async () => ++calls === 1 ? response(null, 503) : response()});
  reader.setContext(context); await settles(reader, 'unavailable'); await tick(); assert.equal(calls, 1);
  reader.retry(); await settles(reader, 'ready'); assert.equal(calls, 2); assert.equal(tokens, 2);
  reader.setContext({...context}); await tick(); assert.equal(calls, 2);
});

test('dispose invalidates, aborts, unsubscribes once and never disposes shared auth', async t => {
  const late = deferred(), auth = fakeAuth(() => late.promise);
  const {reader, calls} = setup(t, {auth}); reader.setContext(context);
  reader.dispose(); reader.dispose(); auth.change(); reader.retry(); reader.setContext(context);
  late.resolve('late.token'); await tick();
  assert.equal(auth.unsubscribes, 1); assert.equal(calls.length, 0); assert.equal(reader.getSnapshot().status, 'idle');
});

test('broken subscribers cannot interrupt cancellation of other subscribers', async t => {
  const {reader} = setup(t); let notifications = 0;
  reader.subscribe(() => { throw Error('broken view'); }); reader.subscribe(() => { notifications++; });
  reader.setContext(context); await settles(reader, 'ready'); reader.setContext({...context, active: false});
  assert.equal(reader.getSnapshot().status, 'idle'); assert.equal(notifications, 3);
});

test('reader remains unimported by production screens and has no global API or persistence writer', () => {
  for (const name of ['Manager.jsx', 'LeadPerformanceCalculator.jsx', 'main.jsx']) {
    assert.equal(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8').includes('reported-month.mjs'), false);
  }
  const source = readFileSync(new URL('../src/reported-month.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['apiCall', 'localStorage', 'sessionStorage', 'console.', 'user_metadata', 'service_role']) assert.equal(source.includes(forbidden), false, forbidden);
});
