#!/usr/bin/env bash
set -euo pipefail
stage_dir=$(cd -- "$(dirname -- "$0")" && pwd)
/usr/bin/python3 -B "$stage_dir/test_android_stage_lifecycle.py"
/usr/bin/python3 -B "$stage_dir/check-android-acceleration.py" "$ANDROID_HOME/emulator/emulator"
exec /bin/bash "$stage_dir/run-android-probes.sh"
