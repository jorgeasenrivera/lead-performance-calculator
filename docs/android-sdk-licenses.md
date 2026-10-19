# Package-specific Android license proof

Preparation only. No new emulator activation, SDK installation, KVM grant or
license acceptance is part of this correction. Run 38608215097 stopped at the
old global license guard on head 2e63a0f27e27066e7b73f5880f425c4d35bc8df0.
Its diagnostic, supplied by Jorge, reported seven of eight SDK licenses pending.
That did not establish that a license needed by this test was missing. The old
requirement that every available license be accepted was too broad.

## Official metadata inspected 14 October 2026

Read directly from Google's HTTPS repository endpoints, not a generic terms page:

- [SDK repository XML](https://dl.google.com/android/repository/repository2-3.xml),
  complete response SHA-256
  `237eefe28e55619d3e63d730f8994cc1ae6d9c171096f07a6c147297145787e6`.
- [Google APIs image XML](https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml),
  complete response SHA-256
  `ad71946ba2d002f86d9ece1121b74aec494b420aa6b8fdac83fa5ce52b51dcb4`.

Every selected package explicitly references `channel-0` and
`android-sdk-license`. These are the observed stable revisions:

| Requested path | Revision | Declared dependencies |
| --- | --- | --- |
| emulator | 37.2.12 | none |
| platform-tools | 37.0.1 | none |
| platforms;android-36 | 2 | none |
| build-tools;36.0.0 | 36.0.0 | none |
| ndk;27.1.12297006 | 27.1.12297006 | none |
| cmake;3.22.1 | 3.22.1 | none |
| cmake;3.30.5 | 3.30.5 | none |
| system-images;android-36;google_apis;x86_64 | 7 | emulator >=35.4.9 |

The image dependency is already in the requested set. These are repository
package dependencies, not a claim that all later Gradle dependencies exist.
Gradle's SDK auto-download prohibition remains unchanged.

Both manifests contain identical `android-sdk-license` text ending
January 16, 2019. SHA-256 of the XML-decoded UTF-8 text, before SDK normalization:
`1f8729233617b193fd619213792ae16a41b95d2bbbf525dfe66998252ba68b16`.
The generic terms webpage is not used as evidence of equivalent consent.

## Read-only acceptance check

[Google's repository 31.13.0 source archive](https://dl.google.com/dl/android/maven2/com/android/tools/repository/31.13.0/repository-31.13.0-sources.jar)
was inspected directly. Its SHA-256 is
`825e8e7510f52c5f49a2f9a6fdb99c006d28399ffb6092f4992e2a0f333eca98`.
Relevant classes are `com/android/repository/api/License.java`,
`com/android/repository/impl/meta/TrimStringAdapter.java`, and generated
`com/android/repository/impl/generated/v2/LicenseType.java`.

The generated license value uses TrimStringAdapter: collapse specified ASCII
whitespace, preserve blank lines, then Java trim. License.getLicenseHash hashes
that value as UTF-8 SHA-1; checkAccepted compares exact CR/LF-delimited records in
`$ANDROID_HOME/licenses/<license-id>`. For this agreement the normalized text
SHA-256 is `aaf80cd0aee7e569ffa8a4be1b61189c0fefccf23068e38dfafe336289b8c723`.
Its SHA-1 lookup marker is `24333f8a63b6825ea9c5514f83c2829b004d1fee`.
Both checks use one CR/LF-only record parser; vertical tab, form feed, NEL,
Unicode separators and the other Python-only line boundaries cannot establish
acceptance. These are reference digests, not acceptance writes. No code creates or modifies
an SDK license file, and no offline test writes an actual agreement marker.
The runner's existing acceptance remains unproven until an authorized run reads it.

The wrapper runs the read-only preflight before any KVM grant or supervisor
startup. A failed preflight makes zero grant calls. The verifier fetches the two fixed HTTPS metadata URLs with bounded curl calls,
no retries or stale-cache fallback. It checks the exact requested set, stable
selection, complete selected-package metadata hashes, revisions, dependencies,
license references and exact agreement text against the reviewed JSON policy.
It then reads only the required acceptance file. Unrelated pending licenses do
not affect the result. Unknown schemas, ambiguous/missing packages, new metadata,
changed terms, missing acceptance, command errors and network failures block.
A metadata refresh requires review even if only an archive or formatting changed.
The policy is never regenerated automatically.

Installation and installed-metadata verification remain under the existing
process supervisor. Both phases share one package list with the preflight.
Installation still uses the same eight package arguments and default stable
channel, with stdin at EOF and the original timeout. The SDK manager remains
an independent acceptance guard. A second read-only check inspects installed
package.xml files for exact revisions, dependencies and normalized agreement
text and rechecks existing acceptance. This catches skipped installs or metadata
changes between preflight and installation before build/emulator startup.
The previously checked source library is not a guarantee about a future runner's
SDK implementation; discrepancies fail closed, and need diagnosis, not acceptance.

## Validation and next gate

Offline tests use fictional agreement text and in-memory acceptance markers.
They cover accepted required terms with unrelated terms pending, missing and
wrong-version acceptance, exact-line matching, changed agreement text, unknown
metadata/schema/channel/license/dependency/revision, ambiguous/missing packages,
command/network/timeout failures, requested-set drift and installed-text drift.
Validation completed: 14 Python regression cases and all 932 Node tests passed.
`npm run build`, shell syntax and diff whitespace checks passed. The build emitted
its existing large-chunk advisory. These checks do not establish runner acceptance
or emulator behavior.

Review the exact correction diff and ordinary checks before considering any
new activation. Do not reuse the old head's approval or label. No workflow,
device/ACL, cleanup, released source, fixture or UI assertions change here.
No new emulator or physical-device evidence exists.
