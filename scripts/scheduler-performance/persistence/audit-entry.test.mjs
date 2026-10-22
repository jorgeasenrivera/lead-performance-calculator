import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditEntry, verifyEntry, verifyChain, validTimestamp, ACTIONS } from './audit-entry.mjs';

const codes = result => result.problems.map(p => p.code);
const clone = value => JSON.parse(JSON.stringify(value));
const input = (over = {}) => ({
  action: 'draft-save', storeId: 'cedar', month: '2026-10', actor: { id: 'manager-1' }, at: '2026-10-18T09:00:00Z',
  fromRev: 0, toRev: 1, subject: { kind: 'draft', rev: 1, digest: 'a'.repeat(16) }, prevHash: null, ...over,
});
const chain = n => {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push(buildAuditEntry(input({ fromRev: i, toRev: i + 1, subject: { kind: 'draft', rev: i + 1, digest: String(i).repeat(16) }, prevHash: i ? entries[i - 1].hash : null })).entry);
  return entries;
};

test('builds a frozen, hashed entry from supplied facts', () => {
  const result = buildAuditEntry(input());
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const { entry } = result;
  assert.equal(entry.actor.id, 'manager-1');
  assert.equal(entry.at, '2026-10-18T09:00:00Z');
  assert.match(entry.hash, /^[0-9a-f]{16}$/);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.actor), true);
  assert.throws(() => { 'use strict'; entry.actor.id = 'other'; }, TypeError);
  assert.deepEqual(buildAuditEntry(input()).entry, entry, 'the same facts give the same entry');
});

test('the actor is only what the caller passes, and nothing else can carry one', () => {
  assert.ok(codes(buildAuditEntry(input({ actor: undefined }))).includes('bad-actor'));
  assert.ok(codes(buildAuditEntry(input({ actor: { id: 'm', role: 'admin' } }))).includes('bad-actor'), 'no role: naming who may act is not decided here');
  assert.ok(codes(buildAuditEntry(input({ actor: 'manager-1' }))).includes('bad-actor'));
  assert.ok(codes(buildAuditEntry(input({ actor: { id: 'has space' } }))).includes('bad-actor'));
  assert.ok(codes(buildAuditEntry(input({ actor: { id: '' } }))).includes('bad-actor'));
  assert.ok(codes(buildAuditEntry(input({ actor: { id: 'x'.repeat(81) } }))).includes('bad-actor'));
  assert.ok(codes(buildAuditEntry({ ...input(), userId: 'someone' })).includes('unknown-key'));
  assert.ok(codes(buildAuditEntry({ ...input(), createdBy: 'someone' })).includes('unknown-key'));
  assert.ok(codes(buildAuditEntry(input({ detail: { actor: 'forged' } }))).includes('bad-detail-key'));
});

test('times are UTC text with a real date', () => {
  for (const ok of ['2026-10-18T09:00:00Z', '2026-10-18T23:59:59.999Z', '2024-02-29T00:00:00Z']) assert.equal(validTimestamp(ok), true, ok);
  for (const bad of ['2026-10-18 09:00:00Z', '2026-10-18T09:00:00', '2026-10-18T09:00:00+00:00', '2026-02-30T09:00:00Z', '2026-10-18T24:00:00Z', '2026-10-18T09:60:00Z', '2026-10-18', 1760778000000, null, undefined]) {
    assert.equal(validTimestamp(bad), false, String(bad));
    assert.ok(codes(buildAuditEntry(input({ at: bad }))).includes('bad-time'));
  }
});

test('refuses a bad action, identity, revision range, subject or previous hash', () => {
  assert.deepEqual([...ACTIONS], ['draft-save', 'publish', 'reset', 'restore']);
  assert.ok(codes(buildAuditEntry(input({ action: 'delete' }))).includes('bad-action'));
  assert.ok(codes(buildAuditEntry(input({ storeId: 'Cedar' }))).includes('bad-store-id'));
  assert.ok(codes(buildAuditEntry(input({ month: '2026-13' }))).includes('bad-month'));
  assert.ok(codes(buildAuditEntry(input({ fromRev: 3, toRev: 2 }))).includes('bad-rev'));
  assert.ok(codes(buildAuditEntry(input({ fromRev: -1 }))).includes('bad-rev'));
  assert.ok(codes(buildAuditEntry(input({ subject: { kind: 'other', rev: 1, digest: 'a'.repeat(16) } }))).includes('bad-subject'));
  assert.ok(codes(buildAuditEntry(input({ subject: { kind: 'draft', rev: 1 } }))).includes('bad-subject'));
  assert.ok(codes(buildAuditEntry(input({ subject: { kind: 'draft', rev: 1, digest: 'zz' } }))).includes('bad-subject'));
  assert.ok(codes(buildAuditEntry(input({ prevHash: 'nope' }))).includes('bad-prev-hash'));
  assert.ok(codes(buildAuditEntry(input({ prevHash: undefined }))).includes('bad-prev-hash'), 'null must be said, not left out');
  assert.deepEqual(codes(buildAuditEntry(null)), ['not-object']);
});

test('detail is a small flat object of short values', () => {
  assert.equal(buildAuditEntry(input({ detail: { supersedes: 2, note: 'ok', flag: true } })).ok, true);
  assert.ok(codes(buildAuditEntry(input({ detail: { nested: { a: 1 } } }))).includes('bad-detail-value'));
  assert.ok(codes(buildAuditEntry(input({ detail: { long: 'x'.repeat(121) } }))).includes('bad-detail-value'));
  assert.ok(codes(buildAuditEntry(input({ detail: { Bad_Key: 1 } }))).includes('bad-detail-key'));
  assert.ok(codes(buildAuditEntry(input({ detail: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${'a'.repeat(i)}`, 1])) }))).includes('bad-detail'));
  assert.ok(codes(buildAuditEntry(input({ detail: [] }))).includes('bad-detail'));
  assert.ok(codes(buildAuditEntry(input({ detail: { n: NaN } }))).includes('non-finite'), 'stopped by the snapshot before the detail check');
});

test('does not change its input', () => {
  const given = input({ detail: { supersedes: 1 } }), before = clone(given);
  buildAuditEntry(given);
  assert.deepEqual(given, before);
});

test('a built entry verifies, and any edit to it does not', () => {
  const { entry } = buildAuditEntry(input());
  assert.equal(verifyEntry(entry).ok, true);
  for (const change of [e => { e.at = '2026-10-19T09:00:00Z'; }, e => { e.actor.id = 'other'; }, e => { e.toRev = 5; }, e => { e.detail = { x: 1 }; }, e => { e.storeId = 'elm'; }, e => { e.hash = '0'.repeat(16); }]) {
    const copy = clone(entry); change(copy);
    assert.equal(verifyEntry(copy).ok, false);
  }
  assert.deepEqual(codes(verifyEntry({ ...clone(entry), extra: 1 })), ['unknown-key']);
  assert.deepEqual(codes(verifyEntry({ ...clone(entry), entryVersion: 2 })), ['unsupported-version']);
  assert.deepEqual(codes(verifyEntry(null)), ['not-object']);
});

test('a chain verifies, and a removed, reordered, edited or foreign entry breaks it', () => {
  const entries = chain(4);
  assert.deepEqual(verifyChain(entries), { ok: true });
  assert.deepEqual(verifyChain([]), { ok: true });
  const removed = [entries[0], entries[2], entries[3]];
  assert.deepEqual([verifyChain(removed).index, codes(verifyChain(removed))], [1, ['chain-broken']]);
  const reordered = [entries[0], entries[2], entries[1], entries[3]];
  assert.equal(verifyChain(reordered).ok, false);
  const edited = entries.map(clone); edited[1].at = '2026-10-19T09:00:00Z';
  assert.deepEqual([verifyChain(edited).index, codes(verifyChain(edited))], [1, ['hash-mismatch']]);
  assert.equal(verifyChain(entries.slice(1)).ok, false, 'a log cannot start mid-chain without saying where');
  assert.equal(verifyChain(entries.slice(1), { after: entries[0].hash }).ok, true);
  const foreign = buildAuditEntry(input({ storeId: 'elm', fromRev: 1, toRev: 2, prevHash: entries[0].hash })).entry;
  assert.deepEqual(codes(verifyChain([entries[0], foreign])), ['mixed-log']);
});

test('the hash depends on the sealer it is given', () => {
  const sealer = { alg: 'test-sum', digest: () => 'e'.repeat(16) };
  assert.equal(buildAuditEntry(input(), sealer).entry.hash, 'e'.repeat(16));
  assert.equal(verifyEntry(buildAuditEntry(input(), sealer).entry, sealer).ok, true);
  assert.equal(verifyEntry(buildAuditEntry(input(), sealer).entry).ok, false);
});

// ---- Review round 1 (F5, L1): what a chain you were handed can and cannot show ---------------

test('an unanchored chain proves its own links, not that it is the whole log', () => {
  const entries = chain(4);
  // Every prefix, including the empty one, is internally valid. Nothing in the entries can say a later one is missing.
  for (let keep = 0; keep <= 4; keep++) assert.deepEqual(verifyChain(entries.slice(0, keep)), { ok: true }, `${keep} entries`);
  assert.deepEqual(verifyChain([]), { ok: true });
  // An entry removed from the interior is visible, because the next entry no longer follows.
  assert.equal(verifyChain([entries[0], entries[1], entries[3]]).ok, false);
  // A missing start is visible only when the caller says where the segment must start.
  assert.equal(verifyChain(entries.slice(1)).ok, false);
  assert.equal(verifyChain(entries.slice(1), { after: entries[0].hash }).ok, true);
  assert.equal(verifyChain(entries.slice(0, 2), { after: entries[0].hash }).ok, false, 'a wrong start fails');
  // The end is never checked. A segment that stops early still verifies against the true start.
  assert.equal(verifyChain(entries.slice(0, 2), { after: null }).ok, true);
  // The last hash is what a trusted copy would have to hold to detect truncation.
  assert.notEqual(entries[1].hash, entries[3].hash);
});

test('a chain can be re-created from scratch by anyone who can write the log, so it is evidence of change, not authenticity', () => {
  const forged = [buildAuditEntry(input({ actor: { id: 'someone-else' }, subject: { kind: 'draft', rev: 1, digest: 'f'.repeat(16) } })).entry];
  assert.deepEqual(verifyChain(forged), { ok: true });
});

test('an entry records no algorithm or key, so a chain is only checked with the sealer it was written with', () => {
  const { entry } = buildAuditEntry(input());
  assert.equal(Object.keys(entry).some(k => /alg|key|sealer|signature/i.test(k)), false);
  const other = { alg: 'test-sum', digest: () => 'e'.repeat(16) };
  assert.equal(verifyChain(chain(2), {}, other).ok, false);
});
