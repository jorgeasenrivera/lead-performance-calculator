> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Bounded authoritative capture design, not implemented

Source inspected at candidate 2861377737f2e04a1d7d462793010f2f2e6085c1.
This is checked-out source evidence, not a claim about deployed production or its catalog.
No source writer, permission change, endpoint activation or app UI wiring is included.

## Actual inputs and writers

- src/Manager.jsx:9307-9320 edits daysOff/daysOffAt through onChange. The upload at
  9725-9777 adds off-days and scheduleSource provenance. Neither action publishes C113.
- src/Manager.jsx:20502 edits roster fields; 20650 edits hiredAt; 1064-1066 removes a
  roster entry and records departure. These are store-document data, not account approval.
- src/LeadPerformanceCalculator.jsx:2439-2491 serializes persistStore calls and invokes
  saveStoreCAS; 1224-1269 reads app_data.value, increments rev and conditionally replaces
  it. This browser CAS does not atomically invalidate publication_source_heads_v2.
- src/LeadPerformanceCalculator.jsx:2356-2384 automatically adds daysOff on historical
  no-activity days. Manual absence handling at src/Manager.jsx:7724-7735 also changes
  daysOff/forcedOff. These writers must invalidate a capture too.
- src/LeadPerformanceCalculator.jsx:1157 writes split activity rows separately from the
  store row. api/ingest.mjs:168-191 has its own revision-checked store writer. Capturing
  only the browser save path misses other writers and multi-row activity dependencies.
- api/link-person.mjs:142-164 deletes/upserts floor_people links. api/delete-account.mjs:79
  deletes links. These are live own-reader authorization, never frozen authorization.
  profiles active/pending and current unique store link must remain checked on every read.

## Reusable semantics and exact gaps

src/scheduler-editor-adapter.mjs:49-102 supplies roster/employment bounds; :112-132
uses staffingMonth and the app isOff callback to derive off-only base records. It does
NOT infer working shifts from absence of an off mark. editorStore at :72 deliberately
supplies null availability, empty rules/history/teams/memberships because the legacy
app data does not establish those inputs. Do not invent them in the capture adapter.
Persisted C113 drafts can provide reviewed planner values, subject to strict validation.
The authoritative origin for any remaining hours/team/history/planningPolicy inputs
must be established before capturing a publishable month.

The real isOff at src/LeadPerformanceCalculator.jsx:376-383 gives forcedOff precedence,
then consults workedAnyway (:325-338), which depends on activity calls/videos and
queue/queueOnline/floor presence. A server adapter must reuse/extract and fixture-test
those exact pure rules, or explicitly obtain a product decision to change them. Using
only daysOff would silently change semantics. This dependency is why split activity
rows and other store writers matter. Legacy off records carry no vacation type; never
invent a vacation classification from an off-day. Explicit C113 absences retain type.

Use the pinned month-review.mjs::exportReviewInput (:396-430) to capture complete-week
base assignments, baseStore, teamState and all relevant monthly drafts. Its parity check
must match the planner. Use _scheduler-contract.mjs persisted draft/neighbor binding
checks and context.mjs::preparePublication, not client-provided projections/digests.

## Minimal safe transaction design

1. Keep a server-owned source-generation record per store. Every relevant app_data
   insert/update/delete (including restore/import paths and split activity keys) must
   invalidate the current capture and advance that generation in the same transaction.
   A database-side trigger restricted to relevant keys is safer than hoping every
   browser/API writer calls a new hook. Conservative invalidation of the whole store
   is acceptable initially. No trigger or privilege is installed by this design.
2. Capture a coherent authoritative snapshot and generation plus all relevant source
   row versions/digests. Use stable store/person IDs; never caller-supplied roster or
   account approval. Rehydrate reviewed monthly/neighbor drafts and pure planner input.
   Missing inputs or ambiguous source ownership fail closed, not guessed defaults.
3. Compute review/plan outside the long transaction. On registration, acquire the
   existing store advisory lock then source-generation/head locks, compare every bound
   revision/generation, and insert immutable context plus current pointer atomically.
   If changed, refuse and require a fresh review. Protect against missing-row inserts
   with generation invalidation, not just locks on rows that happened to exist.
4. Publication retains its current source/head/neighbor checks and store lock. Agree
   one lock order across triggers, capture and publication; invalidation must serialize
   before publication can use a stale pointer. Review lock inversion/deadlocks explicitly.
   Invalidation may remove the pointer; it must not rewrite already published content.
5. Keep account/link revocation independent and immediate on the next read. Never
   grant the runtime broad app_data/profile/context writes. Supply capturedContextFor
   with a narrow trusted lookup only after authorization, and use a separately bounded
   capture-writer role/function. Hashes prove integrity, not source authority.

## Further approvals and proof

Code-only adapter/schema preparation can be proposed as the next bounded task. It
requires resolving authoritative origins of missing planner inputs and reviewing the
legacy isOff dependency set first. Changes to Manager/core need coordination with
existing owners; visible publish/employee screens require the existing UI approval.
Applying triggers, source-reader/capture-writer grants, executor RLS, hosted migrations,
real account permissions, pilot/endpoint activation, deployment, or real-user tests
requires separate explicit approval. None is authorized or performed here.

Before activation: synthetic tests for each writer invalidating capture (including
restores/imports and absent rows), source change during capture, concurrent source
change versus publish, lock ordering, read after approval/revocation, and complete-week
boundaries. Then authorized hosted JWT/pg tests and two independent clients measuring
manager acknowledgement to rendered matching revision/content on one controller clock.
The <=5 second foreground goal remains provisional and unproven. No background or
native acceptance, browser timing, or closed-app notifications are claimed.
