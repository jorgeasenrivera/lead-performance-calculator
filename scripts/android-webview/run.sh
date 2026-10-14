#!/usr/bin/env bash
set -euo pipefail
ROOT=$PWD
OUT="$ROOT/android-webview-evidence"
mkdir -p "$OUT"
exec > >(tee "$OUT/run.txt") 2>&1
printf 'Harness: %s\nRelease: d9320e253b603260f6a7355d4bc1c77a59fefa5b\n' "$(git rev-parse HEAD)"
: "${ANDROID_HOME:?Android SDK required}"
# No sudo, chmod, udev rules, license acceptance or software emulation fallback.
test -r /dev/kvm && test -w /dev/kvm || { echo 'BLOCKED: accessible KVM required'; exit 1; }
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
test -x "$SDKMANAGER"
# EOF never answers yes. Missing acceptance must be resolved outside this task.
timeout 60 "$SDKMANAGER" --licenses </dev/null > "$OUT/licenses.txt" 2>&1
grep -q 'All SDK package licenses accepted' "$OUT/licenses.txt" || { echo 'BLOCKED: SDK license acceptance not established'; exit 1; }
timeout 300 "$SDKMANAGER" 'emulator' 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1' 'cmake;3.30.5' 'system-images;android-36;google_apis;x86_64' </dev/null
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
emulator -accel-check
java -version
node --version
"$SDKMANAGER" --list_installed > "$OUT/sdk-packages.txt"
SOURCE="${RUNNER_TEMP:?}/sage-android-source"
node scripts/android-webview/prepare.mjs prepare "$SOURCE"
(cd "$SOURCE" && npm ci && npm run build)
(cd "$SOURCE/native" && npm ci && npx --no-install expo prebuild --platform android --no-install)
# Prebuild uses the template's standard debug keystore. Never generate a key,
# supply a signing secret, invoke EAS or build a release variant.
test -f "$SOURCE/native/android/app/debug.keystore"
(cd "$SOURCE/native/android" && timeout 1200 ./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64 -Pandroid.builder.sdkDownload=false --console=plain)
npm install --prefix "$RUNNER_TEMP/android-driver" --no-package-lock --no-save playwright@1.63.0
printf 'no\n' | "$AVDMANAGER" create avd --name sage-review --package 'system-images;android-36;google_apis;x86_64' --device pixel_2
# The outer subreaper owns bounded shutdown and waits for all descendants.
emulator -avd sage-review -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -accel on > "$OUT/emulator.txt" 2>&1 &
timeout 120 adb wait-for-device
for attempt in $(seq 1 120); do
  test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 && break
  sleep 1
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1
adb shell input keyevent 82
adb shell settings put secure show_ime_with_hard_keyboard 1
adb shell dumpsys webviewupdate > "$OUT/webview-provider.txt"
adb shell settings get secure default_input_method > "$OUT/ime.txt"
adb reverse tcp:5179 tcp:5179
adb reverse tcp:5433 tcp:5433
adb reverse tcp:8081 tcp:8081
(cd "$SOURCE" && node scripts/mock-supabase.mjs) > "$RUNNER_TEMP/android-mock.log" 2>&1 &
(cd "$SOURCE" && npx --no-install vite preview --port 5178 --host 127.0.0.1) > "$RUNNER_TEMP/android-preview.log" 2>&1 &
node scripts/android-webview/prepare.mjs serve > "$RUNNER_TEMP/android-fixture.log" 2>&1 &
(cd "$SOURCE/native" && npx --no-install expo start --localhost --port 8081) > "$RUNNER_TEMP/android-metro.log" 2>&1 &
for port in 5179 8081; do
  for attempt in $(seq 1 60); do curl -fsS "http://127.0.0.1:$port/" >/dev/null && break; sleep 1; done
  curl -fsS "http://127.0.0.1:$port/" >/dev/null
done
adb install "$SOURCE/native/android/app/build/outputs/apk/debug/app-debug.apk"
ANDROID_PLAYWRIGHT="$RUNNER_TEMP/android-driver/node_modules/playwright/index.mjs" timeout 300 node scripts/android-webview/probe.mjs
