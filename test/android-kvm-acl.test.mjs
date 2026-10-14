import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('ACL lease verifies scoped grant, full restoration and fail-closed recovery', (t) => {
  const result = spawnSync('python3', ['-B', 'scripts/android-webview/test_kvm_acl.py'], { encoding: 'utf8' });
  t.diagnostic(result.stderr.trim());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const mode of ['success', 'failure', 'signal', 'restore-failure']) {
  test(`KVM wrapper trap restores after ${mode}`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sage-kvm-trap-'));
    try {
      mkdirSync(path.join(dir, 'scripts/android-webview'), { recursive: true });
      mkdirSync(path.join(dir, 'bin'));
      copyFileSync('scripts/android-webview/with-kvm.sh', path.join(dir, 'wrapper.sh'));
      // Replace the controller, not sudo or the device. This tests real shell traps.
      writeFileSync(path.join(dir, 'bin/python3'), '#!/bin/bash\necho "$2" >> calls\nif [[ "$2" == restore && "$MODE" == restore-failure ]]; then exit 1; fi\n', { mode: 0o700 });
      writeFileSync(path.join(dir, 'scripts/android-webview/run.sh'), '#!/bin/bash\ntouch started\nif [[ "$MODE" == signal ]]; then sleep 30; fi\nif [[ "$MODE" == failure ]]; then exit 17; fi\n');
      const child = spawn('bash', ['wrapper.sh'], { cwd: dir, env: { ...process.env, MODE: mode, PATH: `${dir}/bin:${process.env.PATH}` }, stdio: 'pipe' });
      let output = '';
      child.stdout.on('data', b => { output += b; });
      child.stderr.on('data', b => { output += b; });
      const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
      if (mode === 'signal') {
        for (let i = 0; i < 100 && !existsSync(path.join(dir, 'started')); i++) await new Promise(r => setTimeout(r, 10));
        assert.ok(existsSync(path.join(dir, 'started')));
        child.kill('SIGTERM');
      }
      const result = await exited;
      assert.equal(result.code, { success: 0, failure: 17, signal: 143, 'restore-failure': 1 }[mode], output);
      assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'), ['grant', 'restore']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
