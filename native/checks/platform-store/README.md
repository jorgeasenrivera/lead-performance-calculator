# Isolated journal stores: platform validation hold

These are uncompiled, unwired storage candidates. The two classes are in existing module source directories, so they will join a future native compilation even though Expo exposes no methods and no runtime caller imports them. Do not merge/release or wire them on the strength of Node tests or the web build.

Targets inspected: `native/modules/sage-live/ios/SageLive.podspec` declares Swift 5.9 and iOS 15.1; Android's module inherits its SDK targets from the existing Expo module configuration and uses compile SDK 36-era dependencies. No SDK/dependency/build setting was changed. The stores use Foundation/Darwin or existing Android/Java framework APIs, not new libraries. Local `swift`, `swiftc`, `kotlinc`, `javac`, `gradle` are absent; only `java` was found. Neither platform probe below was compiled or executed.

## Contract

Caller supplies an existing, canonical, dedicated private directory. No default path, account directory, existing pending-word file, credential store, migration or deletion is supplied. The directory and its ancestors must remain under trusted app ownership and must not be renamed, replaced, hard-linked or mounted over while in use. Symlink roots/lock/data files are refused; owner operations check the directory's device/inode identity. This is not an adversarial filesystem sandbox.

`acquire(directory)` returns an explicit owner or throws busy/error without waiting. The owner retains a kernel lock on a permanent `journal.lock` inode across asynchronous caller work. It must be retained strongly and closed in the caller's finally/defer after all reads, dispatch and writes complete. Do not expose raw handles via Expo yet. Reentry acquires no new owner: Swift has a process registry plus flock, Android has an inode-keyed registry before opening the FileChannel lock descriptor. This avoids closing a second descriptor and releasing a same-process POSIX lock. All actors must use the same store API and must never unlink/replace/hard-link the lock file. No lock timeout, stealing or stale-lock-file deletion exists. Process death is expected to release kernel ownership, subject to the platform probes.

Each owner's synchronous operations serialize against close. That mutex is not held across caller await; the retained kernel lock is. Callbacks used for fault injection must not reenter owner methods. They are internal test hooks, not an Expo/public API. Swift has best-effort deinit release; Android requires explicit Closeable ownership, with process death as the final OS release. A close failure quarantines the process registry entry rather than permitting another owner on uncertain release.

`read()` returns nil/null only if the final journal is confirmed absent, the original directory still exists unchanged, and no journal temporary remains. Missing final data plus an orphan temporary is an error requiring review, never a new empty journal. Healthy final data ignores but preserves stale temporary files. Malformed UTF-8/JSON, non-object envelopes, wrong format/revision/record-list shapes and credential-named keys fail. This is storage-envelope validation only: the existing JS foundation must still validate every record and immutable context before modifying it. The store is not a semantic authorization validator. Callers must never serialize credentials or sensitive values under innocent keys; key-name rejection cannot classify arbitrary strings.

`replace(bytes)` copies/validates bytes and first reads existing data so unreadable/corrupt final data is not reset. It creates a unique 0600 temporary on the same filesystem, writes and synchronizes it, atomically renames to `journal.json`, then synchronizes the parent directory. Darwin additionally requests F_FULLFSYNC before rename and after directory sync through the retained replacement descriptor. An unsupported sync request is a write failure, not a silent downgrade. Platform support and physical power-loss guarantees remain unproven.

Any failure after the temporary-write phase begins poisons that owner. Input validation and old-data read failures propagate before mutation and do not poison it. A failure after rename may mean the new bytes are visible or durable; no success, rollback, retry or deletion is inferred. Close and reopen under an explicit recovery path. Temporary files are never promoted, pruned or expired. The existing journal coordinator turns an interrupted sending state into uncertain, without dispatch, only after successful validated reading. No service-role/session credentials or response rows are added.

## Designed Darwin probe, NOT RUN

On a separately authorized Mac with compatible existing Swift tooling, compile into a unique temporary output directory, from repository root:

```sh
swiftc -swift-version 5 native/modules/sage-live/ios/SageIntentJournalStore.swift native/checks/platform-store/SwiftStoreProbe.swift -o /absolute/new/scratch/SwiftStoreProbe
/absolute/new/scratch/SwiftStoreProbe
```

The probe uses a fresh synthetic temporary directory, child processes and bounded watchdogs. Run as an ordinary non-root user so permission-denial controls are meaningful. Cases: absence, same-process/cross-process contention, close/idempotent close/use-after-close, read/write round trip, invalid/credential-key documents, stale temporary retention, exceptions before/after rename, permission/write failure, corrupt-data preservation, holder SIGKILL/reopening, writer SIGKILL at both checkpoints, orphan-only directory and directory displacement. Child killing targets only executables spawned by this probe. No app process or real account data is touched.

This probe uses macOS Process APIs and is intentionally outside the pod's source glob. Even a passing Mac run would not prove iOS protected-file availability, suspension behavior or app/intent async lifetime. Separate unsigned iOS compilation and synthetic device/app-container tests remain required; no signing/release is authorized by these files.

## Designed Android probe, NOT RUN

`android/AndroidManifest.xml`, `JournalStoreProbe.kt` and `JournalLockService.kt` describe a standalone test APK using framework Instrumentation, Service and Messenger, with no JUnit dependency. Compile them together with the candidate Kotlin store using the repository-compatible Android/Kotlin toolchain in an isolated test module, package `com.sageonline.journalprobe`. No Gradle project or existing module configuration is changed here. Test module assembly/install are prerequisites, not completed actions or authorization to install tooling.

Once separately assembled/installed on an authorized synthetic device, the entry point is:

```sh
adb shell am instrument -w com.sageonline.journalprobe/com.sageonline.sagelive.JournalStoreProbe
```

The test service is non-exported and runs only in `:journal_probe`, with the test APK's UID and fresh cache directory. It probes contention while a parent owns the lock, then holder/writer death and reopening. It never kills the instrumented parent or a production app. Other cases match Darwin, plus strict rejection of unquoted/single-quoted JSON, malformed inputs, Throwable injection poisoning and directory-permission write denial. Checkpoint exceptions exercise pre/post-rename error handling; they do not force fsync/rename syscalls themselves to fail. ENOSPC and actual sync/rename syscall-failure injection remain additional platform validation gaps on both platforms. The test mutex/kernel behaviors have not executed here. API-target compatibility and device filesystem/FileChannel semantics remain mandatory evidence.

## Further safe local work and integration boundary

Executable Node regressions, source review, frozen-source fingerprints and XML/JS checks can run here. Native compile, actual process-lock/crash tests, locked-device file protection, full-sync support and power-loss behavior cannot be established by them. Do not invent or weaken a primitive when the platform rejects it. A failed required sync or unsafe async owner lifetime is a wiring blocker.

No Expo bridge, intent producer, existing preferences, readiness source, page/server protocol or UI is changed. Verified identity/lifecycle/capability/action mapping and approved review UI are still missing independently of storage. The local room-command contract is not deployed capability proof. The five UX decisions remain unapproved.
