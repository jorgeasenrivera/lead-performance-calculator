import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { accountIsActive, staffMayUse } from '../api/_floor-access.mjs';

// Synthetic inputs only. The real SDK runs, but every request ends here.
process.env.SUPABASE_URL = 'https://authorization.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
process.env.SUPABASE_ANON_KEY = 'synthetic-anon';
const manager = { active: true, role: 'manager', stores: ['alpha'], pending: false };
let state;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const project = (row, select) => Object.fromEntries(select.split(',').map(k => k.trim()).filter(k => k in row).map(k => [k, row[k]]));
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://authorization.invalid');
  const method = (options.method || 'GET').toUpperCase();
  const request = { url, method, body: options.body ? JSON.parse(options.body) : null };
  state.requests.push(request);
  if (method !== 'GET') state.writes.push(request);
  if (url.pathname === '/auth/v1/user') {
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-session');
    return state.session ? json({ id: 'actor' }) : json({ message: 'invalid session' }, 401);
  }
  if (url.pathname === '/auth/v1/admin/users') return json({ users: [] });
  const table = url.pathname.replace('/rest/v1/', '');
  const q = url.searchParams;
  if (table === 'profiles' && method === 'GET') {
    const actor = q.get('id') === 'eq.actor';
    assert.ok(actor || q.get('id') === 'eq.target');
    if ((actor && state.profileError) || (!actor && state.targetError)) return json({ message: 'synthetic read failure' }, 500);
    const p = actor ? state.profile : state.target;
    return json(p ? [project(p, q.get('select'))] : []);
  }
  if (table === 'floor_people' && method === 'GET') {
    if (state.linkError) return json({ message: 'synthetic link failure' }, 500);
    return json(state.links.filter(l => (!q.has('user_id') || q.get('user_id') === `eq.${l.user_id}`)
      && q.get('store') === `eq.${l.store}`));
  }
  if (table === 'device_tokens' && method === 'GET') return json([]);
  if (table === 'app_data' && method === 'GET') return json([{ value: { stores: [{ id: 'alpha', stationMode: 'open', stationPlan: { seats: [{ n: '1', x: 1, y: 1 }] } }] } }]);
  if (['floor_public', 'queue_public'].includes(table)) {
    assert.equal(q.get('id'), 'eq.alpha:2026-10-24');
    if (method === 'GET') return json([{ data: state.row, updated_at: '2026-10-24T00:00:00Z' }]);
    if (method === 'PATCH') {
      assert.equal(q.get('updated_at'), 'eq.2026-10-24T00:00:00Z');
      return json([{ id: 'alpha:2026-10-24' }]);
    }
  }
  if (['profiles', 'floor_people', 'device_tokens', 'deal_events'].includes(table) && ['POST', 'PATCH', 'DELETE'].includes(method)) return json([]);
  assert.fail(`Unexpected synthetic request: ${method} ${url.pathname}`);
};
const { default: account } = await import('../api/floor-account.mjs');
const { default: link } = await import('../api/link-person.mjs');
const { default: queue } = await import('../api/queue-action.mjs');
const { default: device } = await import('../api/register-device.mjs');
const { default: ingest } = await import('../api/ingest-deal-event.js');
beforeEach(() => {
  state = { profile: { ...manager }, target: { role: 'manager' }, session: true, requests: [], writes: [],
    links: [{ user_id: 'actor', store: 'alpha', person_id: 'self' }, { user_id: 'target', store: 'alpha', person_id: 'other' }],
    row: { line: [{ id: 'self', label: 'Synthetic A', status: 'waiting' }, { id: 'other', label: 'Synthetic B', status: 'waiting' }], history: [] } };
  process.env.INGEST_SHARED_SECRET = 'synthetic-ingest';
});
async function call(fn, body, { method = 'POST', headers = { authorization: 'Bearer synthetic-session' } } = {}) {
  const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await fn({ method, headers, body, url: '/api/link-person?store=alpha' }, res);
  return res;
}
const operations = [
  ['account deactivate', account, { store: 'alpha', user_id: 'target', action: 'deactivate' }, true],
  ['account activate', account, { store: 'alpha', user_id: 'target', action: 'activate' }, true],
  ['link', link, { store: 'alpha', user_id: 'new-target', person_id: 'new-person' }, true],
  ['unlink', link, { store: 'alpha', user_id: 'target', unlink: true }, true],
  ['link read', link, {}, true, { method: 'GET' }],
  ['floor action', queue, { store: 'alpha', date: '2026-10-24', action: 'lunch', person_id: 'other' }, false],
  ['phone action', queue, { store: 'alpha', date: '2026-10-24', action: 'take-desk' }, false],
  ['device', device, { store: 'alpha', platform: 'ios', device_id: 'synthetic-device', person_id: 'other', apns_token: 'synthetic-token' }, false],
];
for (const [name, fn, body, management, options] of operations) {
  for (const [label, profile, status] of [
    ['inactive', { ...manager, active: false }, 403], ['missing profile', null, 403],
    ['missing active flag', { role: 'admin', stores: ['alpha'] }, 403],
    ['null active flag', { ...manager, active: null }, 403],
    ['profile lookup failed', manager, 500],
  ]) test(`${name}: ${label} refuses before any backend mutation`, async () => {
    state.profile = profile; state.profileError = status === 500;
    const res = await call(fn, { ...body, active: true, role: 'admin', stores: ['alpha'] }, options);
    assert.equal(res.statusCode, status);
    assert.equal(state.writes.length, 0);
    assert.ok(!state.requests.some(r => r.url.pathname === '/rest/v1/floor_people'), 'stop before link or operational reads');
  });
  test(`${name}: invalid session refuses before profile lookup`, async () => {
    state.session = false;
    assert.equal((await call(fn, body, options)).statusCode, 401);
    assert.equal(state.writes.length, 0);
    assert.equal(state.requests.length, 1);
  });
  if (management) {
    for (const [label, profile] of [['foreign store', { ...manager, stores: ['bravo'] }], ['BDC overseer', { ...manager, role: 'overseer' }], ['unknown role', { ...manager, role: 'salesperson' }], ['linked-only', { ...manager, stores: [] }]]) {
      test(`${name}: ${label} cannot administer accounts`, async () => {
        state.profile = profile;
        assert.equal((await call(fn, body, options)).statusCode, 403);
        assert.equal(state.writes.length, 0);
      });
    }
    for (const [label, profile] of [['manager', manager], ['admin', { ...manager, role: 'admin', stores: [] }], ['pending manager unchanged', { ...manager, pending: true }]]) {
      test(`${name}: active ${label} retains scoped access`, async () => {
        state.profile = profile;
        assert.equal((await call(fn, body, options)).statusCode, 200);
        assert.equal(state.writes.length > 0, name !== 'link read');
      });
    }
  } else {
    test(`${name}: foreign-store link cannot authorize self-action`, async () => {
      state.links = [{ user_id: 'actor', store: 'bravo', person_id: 'self' }];
      assert.equal((await call(fn, body, options)).statusCode, 403);
      assert.equal(state.writes.length, 0);
    });
    test(`${name}: failed link lookup cannot authorize self-action`, async () => {
      state.linkError = true;
      assert.equal((await call(fn, body, options)).statusCode, 500);
      assert.equal(state.writes.length, 0);
    });
  }
}
for (const pending of [false, true]) {
  for (const [name, fn, body] of [operations[5], operations[7]]) test(`${name}: active linked pending=${pending} uses server identity`, async () => {
    state.profile = { ...manager, stores: [], pending };
    assert.equal((await call(fn, body)).statusCode, 200);
    const write = state.writes[0].body;
    if (fn === device) assert.equal(write.person_id, 'self');
    else {
      assert.equal(write.data.line[0].status, 'lunch');
      assert.equal(write.data.line[1].status, 'waiting');
    }
  });
}
for (const kind of ['missing', 'failed', 'admin', 'overseer', 'unlinked', 'link failure']) test(`account target ${kind}: refuses without mutation`, async () => {
  if (kind === 'missing') state.target = null;
  if (kind === 'failed') state.targetError = true;
  if (kind === 'admin' || kind === 'overseer') state.target = { role: kind };
  if (kind === 'unlinked') state.links = [];
  if (kind === 'link failure') state.linkError = true;
  assert.equal((await call(account, operations[0][2])).statusCode, ['failed', 'link failure'].includes(kind) ? 500 : 403);
  assert.equal(state.writes.length, 0);
});
for (const [label, secret, header, expected] of [
  ['both absent', undefined, undefined, 503], ['empty', '', '', 503], ['whitespace', '   ', '   ', 503],
  ['absent with header', undefined, 'value', 503], ['header missing', 'value', undefined, 401],
  ['wrong', 'value', 'wrong', 401], ['array', 'value', ['value'], 401], ['correct', 'value', 'value', 200],
]) test(`ingest secret ${label}`, async () => {
  if (secret === undefined) delete process.env.INGEST_SHARED_SECRET; else process.env.INGEST_SHARED_SECRET = secret;
  const headers = header === undefined ? {} : { 'x-ingest-secret': header };
  assert.equal((await call(ingest, { subject: 'Synthetic event - Synthetic alert - Alpha' }, { headers })).statusCode, expected);
  assert.equal(state.writes.length, expected === 200 ? 1 : 0);
  if (expected !== 200) assert.equal(state.requests.length, 0);
});
test('server floor access fails closed on malformed active flag, preserving pending linked staff', () => {
  for (const active of [undefined, null, false, 'true', 1]) {
    assert.equal(accountIsActive({ active }), false);
    assert.equal(staffMayUse({ profile: { ...manager, active }, linkedStores: ['alpha'] }, 'alpha'), false);
  }
  assert.equal(staffMayUse({ profile: { ...manager, pending: true }, linkedStores: ['alpha'] }, 'alpha'), true);
  assert.equal(staffMayUse({ profile: { ...manager, pending: true } }, 'alpha'), false);
});

for (const pending of [false, true]) test(`phone take-desk: active linked pending=${pending} uses server identity`, async () => {
  state.profile = { ...manager, stores: [], pending };
  const result = await call(queue, { ...operations[6][2], person_id: 'other', desk: '1' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.changed, true);
  assert.equal(state.writes.length, 1);
  const write = state.writes[0];
  assert.equal(write.url.pathname, '/rest/v1/queue_public');
  assert.equal(write.body.data.stations['1'].id, 'self');
  assert.equal(write.body.data.line.find(p => p.id === 'other').status, 'waiting');
});
