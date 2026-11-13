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
timeout 600 "$sdkmanager" "$image" > /dev/null
# Both tools must use the same isolated AVD root, independent of user-home defaults.
ANDROID_AVD_HOME=$(mktemp -d "$RUNNER_TEMP/journal-avds.XXXXXX")
export ANDROID_AVD_HOME
echo no | timeout 60 "$avdmanager" create avd --name journal_synthetic --package "$image" --path "$ANDROID_AVD_HOME/journal_synthetic.avd" > /dev/null
test -f "$ANDROID_AVD_HOME/journal_synthetic.ini"
test -f "$ANDROID_AVD_HOME/journal_synthetic.avd/config.ini"
"$ANDROID_HOME/emulator/emulator" -list-avds | grep -Fx journal_synthetic
# No dependency installation or compilation happens under the KVM group.
exec /usr/bin/python3 native/checks/platform-store/run-android-kvm-stage.py launch "$apk"
