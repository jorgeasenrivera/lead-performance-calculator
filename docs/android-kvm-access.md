# Temporary KVM access for one reviewed Android run

Prepared, not activated. Jorge approved temporary access on the disposable
GitHub runner, the bounded Android test and restoration of original access.
Independent review of the new PR #472 head is still required before execution.
No new label has been applied and no test run has been started in this update.

## Evidence and strict boundary

[Diagnostic run 38601677702](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/38601677702/job/115982214525)
found `/dev/kvm` to be a non-symlink character device, major/minor 10:232,
owner/group 0:993 (`root:kvm`), mode 0660, with exactly these base ACL entries:

```
user::rw-
group::rw-
other::---
```

UID 1001 was outside group 993 and had neither read nor write access. The
controller requires these conditions again, the current real/effective UID to
both be 1001, group 993 to still be named kvm, no KVM membership, a hosted Linux
X64 GitHub runner and preinstalled getfacl/setfacl/sudo. Any mismatch aborts.
Extended ACLs or masks are rejected, not rewritten into the expected state.
No package or tool is installed to obtain permission-changing commands.

The complete numeric `getfacl -p -n` output and device identity/metadata are
saved atomically in `$RUNNER_TEMP/sage-kvm-acl.json` before mutation. The only
grant command is `sudo -n /usr/bin/setfacl --no-mask -m
u:1001:rw-,m::rw- /dev/kvm`. It adds only the current runner's read/write entry
and an explicit rw mask. Owner rw, existing group rw and other none stay
identical, as do owner/group, device identity and mode. The postcondition checks
the exact granted ACL and actual read/write access before starting the test.
The original emulator acceleration, license, SDK and time-limit checks remain.

## Restoration

`with-kvm.sh` installs EXIT/INT/TERM traps before granting. The unchanged test
runs in its own process group. INT/TERM stop that group before the EXIT trap
restores the ACL; the child script retains its emulator/server cleanup. A
separate `if: always()` workflow step repeats restoration and verification.
Only the same device identity is eligible for restoration. An unexpected
third-party ACL change fails closed rather than silently overwriting it.

Restoration sends the complete saved ACL to `sudo -n /usr/bin/setfacl
--no-mask --set-file=- /dev/kvm`. The fixed device argument prevents snapshot
headers from selecting other files; this does not restore/change ownership.
The controller verifies exact original ACL text, device identity/metadata and
revoked runner read/write access. It retains the snapshot/status for audit and
idempotent always-cleanup verification. A setter interrupted after mutation is
recoverable from the saved prepared state. Restoration failure fails the job;
it cannot be reported as successful merely because the Android test passed.

SIGKILL, host loss or forcibly terminated Actions jobs cannot be guaranteed to
run either cleanup mechanism. This is a disposable hosted VM, not a persistent
machine. Inspect both restoration messages before treating an attempt as clean.
A changed device or external ACL must be investigated, not bypassed. Existing
open KVM handles are why the test is stopped before restoring access.

Review remains tied to the exact PR head label. The job additionally rejects
`github.run_attempt != 1`. Authorize only one new labeled run; do not reapply
the label to start another. No automatic retry, production change, group/udev
change, broad chmod, new credential or license acceptance is introduced.

## Restoration checks

Ten synthetic Python cases cover full snapshot restoration, idempotent cleanup,
a setter interrupted after mutation, restoration failure followed by retry,
unexpected original ACL/mask, changed device identity, third-party ACL changes,
failed revocation verification, repeated grant rejection, exact privileged
commands and device type/owner/group/mode/number rejection (some cases combine
checks). Four real shell-wrapper cases use a fake controller and child process:
success, child failure, SIGTERM and restoration failure with a failing exit.
No sudo or KVM operation occurs in these tests.

An additional real POSIX ACL round trip uses libacl on an owned temporary file.
It explicitly skips only unavailable libacl or initial EOPNOTSUPP. This cloud
filesystem returned EOPNOTSUPP; that case is not real ACL restoration evidence.
The hosted run must still verify real device restoration. Local tests are not
Android emulator or physical-device evidence.

[ACL semantics and effective mask documentation](https://man7.org/linux/man-pages/man1/getfacl.1.html)
explains why the mask is explicit and why original effective group access is
preserved. The original Android scope and evidence limits remain in
[android-webview.md](android-webview.md).
