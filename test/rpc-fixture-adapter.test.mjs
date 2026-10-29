/* Pure checks for scripts/rpc-fixture-adapter.mjs and its seven consumers. No browser, no server, no network, no script is imported.

   The oracle is EXTRACT-ONLY. Each consumer's own app_data callback is cut out of its file by line shape, its body reverses the exact declared freshness insertion before binding to the original (6c76cff) body hash, and
   it is run in a bare vm context that is given only the live variables that script declares. Any other free name is a ReferenceError. The declared edits are then reversed
   on the whole file and the result must hash to the original file, so nothing else changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  ORIGIN, BASE_STORE, SECOND_STORE, CONFIG_KEY, MAX_BACKING_BYTES, MAX_LIST_ROWS, MAX_RPC_BODY_BYTES, READ_TIMEOUT_MS, LATCH_CAP, WORDS,
  parseRpcRequest, readBacking, installRpcAdapter,
} from '../scripts/rpc-fixture-adapter.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const J = (x) => JSON.parse(JSON.stringify(x));
const quiet = () => {};

/* ---- what the originals were (commit 6c76cffcf915206c49b049c5ebe29ca52d198bfc) ---- */
const SPEC = {
  'hero-freshness':    { body: 'b13727a8a0a52864d08b3bfbe3f9ad1dc151e536c276cfe4f67a860342a353d6', file: '81d0283c773f19100bdf8ece4adc4e662407bc77b156df0c08f72ccc0a3ea650', deps: ['dockFixture', 'stamp', 'importStamp'] },
  'hero-bars':         { body: '2656df6a89209039527d6a718a9138a85013b28bfd778f425b3ee78565d3bef0', file: '1d6a3dfae95dd348eb98dc09b2e7fe2371f2297b9bf40c92e739f49a7ddb0972', deps: ['dockFixture', 'thresholds', 'rates'] },
  'manager-viewports': { body: '8a79a47874a196835fc7e549cf833a1c73ee454dd2b53680c71d4c68ab5ee52c', file: 'fd5d775918c113dc79a44fa897b0e22b4976e1f56652275799bafd2cc1e6bd89', deps: ['dockFixture'] },
  'room-hero-colors':  { body: '8a79a47874a196835fc7e549cf833a1c73ee454dd2b53680c71d4c68ab5ee52c', file: '830d7275c15a6dbb8e17de2c85a6b76724903e7798c6265fdea6d3beeb41a7e5', deps: ['dockFixture'] },
  'color-phone':       { body: '8a79a47874a196835fc7e549cf833a1c73ee454dd2b53680c71d4c68ab5ee52c', file: '9b17de281472d32cebe66b079692da83800a48c8cf99881c8d111b9f82e42ec9', deps: ['dockFixture'] },
  'search-keyboard':   { body: '8a79a47874a196835fc7e549cf833a1c73ee454dd2b53680c71d4c68ab5ee52c', file: 'b85e5306365926ecb15c22c4774144704851667891afa975e32690487d976f85', deps: ['dockFixture'],
                         log: "console.log(JSON.stringify({engine,identity,evidence,errors}));" },
  'manager-selector':  { body: '8a79a47874a196835fc7e549cf833a1c73ee454dd2b53680c71d4c68ab5ee52c', file: '5b01fe0b143a3f90ea6a26b2e0bdeb4f3971da2ced34a03a652a7e2529888573', deps: ['dockFixture'],
                         log: "console.log('SELECTOR_RESULT '+JSON.stringify({engine,evidence,failures,errors}));" },
};
const NAMES = Object.keys(SPEC);

/* The live variables the callbacks read, exactly as the scripts declare them. The values below are bound to those lines by text. */
const THRESHOLDS = { internet: { green: 20, yellow: 10 }, phone: { green: 25, yellow: 12 }, showroom: { green: 30, yellow: 15 } };
const DEP_LINES = {
  'hero-freshness': "let fixtureRole='admin', dockFixture=null, stamp='2026-10-14T09:35:00Z', importStamp=null;",
  'hero-bars': ["const thresholds={internet:{green:20,yellow:10},phone:{green:25,yellow:12},showroom:{green:30,yellow:15}};", "let rates={internet:7,phone:18,showroom:35};"],
};

/* ---- the declared edits (the same four in every script, plus the success-message move in two) ---- */
const IMPORT = "import {installRpcAdapter} from './rpc-fixture-adapter.mjs';";
const OPEN_OLD = "await context.route('http://127.0.0.1:5433/rest/v1/app_data?**', async route => {";
const OPEN_NEW = 'const appDataRoute = async route => {';
const REG = ['};', "await context.route('http://127.0.0.1:5433/rest/v1/app_data?**', appDataRoute);", 'const rpcFx = await installRpcAdapter(context, { appDataRoute });'];
const VERDICT = 'rpcFx.assertNoRefusals();';
const CLOSE_TAIL = 'await browser.close();}';

const read = (name) => readFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), 'utf8');
function linesOf(text) {
  assert.ok(text.endsWith('\n'), 'file ends with a newline');
  assert.ok(!text.includes('\r'), 'no carriage returns');
  return text.split('\n').slice(0, -1);
}
function split(name) {
  const L = linesOf(read(name));
  const open = L.indexOf(OPEN_NEW);
  assert.ok(open >= 0 && L.lastIndexOf(OPEN_NEW) === open, `${name}: exactly one callback opening line`);
  const close = L.indexOf('};', open);
  assert.ok(close > open, `${name}: callback closing line`);
  return { L, open, close, body: L.slice(open + 1, close) };
}
// The only callback-body change after the frozen originals: stamp split fictional
// activity just as the embedded copy is stamped. Reverse these exact bytes only.
const FRESHNESS_SPLIT_STAMP = "    if (/^lpc:store:(sage-demo|spacing-demo-2):act:\\d{4}-\\d{2}-\\d{2}$/.test(row?.key || '') && row?.value && typeof row.value === 'object' && !Array.isArray(row.value)) {\n      row = {...row, value:Object.fromEntries(Object.entries(row.value).map(([name,r]) => [name, r && typeof r === 'object' && !Array.isArray(r) ? {...r, uploadedAt:stamp} : r]))};\n    }\n";
function originalCallback(name, text) {
  if (name !== 'hero-freshness') return text;
  assert.equal(text.split(FRESHNESS_SPLIT_STAMP).length, 2, 'one exact split-stamp insertion');
  assert.ok(text.includes(FRESHNESS_SPLIT_STAMP + '    if(!dockFixture || !row?.value)return row;'), 'insertion at its reviewed anchor');
  return text.replace(FRESHNESS_SPLIT_STAMP, '');
}

// Room rendering now has a read-only API fixture. Its exact wiring is outside
// the unchanged app_data callback; reverse only these three reviewed lines.
function originalRoomFile(name, text) {
  if (name !== 'room-hero-colors') return text;
  const pairs = [
    [IMPORT, "import {installRoomReadFixture} from './room-read-fixture.mjs';"],
    ['const rpcFx = await installRpcAdapter(context, { appDataRoute });', 'const roomFx = await installRoomReadFixture(context, {appOrigin:url});'],
    [VERDICT, 'roomFx.assertNoRefusals();'],
  ];
  for (const [anchor, line] of pairs) {
    assert.equal(text.split(line).length, 2, 'one exact room-fixture wiring line');
    assert.ok(text.includes(anchor + '\n' + line), 'room fixture line at its exact anchor');
    text = text.replace(anchor + '\n' + line, anchor);
  }
  return text;
}

function reverse(name, text) {
  text = originalRoomFile(name, text);
  text = originalCallback(name, text);
  const s = SPEC[name];
  let L = linesOf(text);
  const tail = s.log ? [VERDICT, s.log] : [VERDICT];
  assert.deepEqual(L.slice(-tail.length), tail, `${name}: terminal lines`);
  L = L.slice(0, -tail.length);
  if (s.log) {
    const f = L[L.length - 1];
    assert.ok(f.endsWith(CLOSE_TAIL), `${name}: finally ends with the browser close`);
    L[L.length - 1] = f.slice(0, -CLOSE_TAIL.length) + s.log + CLOSE_TAIL;
  }
  const open = L.indexOf(OPEN_NEW);
  assert.ok(open >= 0 && L.lastIndexOf(OPEN_NEW) === open);
  const close = L.indexOf('};', open);
  assert.deepEqual(L.slice(close, close + 3), REG, `${name}: registration lines`);
  L.splice(close, 3, '});');
  L[open] = OPEN_OLD;
  const imp = L.indexOf(IMPORT);
  assert.ok(imp > 0 && L.lastIndexOf(IMPORT) === imp && L[imp - 1].startsWith('import '), `${name}: one import line after the imports`);
  L.splice(imp, 1);
  return L.join('\n') + '\n';
}

/* ---- the extract-only oracle ---- */
const FIXED = Date.parse('2026-10-14T14:00:00Z');
class FixedDate extends Date {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
}
function buildOracle(name, live) {
  const { body } = split(name);
  /* A bare vm context carries V8's own console; naming it undefined makes any use of it fail loudly like every other name the callback was not given. */
  const sandbox = { Date: FixedDate, console: undefined };
  for (const dep of SPEC[name].deps) Object.defineProperty(sandbox, dep, { get: () => live[dep], enumerable: true });
  const ctx = vm.createContext(sandbox);
  const cb = vm.runInContext(`(async route => {\n${body.join('\n')}\n})`, ctx, { filename: `${name}-callback.vm` });
  return { cb, ctx };
}
const oracle = (name, live) => buildOracle(name, live).cb;

/* ---- a stand-in for the mock: the shapes the demo seeds, and the mock's own filter (eq, else everything) ---- */
function makeTable() {
  const at = '2026-10-14T12:00:00.000Z';
  return [
    { key: CONFIG_KEY, value: { stores: [{ id: BASE_STORE, name: 'Sage Demo Motors', thresholds: {} }], roles: [{ id: 'sales' }], standards: { [BASE_STORE]: { sales: { tiers: [] } } }, approvedDomains: [], registrationOpen: true, holidays: [], support: {} }, updated_at: at },
    { key: `lpc:store:${BASE_STORE}:v2`, value: { months: { '2026-10': { stats: { 'dev okonjo': { internetUnits: 3, internetLeads: 10, internetPct: 0.3 } }, stated: {} } }, activity: { '2026-10-12': { 'dev okonjo': { calls: 4 } } }, roster: [] }, updated_at: at },
    { key: `lpc:store:${BASE_STORE}:act:2026-10-12`, value: { 'dev okonjo': { calls: 4, uploadedAt: '2026-10-12T00:00:00Z' } }, updated_at: at },
    { key: `lpc:store:${BASE_STORE}:act:2026-10-13`, value: { 'dev okonjo': { calls: 5, uploadedAt: '2026-10-13T00:00:00Z' } }, updated_at: at },
    { key: `lpc:board:${BASE_STORE}:v1`, value: { storeId: BASE_STORE }, updated_at: at },
    { key: `lpc:board:${BASE_STORE}:act:2026-10-12`, value: {}, updated_at: at },
  ];
}
function mockRows(table, urlStr) {
  const key = new URL(urlStr).searchParams.get('key') ?? '';
  return structuredClone(key.startsWith('eq.') ? table.filter((r) => r.key === key.slice(3)) : table);
}
const directUrl = (filter) => `${ORIGIN}/rest/v1/app_data?select=key,value,updated_at&key=${filter}`;
/* What the script's own table route does: the callback, fed by the mock's behaviour. */
async function directRun(cb, requestUrl, table) {
  let out;
  await cb({ request: () => ({ url: () => requestUrl }), fetch: async ({ url }) => ({ json: async () => mockRows(table, url) }), fulfill: async ({ json }) => { out = json; } });
  return out;
}

const reply = (status, body, headers = {}) => ({ status: () => status, headers: () => headers, body: async () => Buffer.from(body) });
function makeContext(table, { get } = {}) {
  const routes = [], gets = [];
  return {
    routes, gets,
    route: async (pattern, handler) => { routes.push({ pattern, handler }); },
    request: { get: async (url, opts) => { gets.push({ url, opts }); return get ? get(url, opts, gets.length) : reply(200, JSON.stringify(mockRows(table, url))); } },
  };
}
const handlerOf = (ctx) => ctx.routes.find((r) => r.pattern === `${ORIGIN}/rest/v1/rpc/*`).handler;
function rpcRoute({ name, body = '', method = 'POST', url, headerStatus = 200, headerThrows = false, fulfillThrows = false, abortThrows = false } = {}) {
  const calls = { fulfill: [], abort: [], fallback: 0, fetch: 0, fetchOpts: [] };
  return {
    calls,
    request: () => ({ method: () => method, url: () => url ?? `${ORIGIN}/rest/v1/rpc/${name}`, postData: () => body }),
    fetch: async (o) => { calls.fetch++; calls.fetchOpts.push(o); if (headerThrows) throw new Error('closed'); return { status: () => headerStatus }; },
    fulfill: async (o) => { if (fulfillThrows) throw new Error('closed'); calls.fulfill.push(o); },
    abort: async (r) => { if (abortThrows) throw new Error('closed'); calls.abort.push(r); },
    fallback: async () => { calls.fallback++; },
  };
}
const storeBody = (id) => JSON.stringify({ p_store: id });
async function install(cb, { table = makeTable(), get } = {}) {
  const ctx = makeContext(table, { get });
  const fx = await installRpcAdapter(ctx, { appDataRoute: cb, log: quiet });
  return { ctx, fx, handler: handlerOf(ctx), table };
}
const canonical = () => oracle('color-phone', { dockFixture: null });

/* ===================== source shape: the declared edits, and nothing else ===================== */
for (const name of NAMES) {
  test(`${name}: the declared edits reversed give the original file byte for byte`, () => {
    assert.equal(sha(reverse(name, read(name))), SPEC[name].file);
  });
  test(`${name}: the callback body reverses exactly to the frozen original, and it is registered by name once`, () => {
    const { L, body } = split(name);
    assert.equal(sha(originalCallback(name, body.join('\n') + '\n')), SPEC[name].body);
    assert.equal(L.filter((l) => l.includes('installRpcAdapter(')).length, 1);
    assert.equal(L.filter((l) => l === VERDICT).length, 1);
  });
  test(`${name}: the verdict follows the finally, which holds no return, catch or success message`, () => {
    const L = linesOf(originalRoomFile(name, read(name)));
    const s = SPEC[name];
    const finallyAt = L.length - (s.log ? 3 : 2);
    assert.ok(L[finallyAt].startsWith('}finally{') && L[finallyAt].endsWith(CLOSE_TAIL), 'the finally is the last cleanup line');
    for (const banned of ['return', 'catch', 'console.log']) assert.ok(!L[finallyAt].includes(banned), `finally has no ${banned}`);
    assert.equal(L[finallyAt + 1], VERDICT);
    if (s.log) assert.equal(L[L.length - 1], s.log, 'the success message is last, after the verdict');
  });
}
test('the synthetic dependencies are exactly the lines the scripts declare', () => {
  assert.ok(linesOf(read('hero-freshness')).includes(DEP_LINES['hero-freshness']));
  for (const l of DEP_LINES['hero-bars']) assert.ok(linesOf(read('hero-bars')).includes(l));
});

/* ===================== parity: the adapter's answer is the script's own table rewrite ===================== */
const DOCKS = [null, { rooms: 1, done: 0 }, { rooms: 2, done: 1 }, { rooms: 2, done: 2 }];
const RATES = [{ internet: 7, phone: 18, showroom: 35 }, { internet: 0, phone: 0, showroom: 0 }, { internet: 9.949, phone: 11.949, showroom: 14.949 }, { internet: null, phone: null, showroom: null }];
const LIVE = {
  'hero-freshness': DOCKS.flatMap((d) => [
    { dockFixture: d, stamp: '2026-10-14T09:35:00Z', importStamp: null },
    { dockFixture: d, stamp: null, importStamp: null },
    { dockFixture: d, stamp: '2026-10-14T22:00:00Z', importStamp: '2026-10-13T08:00:00Z' }]),
  'hero-bars': DOCKS.flatMap((d) => RATES.map((rates) => ({ dockFixture: d, thresholds: THRESHOLDS, rates }))),
};
async function parity(name, live) {
  const cb = oracle(name, live);
  const { handler, table } = await install(cb);
  const cfg = await directRun(cb, directUrl(`eq.${CONFIG_KEY}`), table);
  const rc = rpcRoute({ name: 'sage_config_read', body: '' });
  await handler(rc);
  assert.equal(rc.calls.fulfill.length, 1);
  assert.equal(rc.calls.abort.length, 0);
  assert.deepEqual(J(rc.calls.fulfill[0].json), J({ value: cfg[0].value }));
  for (const id of [BASE_STORE, SECOND_STORE]) {
    const st = await directRun(cb, directUrl(`eq.lpc:store:${id}:v2`), table);
    const listing = await directRun(cb, directUrl(`like.lpc:store:${id}:act:*`), table);
    const exact = new RegExp(`^lpc:store:${id}:act:(\\d{4}-\\d{2}-\\d{2})$`);
    const activity = {};
    for (const row of listing) { const m = exact.exec(row.key); if (m) activity[m[1]] = row.value; }
    assert.deepEqual(Object.keys(activity), ['2026-10-12', '2026-10-13'], `${id}: the fixture has split activity`);
    const rs = rpcRoute({ name: 'sage_store_read', body: storeBody(id) });
    await handler(rs);
    assert.equal(rs.calls.fulfill.length, 1);
    assert.deepEqual(J(rs.calls.fulfill[0].json), J({ value: st[0].value, updated_at: st[0].updated_at ?? null, activity }));
  }
}
for (const name of NAMES) {
  test(`${name}: RPC answers equal the callback's own table output for config, both stores and the split activity, across live states`, async () => {
    for (const live of LIVE[name] ?? DOCKS.map((d) => ({ dockFixture: d }))) await parity(name, live);
  });
}
test('the second store is the legacy rewrite: key renamed, __storeId set, also on the split activity rows', async () => {
  const cb = canonical();
  const { handler } = await install(cb);
  const rs = rpcRoute({ name: 'sage_store_read', body: storeBody(SECOND_STORE) });
  await handler(rs);
  const out = rs.calls.fulfill[0].json;
  assert.equal(out.value.__storeId, SECOND_STORE);
  assert.ok(Object.values(out.activity).every((v) => v.__storeId === SECOND_STORE));
});
test('live state is read when each request is made, not when the adapter was installed', async () => {
  const live = { dockFixture: null };
  const { handler } = await install(oracle('color-phone', live));
  const first = rpcRoute({ name: 'sage_config_read' }); await handler(first);
  assert.equal(first.calls.fulfill[0].json.value.stores[0].rooms, undefined);
  live.dockFixture = { rooms: 2, done: 0 };
  const second = rpcRoute({ name: 'sage_config_read' }); await handler(second);
  assert.deepEqual(J(second.calls.fulfill[0].json.value.stores[0].rooms), { floor: true, line: true });
});
test('the extract-only sandbox gives the callback nothing but the declared live variables', () => {
  const { ctx } = buildOracle('hero-bars', { dockFixture: null, thresholds: THRESHOLDS, rates: RATES[0] });
  assert.equal(vm.runInContext('typeof process + typeof console + typeof require + typeof fetch', ctx), 'undefinedundefinedundefinedundefined');
  const bare = vm.runInContext('(async () => process.pid)', vm.createContext({}));
  return assert.rejects(bare(), (e) => e.name === 'ReferenceError');
});

/* ===================== the request gate, before any read ===================== */
test('the gate: exact origin, POST, the two names, no query, bounded body, canonical arguments, allowed stores only', () => {
  const p = (name, bodyText, extra = {}) => parseRpcRequest({ method: 'POST', url: `${ORIGIN}/rest/v1/rpc/${name}`, bodyText, ...extra });
  assert.deepEqual(p('sage_config_read', ''), { kind: 'config' });
  assert.deepEqual(p('sage_config_read', '{}'), { kind: 'config' });
  assert.deepEqual(p('sage_store_read', storeBody(BASE_STORE)), { kind: 'store', id: BASE_STORE });
  assert.deepEqual(p('sage_store_read', storeBody(SECOND_STORE)), { kind: 'store', id: SECOND_STORE });
  const word = (r) => r.word;
  assert.equal(word(p('sage_config_read', '{"x":1}')), 'bad-request');
  assert.equal(word(p('sage_config_read', 'null')), 'bad-request');
  for (const bad of ['', 'null', '[]', '{"p_store":1}', '{"p_store":"sage-demo","x":1}', '{"x":"sage-demo"}', '{', '"sage-demo"']) assert.equal(word(p('sage_store_read', bad)), 'bad-request', bad);
  for (const id of ['other-demo', '', 'sage-demo ', 'SAGE-DEMO', '__proto__', '../x', 'spacing-demo-3']) assert.equal(word(p('sage_store_read', storeBody(id))), 'store-not-allowed', id);
  assert.equal(word(p('sage_config_read', '', { url: `${ORIGIN}/rest/v1/rpc/sage_config_read?x=1` })), 'bad-request');
  assert.equal(word(p('sage_config_read', '', { url: 'http://127.0.0.1:5434/rest/v1/rpc/sage_config_read' })), 'bad-origin');
  assert.equal(word(p('sage_config_read', '', { url: 'not a url' })), 'bad-request');
  const exact = storeBody(BASE_STORE) + ' '.repeat(MAX_RPC_BODY_BYTES - storeBody(BASE_STORE).length);
  assert.equal(Buffer.byteLength(exact), MAX_RPC_BODY_BYTES);
  assert.deepEqual(p('sage_store_read', exact), { kind: 'store', id: BASE_STORE });
  assert.equal(word(p('sage_store_read', exact + ' ')), 'bad-request');
});
test('everything else is passed on untouched and reads nothing', async () => {
  const { ctx, handler, fx } = await install(canonical());
  for (const [name, method] of [['sage_schedule_read', 'POST'], ['sage_config_save', 'POST'], ['sage_room_commit', 'POST'], ['mark_onboarded', 'POST'], ['sage_config_read', 'OPTIONS'], ['sage_store_read', 'GET']]) {
    const r = rpcRoute({ name, method, body: storeBody(BASE_STORE) });
    await handler(r);
    assert.equal(r.calls.fallback, 1, `${name} ${method}`);
    assert.equal(r.calls.fulfill.length + r.calls.abort.length, 0);
  }
  assert.equal(ctx.gets.length, 0);
  assert.equal(fx.refusals().total, 0);
});
test('a refused request reads nothing, is aborted, and is counted by its fixed word', async () => {
  const { ctx, handler, fx } = await install(canonical());
  const bad = rpcRoute({ name: 'sage_store_read', body: storeBody('other-demo') });
  await handler(bad);
  assert.equal(ctx.gets.length, 0);
  assert.deepEqual(bad.calls.abort, ['failed']);
  assert.equal(bad.calls.fulfill.length, 0);
  assert.equal(fx.refusals().counts['store-not-allowed'], 1);
  assert.throws(() => fx.assertNoRefusals(), /store-not-allowed=1/);
});

/* ===================== the backing read: zero, multiple, malformed, redirect, over the cap ===================== */
test('a missing row is only a successful empty array: config { value: null }, store null with no activity read', async () => {
  const { ctx, handler, fx } = await install(canonical(), { table: [] });
  const c = rpcRoute({ name: 'sage_config_read' }); await handler(c);
  assert.deepEqual(J(c.calls.fulfill[0].json), { value: null });
  const s = rpcRoute({ name: 'sage_store_read', body: storeBody(BASE_STORE) }); await handler(s);
  assert.equal(s.calls.fulfill[0].json, null);
  assert.equal(ctx.gets.length, 2, 'one read each, none for activity');
  fx.assertNoRefusals();
});
test('readBacking: every reply other than 200 and an array of at most one matching row is refused with a fixed word', async () => {
  const ctxFor = (r) => ({ request: { get: async () => (typeof r === 'function' ? r() : r) } });
  const row = { key: 'k', value: {} };
  const word = async (r, q = { key: 'k' }) => { try { await readBacking(ctxFor(r), q); return 'accepted'; } catch (e) { return e.word; } };
  assert.equal(await word(reply(200, '[]')), 'accepted');
  assert.equal(await word(reply(200, JSON.stringify([row]))), 'accepted');
  assert.equal(await word(reply(200, JSON.stringify([row, row]))), 'read-shape');
  assert.equal(await word(reply(200, JSON.stringify([{ key: 'other', value: {} }]))), 'read-shape');
  assert.equal(await word(reply(200, JSON.stringify([{ value: {} }]))), 'read-shape');
  assert.equal(await word(reply(200, JSON.stringify([null]))), 'read-shape');
  assert.equal(await word(reply(200, '{"key":"k"}')), 'read-shape');
  assert.equal(await word(reply(200, 'not json')), 'read-error');
  assert.equal(await word(reply(302, '[]')), 'read-redirect');
  assert.equal(await word(reply(500, '[]')), 'read-status');
  assert.equal(await word(reply(404, '[]')), 'read-status');
  assert.equal(await word(() => { throw new Error('refused'); }), 'read-error');
  assert.equal(await word(reply(200, '[]', { 'content-length': String(MAX_BACKING_BYTES + 1) })), 'read-size');
  const dupes = JSON.stringify([{ key: 'a', value: {} }, { key: 'a', value: {} }]);
  assert.equal(await word(reply(200, dupes), { list: true }), 'read-shape');
});
test('the caps: a body of exactly the cap is accepted, one byte over is refused; 512 listing rows pass, 513 do not', async () => {
  const ctxFor = (r) => ({ request: { get: async () => r } });
  const padded = (n) => '[' + ' '.repeat(n - 2) + ']';
  assert.equal(padded(MAX_BACKING_BYTES).length, MAX_BACKING_BYTES);
  assert.deepEqual(await readBacking(ctxFor(reply(200, padded(MAX_BACKING_BYTES))), { key: 'k' }), []);
  await assert.rejects(readBacking(ctxFor(reply(200, padded(MAX_BACKING_BYTES + 1))), { key: 'k' }), (e) => e.word === 'read-size');
  const rows = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: {} })));
  assert.equal((await readBacking(ctxFor(reply(200, rows(MAX_LIST_ROWS))), { list: true })).length, MAX_LIST_ROWS);
  await assert.rejects(readBacking(ctxFor(reply(200, rows(MAX_LIST_ROWS + 1))), { list: true }), (e) => e.word === 'read-size');
});
test('refused backing reads surface through the adapter as the same words, with nothing invented in their place', async () => {
  for (const [r, word] of [[reply(302, '[]'), 'read-redirect'], [reply(500, '[]'), 'read-status'], [reply(200, '[{"key":"x","value":{}}]'), 'read-shape']]) {
    const { handler, fx } = await install(canonical(), { get: async () => r });
    const route = rpcRoute({ name: 'sage_config_read' });
    await handler(route);
    assert.equal(route.calls.fulfill.length, 0);
    assert.deepEqual(route.calls.abort, ['failed']);
    assert.equal(fx.refusals().counts[word], 1, word);
  }
});
test('activity: a key that looks like a day but is not, a malformed row, or a repeated day refuses the whole answer', async () => {
  const cases = {
    'impossible date': { key: `lpc:store:${BASE_STORE}:act:2026-13-40`, value: {} },
    'short date': { key: `lpc:store:${BASE_STORE}:act:2026-1-2`, value: {} },
    'trailing text': { key: `lpc:store:${BASE_STORE}:act:2026-10-12:x`, value: {} },
    'value is an array': { key: `lpc:store:${BASE_STORE}:act:2026-10-14`, value: [] },
    'value is missing': { key: `lpc:store:${BASE_STORE}:act:2026-10-14` },
  };
  for (const [label, extra] of Object.entries(cases)) {
    const table = makeTable(); table.push(extra);
    const { handler, fx } = await install(canonical(), { table });
    const route = rpcRoute({ name: 'sage_store_read', body: storeBody(BASE_STORE) });
    await handler(route);
    assert.equal(route.calls.fulfill.length, 0, label);
    assert.equal(fx.refusals().counts['read-shape'], 1, label);
  }
  const table = makeTable(); table.push({ key: `lpc:store:${BASE_STORE}:act:2026-10-12`, value: {} });
  const { handler, fx } = await install(canonical(), { table });
  await handler(rpcRoute({ name: 'sage_store_read', body: storeBody(BASE_STORE) }));
  assert.equal(fx.refusals().counts['read-shape'], 1, 'a duplicated identity is never resolved by picking one');
});

/* ===================== only what the callback was shown ===================== */
test('a callback that reaches for anything else, fetches twice or elsewhere, or fulfils wrongly is refused as legacy-error', async () => {
  const url = (route) => route.request().url();
  const rogues = {
    'unlisted member': async (route) => { route.continue(); },
    'another url': async (route) => { await route.fetch({ url: 'http://example.com/' }); },
    'extra option': async (route) => { await route.fetch({ url: url(route), headers: {} }); },
    'fetches twice': async (route) => { await route.fetch({ url: url(route) }); await route.fetch({ url: url(route) }); },
    'fulfils twice': async (route) => { await route.fetch({ url: url(route) }); await route.fulfill({ response: {}, json: [] }); await route.fulfill({ response: {}, json: [] }); },
    'never fulfils': async (route) => { await route.fetch({ url: url(route) }); },
    'wrong row count': async (route) => { await route.fetch({ url: url(route) }); await route.fulfill({ response: {}, json: [] }); },
    'throws': async () => { throw new Error('boom'); },
  };
  for (const [label, cb] of Object.entries(rogues)) {
    const { handler, fx } = await install(cb);
    const route = rpcRoute({ name: 'sage_config_read' });
    await handler(route);
    assert.equal(route.calls.fulfill.length, 0, label);
    assert.deepEqual(route.calls.abort, ['failed'], label);
    const counts = fx.refusals().counts;
    assert.equal(counts['legacy-error'] + counts['read-shape'], 1, label);
  }
});
test('the mock\'s own reply headers: a header fetch that fails, redirects or errors aborts the request and is counted', async () => {
  for (const [opts, word] of [[{ headerStatus: 500 }, 'header-status'], [{ headerStatus: 302 }, 'header-redirect'], [{ headerThrows: true }, 'header-error']]) {
    const { handler, fx } = await install(canonical());
    const route = rpcRoute({ name: 'sage_config_read', ...opts });
    await handler(route);
    assert.equal(route.calls.fulfill.length, 0);
    assert.equal(fx.refusals().counts[word], 1, word);
  }
});
test('the latch saturates at its cap and keeps only fixed words', async () => {
  const { handler, fx } = await install(canonical());
  for (let i = 0; i < LATCH_CAP + 5; i++) await handler(rpcRoute({ name: 'sage_store_read', body: storeBody('other-demo') }));
  const r = fx.refusals();
  assert.equal(r.counts['store-not-allowed'], LATCH_CAP);
  assert.deepEqual(Object.keys(r.counts), [...WORDS]);
  assert.throws(() => fx.assertNoRefusals(), new RegExp(`store-not-allowed=${LATCH_CAP}\\b`));
});

/* ===================== late refusal, unsettled requests, primary errors ===================== */
async function scriptLike(fx, { body, cleanup, log }) {
  try { await body(); } finally { await cleanup(); }
  fx.assertNoRefusals();
  log();
}
const refuse = (handler) => handler(rpcRoute({ name: 'sage_store_read', body: storeBody('other-demo') }));
test('a clean run: cleanup, then the verdict, then the success message', async () => {
  const { fx, handler } = await install(canonical());
  const events = [];
  await scriptLike(fx, {
    body: async () => { const r = rpcRoute({ name: 'sage_config_read' }); await handler(r); events.push(`served:${r.calls.fulfill.length}`); },
    cleanup: async () => { events.push('cleanup'); }, log: () => events.push('log'),
  });
  assert.deepEqual(events, ['served:1', 'cleanup', 'log']);
});
test('when cleanup completes, the primary thrown error comes out unchanged and no success message prints', async () => {
  const { fx, handler } = await install(canonical());
  const primary = new Error('primary');
  const events = [];
  await assert.rejects(scriptLike(fx, { body: async () => { await refuse(handler); throw primary; }, cleanup: async () => { events.push('cleanup'); }, log: () => events.push('log') }), (e) => e === primary);
  assert.deepEqual(events, ['cleanup']);
});
test('a refusal before the body ends, after it, or during cleanup fails the verdict and the success message never prints', async () => {
  for (const when of ['body', 'cleanup']) {
    const { fx, handler } = await install(canonical());
    const events = [];
    await assert.rejects(scriptLike(fx, {
      body: async () => { if (when === 'body') await refuse(handler); },
      cleanup: async () => { events.push('cleanup'); if (when === 'cleanup') await refuse(handler); }, log: () => events.push('log'),
    }), /store-not-allowed=1/);
    assert.deepEqual(events, ['cleanup'], when);
  }
});
test('a request that cannot be answered once the page is gone is counted, not excused', async () => {
  const { fx, handler } = await install(canonical());
  const gone = rpcRoute({ name: 'sage_config_read', fulfillThrows: true, abortThrows: true });
  await handler(gone);
  const counts = fx.refusals().counts;
  assert.equal(counts['respond-error'], 2, 'the failed answer and the failed abort');
  await assert.rejects(scriptLike(fx, { body: async () => {}, cleanup: async () => {}, log: () => assert.fail('no success message') }), /respond-error=2/);
});
test('a request still unfinished at the verdict is blocked as unsettled', async () => {
  const { fx, handler } = await install(canonical(), { get: () => new Promise(() => {}) });
  void handler(rpcRoute({ name: 'sage_store_read', body: storeBody(BASE_STORE) }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fx.refusals().inflight, 1);
  await assert.rejects(scriptLike(fx, { body: async () => {}, cleanup: async () => {}, log: () => assert.fail('no success message') }), /unsettled=1/);
});
test('wiring mistakes fail at install, loudly', async () => {
  await assert.rejects(installRpcAdapter({}, { appDataRoute: canonical() }), TypeError);
  await assert.rejects(installRpcAdapter(makeContext([]), {}), TypeError);
});

/* ===================== after review: raw rows first, explicit timeouts, and the limit on error preservation ===================== */
const BAD_VALUES = { array: [1, 2], string: 'abc' };
const rawRow = (key, value) => ({ key, value, updated_at: '2026-10-14T12:00:00.000Z' });

test('the legacy rewrite does turn a raw array or string value into an object for the second store: that is why selected raw rows are checked before it runs', async () => {
  const cb = canonical();
  for (const [label, value] of Object.entries(BAD_VALUES)) {
    const table = makeTable();
    table[1] = rawRow(`lpc:store:${BASE_STORE}:v2`, value);
    const out = await directRun(cb, directUrl(`eq.lpc:store:${SECOND_STORE}:v2`), table);
    assert.equal(Object.prototype.toString.call(out[0].value), '[object Object]', label);
    assert.equal(out[0].value.__storeId, SECOND_STORE, label);
  }
});
test('a selected raw store, activity or config value that is not an object is refused before the callback is given any row, for both stores', async () => {
  /* A minimal callback that only records what it was handed, so "before the callback" is observed and not assumed. For the second store it applies the one legitimate part of
     the rewrite, the key rename, and nothing else: a clean store row then passes the checks that follow, so only the gate under test can refuse, and values are handed on exactly
     as the backing store served them. */
  const spy = (deliveries) => async (route) => {
    const second = route.request().url().includes(SECOND_STORE);
    const response = await route.fetch({ url: route.request().url().replaceAll(SECOND_STORE, BASE_STORE) });
    deliveries.push('rows');
    const rows = await response.json();
    await route.fulfill({ response, json: second ? rows.map((r) => ({ ...r, key: r.key.replace(BASE_STORE, SECOND_STORE) })) : rows });
  };
  const cases = [
    ['store row', (table, value) => { table[1] = rawRow(`lpc:store:${BASE_STORE}:v2`, value); }, 'sage_store_read', 0, 1],
    ['activity row', (table, value) => { table[2] = rawRow(`lpc:store:${BASE_STORE}:act:2026-10-12`, value); }, 'sage_store_read', 1, 2],
    ['config row', (table, value) => { table[0] = rawRow(CONFIG_KEY, value); }, 'sage_config_read', 0, 1],
  ];
  for (const [label, corrupt, rpc, allowedDeliveries, expectedReads] of cases) {
    for (const id of rpc === 'sage_store_read' ? [BASE_STORE, SECOND_STORE] : [BASE_STORE]) {
      for (const [kind, value] of Object.entries(BAD_VALUES)) {
        const where = `${label} ${kind} ${id}`;
        const table = makeTable(); corrupt(table, value);
        const deliveries = [];
        const probe = await install(spy(deliveries), { table });
        const r = rpcRoute({ name: rpc, body: rpc === 'sage_store_read' ? storeBody(id) : '' });
        await probe.handler(r);
        assert.equal(deliveries.length, allowedDeliveries, `${where}: the corrupt rows were never delivered`);
        assert.equal(probe.ctx.gets.length, expectedReads, `${where}: how far the backing reads went`);
        if (label === 'activity row') {
          assert.equal(new URL(probe.ctx.gets[0].url).searchParams.has('key'), true, `${where}: the first read was the store row`);
          assert.equal(new URL(probe.ctx.gets[1].url).searchParams.has('key'), false, `${where}: the refusing read was the activity listing`);
        }
        assert.equal(r.calls.fulfill.length, 0, where);
        assert.deepEqual(r.calls.abort, ['failed'], where);
        assert.equal(probe.fx.refusals().counts['read-shape'], 1, where);
        const real = await install(canonical(), { table });
        const r2 = rpcRoute({ name: rpc, body: rpc === 'sage_store_read' ? storeBody(id) : '' });
        await real.handler(r2);
        assert.equal(r2.calls.fulfill.length, 0, `${where}: the real callback`);
        assert.equal(real.fx.refusals().counts['read-shape'], 1, `${where}: the real callback`);
      }
    }
  }
});
test('every network step carries the explicit timeout: the backing GETs and the real header POST', async () => {
  const { ctx, handler } = await install(canonical());
  const r = rpcRoute({ name: 'sage_store_read', body: storeBody(BASE_STORE) });
  await handler(r);
  assert.equal(READ_TIMEOUT_MS, 15000);
  assert.ok(ctx.gets.length >= 2);
  for (const g of ctx.gets) assert.deepEqual(g.opts, { maxRedirects: 0, failOnStatusCode: false, timeout: READ_TIMEOUT_MS });
  assert.deepEqual(r.calls.fetchOpts, [{ maxRedirects: 0, timeout: READ_TIMEOUT_MS }]);
});
test('limit, not a guarantee: a cleanup that throws replaces the primary error, as the existing finally always could, and the verdict is not reached', async () => {
  const { fx, handler } = await install(canonical());
  await refuse(handler);
  const primary = new Error('primary'), cleanupFailure = new Error('cleanup');
  const events = [];
  await assert.rejects(scriptLike(fx, { body: async () => { throw primary; }, cleanup: async () => { throw cleanupFailure; }, log: () => events.push('log') }), (e) => e === cleanupFailure);
  assert.deepEqual(events, []);
});

/* The freshness fixture must own both storage forms. A real stale timestamp is
   represented by the stale fixture stamp, never promoted to the fixed clock. */
test('freshness split stamps survive actual loadStore precedence: fresh, different, stale, missing and missed', async () => {
  const core = readFileSync(new URL('../src/LeadPerformanceCalculator.jsx', import.meta.url), 'utf8');
  const start = core.indexOf('async function loadStore(');
  assert.ok(start >= 0);
  const loadSource = core.slice(start, core.indexOf('\n}', start) + 2);
  for (const [state, stamp, importStamp] of [
    ['fresh', '2026-10-14T09:35:00Z', null],
    ['different', '2026-10-14T09:35:00Z', '2026-10-14T10:15:00Z'],
    ['stale', '2026-10-13T17:05:00Z', null], ['missing', null, null], ['missed', null, null],
  ]) for (const id of [BASE_STORE, SECOND_STORE]) {
    const table = makeTable();
    for (const row of table.filter(r => r.key.startsWith(`lpc:store:${BASE_STORE}:act:`))) {
      row.value['dev okonjo'].uploadedAt = '2026-10-29T17:00:00Z';
    }
    const { handler, fx } = await install(oracle('hero-freshness', { dockFixture: null, stamp, importStamp }), { table });
    const rpc = async () => {
      const route = rpcRoute({ name: 'sage_store_read', body: storeBody(id) });
      await handler(route);
      assert.equal(route.calls.abort.length, 0, `${state}/${id}`);
      assert.equal(route.calls.fulfill.length, 1);
      return J(route.calls.fulfill[0].json);
    };
    const load = vm.runInNewContext(loadSource + ';loadStore;', {
      storeKey: sid => sid, loadShared: async () => (await rpc()).value,
      loadActivityRows: async () => (await rpc()).activity, console,
    });
    const data = await load(id);
    assert.deepEqual(J(data.__splitDays), ['2026-10-12', '2026-10-13']);
    for (const rows of Object.values(data.activity)) assert.equal(rows['dev okonjo'].uploadedAt, stamp, `${state}/${id}`);
    assert.equal(data.activity['2026-10-13']['dev okonjo'].calls, 5);
    assert.deepEqual(J(data.importLog), stamp ? [{ t: importStamp || stamp }] : []);
    fx.assertNoRefusals();
  }
});

test('freshness stamping does not hide malformed raw split rows or invalid dates', async () => {
  for (const id of [BASE_STORE, SECOND_STORE]) for (const bad of [null, [], 'invalid', 'invalid-day']) {
    const table = makeTable(), row = table.find(r => r.key.includes(':act:'));
    if (bad === 'invalid-day') row.key = `lpc:store:${BASE_STORE}:act:2026-02-30`;
    else row.value = bad;
    const { handler, fx } = await install(oracle('hero-freshness', { dockFixture: null, stamp: '2026-10-14T09:35:00Z', importStamp: null }), { table });
    const route = rpcRoute({ name: 'sage_store_read', body: storeBody(id) });
    await handler(route);
    assert.equal(route.calls.fulfill.length, 0);
    assert.equal(route.calls.abort.length, 1);
    assert.equal(fx.refusals().counts['read-shape'], 1);
    assert.throws(() => fx.assertNoRefusals());
  }
});
