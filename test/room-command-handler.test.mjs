// Actual api/room-command.mjs handler, in-process, fake db only (the SDK import is the only thing mocked, through test/support/). Portable adaptation of the independently reviewed unit5 test
// (handler.tgz sha256 a5792bb59d959ca701f5314e7a0d0572f27ca02646eeaa07c7f28a5d6266f3c2; its original is preserved unchanged). Exact adaptation:
//  1. SUT is this repository's api/ (no SUT_DIR). The SDK mock is registered from here instead of `node --import`. No trace file is written.
//  2. ALWAYS asserted, no baseline needed: a malformed (array/object/boolean) table is HTTP 400 'Unknown table' after the receipt LOOKUP, with no commit and no direct write; a valid scalar table
//     is 200 with exactly one expected commit (actor, person, store, room, date, p_expected stamp with microseconds, p_request, strict stored type) and no direct write.
//  3. The differential half (valid and unknown scalars identical to the 47757af handler) runs ONLY when BASE_DIR names an api/ directory whose whole file set matches the digest below
//     (a mutable or different tree is refused with an error); otherwise those tests are skipped with a stated reason. The baseline tree is not vendored.
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { register } from 'node:module';
const BASELINE_API_FILES = 49, BASELINE_API_DIGEST = '7eebf550461d7cb29003558a1f6f592ce607d4326fb48193faf2ea002f0e4096';   // the 47757af api/ directory
function apiDigest(dir) {
  const out = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else out.push(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + '  ' + r); } })(dir, '');
  out.sort();
  return { n: out.length, d: crypto.createHash('sha256').update(out.join('\n') + '\n').digest('hex') };
}
let BASE = null, skipDifferential = 'BASE_DIR not set: the live comparison with the 47757af handler is skipped (the always-on assertions below still run)';
if (process.env.BASE_DIR) {
  const got = apiDigest(process.env.BASE_DIR);
  if (got.n !== BASELINE_API_FILES || got.d !== BASELINE_API_DIGEST) throw new Error('BASE_DIR is not the authenticated 47757af api/ directory: ' + got.n + ' files, ' + got.d);
  BASE = process.env.BASE_DIR; skipDifferential = false;
}
register('./support/room-command-hooks.mjs', import.meta.url);
process.env.SUPABASE_URL = 'https://synthetic.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
process.env.SUPABASE_ANON_KEY = 'synthetic-anon';
const sutHandler = (await import('../api/room-command.mjs')).default;
const baseHandler = BASE ? (await import(`${BASE}/room-command.mjs`)).default : null;
const NOW = '2026-10-27T15:00:00.000Z', DAY = '2026-10-27', STAMP = '2026-10-27T14:59:00.123456+00:00';
before(() => mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) }));
after(() => { mock.timers.reset(); });
const roomRow = () => ({ store:'alpha', date:DAY,
  roster:[{id:'p1',name:'Synthetic A',label:'A'},{id:'p2',name:'Synthetic B',label:'B'}],
  line:[{id:'p1',label:'A',status:'customer',statusAt:'2026-10-27T14:00:00Z'},{id:'p2',label:'B',status:'waiting',statusAt:'2026-10-27T14:01:00Z'}],
  history:[], goalNotes:[] });
const CONFIG = { stores:[{ id:'alpha', floorPlan:{ tables:[{n:1},{n:2},{n:'3'},{n:'O1'}] } }] };

function fakeDb(log) {
  const builder = (table) => {
    const f = {}; const b = {
      select: () => b, eq: (k, v) => { f[k] = v; return b; },
      maybeSingle: async () => {
        log.push({ op:'read', table, filters:{ ...f } });
        if (table === 'profiles' && f.id === 'actor-1') return { data:{ active:true }, error:null };
        if (table === 'floor_people' && f.store === 'alpha' && f.user_id === 'actor-1') return { data:{ person_id:'p1' }, error:null };
        if (table === 'app_data' && f.key === 'lpc:config:v2') return { data:{ value:CONFIG }, error:null };
        if (table === 'floor_public' && f.id === `alpha:${DAY}` && f.store === 'alpha' && f.fdate === DAY) return { data:{ data:roomRow(), updated_at:STAMP }, error:null };
        return { data:null, error:null };
      },
    };
    for (const w of ['insert', 'update', 'upsert', 'delete']) b[w] = () => { log.push({ op:'WRITE', verb:w, table }); return b; };
    return b;
  };
  return {
    auth: { getUser: async (t) => { log.push({ op:'auth.getUser' }); return t === 'synthetic-session' ? { data:{ user:{ id:'actor-1' } }, error:null } : { data:null, error:{ message:'bad token' } }; } },
    from: builder,
    rpc: async (name, args) => {
      log.push({ op:'rpc', name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'sage_room_receipt') return { data:null, error:null };
      if (name === 'sage_room_commit') return { data:{ ok:true, row:args.p_next }, error:null };
      return { data:null, error:{ code:'XX000', message:'unexpected rpc' } };
    },
  };
}
async function run(handler, body) {
  const log = []; globalThis.__FAKE_DB = fakeDb(log);
  const res = { statusCode:0, status(c){ this.statusCode = c; return this; }, json(v){ this.body = v; return this; } };
  await handler({ method:'POST', headers:{ authorization:'Bearer synthetic-session' }, body }, res);
  globalThis.__FAKE_DB = undefined;
  return { status: res.statusCode, body: res.body, log };
}
const req = (action, input, n = 1) => ({ store:'alpha', room:'floor', date:DAY, action, input, operationId:`00000000-0000-4000-8000-00000000000${n}` });
const names = (log) => log.map(e => e.op === 'rpc' ? `rpc:${e.name}` : e.op === 'read' ? `read:${e.table}` : e.op === 'WRITE' ? `WRITE:${e.verb}:${e.table}` : e.op);
const REJECT_EXPECTED_SEQUENCE = ['auth.getUser', 'read:profiles', 'read:floor_people', 'rpc:sage_room_receipt', 'read:app_data', 'read:floor_public'];

const NONSCALAR = [['1'], [['2']], [], [1, 2], {}, { a: 1 }, true, false];
for (const [action, mk] of [['table', t => ({ table:t })], ['table-checkin', t => ({ table:t })], ['assist', t => ({ kind:'to', table:t })]]) {
  test(`${action}: array/object/boolean table => HTTP 400 Unknown table; no commit, no write, no CAS/audit/receipt-insert dispatch`, async () => {
    for (const t of NONSCALAR) {
      const r = await run(sutHandler, req(action, mk(t)));
      assert.equal(r.status, 400, `${JSON.stringify(t)} => ${r.status}`);
      assert.equal(r.body.error, 'Unknown table');
      assert.deepEqual(names(r.log), REJECT_EXPECTED_SEQUENCE, `unexpected dispatch for ${JSON.stringify(t)}: ${names(r.log)}`);
      assert.equal(r.log.filter(e => e.op === 'WRITE').length, 0);
      assert.equal(r.log.filter(e => e.op === 'rpc' && e.name === 'sage_room_commit').length, 0);
    }
  });
}
for (const [action, mk] of [['table', t => ({ table:t })], ['table-checkin', t => ({ table:t })], ['assist', t => ({ kind:'to', table:t })]]) {
  test(`${action}: valid scalar table => 200 with exactly one expected commit and no direct write (local invariants, no baseline)`, async () => {
    for (const t of ['O1', '3', 1, 2]) {
      const r = await run(sutHandler, req(action, mk(t)));
      assert.equal(r.status, 200); assert.equal(r.body.ok, true);
      const commits = r.log.filter(e => e.op === 'rpc' && e.name === 'sage_room_commit');
      assert.equal(commits.length, 1);
      const a = commits[0].args;
      assert.equal(a.p_actor, 'actor-1'); assert.equal(a.p_person, 'p1'); assert.equal(a.p_store, 'alpha');
      assert.equal(a.p_room, 'floor'); assert.equal(a.p_date, DAY); assert.equal(a.p_expected, STAMP);
      assert.deepEqual(a.p_request, { action, input: mk(t) });
      const stored = action === 'assist' ? a.p_next.assists[0].table : a.p_next.line[0].table;
      assert.strictEqual(stored, t, 'accepted value must be stored with its original type');
      assert.deepEqual(names(r.log), [...REJECT_EXPECTED_SEQUENCE, 'rpc:sage_room_commit']);
      assert.equal(r.log.filter(e => e.op === 'WRITE').length, 0);
    }
  });
  test(`${action}: valid scalar table is identical to the authenticated 47757af handler`, { skip: skipDifferential }, async () => {
    for (const t of ['O1', '3', 1, 2]) {
      const r = await run(sutHandler, req(action, mk(t))), b = await run(baseHandler, req(action, mk(t)));
      assert.deepEqual({ status:r.status, body:r.body, log:r.log }, { status:b.status, body:b.body, log:b.log }, `scalar ${JSON.stringify(t)} differs from baseline handler`);
    }
  });
}
test('unknown scalar table => 400 Unknown table, receipt lookup only, no commit and no write', async () => {
  for (const t of ['99', 'o1', ' 1']) {
    const r = await run(sutHandler, req('table', { table:t }));
    assert.equal(r.status, 400); assert.equal(r.body.error, 'Unknown table'); assert.deepEqual(names(r.log), REJECT_EXPECTED_SEQUENCE);
    assert.equal(r.log.filter(e => e.op === 'WRITE').length, 0); assert.equal(r.log.filter(e => e.op === 'rpc' && e.name === 'sage_room_commit').length, 0);
  }
});
test('unknown scalar table is identical to the authenticated 47757af handler', { skip: skipDifferential }, async () => {
  for (const t of ['99', 'o1', ' 1']) {
    const r = await run(sutHandler, req('table', { table:t })), b = await run(baseHandler, req('table', { table:t }));
    assert.deepEqual({ status:r.status, body:r.body, log:r.log }, { status:b.status, body:b.body, log:b.log });
  }
});
