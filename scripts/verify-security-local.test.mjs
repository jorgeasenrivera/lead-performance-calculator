import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot, verifySnapshot, toolingDigest, MANIFEST } from './verify-security-local.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = collectSnapshot(root);
// This test fixture anchor is for mutation tests only, not a review receipt.
// The CLI separately requires an externally reviewed digest.
const fixtureAnchor = toolingDigest(snapshot.read);
const verify = input => verifySnapshot(input, fixtureAnchor);
const mutateRead = (path, value) => ({ ...snapshot, read: p => p === path ? Buffer.from(value) : snapshot.read(p) });
test('exact reviewed local snapshot qualifies without replacing historical guard', () => {
  const result = verify(snapshot);
  assert.equal(result.runtimePaths, 106);
  assert.equal(result.behaviorFiles, 8);
  assert.equal(result.historicalGuardStillFails.length, 7);
});
for (const [name, change] of [
  ['wrong base', { head: '0'.repeat(40) }],
  ['changed original manifest', { original: Buffer.from('rewritten') }],
  ['wrong historical source', { historicalManifest: Buffer.from('wrong') }],
  ['wrong core parent', { historicalCoreBefore: Buffer.from('wrong') }],
  ['wrong core commit', { historicalCoreAfter: Buffer.from('wrong') }],
  ['different base core', { baseCore: Buffer.from('wrong') }],
  ['unrelated tracked drift', { changed: [...snapshot.changed, 'api/open-room.mjs'] }],
  ['undeclared new file', { untracked: [...snapshot.untracked, 'src/unreviewed.js'] }],
  ['missing changed file', { changed: snapshot.changed.slice(1) }],
  ['duplicate path', { changed: [...snapshot.changed, snapshot.changed[0]] }],
  ['staged edit', { staged: ['api/queue-action.mjs'] }],
]) test(`rejects ${name}`, () => assert.throws(() => verify({ ...snapshot, ...change })));
for (const [name, edit] of [
  ['wrong hash', m => { m.runtime['api/queue-action.mjs'] = '0'.repeat(64); }],
  ['removed path', m => { delete m.runtime['api/_env.mjs']; }],
  ['added path', m => { m.runtime['api/unreviewed.mjs'] = '0'.repeat(64); }],
  ['changed anchor', m => { m.base = '0'.repeat(40); }],
  ['blessed unrelated change', m => { m.reviewedFiles['api/open-room.mjs'] = '0'.repeat(64); }],
]) test(`rejects manifest ${name}`, () => {
  const m = JSON.parse(snapshot.manifest); edit(m);
  assert.throws(() => verify({ ...snapshot, manifest: Buffer.from(JSON.stringify(m, null, 2) + '\n') }), /reviewed manifest/);
});
test('rejects duplicate manifest key', () => {
  const text = snapshot.manifest.toString().replace('"version": 1', '"version": 1, "version": 1');
  assert.throws(() => verify({ ...snapshot, manifest: Buffer.from(text) }));
});
for (const path of ['api/queue-action.mjs', 'test/link-person.test.mjs', 'test/security-authorization.test.mjs', 'src/LeadPerformanceCalculator.jsx', 'src/Manager.jsx', '.github/workflows/manager-spacing.yml']) {
  test(`rejects unreviewed bytes in ${path}`, () => assert.throws(() => verify(mutateRead(path, 'unreviewed'))));
}
test('refuses missing candidate tooling', () => {
  const s = { ...snapshot, untracked: snapshot.untracked.filter(p => p !== MANIFEST) };
  assert.throws(() => verify(s));
});

test('rejects absent or incorrect external tooling anchor', () => {
  assert.throws(() => verifySnapshot(snapshot), /external reviewed tooling hash required/);
  assert.throws(() => verifySnapshot(snapshot, '0'.repeat(64)), /external review anchor/);
});
for (const path of ['scripts/verify-security-local.mjs', 'scripts/verify-security-local.test.mjs', MANIFEST]) {
  test(`rejects altered qualification tooling ${path}`, () => assert.throws(() => verify(mutateRead(path, 'unreviewed')), /external review anchor/));
}
