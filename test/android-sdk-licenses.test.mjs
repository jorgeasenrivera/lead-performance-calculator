import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Android package-specific license proof, offline fictional regressions', () => {
  const result = spawnSync('python3', ['scripts/android-webview/test_licenses.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 14 tests/);
});
