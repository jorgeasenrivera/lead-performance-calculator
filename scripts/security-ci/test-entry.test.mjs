import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testArguments } from './test-entry.mjs';
const branch = 'codex/security-authorization-ci';
test('candidate npm test preserves selected fixture exclusions', () => assert.deepEqual(testArguments(branch), ['scripts/security-ci/run.mjs', 'tests']));
test('detached push and PR candidate use selected suite', () => {
  assert.deepEqual(testArguments('', { GITHUB_REF_NAME: branch }), ['scripts/security-ci/run.mjs', 'tests']);
  assert.deepEqual(testArguments('', { GITHUB_HEAD_REF: branch, GITHUB_REF_NAME: '500/merge' }), ['scripts/security-ci/run.mjs', 'tests']);
});
test('ordinary branches retain original Node discovery', () => {
  for (const b of ['main', 'codex/other', branch + '-other']) assert.deepEqual(testArguments(b), ['--test']);
  assert.deepEqual(testArguments('main', { GITHUB_HEAD_REF: branch }), ['--test']);
});
test('unknown detached checkout refuses automatic fixture discovery', () => assert.throws(() => testArguments(''), /Detached checkout/));
test('same-named fork retains ordinary tests, same-repository PR uses selected suite', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: branch, GITHUB_REPOSITORY: 'owner/repo' };
  assert.deepEqual(testArguments('', env, { pull_request: { head: { repo: { full_name: 'fork/repo' } } } }), ['--test']);
  assert.deepEqual(testArguments('', env, { pull_request: { head: { repo: { full_name: 'owner/repo' } } } }), ['scripts/security-ci/run.mjs', 'tests']);
  assert.throws(() => testArguments('', env), /repository evidence/);
});
