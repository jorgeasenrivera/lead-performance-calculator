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

`with-kvm.sh` installs EXIT/INT/TERM traps before granting. A Python child
[subreaper](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html) runs the unchanged test commands in a new process group/session. It
also adopts daemonized descendants, including those that start another session.
On every exit, including success, child failure and cancellation, it sends TERM
to the process group and discovered descendants, waits/reaps for up to three
seconds, then escalates to KILL with a further three-second verification window.
It requires the original group/session and all adopted descendants to be gone,
including reaped zombies, before writing a stopped process lease. The old
`run.sh` PID-only fire-and-forget cleanup is removed; the supervisor owns cleanup
for all test processes, including emulator, build daemons and fixture servers.

Both the shell trap and the `if: always()` step invoke `cleanup-kvm.sh`. That
first attempts supervisor shutdown, with a 12-second wait bound, and then
independently attempts identity-checked ACL restoration regardless of the
shutdown result. Restoring the original ACL blocks further opens even if an
existing handle could not be drained. Both exit codes are reported; either
failure fails cleanup. Full cleanup is reported verified only when both succeed.
An absent supervisor with an unfinished lease remains an unverified shutdown,
but does not bypass the separate restoration attempt. Supervisor identity includes the Linux process
start time, preventing a reused PID from being mistaken for the supervisor.
Normal EXIT cleanup is independent of the test-script leader's lifetime.
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
open KVM handles are why bounded shutdown is attempted first. Their possible
survival is not a reason to leave a grant permitting further opens in place.

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
checks). Ten real shell-wrapper cases use the real supervisor with a fake ACL
controller: success, child failure, SIGTERM, restoration failure, surviving
descendant, failure with a surviving descendant, TERM-resistant descendant,
separate-session descendant, shutdown failure with successful restoration, and
simultaneous shutdown/restoration failures. Normal shutdown cases still verify
reaping and KILL escalation before restoration. Error cases verify both calls,
both exit codes and the absence of a full-cleanup success message.

Two additional cleanup-helper cases deliberately retain a live fixture process
and simulate failed shutdown. Restoration must still be attempted whether it
succeeds or independently fails; cleanup must fail in both cases. The fixture
process is explicitly killed and waited for afterward. No sudo or KVM operation
occurs in these tests.

An in-memory numeric-serialization check runs even when the filesystem has no
ACL support. The real POSIX ACL round trip uses libacl on an owned temporary file.
It uses `acl_to_any_text` with `TEXT_NUMERIC_IDS`, matching production
`getfacl -n`; name-resolving `acl_to_text` previously made supported CI compare
`runner` with `1001` and fail (run 38603698934). Full ACL and metadata equality
checks remain. A `finally` restores and verifies the snapshot even after a failed
assertion; the test also deliberately injects an assertion failure to exercise it.
It explicitly skips only unavailable libacl or initial EOPNOTSUPP. This cloud
filesystem returned EOPNOTSUPP; that case is not real ACL restoration evidence.
The hosted run must still verify real device restoration. Local tests are not
Android emulator or physical-device evidence.

[ACL semantics and effective mask documentation](https://man7.org/linux/man-pages/man1/getfacl.1.html)
explains why the mask is explicit and why original effective group access is
preserved. The original Android scope and evidence limits remain in
[android-webview.md](android-webview.md).
