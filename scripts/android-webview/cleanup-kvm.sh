#!/usr/bin/env bash
set -euo pipefail
shutdown_status=0
restore_status=0
python3 scripts/android-webview/process_group.py stop || shutdown_status=$?
# Revocation blocks further opens even if old handles could not be drained.
# The controller independently verifies device identity and the original ACL.
python3 scripts/android-webview/kvm_acl.py restore || restore_status=$?
printf 'KVM cleanup results: shutdown=%s restore=%s\n' "$shutdown_status" "$restore_status"
if (( shutdown_status != 0 || restore_status != 0 )); then
  echo 'ERROR: full cleanup unverified; shutdown and ACL restoration must both succeed' >&2
  exit 1
fi
echo 'KVM cleanup verified: descendants stopped and original ACL restored'
