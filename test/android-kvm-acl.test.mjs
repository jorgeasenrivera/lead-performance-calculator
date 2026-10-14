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

const modes = ['success', 'failure', 'signal', 'restore-failure', 'surviving-descendant',
  'surviving-failure', 'term-resistant-descendant', 'escaped-descendant', 'shutdown-failure'];
for (const mode of modes) {
  test(`KVM wrapper drains descendants before restoration: ${mode}`, { timeout: 20000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sage-kvm-trap-'));
    let child;
    try {
      const scriptDir = path.join(dir, 'scripts/android-webview');
      mkdirSync(scriptDir, { recursive: true });
      mkdirSync(path.join(dir, 'bin'));
      for (const file of ['with-kvm.sh', 'cleanup-kvm.sh', 'process_group.py']) {
        copyFileSync(`scripts/android-webview/${file}`, path.join(scriptDir, file));
      }
      // Use the real process supervisor and traps. Only the ACL controller is fake.
      const realPython = spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim();
      writeFileSync(path.join(dir, 'bin/python3'), `#!/bin/bash
if [[ "$1" == scripts/android-webview/kvm_acl.py ]]; then
  if [[ "$2" == restore && -f descendant ]]; then
    if kill -0 "$(cat descendant)" 2>/dev/null; then echo 'descendant alive at ACL restoration' >&2; exit 88; fi
  fi
  echo "$2" >> calls
  if [[ "$2" == restore && "$MODE" == restore-failure ]]; then exit 1; fi
elif [[ "$1" == scripts/android-webview/process_group.py && "$2" == stop && "$MODE" == shutdown-failure ]]; then
  exit 1
else
  exec "$REAL_PYTHON" "$@"
fi
`, { mode: 0o700 });
      writeFileSync(path.join(dir, 'descendant.sh'), `#!/bin/bash
if [[ "$MODE" == term-resistant-descendant ]]; then trap '' TERM; fi
echo "$$" > descendant
while :; do sleep 30; done
`);
      writeFileSync(path.join(scriptDir, 'run.sh'), `#!/bin/bash
if [[ "$MODE" == *descendant || "$MODE" == surviving-failure ]]; then
  if [[ "$MODE" == escaped-descendant ]]; then setsid bash descendant.sh & else bash descendant.sh & fi
  while [[ ! -f descendant ]]; do sleep .01; done
fi
touch started
if [[ "$MODE" == signal ]]; then sleep 30; fi
if [[ "$MODE" == failure || "$MODE" == surviving-failure ]]; then exit 17; fi
`);
      child = spawn('bash', ['scripts/android-webview/with-kvm.sh'], {
        cwd: dir, env: { ...process.env, MODE: mode, REAL_PYTHON: realPython, RUNNER_TEMP: dir,
          PYTHONDONTWRITEBYTECODE: '1', PATH: `${dir}/bin:${process.env.PATH}` }, stdio: 'pipe',
      });
      let output = '';
      child.stdout.on('data', b => { output += b; });
      child.stderr.on('data', b => { output += b; });
      const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
      if (mode === 'signal') {
        for (let i = 0; i < 200 && !existsSync(path.join(dir, 'started')); i++) await new Promise(r => setTimeout(r, 10));
        assert.ok(existsSync(path.join(dir, 'started')));
        child.kill('SIGTERM');
      }
      const result = await exited;
      const expected = { failure: 17, 'surviving-failure': 17, signal: 143, 'restore-failure': 1, 'shutdown-failure': 1 }[mode] || 0;
      assert.equal(result.code, expected, output);
      assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'),
        mode === 'shutdown-failure' ? ['grant'] : ['grant', 'restore']);
      assert.equal(JSON.parse(readFileSync(path.join(dir, 'sage-android-processes.json'))).status, 'stopped');
      if (existsSync(path.join(dir, 'descendant'))) {
        const pid = readFileSync(path.join(dir, 'descendant'), 'utf8').trim();
        assert.equal(existsSync(`/proc/${pid}`), false, `descendant ${pid} must be reaped before restore`);
      }
      if (mode === 'term-resistant-descendant') assert.match(output, /escalating after SIGTERM/);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGTERM');
      if (existsSync(path.join(dir, 'descendant'))) {
        try { process.kill(Number(readFileSync(path.join(dir, 'descendant'), 'utf8')), 'SIGKILL'); } catch {}
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
