#!/usr/bin/env bash
set -euo pipefail
# Prove required acceptance before any device access grant or supervised work.
: "${ANDROID_HOME:?Android SDK required}"
source scripts/android-webview/sdk-packages.sh
OUT="$PWD/android-webview-evidence"
mkdir -p "$OUT"
timeout 60 python3 scripts/android-webview/licenses.py --sdk "$ANDROID_HOME" "${PACKAGES[@]}" > "$OUT/licenses.txt" 2>&1 || { cat "$OUT/licenses.txt"; exit 1; }
source scripts/android-webview/prepare-driver.sh
supervisor=''
cleanup() {
  local result=$?
  trap - EXIT
  # Keep cleanup running if cancellation signals arrive again during shutdown.
  trap '' INT TERM
  # Also cover cancellation before the supervisor has written its lease.
  for running in $(jobs -pr); do
    if [[ "$running" == "$supervisor" ]]; then kill -TERM "$supervisor" 2>/dev/null || true; fi
  done
  if ! bash scripts/android-webview/cleanup-kvm.sh; then
    echo 'ERROR: process shutdown or KVM ACL restoration failed; always cleanup must retry and verify' >&2
    exit 1
  fi
  if [[ -n "$supervisor" ]]; then wait "$supervisor" 2>/dev/null || true; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 scripts/android-webview/kvm_acl.py grant
python3 scripts/android-webview/process_group.py run &
supervisor=$!
wait "$supervisor"
