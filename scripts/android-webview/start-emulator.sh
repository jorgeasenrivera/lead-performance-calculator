# Sourced by the supervised run so creation, discovery and launch share this path.
export ANDROID_AVD_HOME="${RUNNER_TEMP:?}/sage-review-avd"
# A fresh location prevents a stale registration from satisfying these checks.
mkdir "$ANDROID_AVD_HOME"
printf 'no\n' | "$AVDMANAGER" create avd --name sage-review --package 'system-images;android-36;google_apis;x86_64' --device pixel_2 --path "$ANDROID_AVD_HOME/sage-review.avd"
if [[ ! -s "$ANDROID_AVD_HOME/sage-review.ini" || ! -s "$ANDROID_AVD_HOME/sage-review.avd/config.ini" ]]; then
  echo 'BLOCKED: sage-review registration or configuration missing' >&2
  exit 1
fi
if [[ "$(grep -c '^path=' "$ANDROID_AVD_HOME/sage-review.ini")" != 1 ]] ||
   ! grep -Fxq "path=$ANDROID_AVD_HOME/sage-review.avd" "$ANDROID_AVD_HOME/sage-review.ini"; then
  echo 'BLOCKED: sage-review registration points outside its expected data path' >&2
  exit 1
fi
emulator -list-avds > "$OUT/avd-list.txt" 2> "$OUT/avd-list-stderr.txt"
if ! grep -Fxq 'sage-review' "$OUT/avd-list.txt"; then
  echo 'BLOCKED: emulator cannot discover sage-review' >&2
  exit 1
fi
printf 'AVD registration and emulator discovery verified: %s\n' "$ANDROID_AVD_HOME"
# The outer subreaper owns bounded shutdown and waits for all descendants.
emulator -avd sage-review -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -accel on > "$OUT/emulator.txt" 2>&1 &
