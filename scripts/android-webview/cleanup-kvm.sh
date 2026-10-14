#!/usr/bin/env bash
set -euo pipefail
# Never revoke the ACL while a test descendant may retain an open KVM handle.
python3 scripts/android-webview/process_group.py stop
python3 scripts/android-webview/kvm_acl.py restore
