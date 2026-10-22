import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDraft, serializeVersion, persistable, LOCAL_ONLY_KEYS } from './serialize.mjs';
import { canonicalize, MAX_ENVELOPE_CHARS } from './envelope.mjs';
import { deserializeVersion } from './deserialize.mjs';

// Synthetic fixture. Copied into each test file because the persistence tests
// may not share a helper module; keep the copies identical.
const clone = value => JSON.parse(JSON.stringify(value));
const shift = (day, over = {}) => ({ storeId: 'cedar', personId: 'a', date: day, endDate: day, startMinute: 540, endMinute: 1020, timezone: 'America/New_York', ...over });
const makeDraft = (over = {}) => ({
  storeId: 'cedar', month: '2026-10',
  store: {
    people: [
      { id: 'a', name: 'Alex', start: 9, end: 17, off: [], maxHours: 40 },
      { id: 'b', name: 'Blair', start: 9, end: 17, off: [0], maxHours: 40 },
    ],
    rules: [{ effective: '2014-01-01', open: 9, close: 17, minimum: 1, capacity: 8, useCapacity: false, closedDays: [0], holidays: { '2026-11-26': 'closed' } }],
    teams: [{ id: 'oak', name: 'Oak team' }],
    memberships: [
      { storeId: 'cedar', personId: 'a', teamIds: ['oak'], from: '2014-01-01', to: '2100-12-31', unknown: false, source: { kind: 'fictional default' } },
      { storeId: 'cedar', personId: 'b', teamIds: [], from: '2014-01-01', to: '2100-12-31', unknown: true },
    ],
  },
  overrides: {
    '2026-10-05': { on: ['a'], off: ['b'], shifts: [shift('2026-10-05')], absences: { b: { kind: 'off', source: { kind: 'manager day edit' } } } },
  },
  ...over,
});
const ACTOR = { id: 'manager-1' };
const AT = '2026-10-18T09:00:00Z';

const codes = result => result.problems.map(p => p.code);
const save = (draft = makeDraft(), over = {}) => serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft, ...over });

test('serializes a valid draft to canonical text', () => {
  const result = save();
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.text, canonicalize(result.envelope).text);
  assert.equal(result.envelope.kind, 'draft');
  assert.equal(result.envelope.rev, 1);
  assert.deepEqual(result.envelope.meta, {});
});

test('the same data in a different key order gives identical text', () => {
  const a = makeDraft();
  const b = { overrides: clone(a.overrides), store: { memberships: clone(a.store.memberships), teams: clone(a.store.teams), rules: clone(a.store.rules), people: clone(a.store.people) }, month: a.month, storeId: a.storeId };
  assert.equal(save(a).text, save(b).text);
});

test('review state is never stored', () => {
  assert.deepEqual([...LOCAL_ONLY_KEYS].sort(), ['accepted', 'reviewFingerprint']);
  const draft = { ...makeDraft(), accepted: true, reviewFingerprint: '[{"day":"2026-10-01"}]' };
  assert.deepEqual(Object.keys(persistable(draft)).sort(), ['month', 'overrides', 'store', 'storeId']);
  const result = save(draft);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.doesNotMatch(result.text, /accepted|reviewFingerprint/);
  assert.equal(result.text, save(makeDraft()).text, 'a reviewed and an unreviewed draft store identically');
});

test('any other unknown field is refused rather than dropped', () => {
  const result = save({ ...makeDraft(), actor: { id: 'someone' } });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('unknown-key'));
});

test('the stored form shares no state with the live draft', () => {
  const draft = makeDraft(), result = save(draft), snapshot = result.text;
  draft.store.people[0].name = 'Changed';
  draft.overrides['2026-10-05'].on.push('b');
  assert.equal(canonicalize(result.envelope).text, snapshot, 'the stored text did not move when the live draft did');
  assert.equal(result.envelope.payload.store.people[0].name, 'Alex');
  assert.notEqual(result.envelope.payload, draft);
});

test('does not change the draft it is given', () => {
  const draft = { ...makeDraft(), accepted: true }, before = clone(draft);
  save(draft);
  assert.deepEqual(draft, before);
});

test('layered membership order is kept and reported as a warning', () => {
  const draft = makeDraft();
  draft.store.teams.push({ id: 'pine', name: 'Pine team' });
  const early = { storeId: 'cedar', personId: 'a', teamIds: ['oak'], from: '2026-10-05', to: '2026-10-05' };
  const late = { storeId: 'cedar', personId: 'a', teamIds: ['pine'], from: '2026-10-05', to: '2026-10-05' };
  draft.store.memberships.push(early, late);
  const forward = save(draft);
  assert.deepEqual(forward.warnings.map(w => w.code), ['membership-order-significant']);
  const tail = forward.envelope.payload.store.memberships.slice(-2).map(m => m.teamIds[0]);
  assert.deepEqual(tail, ['oak', 'pine'], 'not sorted, not de-duplicated');
  const swapped = makeDraft();
  swapped.store.teams.push({ id: 'pine', name: 'Pine team' });
  swapped.store.memberships.push(late, early);
  assert.notEqual(save(swapped).text, forward.text, 'order is meaning, so a different order is a different version');
});

test('refuses an invalid draft and says why', () => {
  const draft = makeDraft();
  draft.overrides['2026-10-99'] = { on: ['zzz'], off: [] };
  const result = save(draft);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('day-outside-month'));
});

test('refuses a draft whose store or month is not the one being saved', () => {
  assert.ok(codes(save(makeDraft(), { storeId: 'elm' })).includes('identity-mismatch'));
  assert.ok(codes(save(makeDraft(), { month: '2026-11' })).includes('identity-mismatch'));
  assert.ok(codes(save(makeDraft(), { storeId: 'Cedar' })).includes('bad-store-id'));
  assert.ok(codes(save(makeDraft(), { month: '2026-13' })).includes('bad-month'));
});

test('refuses a bad revision or kind', () => {
  assert.ok(codes(save(makeDraft(), { rev: 0 })).includes('bad-rev'));
  assert.ok(codes(serializeVersion({ kind: 'other', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft() })).includes('bad-kind'));
  assert.equal(serializeVersion(undefined).ok, false);
});

test('refuses meta that is not plain JSON, including a cycle', () => {
  const cycle = {}; cycle.self = cycle;
  assert.equal(serializeVersion({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta: cycle }).ok, false);
  assert.equal(serializeVersion({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta: { resetFrom: 1n } }).ok, false);
});

test('refuses a version over the size limit', () => {
  const draft = makeDraft();
  draft.overrides['2026-10-05'].shifts[0].source = { note: 'x'.repeat(MAX_ENVELOPE_CHARS) };
  assert.deepEqual(codes(save(draft)), ['too-large']);
});

test('serializes a published version with its meta', () => {
  const result = serializeVersion({ kind: 'published', storeId: 'cedar', month: '2026-10', rev: 2, draft: makeDraft(), meta: { sourceDraftRev: 3, supersedes: 1, reviewDigest: 'b'.repeat(16), adjacent: { prev: 0, next: 2 } } });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.envelope.kind, 'published');
  assert.equal(result.envelope.meta.supersedes, 1);
});

test('uses the sealer it is given', () => {
  const sealer = { alg: 'test-sum', digest: () => 'f'.repeat(16) };
  const result = serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft() }, sealer);
  assert.deepEqual(result.envelope.hash, { alg: 'test-sum', value: 'f'.repeat(16) });
});

// ---- Review round 1 (F2, L3): what is checked is what is stored and what is read back ----

const HOOKED = [
  ['an array with a serialization hook', d => { d.store.people.toJSON = () => [{ id: 'ghost' }]; return d; }],
  ['an array with a hidden hook', d => { Object.defineProperty(d.store.teams, 'toJSON', { value: () => [], enumerable: false }); return d; }],
  ['an object with a hook', d => { d.store.people[0].toJSON = () => ({ id: 'ghost' }); return d; }],
  ['a getter that answers differently each time', d => { let n = 0; Object.defineProperty(d.store.people[0], 'name', { get: () => (n++ ? 'second read' : 'Alex'), enumerable: true }); return d; }],
  ['a symbol key', d => { d.store.people[0][Symbol('x')] = 1; return d; }],
  ['a hook on a record list', d => { d.overrides['2026-10-05'].on.toJSON = () => []; return d; }],
  ['a hook inside a shift source', d => { d.overrides['2026-10-05'].shifts[0].source = { list: Object.assign([1], { toJSON: () => [] }) }; return d; }],
  ['a root that is a class instance', d => Object.assign(new (class Draft {})(), d)],
  ['a root whose prototype carries a hook', d => Object.setPrototypeOf(d, { toJSON: () => ({}) })],
];
for (const [name, make] of HOOKED) {
  test(`refuses ${name}, and anything it does accept reads back`, () => {
    const result = save(make(makeDraft()));
    if (result.ok) assert.equal(deserializeVersion(result.text, { storeId: 'cedar', month: '2026-10' }).ok, true, 'a serialized draft must always be readable');
    else assert.ok(result.problems.length > 0);
    assert.equal(result.ok, false, 'these are refused outright');
  });
}

test('a Proxy cannot make the stored form differ from what was validated', () => {
  const draft = makeDraft(); let asked = 0;
  const proxied = new Proxy(draft, { getOwnPropertyDescriptor(target, key) { const d = Reflect.getOwnPropertyDescriptor(target, key); if (key === 'overrides') { asked++; return { ...d, value: asked === 1 ? d.value : { '2026-10-99': {} } }; } return d; } });
  const result = save(proxied);
  assert.equal(asked, 1, 'each property is read once');
  if (result.ok) assert.equal(deserializeVersion(result.text, { storeId: 'cedar', month: '2026-10' }).ok, true);
});

test('every successful serialization reads back, for plain, null-prototype and frozen drafts alike', () => {
  const frozen = JSON.parse(JSON.stringify(makeDraft())); (function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } })(frozen);
  const nullProto = Object.assign(Object.create(null), makeDraft());
  for (const draft of [makeDraft(), frozen, nullProto]) {
    const result = save(draft);
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    const read = deserializeVersion(result.text, { storeId: 'cedar', month: '2026-10' });
    assert.equal(read.ok, true, JSON.stringify(read.problems));
    assert.equal(save(read.draft).text, result.text, 'and writes back to the same bytes');
  }
});

test('the envelope returned shares nothing with the input draft or its meta', () => {
  const draft = makeDraft(), meta = { resetFrom: 2 };
  const result = serializeVersion({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 3, draft, meta });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  draft.store.people[0].name = 'Changed'; meta.resetFrom = 9;
  assert.equal(result.envelope.payload.store.people[0].name, 'Alex');
  assert.equal(result.envelope.meta.resetFrom, 2);
  assert.equal(canonicalize(result.envelope).text, result.text);
});

test('meta with a hook or a getter is refused', () => {
  assert.equal(serializeVersion({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta: Object.defineProperty({}, 'resetFrom', { get: () => 1, enumerable: true }) }).ok, false);
  assert.equal(serializeVersion({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta: { restoredFrom: Object.assign({ kind: 'draft', rev: 1 }, { toJSON: () => 1 }) } }).ok, false);
});

test('published meta needs real neighbour revisions for an interior month', () => {
  const published = adjacent => serializeVersion({ kind: 'published', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta: { sourceDraftRev: 1, supersedes: 0, reviewDigest: 'b'.repeat(16), adjacent } });
  assert.ok(codes(published({ prev: null, next: null })).includes('bad-adjacent'));
  assert.equal(published({ prev: 0, next: 0 }).ok, true);
});
