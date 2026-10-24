import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const checks = read('.github/workflows/checks.yml');
const candidate = read('.github/workflows/security-authorization.yml');
function condition(source, job) {
  const match = source.match(new RegExp(`^  ${job}:\\n    if: (.+)$`, 'm'));
  assert.ok(match, `missing job guard ${job}`);
  return match[1].replace(/^\$\{\{ /, '').replace(/ \}\}$/, '');
}
const repo = 'jorgeasenrivera/lead-performance-calculator';
const branch = 'codex/security-authorization-ci';
for (const [name, github, selected] of [
  ['candidate push', { event_name: 'push', ref: `refs/heads/${branch}`, repository: repo }, true],
  ['ordinary push', { event_name: 'push', ref: 'refs/heads/main', repository: repo }, false],
  ['near-name push', { event_name: 'push', ref: `refs/heads/${branch}-other`, repository: repo }, false],
  ['candidate PR', { event_name: 'pull_request', repository: repo, event: { pull_request: { head: { repo: { full_name: repo }, ref: branch } } } }, true],
  ['ordinary PR', { event_name: 'pull_request', repository: repo, event: { pull_request: { head: { repo: { full_name: repo }, ref: 'codex/other' } } } }, false],
  ['same-name fork PR', { event_name: 'pull_request', repository: repo, event: { pull_request: { head: { repo: { full_name: 'fork/repo' }, ref: branch } } } }, false],
]) test(`workflow routing: ${name}`, () => {
  assert.equal(runInNewContext(condition(candidate, 'qualify'), { github }), selected);
  for (const job of ['test', 'feel', 'feel-webkit', 'shots']) {
    assert.equal(runInNewContext(condition(checks, job), { github }), !selected && (job !== 'shots' || github.event_name === 'pull_request'));
  }
});
test('original checks steps and thresholds remain byte-identical after removing only candidate gates', () => {
  const restored = checks.replace(/^    if: \$\{\{ !\(.*\}\}\n/gm, '').replace(/^    if: github.event_name == 'pull_request' && .*$/m, "    if: github.event_name == 'pull_request'");
  const original = execFileSync('git', ['show', '25d821a6d0a8e3c9b4a700cc5845c574e1c9b837:.github/workflows/checks.yml'], { cwd: root, encoding: 'utf8' });
  assert.equal(restored, original);
});
test('only exact branch deployment disable is added', () => {
  const actual = JSON.parse(read('vercel.json'));
  assert.deepEqual(actual.git, { deploymentEnabled: { [branch]: false } });
  delete actual.git;
  assert.deepEqual(actual, JSON.parse(execFileSync('git', ['show', '25d821a6d0a8e3c9b4a700cc5845c574e1c9b837:vercel.json'], { cwd: root, encoding: 'utf8' })));
});
