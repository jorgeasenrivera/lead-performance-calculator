import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const mode of ['success', 'creation-failure', 'missing-registration', 'missing-config', 'wrong-registration', 'absent-listing', 'listing-failure']) {
  test(`AVD creation and discovery gate: ${mode}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sage avd '));
    try {
      const bin = path.join(dir, 'bin');
      const out = path.join(dir, 'evidence');
      mkdirSync(bin);
      mkdirSync(out);
      // Real helper, fictional tools. No SDK, KVM, boot or license operations.
      writeFileSync(path.join(bin, 'avdmanager'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$ANDROID_AVD_HOME" > "$RUNNER_TEMP/creation-home"
printf '%s\\n' "$ANDROID_USER_HOME" "$ANDROID_EMULATOR_HOME" "$ANDROID_SDK_HOME" > "$RUNNER_TEMP/inherited-homes"
printf '%s\\n' "$@" > "$RUNNER_TEMP/creation-args"
read -r answer
test "$answer" = no
if [[ "$MODE" == creation-failure ]]; then exit 23; fi
mkdir "$ANDROID_AVD_HOME/sage-review.avd"
if [[ "$MODE" != missing-config ]]; then echo fictional-config > "$ANDROID_AVD_HOME/sage-review.avd/config.ini"; fi
if [[ "$MODE" != missing-registration ]]; then
  if [[ "$MODE" == wrong-registration ]]; then
    echo 'path=/fictional/wrong' > "$ANDROID_AVD_HOME/sage-review.ini"
  else
    echo "path=$ANDROID_AVD_HOME/sage-review.avd" > "$ANDROID_AVD_HOME/sage-review.ini"
  fi
fi
`, { mode: 0o700 });
      writeFileSync(path.join(bin, 'emulator'), `#!/bin/bash
set -euo pipefail
if [[ "$1" == -list-avds ]]; then
  printf '%s\\n' "$ANDROID_AVD_HOME" > "$RUNNER_TEMP/listing-home"
  if [[ "$MODE" == listing-failure ]]; then echo sage-review; exit 24; fi
  if [[ "$MODE" == absent-listing ]]; then echo other-avd; echo 'warning: sage-review missing' >&2; else echo sage-review; fi
else
  printf '%s\\n' "$ANDROID_AVD_HOME" > "$RUNNER_TEMP/launch-home"
  printf '%s\\n' "$@" > "$RUNNER_TEMP/launch-args"
fi
`, { mode: 0o700 });
      const result = spawnSync('bash', ['-c', 'set -euo pipefail; source scripts/android-webview/start-emulator.sh; wait'], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, RUNNER_TEMP: dir, OUT: out, MODE: mode,
          AVDMANAGER: path.join(bin, 'avdmanager'), PATH: `${bin}:${process.env.PATH}`,
          ANDROID_AVD_HOME: '/fictional/inherited-avds', ANDROID_USER_HOME: '/fictional/user-home',
          ANDROID_EMULATOR_HOME: '/fictional/emulator-home', ANDROID_SDK_HOME: '/fictional/legacy-home' },
      });
      const expectedHome = path.join(dir, 'sage-review-avd');
      assert.equal(readFileSync(path.join(dir, 'creation-home'), 'utf8').trim(), expectedHome);
      assert.deepEqual(readFileSync(path.join(dir, 'inherited-homes'), 'utf8').trim().split('\n'),
        ['/fictional/user-home', '/fictional/emulator-home', '/fictional/legacy-home']);
      assert.deepEqual(readFileSync(path.join(dir, 'creation-args'), 'utf8').trim().split('\n'),
        ['create', 'avd', '--name', 'sage-review', '--package', 'system-images;android-36;google_apis;x86_64',
          '--device', 'pixel_2', '--path', `${expectedHome}/sage-review.avd`]);
      if (mode === 'success') {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        for (const phase of ['listing', 'launch']) assert.equal(readFileSync(path.join(dir, `${phase}-home`), 'utf8').trim(), expectedHome);
        assert.deepEqual(readFileSync(path.join(dir, 'launch-args'), 'utf8').trim().split('\n'),
          ['-avd', 'sage-review', '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect', '-accel', 'on']);
        assert.match(result.stdout, /registration and emulator discovery verified/);
      } else {
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        assert.equal(existsSync(path.join(dir, 'launch-home')), false, 'failed creation or discovery must not launch');
        assert.doesNotMatch(result.stdout, /discovery verified/);
        if (mode === 'creation-failure') assert.equal(result.status, 23);
        if (mode === 'listing-failure') assert.equal(result.status, 24);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
