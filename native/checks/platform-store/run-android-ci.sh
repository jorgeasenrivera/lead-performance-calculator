#!/usr/bin/env bash
set -euo pipefail
# Called by CI after the test-only APK is built. No production APK is installed.
apk=native/android/journalProbe/build/outputs/apk/debug/journalProbe-debug.apk
test -f "$apk"
test -r /dev/kvm && test -w /dev/kvm
sdk=$(sed -n 's/^JOURNAL_COMPILE_SDK=//p' native/android/journal-toolchain.txt)
[[ "$sdk" =~ ^[0-9]+$ ]]
image="system-images;android-${sdk};google_apis;x86_64"
sdkmanager="${ANDROID_HOME:?}/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
test -x "$sdkmanager" && test -x "$avdmanager"
timeout 600 "$sdkmanager" 'emulator' "$image" > /dev/null
echo no | timeout 60 "$avdmanager" create avd --force --name journal_synthetic --package "$image" > /dev/null
# Refuse an existing emulator or occupied console/ADB port. Never stop one.
if adb devices | awk 'NR > 1 { print $1 }' | grep -Fxq emulator-5554; then
  echo 'Refusing pre-existing emulator-5554' >&2
  exit 1
fi
python3 - <<'PY'
import socket
sockets = []
try:
    for port in (5554, 5555):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sockets.append(sock)
        sock.bind(('127.0.0.1', port))
finally:
    for sock in sockets:
        sock.close()
PY
"$ANDROID_HOME/emulator/emulator" -avd journal_synthetic -port 5554 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -accel on > "$RUNNER_TEMP/journal-emulator.log" 2>&1 &
emulator_pid=$!
# Cleanup targets only the process this script launched, never a serial lookup.
trap 'kill "$emulator_pid" 2>/dev/null || true; wait "$emulator_pid" 2>/dev/null || true' EXIT
timeout 240 adb -s emulator-5554 wait-for-device
kill -0 "$emulator_pid"
adb -s emulator-5554 emu avd name | grep -Fx journal_synthetic
timeout 240 bash -c 'until [[ "$(adb -s emulator-5554 shell getprop sys.boot_completed | tr -d "\r")" == 1 ]]; do sleep 2; done'
adb -s emulator-5554 install "$apk"
timeout 120 adb -s emulator-5554 shell am instrument -w com.sageonline.journalprobe/com.sageonline.sagelive.JournalStoreProbe | tee "$RUNNER_TEMP/journal-instrumentation.txt"
# am instrument's shell exit status alone does not establish test success.
grep -Fx 'INSTRUMENTATION_RESULT: result=PASS synthetic Android store probes' "$RUNNER_TEMP/journal-instrumentation.txt"
grep -Fx 'INSTRUMENTATION_CODE: -1' "$RUNNER_TEMP/journal-instrumentation.txt"
echo 'PASS synthetic Android emulator storage probes; not device or power-loss proof'
