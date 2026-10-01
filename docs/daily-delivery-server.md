# Daily delivery server boundary

X15 depends on the source foundation in draft #455. This is source-only work:
no deployment, database mutation, access change or historical application has
been performed. Both application files and their protective unavailable states
are untouched. All test reports and accounts are fictional.

## Ingestion

After all existing store, archive, day-row and board writes finish, an isolated
daily sidecar re-extracts
the original PDF bytes. Daily Activity PDFs identified by title, filename or subject enter this path
independently of employee-mapper success. A strict printed-store match or the
existing store-specific address supplies scope; unassignable attempts are reported
as unrecorded rather than assigned to every store. Extractor failures can still
create coverage holds when the filename/subject and address identify the attempt.
Completely unidentifiable PDFs remain explicit existing ingest failures. CSV,
employee, delivery-summary and monthly writes keep their existing code paths.
Exact printed-store matching and the existing day-sent contract remain required.
The Date header is validated before PostalMime's normalized date can invent a
local timezone or normalize an impossible date. Missing Date may use the
foundation's explicitly dated, matching-receipt fallback; invalid Date cannot.

A private immutable coverage hold is recorded first, before parsing or archival.
All identifiable batch holds are registered before parsing its first PDF, so a
stalled parser cannot skip coverage for later attachments. Each hold
carries only store/date scope, opaque source/receipt identity and a private
reason code. A typed raw archive record is then inserted, never upserted, at the foundation's
content-hashed key. A duplicate is accepted only after exact read-back equality.
Raw archive success and verification precede inserting any daily evidence.
Receipts have separate immutable evidence keys:

`lpc:dailyfacts:<store>:v1:<business-date>:<sha256>:<receipt-id>`

Different receipts and corrections cannot overwrite one another. The reader
selects the latest supported sent version, retains decreases as corrections,
deduplicates raw sources and holds tied or unordered versions. A raw source
claimed for two dates, including across months, holds both dates. Evidence keeps
its parser version, date contract and receipt provenance internally.

An archive, parsing or evidence error leaves the hold unresolved. A safely dated
hold changes that day to incomplete with a null count, even if an earlier report
had succeeded. A date that cannot safely be scoped holds the store's coverage,
rather than guessing a day. A later different receipt does not silently clear it.
A verified retry of the exact receipt clears its hold implicitly. Otherwise,
`resolveDailyCoverageHold` is an internal administrative recovery function, not
an HTTP route or CLI. It requires explicit approval for the exact hold,
replacement and business date before use. It verifies a same-store provisional
replacement with valid source/as-of provenance and the matching known hold date,
then appends an immutable resolution record. An unscoped hold can be assigned a
reviewed date through this explicit path. Holds and originals are never deleted.
No resolution has been applied to production.

Failures never change the success of existing employee/monthly imports. The
secret-protected ingest response and sanitized log carry accepted, held and
unrecorded-attempt counts, so unavailable persistence cannot silently claim
coverage was saved. A two-second asynchronous budget aborts storage requests;
signal checks after extraction prevent a late parser from submitting evidence.
Aborting cannot roll back a request that the database already committed, and CPU
work itself cannot be preempted by a JavaScript timer. Verified raw archival is
always required before a fact is submitted.
The older archive and pruning paths remain unchanged. Typed raw keys retain the
existing receipt-day position, so the same 60-day raw-retention boundary applies.
Daily evidence contains no raw PDF bytes and survives raw-report expiry. This is
not a promise to retain raw sources beyond the existing limit. There is no
backfill command or client-supplied candidate publication endpoint.

## Read boundary

`GET /api/daily-deliveries?store=<id>&month=YYYY-MM` requires a Bearer token
validated through Supabase Auth getUser, then a fresh database profile read.
Profiles must explicitly be active and approved. The profile must be an admin or
include the requested store. Request-body roles, JWT user metadata and floor
links do not grant access. Missing/failed authorization never reads facts.

The response is private/no-store and consists only of store/month and dated
count, New/Used split, status and as-of entries. It returns no hashes, filenames,
raw reports, employee names, parser diagnostics or internal reasons. Missing and
conflicting days carry null counts, never zero. Printed zero remains known.
Every known value is provisional. No finalized closing status is inferred.

The app_data RLS definitions were inspected read-only on 1 October. Existing
client read/write prefixes exclude both typed reportfile and dailyfacts records.
No policy, grant, table or privileged RPC was added. This endpoint uses the
existing server service role only after checking the caller's live profile.
Before any activation, recheck that the access policies still exclude these
namespaces. No production policy check is bypassed or repaired automatically.

Evidence uses ordered keyset pages rather than trusting one capped REST page.
Every store month is read so cross-month source conflicts cannot disappear.
The read path has a five-second abort budget. The safety ceiling is 50,000
evidence/hold/resolution rows; beyond it the reader returns an
unavailable response rather than silently truncating. A scalable source index
or transactionally consistent snapshot remains future work before that limit
is approached. Concurrent arrivals can appear on the next request, as expected
for as-received provisional evidence.

## Verification and release gates

Synthetic tests cover archive-first ordering, duplicate equality, archive and
fact failures, retry/idempotency, concurrent corrections, resend ordering,
zero, cross-month source conflicts, reader isolation, missing/revoked/unapproved
profiles, request validation, sanitized errors, response allowlisting, paging
original MIME Date validation stalled-sidecar cancellation, durable failure holds, exact retry clearing and
explicit validated resolution. All 924 tests
and the production build pass locally. Existing employee/monthly source tests and
build remain required. No salesperson UI or motion changes call for a new feel
run in this slice.

Keep this draft unmerged. Review the sidecar and authorization boundary before
any release. No deployment, historical application or Manager reader hookup is
authorized by this source-only stage. A concrete fictional-data UI proposal and
approval still precede changes to what the calendar displays.
