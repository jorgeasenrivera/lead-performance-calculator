// Portable adaptation of evidence/typeonly-scratch-differential.test.mjs (that file is preserved unchanged). Exact minimal adaptation:
//  1. SUT is this repository's api/ (no SUT_DIR); 2. the 47757af scalar outcomes are frozen below as literals generated from the authenticated baseline module
//     (sha256 d41af8518fe8a5874dc9a734c516ea9fe0bd83bbaab83477328b44c1baf6025d), so no baseline copy is needed; 3. the live differential half runs only when BASE_DIR is given AND that
//     baseline module hashes to the value above (a mutable current tree is refused); otherwise it is skipped with a stated reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selfRoomCommand as sut } from '../api/_self-room-command.mjs';
const BASELINE_SHA = 'd41af8518fe8a5874dc9a734c516ea9fe0bd83bbaab83477328b44c1baf6025d';
let base = null, skipWhy = 'BASE_DIR not set (frozen baseline literals still checked)';
if (process.env.BASE_DIR) {
  const got = createHash('sha256').update(readFileSync(`${process.env.BASE_DIR}/_self-room-command.mjs`)).digest('hex');
  if (got !== BASELINE_SHA) throw new Error('BASE_DIR is not the authenticated 47757af baseline module: ' + got);
  base = (await import(`${process.env.BASE_DIR}/_self-room-command.mjs`)).selfRoomCommand; skipWhy = false;
}
const NOW = '2026-10-27T15:00:00.000Z';
const mkRow = () => ({ store:'alpha', date:'2026-10-27',
  roster:[{id:'p1',name:'Synthetic A',label:'A'},{id:'p2',name:'Synthetic B',label:'B'}],
  line:[{id:'p1',label:'A',status:'customer',statusAt:'t'},{id:'p2',label:'B',status:'waiting'}], history:[], goalNotes:[] });
const ALLOWED = [1, 2, '3', 'O1', 'O2'];
const call = (fn, o) => fn({ room:'floor', row:mkRow(), personId:'p1', now:NOW, config:{stores:[{id:'alpha'}]}, store:'alpha', allowedTables:ALLOWED, ...o });
const outcome = (fn, o) => { try { const r = call(fn, o); return { ok:true, row:r.row, changed:r.changed }; } catch (e) { return { ok:false, msg:e.message }; } };
const ACTIONS = [['table', t => ({ input:{ table:t } })], ['table-checkin', t => ({ input:{ table:t } })], ['assist', t => ({ input:{ kind:'to', table:t } })]];
const SCALARS = ['1', '2', '3', 'O1', 'O2', 'o1', '99', '', ' 1', '1 ', '01', '1.0', 1, 2, 3, 0, -0, 1.5, 99, 1e0, '1e0'];
const NONSCALARS = [['1'], [['2']], [1], ['O1'], [], [1, 2], {}, { a: 1 }, { toString: 'x' }, true, false];
const FROZEN = [["table", "s:1", {"ok": true, "type": "string", "v": "1"}], ["table", "s:2", {"ok": true, "type": "string", "v": "2"}], ["table", "s:3", {"ok": true, "type": "string", "v": "3"}], ["table", "s:O1", {"ok": true, "type": "string", "v": "O1"}], ["table", "s:O2", {"ok": true, "type": "string", "v": "O2"}], ["table", "s:o1", {"ok": false, "msg": "Unknown table"}], ["table", "s:99", {"ok": false, "msg": "Unknown table"}], ["table", "s:", {"ok": false, "msg": "Unknown table"}], ["table", "s: 1", {"ok": false, "msg": "Unknown table"}], ["table", "s:1 ", {"ok": false, "msg": "Unknown table"}], ["table", "s:01", {"ok": false, "msg": "Unknown table"}], ["table", "s:1.0", {"ok": false, "msg": "Unknown table"}], ["table", "n:1", {"ok": true, "type": "number", "v": "1"}], ["table", "n:2", {"ok": true, "type": "number", "v": "2"}], ["table", "n:3", {"ok": true, "type": "number", "v": "3"}], ["table", "n:0", {"ok": false, "msg": "Unknown table"}], ["table", "-0", {"ok": false, "msg": "Unknown table"}], ["table", "n:1.5", {"ok": false, "msg": "Unknown table"}], ["table", "n:99", {"ok": false, "msg": "Unknown table"}], ["table", "n:1", {"ok": true, "type": "number", "v": "1"}], ["table", "s:1e0", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:1", {"ok": true, "type": "string", "v": "1"}], ["table-checkin", "s:2", {"ok": true, "type": "string", "v": "2"}], ["table-checkin", "s:3", {"ok": true, "type": "string", "v": "3"}], ["table-checkin", "s:O1", {"ok": true, "type": "string", "v": "O1"}], ["table-checkin", "s:O2", {"ok": true, "type": "string", "v": "O2"}], ["table-checkin", "s:o1", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:99", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s: 1", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:1 ", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:01", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "s:1.0", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "n:1", {"ok": true, "type": "number", "v": "1"}], ["table-checkin", "n:2", {"ok": true, "type": "number", "v": "2"}], ["table-checkin", "n:3", {"ok": true, "type": "number", "v": "3"}], ["table-checkin", "n:0", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "-0", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "n:1.5", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "n:99", {"ok": false, "msg": "Unknown table"}], ["table-checkin", "n:1", {"ok": true, "type": "number", "v": "1"}], ["table-checkin", "s:1e0", {"ok": false, "msg": "Unknown table"}], ["assist", "s:1", {"ok": true, "type": "string", "v": "1"}], ["assist", "s:2", {"ok": true, "type": "string", "v": "2"}], ["assist", "s:3", {"ok": true, "type": "string", "v": "3"}], ["assist", "s:O1", {"ok": true, "type": "string", "v": "O1"}], ["assist", "s:O2", {"ok": true, "type": "string", "v": "O2"}], ["assist", "s:o1", {"ok": false, "msg": "Unknown table"}], ["assist", "s:99", {"ok": false, "msg": "Unknown table"}], ["assist", "s:", {"ok": false, "msg": "Unknown table"}], ["assist", "s: 1", {"ok": false, "msg": "Unknown table"}], ["assist", "s:1 ", {"ok": false, "msg": "Unknown table"}], ["assist", "s:01", {"ok": false, "msg": "Unknown table"}], ["assist", "s:1.0", {"ok": false, "msg": "Unknown table"}], ["assist", "n:1", {"ok": true, "type": "number", "v": "1"}], ["assist", "n:2", {"ok": true, "type": "number", "v": "2"}], ["assist", "n:3", {"ok": true, "type": "number", "v": "3"}], ["assist", "n:0", {"ok": false, "msg": "Unknown table"}], ["assist", "-0", {"ok": false, "msg": "Unknown table"}], ["assist", "n:1.5", {"ok": false, "msg": "Unknown table"}], ["assist", "n:99", {"ok": false, "msg": "Unknown table"}], ["assist", "n:1", {"ok": true, "type": "number", "v": "1"}], ["assist", "s:1e0", {"ok": false, "msg": "Unknown table"}]];
const decode = k => k === '-0' ? -0 : k.startsWith('n:') ? Number(k.slice(2)) : k.slice(2);
const stored = (action, row) => action === 'assist' ? row.assists[0].table : row.line[0].table;

for (const [action, mk] of ACTIONS) {
  test(`${action}: arrays, objects and booleans are refused with Unknown table`, () => {
    for (const t of NONSCALARS) {
      const o = outcome(sut, { action, ...mk(t) });
      assert.equal(o.ok, false, `${JSON.stringify(t)} was accepted`);
      assert.equal(o.msg, 'Unknown table');
    }
  });
  test(`${action}: scalar outcomes equal the frozen 47757af outcomes (accept, refuse, message, stored value and type)`, () => {
    const rows = FROZEN.filter(r => r[0] === action); assert.equal(rows.length, 21);
    for (const [, key, want] of rows) {
      const t = decode(key), o = outcome(sut, { action, ...mk(t) });
      assert.equal(o.ok, want.ok, `scalar ${key}`);
      if (!want.ok) assert.equal(o.msg, want.msg, `scalar ${key}`);
      else { const s = stored(action, o.row); assert.equal(typeof s, want.type, `scalar ${key}`); assert.equal(Object.is(s, -0) ? '-0' : String(s), want.v, `scalar ${key}`); }
    }
  });
  test(`${action}: scalar outcomes are identical to the live authenticated baseline`, { skip: skipWhy }, () => {
    for (const t of SCALARS) assert.deepEqual(outcome(sut, { action, ...mk(t) }), outcome(base, { action, ...mk(t) }), `scalar ${JSON.stringify(t)}`);
  });
}
test('accepted scalars are stored exactly as given, strict type preserved (no normalization)', () => {
  assert.equal(outcome(sut, { action:'table', input:{ table:'O1' } }).row.line[0].table, 'O1');
  assert.strictEqual(outcome(sut, { action:'table', input:{ table:2 } }).row.line[0].table, 2);
  assert.strictEqual(outcome(sut, { action:'assist', input:{ kind:'to', table:1 } }).row.assists[0].table, 1);
});
test('assist without a table (undefined or null) is still the lot', () => {
  for (const input of [{ kind:'to' }, { kind:'to', table:null }]) { const a = outcome(sut, { action:'assist', input }); assert.equal(a.ok, true); assert.equal(a.row.assists[0].spot, 'lot'); assert.equal(a.row.assists[0].table, null); }
});
test('table action with null or missing table is refused', () => {
  for (const input of [{ table:null }, {}]) { const o = outcome(sut, { action:'table', input }); assert.equal(o.ok, false); assert.equal(o.msg, 'Unknown table'); }
});
test('unchanged by this change: goal-note and history are NOT bounded here', () => {
  let r = mkRow();
  for (let i = 0; i < 250; i++) r = call(sut, { row:r, action:'goal-note', input:{ text:`n${i}`, forDay:'2026-10-27' } }).row;
  assert.equal(r.goalNotes.length, 250);
  r = mkRow(); r.line[0].status = 'waiting';
  for (let i = 0; i < 120; i++) { const o = call(sut, { row:r, action:'status', input:{ status: i % 2 ? 'waiting' : 'lunch' } }); if (o.changed) r = o.row; }
  assert.equal(r.history.length, 120);
});
