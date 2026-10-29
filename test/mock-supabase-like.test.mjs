// No sockets or browser: execute the mock's actual request handler in a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { installRpcAdapter, ORIGIN } from '../scripts/rpc-fixture-adapter.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const activityKey = 'lpc:store:sage-demo:act:2026-10-14';
function mock() {
  let handler;
  const seed = [
    { key: 'lpc:store:sage-demo:v2', value: { months: {} } },
    { key: activityKey, value: { fictional: { calls: 3 } } },
    { key: 'lpc:backup:sage-demo:old:v1', value: {} },
    { key: 'lpc:backup:sage-demo:keep:v1', value: {} },
    { key: 'lpc:config:backup:old:v1', value: {} },
  ];
  const source = read('scripts/mock-supabase.mjs').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, {
    http: { createServer: fn => { handler = fn; return { listen() {} }; } },
    buildDemo: () => ({ rows: seed.map(row => ({ table: 'app_data', row })), storeConfig: {} }),
    DEMO_STORE_ID: 'sage-demo', DEMO_STORE_NAME: 'Fictional',
    process: { env: {} }, URL, console,
    setTimeout() { throw Error('Unexpected delayed request'); },
  });
  return async (url, method = 'GET', data) => {
    const req = new EventEmitter();
    Object.assign(req, { url, method, headers: { prefer: 'resolution=merge-duplicates' } });
    let code, headers, body;
    handler(req, { writeHead: (c, h) => { code = c; headers = h; }, end: b => { body = b; } });
    if (data !== undefined) req.emit('data', JSON.stringify(data));
    req.emit('end');
    assert.notEqual(code, undefined, 'request completed');
    return { status: () => code, headers: () => headers, body: async () => Buffer.from(body || ''), json: async () => JSON.parse(body) };
  };
}
const tableUrl = params => ORIGIN + '/rest/v1/app_data?' + new URLSearchParams(params);
function extractFunction(source, name) {
  const start = source.indexOf('async function ' + name + '(');
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('mock like filters preserve activity during actual backup pruning; genuine null still refuses', async () => {
  const request = mock(), writes = [];
  const supabase = { from: () => ({ select: () => ({ like: async (key, pattern) => ({ data: await (await request(tableUrl({ [key]: 'like.' + pattern }))).json() }) }) }) };
  const saveShared = async (key, value) => {
    writes.push(key);
    const res = await request(tableUrl({}), 'POST', { key, value });
    assert.equal(res.status(), 201);
    return true;
  };
  const prune = vm.runInNewContext(extractFunction(read('src/LeadPerformanceCalculator.jsx'), 'pruneBackups') + ';pruneBackups;', { supabase, saveShared, console });
  assert.equal((await prune([{ id: 'keep' }])).dropped, 2);
  assert.deepEqual(writes, ['lpc:backup:sage-demo:old:v1', 'lpc:config:backup:old:v1']);
  const kept = await (await request(tableUrl({ key: 'eq.lpc:backup:sage-demo:keep:v1' }))).json();
  assert.deepEqual(kept[0].value, {});

  const source = read('scripts/hero-freshness.mjs');
  const start = source.indexOf('const appDataRoute = async route => {');
  assert.ok(start >= 0);
  const callback = vm.runInNewContext(source.slice(start, source.indexOf('\n};', start) + 3) + ';appDataRoute;', { dockFixture: null, stamp: '2026-10-14T09:35:00Z', importStamp: null });
  let handle;
  const fx = await installRpcAdapter({ route: async (_, fn) => { handle = fn; }, request: { get: request } }, { appDataRoute: callback, log() {} });
  const readStore = async () => {
    let fulfilled = 0, aborted = 0, value;
    const url = ORIGIN + '/rest/v1/rpc/sage_store_read';
    await handle({ request: () => ({ method: () => 'POST', url: () => url, postData: () => '{"p_store":"sage-demo"}' }),
      fetch: () => request(url, 'POST', { p_store: 'sage-demo' }),
      fulfill: async ({ json }) => { fulfilled++; value = json; }, abort: async () => { aborted++; },
      fallback: async () => { throw Error('Unexpected fallback'); } });
    return { fulfilled, aborted, value };
  };
  const good = await readStore();
  assert.equal(good.fulfilled, 1);
  assert.equal(good.aborted, 0);
  assert.equal(good.value.activity['2026-10-14'].fictional.calls, 3);
  fx.assertNoRefusals();
  await saveShared(activityKey, null);
  const bad = await readStore();
  assert.equal(bad.fulfilled, 0);
  assert.equal(bad.aborted, 1);
  assert.equal(fx.refusals().counts['read-shape'], 1);
  assert.throws(() => fx.assertNoRefusals());
});

test('mock like handles current prefix queries, wildcard aliases, literals and null', async () => {
  const request = mock();
  for (const [pattern, yes, no] of [
    ['a.b%', 'a.b1', 'axb1'], ['a_b', 'acb', 'acdb'],
    ['abc*', 'abcdef', 'zabcdef'], ['x[y]%', 'x[y]z', 'xyz'],
  ]) {
    await request(tableUrl({}), 'POST', [{ key: yes, value: {} }, { key: no, value: {} }, { key: null, value: {} }]);
    const rows = await (await request(tableUrl({ key: 'like.' + pattern }))).json();
    assert.deepEqual(rows.map(row => row.key), [yes]);
  }
});
