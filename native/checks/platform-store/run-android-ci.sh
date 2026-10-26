#!/usr/bin/env bash
set -euo pipefail
# Called by CI after the test-only APK is built. No production APK is installed.
apk=native/android/journalProbe/build/outputs/apk/debug/journalProbe-debug.apk
test -f "$apk"
sdk=$(sed -n 's/^JOURNAL_COMPILE_SDK=//p' native/android/journal-toolchain.txt)
[[ "$sdk" =~ ^[0-9]+$ ]]
image="system-images;android-${sdk};google_apis;x86_64"
sdkmanager="${ANDROID_HOME:?}/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
adb="$ANDROID_HOME/platform-tools/adb"
test -x "$sdkmanager" && test -x "$avdmanager" && test -x "$adb"
timeout 600 "$sdkmanager" 'emulator' > /dev/null
python3 native/checks/platform-store/check-android-acceleration.py "$ANDROID_HOME/emulator/emulator"
timeout 600 "$sdkmanager" "$image" > /dev/null
# Both tools must use the same isolated AVD root, independent of user-home defaults.
ANDROID_AVD_HOME=$(mktemp -d "$RUNNER_TEMP/journal-avds.XXXXXX")
export ANDROID_AVD_HOME
echo no | timeout 60 "$avdmanager" create avd --name journal_synthetic --package "$image" --path "$ANDROID_AVD_HOME/journal_synthetic.avd" > /dev/null
test -f "$ANDROID_AVD_HOME/journal_synthetic.ini"
test -f "$ANDROID_AVD_HOME/journal_synthetic.avd/config.ini"
"$ANDROID_HOME/emulator/emulator" -list-avds | grep -Fx journal_synthetic
# Refuse an existing emulator or occupied console/ADB port. Never stop one.
devices=$("$adb" devices)
if printf '%s\n' "$devices" | awk 'NR > 1 { print $1 }' | grep -Fxq emulator-5554; then
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
journal_cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    if kill -0 "$emulator_pid" 2>/dev/null; then
      echo 'Synthetic emulator failure: child still running'
    else
      echo 'Synthetic emulator failure: child exited before completion'
    fi
    # Print only fixed classifications, never log lines, paths or arbitrary values.
    python3 - "$RUNNER_TEMP/journal-emulator.log" <<'JOURNAL_DIAGNOSTICS' || true
import re
import sys

try:
    with open(sys.argv[1], 'rb') as stream:
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(max(0, size - 131072))
        text = stream.read(131072).decode('utf-8', errors='replace').lower()
except OSError:
    print('Synthetic emulator diagnostic: startup log unavailable')
    sys.exit(0)

categories = (
    ('missing shared library', r'error while loading shared libraries|cannot open shared object file|library not loaded'),
    ('disk space exhausted', r'no space left|not enough (?:disk )?space|insufficient (?:disk )?space'),
    ('acceleration or KVM error', r'(?:kvm|accel(?:eration)?).{0,100}(?:fail|error|denied|not supported|not installed|unavailable|required)|(?:fail|error|denied).{0,100}(?:kvm|accel)'),
    ('GPU or Qt initialization error', r'(?:gpu|qt|xcb|egl|vulkan|opengl).{0,100}(?:fail|error|not found|could not|cannot)|(?:fail|error|could not|cannot).{0,100}(?:gpu|qt|xcb|egl|vulkan|opengl)'),
    ('AVD lookup or configuration error', r'unknown avd|avd.{0,100}(?:not found|missing|invalid)|broken avd'),
    ('system image missing', r'(?:system image|sdk root).{0,100}(?:not found|missing|invalid)|cannot find.{0,100}system'),
    ('port already occupied', r'address already in use|port.{0,50}(?:in use|occupied)'),
    ('CPU or architecture unsupported', r'(?:cpu|architecture).{0,100}(?:unsupported|not supported)|unsupported.{0,100}(?:cpu|architecture)'),
)
matched = False
for label, pattern in categories:
    if re.search(pattern, text):
        print('Synthetic emulator diagnostic: ' + label)
        matched = True
if not matched:
    print('Synthetic emulator diagnostic: no recognized startup error in bounded log tail')
JOURNAL_DIAGNOSTICS
  fi
  kill "$emulator_pid" 2>/dev/null || true
  wait "$emulator_pid" 2>/dev/null || true
  exit "$status"
}
trap journal_cleanup EXIT
timeout 240 "$adb" -s emulator-5554 wait-for-device
kill -0 "$emulator_pid"
"$adb" -s emulator-5554 emu avd name | grep -Fx journal_synthetic
timeout 240 bash -c 'until [[ "$("$1" -s emulator-5554 shell getprop sys.boot_completed | tr -d "\r")" == 1 ]]; do sleep 2; done' _ "$adb"
"$adb" -s emulator-5554 install "$apk"
timeout 120 "$adb" -s emulator-5554 shell am instrument -w com.sageonline.journalprobe/com.sageonline.sagelive.JournalStoreProbe | tee "$RUNNER_TEMP/journal-instrumentation.txt"
# am instrument's shell exit status alone does not establish test success.
grep -Fx 'INSTRUMENTATION_RESULT: result=PASS synthetic Android store probes' "$RUNNER_TEMP/journal-instrumentation.txt"
grep -Fx 'INSTRUMENTATION_CODE: -1' "$RUNNER_TEMP/journal-instrumentation.txt"
echo 'PASS synthetic Android emulator storage probes; not device or power-loss proof'
