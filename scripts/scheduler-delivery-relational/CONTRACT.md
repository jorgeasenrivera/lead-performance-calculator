> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Disabled relational publication v2 contract

Base 2861377737f2e04a1d7d462793010f2f2e6085c1. This additive proposal uses existing
scheduler_private heads/versions/audit/receipts and scheduler_gateway. V1 draft RPCs
remain unchanged. No endpoint composition, runtime LOGIN, enabled scope or grant
is installed. Apply only to disposable synthetic database during this task.

Publication inputs are an immutable context record:
- version scheduler-publication-context/2; scope storeId/month;
- exact reviewed month-review/1 input, including baseStore, teamState, base daily
  assignments, relevant month drafts and complete-week neighboring input;
- inputDigest and review digest from the pinned reviewed provider;
- source epoch for the authoritative capture, draft/published and neighbor revisions;
- derived per-person day projection with explicit intervals/status, never review rows.
The current context pointer is changed only by the trusted source-capture adapter.
SQL publication requires the exact captured context ID and epoch, current heads and
neighbor expectations. Capturing context is not manager publication and cannot change
published head. Context rows and published versions are immutable. Any source change
must advance source epoch and replace the pointer before publication can succeed.
Production source-capture adapters are an explicit missing integration dependency;
synthetic fixtures are not substitutes for authoritative source provenance.

The trusted JS constructor uses the exact review provider to validate/recompute the
context, rejects open issues, verifies the persisted draft/neighbor relationships via
existing scheduler contract, and compares C113 publication plan byte-for-byte against
server recomputation. SQL validates versioned shape, relational identity, expected
heads, adjacent revisions, envelope payload equality, audit chain and receipt bindings.
FNV is checked by C113 JS, not reimplemented in SQL or treated as authentication.

Atomic publication writes existing immutable published version, moved draft version,
audit, head and receipt plus context binding. All commit or none. Store advisory lock
matches the existing draft RPC lock namespace, including absent neighboring heads.
Replay requires current authorization and matching request fingerprint.

Own-read requires current profile active=true,pending=false and unique floor_people
mapping for the authenticated actor/store. No admin-wide reader bypass. It returns
only the matching person's stored projection and published revision. No draft payload,
raw context, other employees, review issues or source metadata. Server must verify JWT;
SQL authority is a trusted server seam, never the HTTP body. Synthetic tests inject ID.

Projection uses frozen reviewed rows. Explicit intervals override legacy full-day on;
legacy on uses the dated rule's open/close. No assignment is inferred from availability
or suggestions. Off/vacation/unavailable/unknown reflect explicit absence; closed and
unentered remain distinct. Finite fractional minutes from legacy store hours are preserved without rounding.
The shared capture/read DTO validator checks interval bounds before publication.
Overnight and unsupported timezone remain rejected by the reviewed planner; every
working projection additionally uses its stableLocalDate guard, including legacy on
without planningPolicy. Unknown contradictory state fails closed. No new legal/break policy.

Required tests: existing draft compatibility; disabled defaults; runtime/private ACL;
pending/cross-store/revoked own-read; source and neighbor CAS; exact plan rejection;
replay/reuse/concurrent publication; rollback after partial insert; immutable context;
legacy on, inherited base, explicit absence and later source edit stability. No browser.
