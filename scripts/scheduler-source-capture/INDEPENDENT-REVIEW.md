> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Independent final review

Reviewer /root/independent_relational_review did not author this implementation.
Read-only source/evidence inspection, no tests or database/browser execution.

The TRUNCATE blocker is resolved for the documented local transaction model.
Source-table ACCESS SHARE locks precede the store advisory lock. The synchronized
regression observes relation/advisory contention then completion. The actual
publication/source-write regression observes blocking then pointer invalidation
without modifying published output. Recorded evidence:18 SQL checks,2 pure tests,
cluster mzp23u stopped/status3/removed.

No remaining concrete local defect found within stated boundaries: separate READ
COMMITTED port transactions; no capture after publication advisory locks are held.

Production blockers: authoritative supplements and complete presence/writer mapping;
authenticated capture and narrow writer role; transaction-wide multi-store ordering;
catalog/isolation/JWT/node-postgres verification; app wiring and delivery testing.
This is an implemented/tested local prototype, not a production-ready capture path.
