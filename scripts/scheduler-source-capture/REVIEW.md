> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Local source-capture implementation checkpoint

Candidate base: 2861377737f2e04a1d7d462793010f2f2e6085c1. Separate isolated worktree.
No app entrypoint, UI, pilot, endpoint, credentials or hosted database changed.

## Actual scope

- legacy-absence.mjs extracts workedAnyway/isOff verbatim; original app is unchanged.
  Pure tests compare function text to checked-out core and exercise forced off,
  calls/video, ignored texts/emails/tasks, line/floor presence and absent identity.
- adapter.mjs reads only the injected trusted snapshot port, validates source
  completeness, binds persisted current/neighbor C113 drafts, and recomputes legacy
  base off records using the existing month roster and assignment resolver. It never
  invents working shifts or typed vacation. Snapshot reread backs the contract's
  context acknowledgement; final SQL CAS covers changes after that reread.
- capture.sql adds owner-only local artifacts. Sorted statement-level source triggers
  bump a per-store epoch and remove mutable context pointers. Relevant app_data
  inserts/updates/deletes/restores/config changes, supplemental inputs and truncation
  participate. A coherent snapshot binds all store rows, extras, heads and versions.
  Registration rechecks the complete snapshot under the existing store lock before
  inserting immutable context and updating the source pointer. No runtime grants.

## Results and correction history

2 pure tests passed. Final disposable PostgreSQL run: 18 checks passed, 0 failed.
Results are in pure-results.tap and sql-results.json. Fake identities only, existing
verified PostgreSQL17.11 binaries, Unix socket, listen_addresses empty, no pg driver.
Final cluster /tmp/sage-delivery-mzp23u stopped; pg_ctl status3; directory removed.

The first run stopped at duplicate app_data fixture creation (shared fixture already
provided it). The second reached12 checks but attempted to delete an immutable test
head during cleanup. Both clusters stopped/removed. Fixtures were corrected, not
production guards. Subsequent successful clusters eiu5fT, o1jCbm and zZSBGi also
stopped/removed. Final run includes all later race/lock fixes.

Independent reviewer found a TRUNCATE table/advisory lock inversion. Capture now
acquires ACCESS SHARE on app_data and supplemental inputs before the store advisory
lock. A synchronized regression holds the advisory lock, queues capture, verifies
TRUNCATE waits for the relation lock, then allows both to finish. No deadlock occurred.
Source-write versus actual gateway publication also observes a blocked writer; after
publication commits the source write invalidates the pointer while the published
schedule stays unchanged. Source-first ordering rejects publication of stale context.

Other checks: absent supplemental input; incomplete availability and missing policy/
history keys; roster mismatch; split activity precedence; missing-row invalidation;
source rollback; change during JS review or immediately before registration; concurrent
same-context registration; snapshot versus source writer in both orders; adjacent draft
change; runtime ACL denial; typed C113 vacation; pending reader denial after publish.

## Remaining boundaries

Production supplemental origins remain missing. capture_inputs_v1 is explicitly
fixture-only trusted data, not a production input authoring workflow. See ORIGINS.md.
BaseStore/teamState, history and explicit policy state must have an approved source;
C113 persists neither history nor policy. Live presence-table dependencies are not
fully mapped; these tests capture the existing store-document fields and split activity.
No hosted identity verifier or authenticated capture handler is implemented. Captured
actor is trusted server data; publish still checks live manager scope/grant/profile.
SQL registration trusts JS recomputation; only a trusted narrow capture writer may
receive future execute permission. Runtime remains denied.

Supported local port calls are separate READ COMMITTED transactions. Table locks
precede advisory locks for snapshot/registration; capture never locks app_data rows.
Triggers sort stores within a statement. Arbitrary multi-statement multi-store writers
can still acquire advisory locks in opposite orders and be deadlock-aborted; they need
an agreed transaction-wide ordering before production. Do not claim this solved or
silently retry writes. Do not call capture in a transaction already holding publication
advisory locks before source-table locks. Production writer inventory, transaction
isolation and role/grant design require independent review before application.

Local cleanup retires the entire disposable cluster. No hosted migration or rollback
was executed. A future hosted rollback must remove capture triggers/functions before
tables and preserve immutable published context referenced by bindings; that rollout
and its rollback require separate approval.

No browser, native, transport latency or end-to-end delivery proof. The <=5s foreground
goal remains unmeasured. No files uploaded and no alternate sharing route used.
