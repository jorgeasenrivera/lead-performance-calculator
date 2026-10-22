import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { canonicalize, checksum, seal, open, DEFAULT_SEALER, FORMAT, VERSION, MAX_ENVELOPE_CHARS } from './envelope.mjs';
import * as E from './envelope.mjs'; // new exports are reached through E so a missing one fails one test, not the file

const codes = result => result.problems.map(p => p.code);
const clone = value => JSON.parse(JSON.stringify(value));
const fields = (over = {}) => ({ kind: 'draft', storeId: 'cedar', month: '2026-10', rev: 1, meta: {}, payload: { hello: 'world', list: [3, 1, 2] }, ...over });
const PUBLISHED_META = { sourceDraftRev: 2, supersedes: 0, reviewDigest: 'a'.repeat(16), adjacent: { prev: 1, next: 2 } };

test('canonical text ignores key order and whitespace and sorts keys', () => {
  const a = canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } });
  const b = canonicalize(JSON.parse('{ "a": {"c":"x", "d":[1,{"y":2,"z":1}]},\n "b": 1 }'));
  assert.equal(a.text, '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(a.text, b.text);
});

test('canonical text keeps array order, which can be meaning', () => {
  assert.equal(canonicalize({ list: [3, 1, 2] }).text, '{"list":[3,1,2]}');
  assert.notEqual(canonicalize([1, 2]).text, canonicalize([2, 1]).text);
});

test('canonical numbers have one spelling', () => {
  assert.equal(canonicalize(-0).text, '0');
  assert.equal(canonicalize(1e21).text, JSON.stringify(1e21));
  assert.equal(canonicalize({ n: 0.1 }).text, '{"n":0.1}');
});

const NOT_JSON = [
  ['undefined', { a: undefined }, 'undefined-value'],
  ['NaN', { a: NaN }, 'non-finite'],
  ['Infinity', [Infinity], 'non-finite'],
  ['a Date', new Date(0), 'not-plain-json'],
  ['a Map', new Map(), 'not-plain-json'],
  ['a function', () => 1, 'not-plain-json'],
  ['a class instance', new (class Thing {})(), 'not-plain-json'],
  ['a BigInt', 1n, 'not-plain-json'],
  ['a sparse array', [1, , 3], 'sparse-array'],
  ['a forbidden key', JSON.parse('{"__proto__":1}'), 'forbidden-key'],
];
for (const [name, value, code] of NOT_JSON) {
  test(`refuses ${name} instead of writing something different`, () => {
    const result = canonicalize(value);
    assert.equal(result.ok, false);
    assert.equal(result.problems[0].code, code);
  });
}

test('refuses data nested deeper than twelve levels, which also stops cycles', () => {
  const cycle = {}; cycle.self = cycle;
  assert.equal(canonicalize(cycle).problems[0].code, 'too-deep');
});

test('the checksum matches published FNV-1a 64 vectors and works on UTF-8 bytes', () => {
  assert.equal(checksum(''), 'cbf29ce484222325');
  assert.equal(checksum('a'), 'af63dc4c8601ec8c');
  assert.equal(checksum('foobar'), '85944171f73967e8');
  // An independent calculation over Node's own UTF-8 bytes, for non-ASCII text.
  const reference = text => { let h = 0xcbf29ce484222325n; for (const b of Buffer.from(text, 'utf8')) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n); return h.toString(16).padStart(16, '0'); };
  for (const text of ['é', 'Zoë Núñez', '日本語', '😀 shift', 'a\u0000b']) assert.equal(checksum(text), reference(text), text);
});

test('seal then open returns the same data under the same identity', () => {
  const sealed = seal(fields());
  assert.equal(sealed.ok, true);
  assert.equal(sealed.envelope.format, FORMAT);
  assert.equal(sealed.envelope.version, VERSION);
  assert.equal(sealed.text, canonicalize(sealed.envelope).text, 'the text is the canonical form');
  const opened = open(JSON.parse(sealed.text), { storeId: 'cedar', month: '2026-10', kind: 'draft', rev: 1 });
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.envelope.payload, { hello: 'world', list: [3, 1, 2] });
});

test('any change to a stored version is caught by the checksum', () => {
  const stored = clone(seal(fields()).envelope);
  for (const change of [e => { e.payload.hello = 'there'; }, e => { e.payload.list.reverse(); }, e => { e.meta = { resetFrom: 1 }; }]) {
    const copy = clone(stored); change(copy);
    assert.equal(codes(open(copy))[0], 'hash-mismatch');
  }
});

test('a version moved to another store, month, kind or revision is refused even with a matching hash', () => {
  const stored = clone(seal(fields()).envelope);
  for (const [key, value] of [['storeId', 'elm'], ['month', '2026-11'], ['rev', 2]]) {
    const copy = { ...stored, [key]: value };
    assert.equal(codes(open(copy))[0], 'hash-mismatch', `${key} is covered by the hash`);
  }
  assert.deepEqual(codes(open(stored, { storeId: 'elm' })), ['identity-mismatch']);
  assert.deepEqual(codes(open(stored, { month: '2026-11' })), ['identity-mismatch']);
  assert.deepEqual(codes(open(stored, { kind: 'published' })), ['kind-mismatch']);
  assert.deepEqual(codes(open(stored, { rev: 2 })), ['rev-mismatch']);
});

test('refuses a different format, an unsupported version, extra fields and non-objects', () => {
  const stored = clone(seal(fields()).envelope);
  assert.deepEqual(codes(open({ ...stored, version: 2 })), ['unsupported-version']);
  assert.deepEqual(codes(open({ ...stored, version: '1' })), ['unsupported-version']);
  assert.deepEqual(codes(open({ ...stored, format: 'other' })), ['bad-format']);
  assert.deepEqual(codes(open({ ...stored, extra: 1 })), ['bad-shape']);
  const { hash, ...without } = stored;
  assert.deepEqual(codes(open(without)), ['bad-shape']);
  for (const bad of [null, [], 'x', 4]) assert.deepEqual(codes(open(bad)), ['not-object']);
});

test('meta is strict for each kind', () => {
  assert.equal(seal(fields({ kind: 'published', meta: PUBLISHED_META })).ok, true);
  assert.equal(seal(fields({ meta: { resetFrom: 3, publishedRev: 1, restoredFrom: { kind: 'published', rev: 2 } } })).ok, true);
  assert.ok(codes(seal(fields({ meta: { sourceDraftRev: 1 } }))).includes('unknown-key'), 'published fields on a draft');
  assert.ok(codes(seal(fields({ kind: 'published', meta: {} }))).includes('bad-rev'), 'published needs its source');
  assert.ok(codes(seal(fields({ kind: 'published', meta: { ...PUBLISHED_META, reviewDigest: 'xyz' } }))).includes('bad-digest'));
  assert.ok(codes(seal(fields({ kind: 'published', meta: { ...PUBLISHED_META, adjacent: { prev: 1 } } }))).includes('bad-adjacent'));
  assert.ok(codes(seal(fields({ meta: { restoredFrom: { kind: 'draft' } } }))).includes('bad-restore'));
  assert.ok(codes(seal(fields({ meta: { resetFrom: 0 } }))).includes('bad-rev'));
  assert.ok(codes(seal(fields({ meta: { note: 'x' } }))).includes('unknown-key'));
});

test('refuses a bad identity or revision when sealing', () => {
  assert.ok(codes(seal(fields({ storeId: 'Cedar' }))).includes('bad-store-id'));
  assert.ok(codes(seal(fields({ month: '2026-13' }))).includes('bad-month'));
  assert.ok(codes(seal(fields({ rev: 0 }))).includes('bad-rev'));
  assert.ok(codes(seal(fields({ kind: 'other' }))).includes('bad-kind'));
  assert.deepEqual(codes(seal(null)), ['not-object']);
  assert.equal(seal(fields({ payload: { when: new Date(0) } })).ok, false);
});

test('refuses a version larger than the stated limit', () => {
  const result = seal(fields({ payload: { big: 'x'.repeat(MAX_ENVELOPE_CHARS) } }));
  assert.deepEqual(codes(result), ['too-large']);
});

test('the sealer is replaceable, and a reader without it says so', () => {
  const other = { alg: 'test-sum', digest: text => String(text.length).padStart(16, '0') };
  const sealed = seal(fields(), other);
  assert.equal(sealed.envelope.hash.alg, 'test-sum');
  assert.equal(open(clone(sealed.envelope), {}, other).ok, true);
  assert.deepEqual(codes(open(clone(sealed.envelope))), ['unsupported-hash']);
  assert.equal(DEFAULT_SEALER.alg, 'fnv1a64');
});

test('sealing does not change its input', () => {
  const input = fields(), before = clone(input);
  seal(input);
  assert.deepEqual(input, before);
});

// ---- Review round 1 (F1, F2, F3, F4, L4) -------------------------------------------------

test('the checksum treats an unpaired surrogate as U+FFFD, as a standard UTF-8 encoder does', () => {
  const reference = text => { let h = 0xcbf29ce484222325n; for (const b of Buffer.from(text, 'utf8')) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n); return h.toString(16).padStart(16, '0'); };
  assert.equal(checksum('\ud800'), '6f6d661b9658624a', 'the value the review computed from Node UTF-8 bytes');
  for (const text of ['\ud800', '\udfff', 'a\ud83dz', '\udc00\ud800', '\ud83d\ude00', 'ok \ud800 ok']) assert.equal(checksum(text), reference(text), JSON.stringify(text));
  assert.equal(checksum('\ud800'), checksum('\udfff'), 'both map to one replacement character, so they collide; documented');
  assert.equal(checksum('\ud83d\ude00'), checksum('😀'), 'a valid pair is still one code point');
});

test('the hash wrapper must be exactly an algorithm name and a hex digest', () => {
  const stored = clone(seal(fields()).envelope);
  for (const [name, change] of [
    ['an extra field', h => { h.extra = 'not covered'; }],
    ['no value', h => { delete h.value; }],
    ['no algorithm', h => { delete h.alg; }],
    ['a non-hex value', h => { h.value = 'ZZZZZZZZZZZZZZZZ'; }],
    ['a value that is too short', h => { h.value = 'abc'; }],
    ['an upper-case value', h => { h.value = h.value.toUpperCase().replace(/[0-9]/g, 'A'); }],
    ['a bad algorithm name', h => { h.alg = 'Not Valid!'; }],
  ]) {
    const copy = clone(stored); change(copy.hash);
    assert.deepEqual(codes(open(copy)), ['bad-hash'], name);
  }
  assert.equal(open(clone(stored)).ok, true, 'the two-field wrapper still opens');
  assert.deepEqual(codes(open({ ...clone(stored), hash: 'abc' })), ['bad-hash']);
  assert.deepEqual(codes(open({ ...clone(stored), hash: null })), ['bad-hash']);
});

test('a sealer must return a lowercase hex digest and name itself plainly', () => {
  assert.deepEqual(codes(seal(fields(), { alg: 'x-sum', digest: () => 'XYZ' })), ['bad-sealer']);
  assert.deepEqual(codes(seal(fields(), { alg: 'x-sum', digest: () => 12345 })), ['bad-sealer']);
  assert.deepEqual(codes(seal(fields(), { alg: 'Bad Name', digest: () => 'f'.repeat(16) })), ['bad-sealer']);
  assert.deepEqual(codes(seal(fields(), { alg: 'x-sum' })), ['bad-sealer']);
  assert.equal(seal(fields(), { alg: 'x-sum', digest: () => 'f'.repeat(128) }).ok, true);
  assert.deepEqual(codes(seal(fields(), { alg: 'x-sum', digest: () => 'f'.repeat(129) })), ['bad-sealer']);
});

test('published neighbour revisions mean the calendar neighbours, so null is only valid beside the range ends', () => {
  const sealPublished = (month, adjacent) => seal(fields({ kind: 'published', month, meta: { ...PUBLISHED_META, adjacent } }));
  // an interior month has both neighbours: null and missing are impossible values
  for (const adjacent of [{ prev: null, next: null }, { prev: 1, next: null }, { prev: null, next: 2 }, { prev: -1, next: 0 }, { prev: 1.5, next: 0 }, { prev: '1', next: 0 }, { prev: 1 }, { next: 1 }]) {
    assert.ok(codes(sealPublished('2026-10', adjacent)).includes('bad-adjacent'), JSON.stringify(adjacent));
  }
  assert.equal(sealPublished('2026-10', { prev: 0, next: 0 }).ok, true, 'zero means no saved draft next door');
  // the first month has no earlier month; the last has no later one
  assert.equal(sealPublished('2014-01', { prev: null, next: 3 }).ok, true);
  assert.ok(codes(sealPublished('2014-01', { prev: 0, next: 3 })).includes('bad-adjacent'), 'there is no month before 2014-01');
  assert.ok(codes(sealPublished('2014-01', { prev: null, next: null })).includes('bad-adjacent'), 'but 2014-02 exists');
  assert.equal(sealPublished('2100-12', { prev: 2, next: null }).ok, true);
  assert.ok(codes(sealPublished('2100-12', { prev: 2, next: 0 })).includes('bad-adjacent'));
  assert.ok(codes(sealPublished('2100-12', { prev: null, next: null })).includes('bad-adjacent'), 'but 2100-11 exists');
  // reading applies the same meaning
  const forged = clone(sealPublished('2026-10', { prev: 0, next: 0 }).envelope); forged.meta.adjacent = { prev: null, next: null };
  assert.ok(codes(open(forged)).includes('bad-adjacent'));
});

test('sealing and opening take a detached snapshot, so a serialization hook cannot change what is stored', () => {
  const hooked = fields({ payload: Object.assign([1, 2], { toJSON: () => ['ghost'] }) });
  assert.equal(seal(hooked).ok, false);
  const stored = clone(seal(fields()).envelope); stored.payload.list = Object.assign([3, 1, 2], { toJSON: () => [] });
  assert.equal(open(stored).ok, false);
  const input = fields(), sealed = seal(input);
  assert.notEqual(sealed.envelope.payload, input.payload, 'the envelope shares nothing with the input');
  input.payload.list.push(99);
  assert.deepEqual(sealed.envelope.payload.list, [3, 1, 2]);
  assert.equal(canonicalize(sealed.envelope).text, sealed.text);
  const plain = clone(seal(fields()).envelope), opened = open(plain);
  assert.notEqual(opened.envelope, plain, 'what open returns is a copy, not the object it was given');
});

test('the canonical writer can stop early at a character budget', () => {
  assert.equal(E.canonicalize({ a: 'x'.repeat(100) }, { maxChars: 50 }).problems[0].code, 'too-large');
  const exact = E.canonicalize({ a: 'xxxx' });
  assert.equal(E.canonicalize({ a: 'xxxx' }, { maxChars: exact.text.length }).ok, true, 'exactly the limit is allowed');
  assert.equal(E.canonicalize({ a: 'xxxx' }, { maxChars: exact.text.length - 1 }).problems[0].code, 'too-large');
  assert.equal(E.canonicalize({ a: 'x'.repeat(10 ** 6) }).ok, true, 'no budget unless asked');
});

test('canonical nesting allows 12 levels and refuses 13', () => {
  const nestArr = levels => { let v = 1; for (let i = 0; i < levels; i++) v = [v]; return v; };
  assert.equal(canonicalize(nestArr(12)).ok, true);
  assert.equal(canonicalize(nestArr(13)).problems[0].code, 'too-deep');
});

// A guard on the contract's central promise: these modules only compute. Scans
// the source of every module that is not a test, with comments removed.
test('the persistence modules import nothing outside this folder and touch no clock, storage, network, file or environment', () => {
  const dir = new URL('./', import.meta.url);
  const modules = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  assert.ok(modules.length >= 10, modules.join());
  const forbidden = [
    /\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage/, /sessionStorage/, /indexedDB/,
    /\bprocess\b/, /\bglobalThis\b/, /\bwindow\b/, /\bdocument\b/, /\bDate\b/, /Math\.random/, /performance\.now/,
    /\brequire\s*\(/, /\bimport\s*\(/, /['"]node:/, /supabase/i, /\bsetTimeout\b/, /\bsetInterval\b/, /\bcrypto\b/, /\bBuffer\b/,
  ];
  for (const file of modules) {
    const source = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} uses ${pattern}`);
    for (const [, from] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.match(from, /^\.\/[a-z-]+\.mjs$/, `${file} imports ${from}`);
      assert.ok(modules.includes(from.slice(2)), `${file} imports ${from}, which is not one of this folder's modules`);
      assert.notEqual(from, './fake-port.mjs', `${file} imports the test-only double`);
    }
  }
});
