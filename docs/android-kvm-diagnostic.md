# Android KVM runner diagnosis

Preparation only. This diagnostic has not been executed. Review this PR's exact
head before adding its execution label. It does not rerun the Android test.

## Why this exists

[Run 38599473804](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/38599473804/job/115974682039)
checked Android harness head `b78ee46e69731cf560ad5610d1fdcad4fa081b8e` on
Ubuntu 24.04 image `20261012.334.1`. The log stopped at
`BLOCKED: accessible KVM required`, before SDK downloads, builds or emulator
startup. The combined readable/writable check did not record whether `/dev/kvm`
was absent, an unexpected file type or inaccessible to that runner user.

This separate branch starts from main and adds only this document and
`.github/workflows/android-kvm-diagnostic.yml`. Original PR #472, its branch,
emulator gates and all application code stay unchanged. Ownership claims remain
untouched under the original explicit task restriction.

## Review and execution boundary

After independent review, the parent may apply `kvm:<full 40-character head SHA>`
to this diagnostic PR. No label is created or applied as part of preparation.
Only a newly added exact-head label on the same repository's
`codex/android-kvm-diagnostic` branch can run the diagnostic. Push, PR opening
and synchronization do not trigger it. No merge is needed. Later commits require
a newly reviewed matching label.

The job uses standard `ubuntu-24.04`, with a five-minute job timeout and a
two-minute step timeout. It grants no workflow token permissions and invokes
only preinstalled Python and, if present, `getfacl`. It has no checkout, external
actions, tool/package downloads, cache, SDK/license commands, build, emulator,
sudo, device opens, ioctls, permission changes or security-setting changes.
The sole subprocess is bounded read-only `getfacl -p /dev/kvm`.

Output is JSON in the job log, followed by a completion line. There is no
artifact-upload action or generated artifact. It records only allowlisted runner
metadata, kernel architecture/version, process identity and groups, `/dev` stat,
`/dev/kvm` lstat/stat/type/mode/owner/group/device numbers, effective-ID access
checks, ACL output or its explicit unavailability, and counts of CPU flag records
containing vmx/svm/hypervisor. It does not dump the environment or business data.

## Reading the eventual evidence

- Stat errno 2 indicates a missing path or missing symlink target. Compare lstat
  to stat to distinguish the two. Other errors remain explicit, not "missing".
- A present character device with denied read/write access points to an access
  restriction; inspect mode, group membership and ACL before drawing conclusions.
- A missing getfacl tool leaves ACL evidence unavailable. It is never installed.
- CPU virtualization flags are metadata, not proof that KVM can be used. Even
  accessible device metadata does not prove an open or KVM ioctl would succeed.

A completed diagnostic means collection finished, not that acceleration works.
A new hosted runner cannot establish the exact state of the prior failed VM.
Record its image version and identity and compare them with the failed run.
No emulator or physical-device evidence results from this job. Any proposed
remediation or emulator retry remains separate from this diagnostic review.

## Preparation checks

YAML parsing, the single labeled-event trigger, empty token permissions, shell
syntax and embedded Python syntax were checked without executing the diagnostic.
All 916 repository Node tests and the local web build passed. These are ordinary
pre-push checks, not runner, KVM, emulator or Android evidence.
