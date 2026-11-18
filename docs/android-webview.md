# Android WebView review check

Driver preparation and cleanup diagnostics prepared for parent review. The
latest run booted Android and installed the debug APK, then failed during the
first launch because driver assets were missing. ACL restoration was unverified.
No physical Android result exists. Jorge does not own an Android device.

## Scope and ownership

Branch `codex/android-webview-verification` adds only a workflow, test scripts,
one fixture-isolation test and this document. No runtime/UI, native source,
shared mock, signing, production or ownership-board edits. The explicit task
prohibits claims, so it overrides AGENTS.md's normal claim-to-main procedure.
Current X25 is done; C97's core-file ownership remains untouched.

The test exports released commit
`d9320e253b603260f6a7355d4bc1c77a59fefa5b` with `git archive`. The existing
wrapper's `App.js`, native modules and plugins stay unchanged. Only the exported
`app.json` site URL points to `http://127.0.0.1:5179`. The web build uses the
existing local mock and fictional demo seed, never its live demo account.
A local HTTP fixture adds a restrictive CSP before scripts execute, disallows
service workers and external web requests. ADB reverses localhost ports. No
credentials, Expo account, Firebase file, production signing or EAS service is
used. The existing first-launch location prompt is declined, never granted. The generated Expo template's existing debug keystore signs the debug APK;
no new signing key is generated. The APK is not uploaded or distributed.

## Feasibility and prerequisites

The cloud container has no SDK, emulator or `/dev/kvm`; it cannot supply Android
evidence. GitHub's official runner documentation explicitly supports Android
hardware acceleration on hosted Linux. The repository is public, verified via
GitHub metadata, so a standard `ubuntu-24.04` job does not use paid hosted minutes.
The workflow refuses private repositories and bounds one job to 40 minutes,
SDK acquisition to 5 minutes, compilation to 20 minutes and the probe to 5 minutes.

The released lockfile resolves Expo 54.0.37; native package requirements are
Expo ~54, React Native 0.81.4, React 19.1 and WebView 13.15.0. Expo 54 documents
Node >=20.19.x; use Node 22 and preinstalled Java 17. SDK 36 is also required by
the existing Android module's AndroidX core 1.17 dependency. The SDK packages
requested are platform/build-tools 36, NDK 27.1.12297006, CMake 3.22.1/3.30.5 and the
API 36 Google APIs x86_64 image, plus emulator/platform-tools. Generated Gradle
requirements remain authoritative: SDK auto-download is disabled during build,
so a missing or different dependency fails rather than being silently adopted.
The currently documented runner image lists SDK 36 but does not promise the
emulator system image, requested NDK or CMake versions.

Before any KVM grant, the wrapper requires read-only proof of existing acceptance
for the exact requested stable packages and their dependencies. See
[package-specific license proof](android-sdk-licenses.md) for pinned official
metadata and agreement provenance. Failure exits before the ACL grant or
supervisor starts. The approved temporary ACL wrapper then requires the exact
reviewed device and ACL, saves the original ACL, and grants only current runner
UID 1001 read/write. See [temporary KVM access](android-kvm-access.md).
The supervised test requires readable/writable `/dev/kvm`. Installation receives
EOF, never an affirmative response; installed metadata is verified under the
same supervisor before proceeding. Then
require `emulator -accel-check` and boot with `-accel on`. The only privileged commands are the approved narrow ACL grant and restoration.
No broad mode, group, udev or other security-setting change is included. A prerequisite
failure is a blocker, not a failed app assertion. A new agreement needs separate
owner handling outside this task; do not add license acceptance to this script.

## Parent execution gate

No push, PR-open or synchronize event runs the emulator. Do not merge to run it.
After reviewing the exact head, the parent may create/apply the PR label
`android:<full 40-character reviewed head SHA>`. Only attempt 1 runs; a rerun is rejected. Only a newly added label matching
the same-repository PR head and this exact branch starts the job. No label was
created or applied during preparation. A later commit invalidates the label.
If the workflow eventually exists on the default branch, manual dispatch is also
available, on this test branch only, with an exact matching `reviewed_head`.
GitHub's default-branch requirement is why dispatch alone is insufficient here.
The workflow has only `contents: read`; it requests no secrets or write token.
Existing ordinary repository checks may still run on push/PR.

## Evidence and limits

One API 36 emulator, four scenarios: 320dp/390dp at font scale 1.0/1.3. The probe
attaches to `com.sageonline`'s actual debuggable WebView through Playwright's
experimental Android API, never a desktop browser. It records the installed
System WebView provider/version, IME, Android version and SDK package inventory.
It checks search opening, actual Android text input, filtering, Clear restoring
ordered rows, Done hiding the field and IME, retained query on reopening, and
native Back dismissing the IME. It checks narrow viewport width, overflow,
nonzero shell-injected status/navigation insets and search/Done geometry against
the visible viewport. System font_scale is changed and read back, with app
restarts; screenshots and geometry allow review of how WebView renders it.
This does not assert that CSS pixels scale proportionally with Android text size.

Full-device PNGs include native bars and keyboard. `result.json` records stages,
geometry and failures; `run.txt` and prerequisite inventories accompany it.
Artifacts expire in seven days and contain only fictional screens/build output.
No APK, tokens, browser storage, real account data or production request logs
are uploaded. Failure before attachment is an infrastructure/native-build finding;
after attachment it may be a fixture, driver or app defect and needs triage.
Do not change app code or loosen assertions in this PR to hide a failure.

This is not physical-device evidence, OEM keyboard coverage, push/Firebase,
Play distribution, production signing, offline-service-worker coverage, all
Android releases, display cutout modes or a performance benchmark. Nonzero
native insets are checked; screenshots still need human review for visual quality.

## Preparation validation

All 914 Node tests passed and the web production build passed. Shell syntax,
JavaScript syntax, YAML parsing, export isolation and diff whitespace checks
passed. A disposable native `npm ci --ignore-scripts` and Expo Android prebuild
completed without an SDK or emulator. Installed React Native's
`gradle/libs.versions.toml` confirms SDK 36, Build Tools 36.0.0 and NDK
27.1.12297006. ReactAndroid also declares CMake 3.30.5 for source builds; both it and the
Android Gradle plugin default 3.22.1 are requested. The generated template contains its debug keystore, and WebView
13.15.0 enables debugging for ReactBuildConfig.DEBUG.

Prebuild warns that React Native 0.81.5 is recommended instead of locked 0.81.4,
that expo-system-ui is absent, and that the iOS Apple team id is unset. These
existing configuration warnings were not repaired in this test-only task.
These were the initial preparation results. The later run below compiled the
debug APK; no Android UI assertions have executed.

## Latest run and AVD discovery correction

[Run 38618082440](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/38618082440),
head `5ea0dd9c0ec709dee45dacca12cb387120caed4a`, attempt 1, passed the
package/license preflight, installed-metadata check and KVM acceleration check.
The debug APK build succeeded in 5m 1s. The ADB device wait then timed out after
120 seconds, before APK installation or any WebView/keyboard assertions.
Both exit-trap and final cleanup verified descendants stopped/reaped, the complete
original ACL and device metadata restored, and runner access revoked:
`shutdown=0 restore=0` twice.

The parent independently inspected Jorge's supplied artifact and verified its
ZIP SHA-256 against the uploaded digest:
`4ce7dee8bfef35de3edb188a2ed4663ae772d967cbf66448991ecee3160553d4`.
`emulator.txt` reported `Unknown AVD name [sage-review]` and no registration in
its searched directories. That establishes an AVD registration/discovery failure.
It does not establish slow boot, unusable KVM or an application defect.
This session's direct artifact download returned HTTP 403 and was not bypassed.

The correction sources `start-emulator.sh` from the existing supervised run.
It creates a fresh `$RUNNER_TEMP/sage-review-avd`, exports it as
`ANDROID_AVD_HOME` for creation, listing and launch, and gives avdmanager the
explicit data path `$ANDROID_AVD_HOME/sage-review.avd`. It requires nonempty
registration/configuration files, exactly one registration path matching that
data directory, and an exact `sage-review` entry from successful
`emulator -list-avds`. Only then does the unchanged emulator command launch.
Warnings alone cannot satisfy these checks. A failed create/list command stops
immediately; no manual registration repair or forced overwrite is attempted.

Official [Android environment-variable documentation](https://developer.android.com/tools/variables)
defines `ANDROID_AVD_HOME` as the AVD location and first emulator search location.
The [avdmanager reference](https://developer.android.com/tools/avdmanager) documents
`--path`/`-p` for the data directory; the [emulator reference](https://developer.android.com/studio/run/emulator-commandline)
documents `-list-avds`. Google's [common 31.13.0 source archive](https://dl.google.com/dl/android/maven2/com/android/tools/common/31.13.0/common-31.13.0-sources.jar),
`com/android/prefs/AbstractAndroidLocations.kt` and `AndroidLocation.java`, also
confirm the AVD override is honored by the Java tooling. Other inherited home
variables and the SDK location are left unchanged.

Seven offline cases execute the real helper with fictional tools: differing
inherited Android home variables, failed creation, absent registration, absent
configuration, wrong registration path, absent listing entry and failed listing
command. They verify no launch on failure and identical explicit AVD locations
for creation/listing/launch on success. No SDK/emulator or KVM runs locally.
The existing boot timeouts, launch flags, assertions, license gates, permission
scope, supervision and cleanup remain unchanged. No activation accompanies this
correction; a new exact-head review is required before another run.

## Driver prerequisite and unresolved ACL restoration

[Run 38633800752](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/38633800752),
at `f16aac1787d68e8798b94c445c7b5ea453684c26`, passed the license/package gates,
KVM acceleration, debug build, AVD registration/discovery, boot and APK install.
The owner-supplied artifact matched uploaded ZIP SHA-256
`e40f330175b79f0228a8c7ffcc9d92ba903bd7215a33d80e90ba3790c6b541ba`.
The parent reports that result.json failed at device.tap in the first 320dp
launch because Playwright's Android driver APKs were absent. No UI assertions ran.

Preparation now installs pinned playwright@1.63.0 in the existing task-local
package directory before any KVM grant. Its own CLI runs `install android` with
`PLAYWRIGHT_BROWSERS_PATH=$RUNNER_TEMP/sage-playwright-cache`; the same exported
cache and package module are inherited by the supervised probe. Both package
versions and Android revision 1001 are checked, then both required regular APK
files must be readable, valid ZIP archives with a nonempty AndroidManifest.xml.
The diagnostic JSON records sizes and SHA-256 digests; the APKs are not uploaded.
Npm/CLI/verifier failures stop before grant. Existing SDK license preflight still
runs first; no SDK agreement is accepted by this addition.

The inspected installed Playwright 1.63.0 package's browsers.json defines
Android revision 1001. Its lib/coreBundle.js `_installDriver` implementation
requires `android-driver.apk` and `android-driver-target.apk`, and its registry
uses PLAYWRIGHT_BROWSERS_PATH. These are the exact installed-package sources,
consistent with [Playwright's Android API](https://playwright.dev/docs/api/class-android)
and [browser cache controls](https://playwright.dev/docs/browsers#managing-browser-binaries).
No Playwright device calls or asset downloads run in the offline tests.

That same run stopped/reaped descendants, but both ACL restoration paths refused
an unexpected ACL and reported `shutdown=0 restore=1`. Original ACL restoration
and runner-access revocation were not verified. The actual unexpected ACL was
not captured, so the cause remains unknown. This change does not repair it or
make another permission grant safe by itself.

On cleanup failure only, a read-only diagnostic command now independently reads
the saved lease's ACL/status/metadata, current numeric ACL, current lstat device
identity/type, runner UID/GID/groups, and effective read/write access. Each failed
read is recorded without suppressing the other observations. Reports go to the
job log and append to kvm-cleanup-diagnostics.jsonl, preserving both cleanup
attempts. The command never changes the lease, ACL, ownership or permission state.
Even diagnostic failure retains cleanup's nonzero result. Exact grant commands,
device/ACL refusal guards, restoration logic and shutdown policy are unchanged.

Offline coverage checks both driver files, versions/revision, missing/corrupt/
symlink assets, manifest presence, shared cache inheritance and zero grants on
npm/CLI/verification failures. Diagnostic tests cover unknown ACL/device identity,
independent read failures, both reports retained, unchanged saved lease and no
setter calls. A shell case verifies diagnostic failure cannot hide failed cleanup.
Validation: all 944 Node tests and the production build passed, along with shell
syntax and diff whitespace checks. The driver suite has seven offline cases.
The ACL/diagnostic Python suite ran 15 cases, with the existing owned-file POSIX
ACL case skipped locally because this filesystem returns EOPNOTSUPP. The pinned
CLI's `install --dry-run android` confirmed revision 1001 and the explicit cache
without downloading assets. AST comparison confirmed every pre-existing System
method and the grant/restore/ACL parser functions are unchanged.
These are preparation checks, not Android UI or restoration evidence. No new
emulator execution is authorized; the unresolved cleanup risk requires review.

## Sources checked 14 October 2026

- [GitHub hosted runners, Android acceleration and public-repo pricing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Official Ubuntu 24.04 runner software inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [Android sdkmanager, package licenses](https://developer.android.com/tools/sdkmanager)
- [Expo 54 version requirements](https://docs.expo.dev/versions/v54.0.0/)
- [Expo Android environment setup, Java 17 and SDK 36](https://docs.expo.dev/workflow/android-studio-emulator/)
- [Playwright experimental Android and WebView attachment](https://playwright.dev/docs/api/class-android)
- [GitHub workflow events and dispatch default-branch requirement](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
