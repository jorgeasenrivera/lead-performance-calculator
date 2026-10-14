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

const modes = ['preflight-failure', 'success', 'failure', 'signal', 'restore-failure', 'surviving-descendant',
  'surviving-failure', 'term-resistant-descendant', 'escaped-descendant', 'shutdown-failure', 'both-cleanup-failures'];
for (const mode of modes) {
  test(`KVM wrapper attempts shutdown and restoration: ${mode}`, { timeout: 20000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sage-kvm-trap-'));
    let child;
    try {
      const scriptDir = path.join(dir, 'scripts/android-webview');
      mkdirSync(scriptDir, { recursive: true });
      mkdirSync(path.join(dir, 'bin'));
      for (const file of ['with-kvm.sh', 'cleanup-kvm.sh', 'process_group.py', 'sdk-packages.sh']) {
        copyFileSync(`scripts/android-webview/${file}`, path.join(scriptDir, file));
      }
      // Use the real wrapper, process supervisor and traps; fake license proof and ACL operations.
      const realPython = spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim();
      writeFileSync(path.join(dir, 'bin/python3'), `#!/bin/bash
if [[ "$1" == scripts/android-webview/licenses.py ]]; then
  echo preflight >> calls
  if [[ "$MODE" == preflight-failure ]]; then echo 'BLOCKED: fictional missing acceptance'; exit 23; fi
elif [[ "$1" == scripts/android-webview/kvm_acl.py ]]; then
  if [[ "$2" == restore && -f descendant ]]; then
    if kill -0 "$(cat descendant)" 2>/dev/null; then echo 'descendant alive at ACL restoration' >&2; exit 88; fi
  fi
  echo "$2" >> calls
  if [[ "$2" == restore && ( "$MODE" == restore-failure || "$MODE" == both-cleanup-failures ) ]]; then exit 9; fi
elif [[ "$1" == scripts/android-webview/process_group.py && "$2" == stop && ( "$MODE" == shutdown-failure || "$MODE" == both-cleanup-failures ) ]]; then
  exit 7
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
          ANDROID_HOME: '/fictional-sdk', PYTHONDONTWRITEBYTECODE: '1', PATH: `${dir}/bin:${process.env.PATH}` }, stdio: 'pipe',
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
      if (mode === 'preflight-failure') {
        assert.equal(result.code, 1, output);
        assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'), ['preflight']);
        assert.match(output, /BLOCKED: fictional missing acceptance/);
        assert.equal(existsSync(path.join(dir, 'started')), false, 'supervised child must not start');
        assert.equal(existsSync(path.join(dir, 'sage-android-processes.json')), false);
        return;
      }
      const expected = { failure: 17, 'surviving-failure': 17, signal: 143, 'restore-failure': 1, 'shutdown-failure': 1, 'both-cleanup-failures': 1 }[mode] || 0;
      assert.equal(result.code, expected, output);
      assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'),
        ['preflight', 'grant', 'restore']);
      const shutdownCode = ['shutdown-failure', 'both-cleanup-failures'].includes(mode) ? 7 : 0;
      const restoreCode = ['restore-failure', 'both-cleanup-failures'].includes(mode) ? 9 : 0;
      assert.ok(output.includes(`KVM cleanup results: shutdown=${shutdownCode} restore=${restoreCode}`));
      if (shutdownCode || restoreCode) {
        assert.match(output, /full cleanup unverified/);
        assert.doesNotMatch(output, /KVM cleanup verified:/);
      }
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

for (const restoreCode of [0, 9]) {
  test(`unverified live descendant does not skip ACL restore (restore exit ${restoreCode})`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sage-kvm-independent-'));
    const descendant = spawn('sleep', ['30'], { stdio: 'ignore' });
    const exited = new Promise(resolve => descendant.on('exit', resolve));
    try {
      mkdirSync(path.join(dir, 'bin'));
      copyFileSync('scripts/android-webview/cleanup-kvm.sh', path.join(dir, 'cleanup.sh'));
      writeFileSync(path.join(dir, 'bin/python3'), `#!/bin/bash
if [[ "$1" == scripts/android-webview/process_group.py ]]; then
  echo shutdown >> calls
  exit 7
fi
kill -0 "$DESCENDANT_PID" || exit 88
echo restore-with-live-descendant >> calls
exit "$RESTORE_EXIT"
`, { mode: 0o700 });
      const result = spawnSync('bash', ['cleanup.sh'], { cwd: dir, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, DESCENDANT_PID: String(descendant.pid), RESTORE_EXIT: String(restoreCode),
          PATH: `${dir}/bin:${process.env.PATH}` } });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'),
        ['shutdown', 'restore-with-live-descendant']);
      assert.ok(result.stdout.includes(`shutdown=7 restore=${restoreCode}`));
      assert.match(result.stderr, /full cleanup unverified/);
      assert.doesNotMatch(result.stdout, /KVM cleanup verified:/);
    } finally {
      descendant.kill('SIGKILL');
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
