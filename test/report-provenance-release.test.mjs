import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMonths } from '../api/_month-intent.mjs';
import { isDeepStrictEqual } from '../api/_value-equality.mjs';

/* Release guards for the monthly report provenance boundary, written against
   what api/_month-intent.mjs and api/_value-equality.mjs already say about
   themselves. Nothing here sets a rule: no rounding, no whole-unit rule, no
   closed-month rule. Each test pins a distinction the source comments state,
   and that no other test reaches by calling reconcileMonths directly.
   Synthetic data only. */

const copy = v => structuredClone(v);
const M = '2026-05';
const base = () => ({
  __storeId: 'synthetic', rev: 1, roster: [],
  months: {
    [M]: { stats: { person: { internetUnits: 1, phoneUnits: 2, campaignUnits: 0.5 } }, imports: {}, names: { phone: ['one'] } },
    '2026-04': { stats: { person: { internetUnits: 7 } } },
  },
});
const person = d => d.months[M].stats.person;
const personOf = months => months[M].stats.person;
const frozen = (...docs) => JSON.stringify(docs);
const conflict = { code: 'MONTH_IMPORT_CONFLICT' };

test('value equality: no coercion of null, zero, units or absence; key order is irrelevant', () => {
  // The header of _value-equality.mjs promises exactly this, and every merge
  // decision in _month-intent.mjs rests on it.
  const distinct = [0, null, '', false, '0', undefined];
  for (const a of distinct) for (const b of distinct) {
    assert.equal(isDeepStrictEqual(a, b), a === b, `${String(a)} vs ${String(b)}`);
  }
  assert.equal(isDeepStrictEqual(0.5, 0.5), true);
  assert.equal(isDeepStrictEqual(0.5, 1), false);
  assert.equal(isDeepStrictEqual({ a: 0 }, { a: null }), false);
  assert.equal(isDeepStrictEqual({ a: 0 }, {}), false);
  assert.equal(isDeepStrictEqual({}, { a: 0 }), false, 'absence versus zero is not equal from either side');
  assert.equal(isDeepStrictEqual({}, { a: null }), false);
  assert.equal(isDeepStrictEqual({}, { a: undefined }), false);
  assert.equal(isDeepStrictEqual({ a: null }, {}), false);
  assert.equal(isDeepStrictEqual({ a: undefined }, {}), false, 'a present undefined is not absence');
  assert.equal(isDeepStrictEqual({ a: 1, b: 0.5 }, { b: 0.5, a: 1 }), true);
  assert.equal(isDeepStrictEqual([1, 2], [2, 1]), false, 'arrays are ordered values');
  assert.equal(isDeepStrictEqual([], {}), false);
});

test('reconcile output survives a JSON round trip with 0, null, absence and 0.5 kept distinct', () => {
  // Takes the per-key path: both sides changed something, so every key is
  // settled on its own. a: intended wins, b: current wins, c: unchanged
  // fraction, d: deleted by intent, e: present only on the server.
  const b = base();
  Object.assign(person(b), { a: 1, b: 1, c: 0.5, d: 5 });
  const n = copy(b), s = copy(b);
  person(n).a = 0; delete person(n).d;
  person(s).b = null; person(s).e = 0.5;
  const out = reconcileMonths(b, n, s);
  const settled = personOf(out);
  assert.equal(Object.is(settled.a, 0), true);
  assert.equal(settled.b, null);
  assert.equal(settled.c, 0.5);
  assert.equal(Object.hasOwn(settled, 'd'), false);
  assert.equal(settled.e, 0.5);
  const round = JSON.parse(JSON.stringify(out));
  assert.deepStrictEqual(round, out);
  assert.equal(Object.is(personOf(round).a, 0), true);
  assert.equal(personOf(round).b, null);
  assert.equal(personOf(round).c, 0.5);
  assert.equal(Object.hasOwn(personOf(round), 'd'), false);
  assert.equal(personOf(round).e, 0.5);
  assert.equal(Object.values(settled).includes(undefined), false, 'absence is omitted, never stored as undefined');
});

test('reconcile output shares nothing with baseline, intended or current on any return path', () => {
  const poke = out => {
    personOf(out).internetUnits = 'poked';
    out[M].names.phone.push('poked');
    out[M].imports.poked = true;
    out['2026-04'].stats.person.internetUnits = 'poked';
  };
  const paths = {
    // intended differs from baseline, server unchanged: the caller's value is taken
    intendedWins() { const b = base(), n = copy(b), s = copy(b); person(n).phoneUnits = 9; return [b, n, s]; },
    // caller unchanged, server moved on: the server's value is kept
    currentWins() { const b = base(), n = copy(b), s = copy(b); person(s).phoneUnits = 4; return [b, n, s]; },
    // both moved on different fields: settled key by key
    perKey() { const b = base(), n = copy(b), s = copy(b); person(n).phoneUnits = 9; person(s).internetUnits = 8; return [b, n, s]; },
  };
  for (const [name, make] of Object.entries(paths)) {
    const [b, n, s] = make();
    const before = frozen(b, n, s);
    const out = reconcileMonths(b, n, s);
    assert.equal(frozen(b, n, s), before, `${name}: inputs unchanged by the call`);
    poke(out);
    assert.equal(frozen(b, n, s), before, `${name}: mutating the result must not reach an input`);
  }
  // No current row at all: "created" months are a copy of the intent.
  const n = base(), before = frozen(n);
  const created = reconcileMonths(null, n, null);
  assert.deepStrictEqual(created, n.months);
  poke(created);
  assert.equal(frozen(n), before, 'created months: mutating the result must not reach the intent');
  const b = base(), kept = base();
  const again = reconcileMonths(b, kept, null, [], { rowAbsentAtLoad: true });
  poke(again);
  assert.equal(frozen(b, kept), frozen(base(), base()), 'authoritative no-row: result is still a copy');
});

test('a changed store identity refuses the save, whichever side moved', () => {
  const b = base();
  const n = copy(b); n.__storeId = 'other';
  assert.throws(() => reconcileMonths(b, n, copy(b)), conflict);
  const s = copy(b); s.__storeId = 'other';
  assert.throws(() => reconcileMonths(b, copy(b), s), conflict);
});

test('a malformed reported-field mask is refused when the current row exists', () => {
  // A mask that silently matched nothing would let an import skip the
  // "reported value has another change" check. The mask is only read after the
  // no-row early return in reconcileMonths, so this pins the existing-row path
  // only and says nothing about what a no-row save does with a mask.
  const b = base(), n = copy(b), s = copy(b);
  for (const mask of [[[]], [['2026-05', 7]], [['2026-05', null]], ['2026-05'], [null]]) {
    assert.throws(() => reconcileMonths(b, n, s, mask), conflict, JSON.stringify(mask));
  }
});

test('reportInputs is one snapshot: a one-sided change is taken whole, two independent changes refuse', () => {
  // Same rule as stated in _month-intent.mjs: never pair pieces of two
  // different observations. month-intent.test.mjs pins this for stated only.
  const withInputs = () => { const d = base(); d.months[M].reportInputs = { file: 'a.csv', at: 'old', rows: { person: 1 } }; return d; };
  const b = withInputs(), n = copy(b), s = copy(b);
  n.months[M].reportInputs.at = 'new';
  const before = frozen(b, n, s);
  const taken = reconcileMonths(b, n, s);
  assert.deepStrictEqual(taken[M].reportInputs, { file: 'a.csv', at: 'new', rows: { person: 1 } });
  taken[M].reportInputs.rows.person = 'poked';
  assert.equal(frozen(b, n, s), before, 'the snapshot taken from the intent is a copy');

  const s2 = copy(b); s2.months[M].reportInputs.rows.person = 2;
  const beforeRefusal = frozen(b, n, s2);
  assert.throws(() => reconcileMonths(b, n, s2), conflict);
  assert.equal(frozen(b, n, s2), beforeRefusal, 'refusal leaves the inputs as they were');
});

test('reportInputs is taken whole even when the server changed an unrelated field, so the per-key walk is exercised', () => {
  // The test above leaves the server equal to the baseline, which returns the
  // intent for the whole month at once (rule 2 at the top of reconcile) and
  // never reaches the per-key walk. Here the server also moved stats.person.a,
  // so the month is settled key by key and reportInputs must still arrive as
  // one unmodified snapshot next to the server's value.
  const withInputs = () => {
    const d = base();
    d.months[M].stats.person.a = 1;
    d.months[M].reportInputs = { file: 'a.csv', at: 'old', rows: { person: 1 } };
    return d;
  };
  const b = withInputs(), n = copy(b), s = copy(b);
  n.months[M].reportInputs.at = 'new';
  person(s).a = 9;
  const before = frozen(b, n, s);
  const out = reconcileMonths(b, n, s);
  assert.deepStrictEqual(out[M].reportInputs, { file: 'a.csv', at: 'new', rows: { person: 1 } });
  assert.equal(personOf(out).a, 9, 'the server change to a different field is kept');
  assert.equal(personOf(out).phoneUnits, 2, 'untouched fields are unchanged');
  out[M].reportInputs.rows.person = 'poked';
  personOf(out).a = 'poked';
  assert.equal(frozen(b, n, s), before, 'neither the snapshot nor the merged field shares a reference with an input');
});

test('a field the intent adds keeps 0, null and 0.5 per key when baseline and current lack it', () => {
  // Server also moves another field, so this goes through the per-key walk and
  // not the whole-month shortcut. z is absent from baseline and current.
  for (const z of [0, null, 0.5]) {
    const b = base(), n = copy(b), s = copy(b);
    person(n).z = z;
    person(s).internetUnits = 8;
    const out = reconcileMonths(b, n, s);
    assert.equal(Object.hasOwn(personOf(out), 'z'), true, `z=${z} is present, not treated as absence`);
    assert.equal(Object.is(personOf(out).z, z), true, `z=${z}`);
    assert.equal(personOf(out).internetUnits, 8, `z=${z}: the server change is kept`);
    assert.equal(personOf(out).campaignUnits, 0.5);
    const round = JSON.parse(JSON.stringify(out));
    assert.deepStrictEqual(round, out, `z=${z} survives a JSON round trip`);
    assert.equal(Object.is(personOf(round).z, z), true);
  }
});
