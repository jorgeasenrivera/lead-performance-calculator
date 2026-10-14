# Android WebView review check

Prepared for parent review, not executed on an emulator. No physical Android
result exists. Jorge does not own an Android device.

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
used. The generated Expo template's existing debug keystore signs the debug APK;
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
requested are platform/build-tools 36, NDK 27.1.12297006, CMake 3.22.1 and the
API 36 Google APIs x86_64 image, plus emulator/platform-tools. Generated Gradle
requirements remain authoritative: SDK auto-download is disabled during build,
so a missing or different dependency fails rather than being silently adopted.
The currently documented runner image lists SDK 36 but does not promise the
emulator system image, requested NDK or CMake versions.

Before download/build, require an already readable/writable `/dev/kvm` and the
SDK manager's affirmative report that all package licenses are accepted. License
inspection and installation receive EOF, never an affirmative response. Then
require `emulator -accel-check` and boot with `-accel on`. No KVM permission,
udev, sudo, root or security-setting workaround is included. A prerequisite
failure is a blocker, not a failed app assertion. A new agreement needs separate
owner handling outside this task; do not add license acceptance to this script.

## Parent execution gate

No push, PR-open or synchronize event runs the emulator. Do not merge to run it.
After reviewing the exact head, the parent may create/apply the PR label
`android:<full 40-character reviewed head SHA>`. Only a newly added label matching
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
27.1.12297006. The generated template contains its debug keystore, and WebView
13.15.0 enables debugging for ReactBuildConfig.DEBUG.

Prebuild warns that React Native 0.81.5 is recommended instead of locked 0.81.4,
that expo-system-ui is absent, and that the iOS Apple team id is unset. These
existing configuration warnings were not repaired in this test-only task.
No Gradle compilation or emulator/UI evidence has been obtained.

## Sources checked 14 October 2026

- [GitHub hosted runners, Android acceleration and public-repo pricing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Official Ubuntu 24.04 runner software inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [Android sdkmanager, package licenses](https://developer.android.com/tools/sdkmanager)
- [Expo 54 version requirements](https://docs.expo.dev/versions/v54.0.0/)
- [Expo Android environment setup, Java 17 and SDK 36](https://docs.expo.dev/workflow/android-studio-emulator/)
- [Playwright experimental Android and WebView attachment](https://playwright.dev/docs/api/class-android)
- [GitHub workflow events and dispatch default-branch requirement](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
