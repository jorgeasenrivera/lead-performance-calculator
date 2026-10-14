#!/usr/bin/env bash
set -euo pipefail
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
