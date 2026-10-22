> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Manual scheduling local milestone

Base: candidate 2861377737f2e04a1d7d462793010f2f2e6085c1, isolated branch codex/scheduler-published-delivery-local. No hosted state changed.

The actual Manager BoardRoomPhone and StoreHero mount ManualManagerEntry only behind MANUAL_SCHEDULER_ENABLED=false. MyCorner's schedule sheet mounts OwnPublishedSchedule instead of the inferred legacy calendar when that same switch is enabled. The public API default remains 503. The injected server factory is used only by disposable synthetic tests. Changing the UI switch alone cannot activate a server.

## Manual profile

scheduler-manual-policy/1 is an owner-controlled capture supplement with an explicit planningPolicy entry for every month intersecting the Monday-Sunday review span. Explicit null represents a deliberately configured absence of policy; a missing field is rejected. No request body supplies this supplement. Existing team and membership data come from each persisted C113 draft. The target and boundary drafts must all exist, with complete dated store hours and person availability/limits. Their identity/name sets must match the authoritative source's monthPeople result, including employment bounds.

Every open date requires explicit assignments: each person has dated same-day shift(s) or an off record. Legacy on without explicit times is rejected. UI accepts minute-precision start/end, split shifts and optional configured role. Existing provider validates availability, overlap, weekly hours, coverage, team membership, eligibility and role coverage across complete boundary weeks. It is never an account grant. Explicit replacement is required before turning an absence into a shift. Generic off remains distinct from vacation/unavailable/unknown. Existing typed absences are preserved.

This profile supplies no inherited assignments or forecasting history because it never generates/advises/inherits a schedule. It does not fabricate hours, availability, memberships or policies. The generic capture path is unchanged by default; only this trusted profile selects explicitManual. Immutable context remains scheduler-publication-context/2 and review remains month-review/1, with the profile's complete assembled inputs bound by inputDigest and the exact owner supplement included in snapshot CAS.

## API and authorization

POST only, exact action fields, no query, bounded JSON, no-store. Actions load/save reuse the existing draft-only handler and explicit draft pilot/grants. Review requires an active approved manager/admin, profile store scope and explicit publish grant, both before capture and again before returning the roster projection. Token is reverified too. These two application checks narrow revocation exposure but are not one SQL authorization transaction. Publish retains SQL authorization, source-generation/CAS validation, atomic immutable version/context binding and idempotent receipt. Review does not publish. Uncertain writes offer only the identical request for retry.

Own read accepts store/month, never employee selection. SQL resolves current active approved profile and unique employee/store link on every read and replay boundary. Pending, revoked, missing/ambiguous link and cross-store access deny. Scheduling pending roster members does not approve their account. Frozen context never freezes access permission.

## Display and lifecycle

Auth subscription is created/disposed in an effect; useSyncExternalStore observes auth epochs. Store/month/account changes remount and clear owned state. Old in-flight responses are ignored. Own reads use same-origin POST, redirect:error, no-store, bounded timeout and a 2-second foreground poll after completion. Resume/online trigger fresh reads. Denied/failed reads clear content. No automatic write retry, push or background-delivery guarantee. This is not a proven <=5-second delivery SLA: server latency, suspended app behavior and rendered browser timing remain unmeasured.

The manual editor and setup register the existing parent in-app leave guard and page-exit warnings; uncertain saves block leaving. No browser interaction validation was run.

## Setup, policy persistence and source capture

The manual entry now mounts the existing SchedulerDraftDesktop/SchedulerEditor for People, Store hours and Teams, using schedulerDraftCodec and the existing authenticated draft transport mapped to the manual API's load/save actions. It checks the source document's actual loadedUnder stamp against currentReportedAuth before translating to the local editor epoch. Unknown or stale data blocks setup and offers Back. No hours, availability or cap is defaulted; the repository's existing STORE_TIME_ZONE is reused, not inferred from a device. Every required month still needs deliberate settings and save. The setup surface retains the existing broader editor tools; generation is unavailable in live/non-preview mode. Its browser interactions are untested here.

The existing People Apply adds maxHoursSource. The original reviewed provider bytes are preserved. A separately named month-review-provenance.mjs compatibility extension accepts that optional C113 field as short text. Previously accepted inputs have identical results; review arithmetic and row-based month-review/1 digest computation are unchanged. The original provider still rejects annotated inputs. Full provenance remains in persisted versions and captured inputText/inputDigest with exact sameDraft comparison. A provenance-only edit need not change the row-based review digest.

policy.sql adds an owner-only put_manual_policy_v1 operation over the authoritative capture_inputs_v1 payload. It requires an explicit versioned replacement, compares the expected previous payload, serializes on the existing store lock and records old/new payload, writer, revision, request ID and time in the same transaction. Existing invalidation triggers make captured contexts stale. Identical retries replay; changed request reuse or stale CAS refuses. No public/manager/runtime permissions are granted. An owner is still able to maintain database objects; this is audited API behavior, not tamper-proof audit storage against the database owner.

api/_scheduler-capture-port.mjs implements snapshot/register/context and owner policy maintenance using fixed parameterized statements on an injected trusted query capability. The manual server uses it in disposable SQL tests. It opens no pool and has no credential access. Production must supply a least-privilege executor; no broad owner capability is exposed to manager requests, and putPolicy is not wired to HTTP.

## Remaining dependencies

1. Actual People/Hours/Teams UI interaction and first-month setup through a browser remain unverified. Model export, codec, transport and real local persistence are tested. No browser execution is permitted in this task.
2. Before deployment, choose/provision the real trusted policy-maintenance and capture executor identities and their narrowly scoped permissions. Existing manager permissions were not broadened; a manager policy-edit UI would require a separate access decision. Local owner-only implementation and fake-data tests need no further user decision.
3. Exact locked pg8.23.1 is now installed in an isolated dependency directory and real JavaScript transport passed16 local SQL checks. Hosted JWT/profile plumbing remains untested. Source capture and identity fixture adapters still execute through psql; this does not prove hosted composition.
4. Real two-client rendered latency and native/WebView behavior remain unmeasured. <=5 seconds remains a provisional foreground target, not an SLA or a test result.
5. Hosted migration/grants, credentials, endpoint/pilot activation, deployment, remote push and real staff testing require future authority. No such action was taken.

Unsupported by this UI: overnight shifts, inferred full-day on, automatic generation/forecasting, editing policy eligibility/role requirements, changing a typed absence to a different absence type, closed-app notifications. Existing valid legacy fractional-minute intervals are displayed without rounding; new direct time entry uses explicit whole minutes and does not silently coerce stored data.
