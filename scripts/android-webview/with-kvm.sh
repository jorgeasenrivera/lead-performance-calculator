#!/usr/bin/env bash
set -euo pipefail
child=''
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if ! python3 scripts/android-webview/kvm_acl.py restore; then
    echo 'ERROR: KVM ACL restoration failed; always cleanup must retry and verify' >&2
    exit 1
  fi
  exit "$result"
}
stop() {
  if [[ -n "$child" ]]; then
    kill -TERM -- "-$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit "$1"
}
trap cleanup EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
python3 scripts/android-webview/kvm_acl.py grant
# Separate process group lets cancellation stop the test before revoking access.
setsid bash scripts/android-webview/run.sh &
child=$!
wait "$child"
