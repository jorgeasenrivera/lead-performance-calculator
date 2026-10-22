> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Source origins, candidate 2861377737f2e04a1d7d462793010f2f2e6085c1

C113 validate.mjs:300-314 accepts exactly store.people/rules/teams/memberships and
optional timezone; serialize.mjs:20-36 only removes local review flags. Unknown
history/planningPolicy fields are rejected, not secretly persisted. Contract
_scheduler-contract.mjs:94-115 compares those persisted fields and overrides to
review inputs. It deliberately does not erase extra review provenance.

Resolved: persisted current and adjacent draft envelopes supply their people's
availability/weekly caps, dated rules/holidays, teams/memberships, timezone and typed
overrides/absences. Unknown/null availability and missing rules cannot be invented.
Whole-week review uses neighbors or explicitly sourced base settings where absent.

Not resolved by drafts: review baseStore, teamState distinct from month drafts,
history and optional planningPolicy for base and each month. Provider
month-review.mjs:147-203 requires history and permits explicitly absent/null policy;
no authoritative production writer for these supplemental inputs has been established.
Local capture_inputs_v1 stores an explicitly versioned trusted supplement only for
fake-data tests. It is NOT a new live source of truth or an implemented product writer.
Missing supplements fail SOURCE_INPUTS_MISSING; malformed/incomplete supplemental
fields fail SOURCE_INPUTS_INVALID. Null/absent history is not converted to empty.
Policy absence is explicitly represented as null, never inferred from missing fields.
C113 maxHoursSource is not accepted by review provider; fail closed, never strip it.

Legacy base assignments use actual roster/departure bounds via editor adapter and
verbatim isOff/workedAnyway (with original norm import). Split activity rows replace
embedded day rows, matching loadStore. Generic off stays generic off; actual work
never becomes a scheduled shift. The base store identity/name roster must match
app_data roster. Month draft identities must match the source's month roster; drift
requires fresh manager review, not automatic additions/removals.

Local artifacts invalidate all enrolled stores on config changes and the affected
store on any lpc:store:<id>:* row mutation, including inserts/deletes/restores, plus
supplement changes. Live presence tables beyond captured store documents are NOT
mapped here; production writer inventory remains necessary before deployment.
Account profiles/floor_people never enter frozen authorization. V2 own-read keeps
live active-approved/unique-link checks. No endpoint or pilot is enabled.
