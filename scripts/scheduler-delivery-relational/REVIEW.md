> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Relational publication v2 review checkpoint

Base 2861377737f2e04a1d7d462793010f2f2e6085c1, branch
codex/scheduler-published-delivery-local. Endpoint and existing draft pilot remain
OFF. New schema proposal installs no enabled scope or action grant, no LOGIN,
password, connection, public PostgREST exposure or application entrypoint.

## What changed

CONTRACT.md specifies immutable original review inputs and source epoch. context.mjs
uses the pinned month-review provider and original C113 contract to build a reviewed
publication plan and per-person monthly projection. It freezes inherited assignments,
dated store rules, neighboring review inputs and explicit absences, rather than
reconstructing an older publication from current mutable data.

publication-v2.sql is additive, separate from reference SQL and auto-applied migrations.
It uses the existing relational heads/versions/audits/receipts, existing immutable
record protections, and the same store advisory lock as v1 draft writes. It adds
immutable context/binding tables and a trusted source-head pointer. Its new gateway
functions check explicit scope/grant, active approved profiles, exact captured plan,
source epoch, expected heads/audit chain and adjacent-month expectations. Publication
writes both versions, head, audit, receipt and context binding atomically. Own-read
locks current profile/link and returns only that person's immutable monthly DTO.

api/_scheduler-publication-v2.mjs adds a default-off, injected server composition.
Actor comes from the verifier, not a request field. Own-read refuses employee/draft
selectors and validates the narrow result shape. api/_scheduler-pg-transport.mjs adds
two parameterized allowlisted RPCs only when publicationV2===true is explicitly
passed to the pool-injection factory. Existing environment/draft factory behavior
and the draft-only capability are unchanged. No pool constructed in this task.

## Actual evidence

Latest corrective run: 8 pure JS tests passed, 0 failed, recorded in pure-results.tap.
Both original P2 findings are fixed: legacy fractional-hour precision is preserved by
a shared capture/read DTO validator; all working days use the existing stableLocalDate
check regardless of planningPolicy. New regressions reject 2026-03-08 and 2026-11-01
and accept fractional hours on their stable following dates without rounding.

Two separate disposable PostgreSQL runs each passed 20 checks, 0 failed:
- sql-results.json: competing distinct first publications, one commit and one conflict;
- sql-identical-results.json: identical first publications, one commit and one replay.
Both call the JS publish composition with synthetic verified identities and psql RPCs.
Both observe two blocked publication sessions behind the store advisory lock before
releasing contention. Each also tests conflicting request-ID reuse, enabled-other-store
denial, fractional-hour context through committed SQL publication and JS own-reader,
and profile/link/grant revocation with an observed blocked reader/replay session.
The audit-insert failure trigger asserts that both version inserts have already happened,
then fails; all five affected tables equal their pre-call state after rollback.
Existing default-off, v1 draft compatibility/invisibility, plan/source/neighbor guards,
pending/inactive/unlinked denial, immutable projection/context and ACL checks remain.

Final clusters /tmp/sage-delivery-A3lbxB and /tmp/sage-delivery-YGOdnq both stopped;
pg_ctl status exit 3 confirmed stopped and both directories were removed. Preliminary
corrective runs also stopped/removed their clusters (kExETc and NdCskf). No browser,
install, live credentials, hosted DB request, deployment, push or notifications.

Node syntax checks and git diff --check passed. pg package is absent, so the real
node-postgres transport was NOT executed. SQL runs use existing psql as
scheduler_runtime via SET ROLE against a disposable Unix-socket-only cluster;
identity verification is synthetic, not real JWT. Source capture is owner-inserted
synthetic data, not production source integration. No latency or native claim.

## Critical remaining dependencies

1. Implement and independently review the trusted authoritative source-capture
adapter. It must re-read real versioned source inputs, verify review bindings and
advance source epoch atomically with any relevant source change. Runtime intentionally
has no context insert/update privilege. The injected capturedContextFor lookup is
not an implemented production adapter. Do not grant runtime broad source writes to
make this easier. A deployment without this capture path must remain disabled.
2. Review new executor-only profile/link SELECT/row-lock policies against the actual
catalog before any hosted application. SQL checks use the known synthetic schema,
not production policy inventory. No new real access has been granted.
3. Run the locked pg transport and full existing suite/build once dependency use is
authorized. Current psql checks do not prove Node pooling/serverless/TLS behavior.
4. Integrate explicit manager review/publish and salesperson DTO display/refresh in
the actual application under existing UI/ownership gates. Neither is wired here.
Supported sandboxed browser and device verification remain separate blockers.

## Semantics and unsupported cases

Established and captured: explicit same-day intervals; inherited base day records;
legacy `on` mapped to dated rule hours; explicit off/vacation/unavailable/unknown;
closed vs unentered. Suggestions/availability never imply an assignment. Full-month
DTO contains only date/status/intervals/timezone, not other people's data.
Actual fixtures cover explicit shifts, inherited full-day, explicit vacation, closed
days. Split-day intervals, off/unavailable/unknown and multiple-month edge cases have
not all received new gateway fixtures; they remain coverage gaps, not passes.

Overnight shifts and other timezones remain rejected by the exact reviewed provider.
Working DST-change dates are additionally rejected by the capture guard using the
provider stableLocalDate function. Legacy fractional store hours are preserved. No new breaks policy, legacy-off conversion, name matching,
autoapproval or employment-date policy is invented. Pending accounts stay hidden
until approved while manager roster scheduling remains a separate action.

## Review focus

- Source-capture trust is essential: SQL compares against an immutable server-prepared
plan; it does not reimplement the planner or FNV. Context hashes are integrity checks,
not identity/authentication. Protect the trusted capture writer and its provenance.
- Check policy/grant minimization, lock ordering, context immutability and replay
re-authorization. A fresh source epoch must always accompany real source changes.
- Historical local JSONB results and excluded unsandboxed browser timings are not
substitutes for this relational evidence and remain excluded from release acceptance.

## Source capture design

See SOURCE-CAPTURE-DESIGN.md for verified app_data, roster, absence and identity
writers, reusable modules, missing source origins and approval boundaries. No capture
adapter or real permission change has been implemented.
