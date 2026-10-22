import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDraft, serializeVersion } from './serialize.mjs';
import { deserializeVersion } from './deserialize.mjs';
import { seal, canonicalize, checksum, MAX_ENVELOPE_CHARS } from './envelope.mjs';
import { validateDraft } from './validate.mjs';

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
const EXPECT = { storeId: 'cedar', month: '2026-10', kind: 'draft', rev: 1 };
const stored = (draft = makeDraft()) => serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft }).text;

test('a draft survives a round trip and writes back to identical text', () => {
  const text = stored();
  const read = deserializeVersion(text, EXPECT);
  assert.equal(read.ok, true, JSON.stringify(read.problems));
  assert.deepEqual(read.draft, makeDraft());
  assert.equal(read.kind, 'draft');
  assert.equal(read.rev, 1);
  const again = serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft: read.draft });
  assert.equal(again.text, text, 'byte for byte');
});

test('a round trip keeps layered membership order', () => {
  const draft = makeDraft();
  draft.store.teams.push({ id: 'pine', name: 'Pine team' });
  draft.store.memberships.push(
    { storeId: 'cedar', personId: 'a', teamIds: ['pine'], from: '2026-10-05', to: '2026-10-05', date: '2026-10-05', membershipBasis: { from: '2014-01-01', to: '2100-12-31' } },
    { storeId: 'cedar', personId: 'a', teamIds: ['oak'], from: '2026-10-05', to: '2026-10-05' },
  );
  const read = deserializeVersion(stored(draft), EXPECT);
  assert.equal(read.ok, true, JSON.stringify(read.problems));
  assert.deepEqual(read.draft.store.memberships, draft.store.memberships);
  assert.deepEqual(read.warnings.map(w => w.code), ['membership-order-significant']);
});

test('a published version and its meta round trip', () => {
  const meta = { sourceDraftRev: 4, supersedes: 0, reviewDigest: 'c'.repeat(16), adjacent: { prev: 0, next: 0 } };
  const text = serializeVersion({ kind: 'published', storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft(), meta }).text;
  const read = deserializeVersion(text, { ...EXPECT, kind: 'published' });
  assert.equal(read.ok, true, JSON.stringify(read.problems));
  assert.deepEqual(read.meta, meta);
});

test('the result is a copy that can be changed without touching anything stored', () => {
  const object = JSON.parse(stored());
  const read = deserializeVersion(object, EXPECT);
  read.draft.store.people[0].name = 'Changed';
  assert.equal(object.payload.store.people[0].name, 'Alex');
});

test('refuses text that is not JSON, and text that is too large', () => {
  assert.deepEqual(codes(deserializeVersion('{nope', EXPECT)), ['invalid-json']);
  assert.deepEqual(codes(deserializeVersion('', EXPECT)), ['invalid-json']);
  assert.deepEqual(codes(deserializeVersion('x'.repeat(MAX_ENVELOPE_CHARS + 1), EXPECT)), ['too-large']);
});

test('refuses text that is valid but not in canonical form', () => {
  const text = stored();
  assert.deepEqual(codes(deserializeVersion(JSON.stringify(JSON.parse(text), null, 2), EXPECT)), ['not-canonical']);
  assert.deepEqual(codes(deserializeVersion(` ${text}`, EXPECT)), ['not-canonical']);
  // A repeated key is collapsed by JSON.parse, so the text no longer matches what it parses to.
  const repeated = text.replace('{"format"', '{"rev":9,"format"');
  assert.deepEqual(codes(deserializeVersion(repeated, EXPECT)), ['not-canonical']);
});

test('refuses a version that was changed after it was written', () => {
  const object = JSON.parse(stored());
  object.payload.store.people[0].name = 'Mallory';
  assert.deepEqual(codes(deserializeVersion(canonicalize(object).text, EXPECT)), ['hash-mismatch']);
});

test('refuses a version that belongs to another store, month, kind or revision', () => {
  const text = stored();
  assert.deepEqual(codes(deserializeVersion(text, { ...EXPECT, storeId: 'elm' })), ['identity-mismatch']);
  assert.deepEqual(codes(deserializeVersion(text, { ...EXPECT, month: '2026-11' })), ['identity-mismatch']);
  assert.deepEqual(codes(deserializeVersion(text, { ...EXPECT, kind: 'published' })), ['kind-mismatch']);
  assert.deepEqual(codes(deserializeVersion(text, { ...EXPECT, rev: 2 })), ['rev-mismatch']);
});

test('refuses an unsupported version number', () => {
  const object = JSON.parse(stored());
  object.version = 2;
  assert.deepEqual(codes(deserializeVersion(canonicalize(object).text, EXPECT)), ['unsupported-version']);
});

test('refuses a payload that fails validation even when its checksum is correct', () => {
  const draft = makeDraft();
  draft.overrides['2026-10-06'] = { on: ['zzz'], off: [] };
  const sealed = seal({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, meta: {}, payload: draft });
  assert.equal(sealed.ok, true, 'sealing does not know what a draft is');
  const read = deserializeVersion(sealed.text, EXPECT);
  assert.equal(read.ok, false);
  assert.ok(codes(read).includes('unknown-person'));
});

test('refuses a payload filed under a different store than its wrapper says', () => {
  const sealed = seal({ kind: 'draft', storeId: 'elm', month: '2026-10', rev: 1, meta: {}, payload: makeDraft() });
  const read = deserializeVersion(sealed.text, { storeId: 'elm', month: '2026-10' });
  assert.equal(read.ok, false);
  assert.ok(codes(read).includes('identity-mismatch'));
});

test('refuses a prototype-polluting key written into stored text', () => {
  const text = stored().replace('"payload":{', '"payload":{"__proto__":{"x":1},');
  const read = deserializeVersion(text, EXPECT);
  assert.equal(read.ok, false);
  assert.deepEqual(codes(read), ['forbidden-key']);
});

test('refuses things that are not stored versions', () => {
  for (const bad of [null, [], 4, {}, { format: 'sage.scheduler.version' }]) assert.equal(deserializeVersion(bad, EXPECT).ok, false);
});

test('the same payload under two stores or months is two different versions that cannot be swapped', () => {
  const cedar = serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft: makeDraft() });
  const elmDraft = makeDraft({ storeId: 'elm' });
  elmDraft.store.memberships = elmDraft.store.memberships.map(m => ({ ...m, storeId: 'elm' }));
  elmDraft.overrides['2026-10-05'].shifts[0].storeId = 'elm';
  const elm = serializeDraft({ storeId: 'elm', month: '2026-10', rev: 1, draft: elmDraft });
  assert.equal(elm.ok, true, JSON.stringify(elm.problems));
  assert.notEqual(cedar.envelope.hash.value, elm.envelope.hash.value);
  assert.equal(deserializeVersion(elm.text, { storeId: 'cedar', month: '2026-10' }).ok, false);
});

// ---- Review round 1 (F2, F3, F4) --------------------------------------------------------

const GOOD = () => JSON.parse(stored());

test('a hooked or custom-prototype payload in an envelope object is refused, not read through the hook', () => {
  const hookedArray = GOOD(); hookedArray.payload.store.people.toJSON = () => [{ id: 'ghost' }];
  const hookedObject = GOOD(); hookedObject.payload.store.people[0].toJSON = () => ({ id: 'ghost' });
  const subclass = GOOD(); subclass.payload.store.teams = Object.setPrototypeOf(subclass.payload.store.teams, { toJSON: () => [] });
  const getter = GOOD(); Object.defineProperty(getter.payload.store.people[0], 'name', { get: () => 'changes', enumerable: true });
  const klass = Object.assign(new (class Envelope {})(), GOOD());
  for (const [name, input] of [['array hook', hookedArray], ['object hook', hookedObject], ['array prototype hook', subclass], ['getter', getter], ['class instance', klass]]) {
    const read = deserializeVersion(input, EXPECT);
    assert.equal(read.ok, false, name);
  }
});

test('a successful read always satisfies validateDraft, and writes back to the bytes it came from', () => {
  const text = stored(), read = deserializeVersion(text, EXPECT);
  assert.equal(read.ok, true);
  assert.equal(validateDraft(read.draft, { storeId: 'cedar', month: '2026-10' }).ok, true);
  assert.equal(serializeDraft({ storeId: 'cedar', month: '2026-10', rev: 1, draft: read.draft }).text, text);
  const fromObject = deserializeVersion(JSON.parse(text), EXPECT);
  assert.deepEqual(fromObject.draft, read.draft);
});

// A valid envelope whose canonical form is exactly `target` characters.
const withPad = pad => {
  const draft = makeDraft();
  draft.overrides['2026-10-05'].shifts[0].source = { note: 'x'.repeat(pad) };
  const body = { format: 'sage.scheduler.version', version: 1, kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, meta: {}, payload: draft };
  return { ...body, hash: { alg: 'fnv1a64', value: checksum(canonicalize(body).text) } };
};
const ofLength = target => {
  const delta = target - canonicalize(withPad(1000)).text.length;
  const envelope = withPad(1000 + delta);
  assert.equal(canonicalize(envelope).text.length, target, 'the helper built the length asked for');
  return envelope;
};

test('the size limit applies to the canonical form, for text and for an already-parsed object alike', () => {
  const atLimit = ofLength(MAX_ENVELOPE_CHARS), overLimit = ofLength(MAX_ENVELOPE_CHARS + 1), review = ofLength(1000396);
  for (const [name, input] of [['text', canonicalize(atLimit).text], ['object', atLimit]]) {
    const read = deserializeVersion(input, EXPECT);
    assert.equal(read.ok, true, `exactly the limit is accepted as ${name}: ${JSON.stringify(read.problems)}`);
  }
  for (const [name, input] of [['text', canonicalize(overLimit).text], ['object', overLimit], ['review text', canonicalize(review).text], ['review object', review]]) {
    assert.deepEqual(codes(deserializeVersion(input, EXPECT)), ['too-large'], `one over is refused as ${name}`);
  }
});

test('an enormous object is refused without being written out in full', () => {
  const huge = GOOD(); huge.payload.overrides['2026-10-05'].shifts[0].source = { note: 'x'.repeat(5 * MAX_ENVELOPE_CHARS) };
  assert.deepEqual(codes(deserializeVersion(huge, EXPECT)), ['too-large']);
  const wide = GOOD(); wide.payload.store.rules[0].holidays = Object.fromEntries(Array.from({ length: 300000 }, (_, i) => [`k${i}`, 1]));
  assert.equal(deserializeVersion(wide, EXPECT).ok, false);
});

test('an unknown field in the hash wrapper is refused for text and for objects', () => {
  const object = GOOD(); object.hash.extra = 'not covered by the checksum';
  assert.deepEqual(codes(deserializeVersion(canonicalize(object).text, EXPECT)), ['bad-hash']);
  assert.deepEqual(codes(deserializeVersion(object, EXPECT)), ['bad-hash']);
  const missing = GOOD(); delete missing.hash.alg;
  assert.deepEqual(codes(deserializeVersion(missing, EXPECT)), ['bad-hash']);
  assert.equal(deserializeVersion(stored(), EXPECT).ok, true, 'the two-field wrapper still reads');
});

test('a published version with impossible neighbour revisions is refused on read', () => {
  const sealed = seal({ kind: 'published', storeId: 'cedar', month: '2026-10', rev: 1, meta: { sourceDraftRev: 1, supersedes: 0, reviewDigest: 'c'.repeat(16), adjacent: { prev: null, next: null } }, payload: makeDraft() });
  assert.ok(sealed.ok === false && codes(sealed).includes('bad-adjacent'), 'sealing already refuses it');
});

test('nesting beyond the draft limit is refused on read even when the envelope is within the canonical limit', () => {
  const object = GOOD(); object.payload.overrides['2026-10-05'].shifts[0].source = { a: { b: { c: { d: 1 } } } };
  const sealed = seal({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, meta: {}, payload: object.payload });
  assert.equal(sealed.ok, true, 'the envelope itself is within 12 levels');
  assert.ok(codes(deserializeVersion(sealed.text, EXPECT)).includes('too-deep'), 'the draft inside it is not');
});
