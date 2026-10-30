# Reviewed DST provider, exact local source

This is the reviewed local implementation, not an active endpoint and not a scheduler-compatibility/1 or /2 adapter. Do not silently upgrade either gateway contract. No actor, role, registry, auth, data-source provider or digest policy is supplied by this temporal function. All examples and executable tests use fictional store/person data.

## Direct interface

Import `localInterval` from `scripts/scheduler-performance/shift-intervals.mjs`.

`localInterval(day, startMinute, endMinute, timezone)` is synchronous. Inputs: real YYYY-MM-DD date in 2014-01-01 through 2100-12-31; increasing integral same-day wall-clock minutes, start >= 0 and end < 1440; timezone exactly `America/New_York`. Other zones, midnight end/overnight, invalid dates or minutes are refused. Caller must preserve exact store IDs separately; this function receives no identity.

Every return has exactly `{ok: boolean, reason: string | null, elapsedMinutes: number | null}`:

| Outcome | ok | reason | elapsedMinutes |
|---|---|---|---|
| Unique endpoints, no offset transition | true | null | Exact elapsed minutes, equal to wall-minute difference |
| Date/zone outside scope | false | Date or timezone is outside the supported preview. | null |
| Invalid interval | false | Enter an increasing same-day HH:MM interval. | null |
| At least one nonexistent endpoint | false | Nonexistent local time requires manual review. | null |
| At least one ambiguous endpoint | false | Ambiguous local time requires manual review. | null |
| Unique endpoints but interval crosses transition | false | DST-crossing interval requires manual review. | Exact diagnostic elapsed minutes; still refused |

The UI/backend must gate on `ok`, never on whether elapsedMinutes is numeric. Durations do not decide paid hours, breaks, overtime or payroll. A rejected crossing duration is diagnostic evidence, not approval. Missing time zones are refused by this direct function; the separate legacy storeTimezone helper defaults missing store zone to New York and must not be used as an authorization or gateway fallback.

Examples verified by tests:
- 2026-11-01 540..1020: true, null, 480.
- 2026-03-08 540..1020: true, null, 480.
- 2026-11-01 60..90: false, ambiguous, null.
- 2026-03-08 120..150: false, nonexistent, null.
- 2026-11-01 0..180: false, crossing, 240.
- 2026-03-08 60..240: false, crossing, 120.

Intl round-trips all candidate offsets around the date, distinguishes zero/one/two endpoint mappings, then scans actual minutes for offset changes. No ambiguous occurrence is selected. Date-offset cache bound128, interval cache bound512, returns copied. This module has zero imports. It depends on host IANA timezone data; review runtime Node24.19.0, ICU78.3, tz2026b. Backend runtime timezone-data parity remains to be tested by the backend owner. No real browser/device qualification.

## Other exports and generator composition

`shiftProblem(shift, store, day)` first checks store/date/zone identity and same-day bounds, then returns localInterval.reason. It is a local model helper, not a server authorization guard. `generationDateSafe(day, store, policy, record)` is exported from generation.mjs: opening interval, every configured template and retained shifts must pass; unsafe dates preserve previous choices and generate no new Off/absence/ownership. It conservatively refuses a whole date if any relevant interval needs review. Closed transition-date preservation and adjacent-week unknown safeguards remain intact.

`temporalPolicy: unambiguous-local/1` exists only on new in-memory generator proposals. It protects the existing local Apply flow from older refused-date Off payloads. It is NOT a persistent document field, publication version, compatibility-v2 digest or security credential. Backend must use its own exact validated source/provider/policy digest binding and must not infer a digest algorithm from this package.

## Dependencies, exact identities and receipts

DEPENDENCIES.json includes every copied file SHA-256 and direct imports; provider itself is standalone. Additional files are the exact generator/audit dependency closure needed to reproduce no-Off/Apply tests, not a new backend.

Reviewed provider SHA-256:
`0a8bbaf67349bdbc60491e2bb60f2e70f2091d7c0f6354216243479c1ca24ad0`

Reviewed generator SHA-256:
`065b5a58f44a022f991ff8b4f4f3d663b416eb44f129fb0ba7b6bdfa0998f527`

Run from package root, without install/network:
`node --test scripts/scheduler-performance/local-time.test.mjs scripts/scheduler-performance/generation-dst.test.mjs`

evidence/package-tests.txt is the package-local rerun. Negatives assert fold, gap, crossings, invalid zone/date, overnight, unsafe template, no generated Off, retained-choice preservation and old-proposal Apply refusal. evidence/independent-dst-review-final.txt is the prior independent broader run:118tests,117pass,0fail,1existing greedy TODO. The broad run also used files outside this minimal package; only the two named suites are self-contained here.

No production/customer data, credentials, SQL, gateway activation, auth changes, push or deployment. Source approval does not qualify SQL authorization/atomicity or gateway compatibility-v2. Backend owner must verify supplied hashes, exact result handling, runtime parity and its fail-closed provider binding before local integration.
