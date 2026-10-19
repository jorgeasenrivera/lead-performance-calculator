import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, plainJsonProblem, LIMITS } from './validate.mjs';
import * as V from './validate.mjs'; // new exports are reached through V so a missing one fails one test, not the file

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
// Applies `change` to a fresh copy and returns the validation result.
const mutated = (change, expect = { storeId: 'cedar', month: '2026-10' }) => {
  const draft = makeDraft();
  change(draft);
  return validateDraft(draft, expect);
};

test('a well-formed draft is accepted with no problems or warnings', () => {
  const result = validateDraft(makeDraft(), { storeId: 'cedar', month: '2026-10' });
  assert.deepEqual(result, { ok: true, problems: [], warnings: [], value: makeDraft() });
});

test('unknown availability and weekly limits may be null, as the model reads them', () => {
  const result = mutated(d => { Object.assign(d.store.people[0], { start: null, end: null, off: null, maxHours: null }); });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('layered memberships are valid, warn, and keep their order', () => {
  // The seed gives everyone a 2014 to 2100 entry; a single-day change is added
  // after it and the later entry wins (team-model membershipAt takes the last).
  const draft = makeDraft();
  draft.store.teams.push({ id: 'pine', name: 'Pine team' });
  draft.store.memberships.push({ storeId: 'cedar', personId: 'a', teamIds: ['pine'], from: '2026-10-05', to: '2026-10-05', date: '2026-10-05', source: { kind: 'CSV confirmed team change' } });
  const result = validateDraft(draft, { storeId: 'cedar', month: '2026-10' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(result.warnings.map(w => w.code), ['membership-order-significant']);
  assert.match(result.warnings[0].path, /:a$/);
  assert.equal(validateDraft(makeDraft(), { storeId: 'cedar', month: '2026-10' }).warnings.length, 0, 'no overlap, no warning');
});

const REFUSALS = [
  ['a day that does not exist', d => { d.overrides['2026-10-99'] = { on: [], off: [] }; }, 'day-outside-month'],
  ['a day in another month', d => { d.overrides['2026-11-01'] = { on: [], off: [] }; }, 'day-outside-month'],
  ['a day written without padding', d => { d.overrides['2026-10-5'] = { on: [], off: [] }; }, 'day-outside-month'],
  ['an unknown person on a day', d => { d.overrides['2026-10-06'] = { on: ['zzz'], off: [] }; }, 'unknown-person'],
  ['an unknown person in a shift', d => { d.overrides['2026-10-05'].shifts[0].personId = 'zzz'; }, 'unknown-person'],
  ['the same person on and off', d => { d.overrides['2026-10-06'] = { on: ['a'], off: ['a'] }; }, 'on-and-off'],
  ['a duplicate person in a list', d => { d.overrides['2026-10-06'] = { on: ['a', 'a'], off: [] }; }, 'bad-list'],
  ['a shift for another store', d => { d.overrides['2026-10-05'].shifts[0].storeId = 'elm'; }, 'wrong-store'],
  ['a shift stored under the wrong day', d => { d.overrides['2026-10-05'].shifts[0].date = '2026-10-06'; }, 'wrong-day'],
  ['an overnight shift', d => { d.overrides['2026-10-05'].shifts[0].endDate = '2026-10-06'; }, 'overnight'],
  ['a shift in another time zone', d => { d.overrides['2026-10-05'].shifts[0].timezone = 'America/Chicago'; }, 'bad-timezone'],
  ['a shift that ends before it starts', d => { d.overrides['2026-10-05'].shifts[0].endMinute = 500; }, 'bad-interval'],
  ['a shift ending at 24:00', d => { d.overrides['2026-10-05'].shifts[0].endMinute = 1440; }, 'bad-interval'],
  ['a shift with fractional minutes', d => { d.overrides['2026-10-05'].shifts[0].startMinute = 540.5; }, 'bad-interval'],
  ['an absence of an unknown kind', d => { d.overrides['2026-10-05'].absences.b.kind = 'sick'; }, 'bad-absence'],
  ['an absence for an unknown person', d => { d.overrides['2026-10-05'].absences.zzz = { kind: 'off' }; }, 'unknown-person'],
  ['a record with an unrecognised field', d => { d.overrides['2026-10-05'].approvedBy = 'x'; }, 'unknown-key'],
  ['a rule with blank hours (the form gives 0 and 0)', d => { d.store.rules[0].open = 0; d.store.rules[0].close = 0; }, 'bad-hours'],
  ['a rule with hours as text', d => { d.store.rules[0].open = ''; }, 'bad-hour'],
  ['a rule that closes before it opens', d => { d.store.rules[0].close = 8; }, 'bad-hours'],
  ['a rule with no minimum', d => { d.store.rules[0].minimum = 0; }, 'bad-minimum'],
  ['a rule whose date is not a date', d => { d.store.rules[0].effective = 'banana'; }, 'bad-date'],
  ['two rules on the same date', d => { d.store.rules.push({ ...d.store.rules[0] }); }, 'duplicate-rule'],
  ['a special day before its rule takes effect', d => { d.store.rules[0].effective = '2026-12-01'; }, 'holiday-before-effective'],
  ['a special day with an invented state', d => { d.store.rules[0].holidays['2026-11-26'] = 'maybe'; }, 'bad-state'],
  ['a special day that is not a date', d => { d.store.rules[0].holidays['2026-02-30'] = 'closed'; }, 'bad-date'],
  ['closed days outside the week', d => { d.store.rules[0].closedDays = [7]; }, 'bad-closed-days'],
  ['a person with a bad id', d => { d.store.people[0].id = 'a b'; }, 'bad-person-id'],
  ['two people with one id', d => { d.store.people[1].id = 'a'; }, 'duplicate-person'],
  ['availability that ends before it starts', d => { d.store.people[0].end = 8; }, 'bad-availability'],
  ['weekly hours above a week', d => { d.store.people[0].maxHours = 169; }, 'bad-max-hours'],
  ['weekly hours that are NaN (stopped by the snapshot, before the field check)', d => { d.store.people[0].maxHours = NaN; }, 'non-finite'],
  ['weekly hours that are text', d => { d.store.people[0].maxHours = '40'; }, 'bad-max-hours'],
  ['days off that repeat', d => { d.store.people[0].off = [1, 1]; }, 'bad-days-off'],
  ['two teams with one name in different case', d => { d.store.teams.push({ id: 'oak2', name: ' OAK   team ' }); }, 'duplicate-team-name'],
  ['a team called none', d => { d.store.teams.push({ id: 'zero', name: 'None' }); }, 'bad-team-name'],
  ['a team name with a bar', d => { d.store.teams.push({ id: 'bar', name: 'A|B' }); }, 'bad-team-name'],
  ['a membership in an unknown team', d => { d.store.memberships[0].teamIds = ['nope']; }, 'unknown-team'],
  ['a membership for an unknown person', d => { d.store.memberships[0].personId = 'zzz'; }, 'unknown-person'],
  ['a membership for another store', d => { d.store.memberships[0].storeId = 'elm'; }, 'wrong-store'],
  ['a membership range that runs backwards', d => { d.store.memberships[0].from = '2026-10-05'; d.store.memberships[0].to = '2026-10-04'; }, 'bad-range'],
  ['a field the contract does not know, at the top', d => { d.actor = { id: 'x' }; }, 'unknown-key'],
  ['a field the contract does not know, in the store', d => { d.store.history = []; }, 'unknown-key'],
  ['a time zone other than New York', d => { d.store.timezone = 'America/Chicago'; }, 'bad-timezone'],
  ['review state left in the draft', d => { d.accepted = true; }, 'unknown-key'],
  ['a store id that is not valid', d => { d.storeId = 'Cedar'; }, 'bad-store-id'],
  ['a month out of range', d => { d.month = '2101-01'; }, 'bad-month'],
];
for (const [name, change, code] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = mutated(change, {});
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(code), `expected ${code}, got ${codes(result)}`);
  });
}

test('refuses a draft that belongs to another store or month than the caller expects', () => {
  const draft = makeDraft();
  assert.ok(codes(validateDraft(draft, { storeId: 'elm', month: '2026-10' })).includes('identity-mismatch'));
  assert.ok(codes(validateDraft(draft, { storeId: 'cedar', month: '2026-11' })).includes('identity-mismatch'));
});

test('refuses anything that is not a plain object', () => {
  for (const bad of [null, undefined, [], 'draft', 4, () => {}]) assert.deepEqual(codes(validateDraft(bad)), ['not-object']);
});

test('refuses names that could rewrite an object prototype', () => {
  const text = '{"on":[],"off":[],"absences":{"__proto__":{"kind":"off"}}}';
  const draft = makeDraft();
  draft.overrides['2026-10-06'] = JSON.parse(text);
  const result = validateDraft(draft, {});
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('forbidden-key') || codes(result).includes('unknown-person'));
  assert.equal(plainJsonProblem(JSON.parse('{"constructor":1}')).code, 'forbidden-key');
});

test('refuses values that are not plain JSON anywhere in free-form fields', () => {
  for (const bad of [new Date(0), new Map(), Infinity, NaN, () => 1, Symbol('x'), 10n, Object.create({ inherited: 1 }), (() => { const a = []; a[2] = 1; return a; })()]) {
    const draft = makeDraft();
    draft.overrides['2026-10-05'].shifts[0].source = { value: bad };
    assert.equal(validateDraft(draft, {}).ok, false, String(typeof bad));
  }
  const cycle = {}; cycle.self = cycle;
  assert.equal(plainJsonProblem(cycle).code, 'too-deep');
});

test('refuses lists beyond the stated limits', () => {
  const crowd = makeDraft();
  crowd.store.people = Array.from({ length: LIMITS.people + 1 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, start: 9, end: 17, off: [], maxHours: 40 }));
  assert.ok(codes(validateDraft(crowd, {})).includes('people-count'));
  const days = makeDraft();
  for (let d = 1; d <= 31; d++) days.overrides[`2026-10-${String(d).padStart(2, '0')}`] = { on: [], off: [] };
  assert.equal(validateDraft(days, {}).ok, true, 'a full month is fine');
});

test('reports at most the first fifty problems', () => {
  const draft = makeDraft();
  for (let d = 1; d <= 31; d++) draft.overrides[`2026-11-${String(d).padStart(2, '0')}`] = { on: ['zzz'], off: [] };
  draft.store.people = Array.from({ length: 101 }, (_, i) => ({ id: 'dup', name: 'X', start: 1, end: 0, off: 'x', maxHours: -1 }));
  assert.ok(validateDraft(draft, {}).problems.length <= LIMITS.problems);
});

test('does not change the draft it checks', () => {
  const draft = makeDraft(), before = clone(draft);
  validateDraft(draft, { storeId: 'cedar', month: '2026-10' });
  assert.deepEqual(draft, before);
});

test('accepts the older bare list of people who are on', () => {
  const draft = makeDraft();
  draft.overrides['2026-10-06'] = ['a'];
  assert.equal(validateDraft(draft, {}).ok, true);
  draft.overrides['2026-10-06'] = ['zzz'];
  assert.ok(codes(validateDraft(draft, {})).includes('unknown-person'));
});

// ---- Review round 1 (F2, L3): one strict plain-data snapshot ----------------------------

const nest = (levels, leaf = 1) => { let v = leaf; for (let i = 0; i < levels; i++) v = { n: v }; return v; };
const nestArr = (levels, leaf = 1) => { let v = leaf; for (let i = 0; i < levels; i++) v = [v]; return v; };
const snapCode = value => V.plainSnapshot(value).problems?.[0]?.code;

test('a snapshot is a detached plain copy: no shared objects, -0 as 0, key order kept', () => {
  const frozen = Object.freeze({ list: Object.freeze([1, { a: -0 }]), nul: Object.assign(Object.create(null), { x: 1 }) });
  const result = V.plainSnapshot(frozen);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(result.value, { list: [1, { a: 0 }], nul: { x: 1 } });
  assert.equal(Object.is(result.value.list[1].a, 0), true, '-0 is written as 0');
  assert.notEqual(result.value.list, frozen.list);
  assert.equal(Object.isFrozen(result.value), false, 'a plain, ordinary copy');
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
});

const HOSTILE = [
  ['an array with its own toJSON', () => Object.assign([1], { toJSON: () => [2] }), 'array-extra-property'],
  ['an array with a hidden toJSON', () => Object.defineProperty([1], 'toJSON', { value: () => [2], enumerable: false }), 'array-extra-property'],
  ['an array with an extra named property', () => Object.assign([1], { label: 'x' }), 'array-extra-property'],
  ['an array whose prototype carries toJSON', () => Object.setPrototypeOf([1], { toJSON: () => [2] }), 'not-plain-json'],
  ['a subclass of Array', () => new (class Rows extends Array {})(1), 'not-plain-json'],
  ['an array with a getter element', () => Object.defineProperty([0], '0', { get: () => 1, enumerable: true }), 'accessor-property'],
  ['an array with a hidden element', () => Object.defineProperty([0], '0', { value: 1, enumerable: false }), 'non-enumerable-property'],
  ['an array with a hole', () => [1, , 3], 'sparse-array'],
  ['an array with a symbol key', () => Object.assign([1], { [Symbol('s')]: 1 }), 'symbol-key'],
  ['an object with a getter', () => Object.defineProperty({}, 'a', { get: () => 1, enumerable: true }), 'accessor-property'],
  ['an object with a hidden property', () => Object.defineProperty({}, 'a', { value: 1, enumerable: false }), 'non-enumerable-property'],
  ['an object with a hidden toJSON', () => Object.defineProperty({ a: 1 }, 'toJSON', { value: () => 2, enumerable: false }), 'non-enumerable-property'],
  ['an object with an own toJSON function', () => ({ a: 1, toJSON: () => 2 }), 'not-plain-json'],
  ['an object with a symbol key', () => ({ [Symbol('s')]: 1 }), 'symbol-key'],
  ['an object whose prototype carries toJSON', () => Object.setPrototypeOf({ a: 1 }, { toJSON: () => 2 }), 'not-plain-json'],
  ['a class instance', () => new (class Thing { constructor() { this.a = 1; } })(), 'not-plain-json'],
  ['a Date', () => new Date(0), 'not-plain-json'],
  ['a key that would rewrite a prototype', () => JSON.parse('{"__proto__":{"x":1}}'), 'forbidden-key'],
  ['an undefined value', () => ({ a: undefined }), 'undefined-value'],
];
for (const [name, make, code] of HOSTILE) {
  test(`a snapshot refuses ${name}`, () => {
    assert.equal(snapCode(make()), code);
  });
}

test('a snapshot reads every property exactly once, so a changing accessor cannot split validation from output', () => {
  let reads = 0;
  const shifty = Object.defineProperty({}, 'v', { get: () => ++reads, enumerable: true });
  assert.equal(snapCode(shifty), 'accessor-property');
  const draft = makeDraft(); let people = 0;
  const proxied = new Proxy(draft.store, { getOwnPropertyDescriptor(target, key) { const d = Reflect.getOwnPropertyDescriptor(target, key); if (key === 'people') { people++; return { ...d, value: people === 1 ? d.value : [] }; } return d; } });
  const result = V.plainSnapshot({ ...draft, store: proxied });
  assert.equal(people, 1, 'people was asked for once');
  if (result.ok) assert.deepEqual(result.value.store.people, draft.store.people, 'what was checked is what was copied');
});

test('depth limits: a snapshot allows 12 levels, a draft allows 8', () => {
  assert.equal(V.plainSnapshot(nest(12)).ok, true);
  assert.equal(snapCode(nest(13)), 'too-deep');
  assert.equal(V.plainSnapshot(nestArr(12)).ok, true);
  assert.equal(snapCode(nestArr(13)), 'too-deep');
  assert.equal(V.plainSnapshot(nest(8), { maxDepth: 8 }).ok, true);
  assert.equal(V.plainSnapshot(nest(9), { maxDepth: 8 }).problems[0].code, 'too-deep');
  const within = makeDraft(); within.overrides['2026-10-05'].shifts[0].source = { a: { b: { c: 1 } } }; // leaf at depth 8
  assert.equal(validateDraft(within, {}).ok, true, JSON.stringify(validateDraft(within, {}).problems));
  const beyond = makeDraft(); beyond.overrides['2026-10-05'].shifts[0].source = { a: { b: { c: { d: 1 } } } }; // leaf at depth 9
  assert.ok(codes(validateDraft(beyond, {})).includes('too-deep'));
});

test('a snapshot stops at a node budget before copying an enormous value', () => {
  assert.equal(V.plainSnapshot(Array.from({ length: 11 }, () => 1), { maxNodes: 10 }).problems[0].code, 'too-large');
  assert.equal(V.plainSnapshot(Array.from({ length: 9 }, () => 1), { maxNodes: 10 }).ok, true);
});

test('undefined can be treated as absent only when the caller asks', () => {
  assert.equal(snapCode({ a: undefined }), 'undefined-value');
  assert.deepEqual(V.plainSnapshot({ a: undefined, b: 1 }, { dropUndefined: true }).value, { b: 1 });
});

test('validateDraft hands back the snapshot it checked, detached from the input', () => {
  const draft = makeDraft(), result = validateDraft(draft, { storeId: 'cedar', month: '2026-10' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, draft);
  assert.notEqual(result.value.store, draft.store);
  draft.store.people[0].name = 'Changed afterwards';
  assert.equal(result.value.store.people[0].name, 'Alex');
  assert.equal('value' in validateDraft(null), false);
  assert.equal('value' in mutated(d => { d.overrides['2026-10-99'] = {}; }), false, 'no value when it failed');
});

test('validateDraft refuses a draft that smuggles a serialization hook or a custom prototype', () => {
  const hooked = makeDraft(); hooked.store.people.toJSON = () => [{ id: 'ghost' }];
  assert.equal(validateDraft(hooked, {}).ok, false);
  class Draft {}
  assert.equal(validateDraft(Object.assign(new Draft(), makeDraft()), {}).ok, false);
  assert.equal(validateDraft(Object.assign(Object.create(null), makeDraft()), {}).ok, true, 'a null-prototype object is plain data');
});

test('validateSnapshot checks data that is already a snapshot', () => {
  const snapshot = V.plainSnapshot(makeDraft()).value;
  assert.deepEqual(V.validateSnapshot(snapshot, { storeId: 'cedar', month: '2026-10' }).problems, []);
  snapshot.overrides['2026-10-06'] = { on: ['zzz'], off: [] };
  assert.ok(codes(V.validateSnapshot(snapshot, {})).includes('unknown-person'));
});
