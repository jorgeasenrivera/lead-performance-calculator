# Report-backed daily delivery evidence

X14 is a source-only foundation. The selected calendar metric is the Daily
Activity report's printed store All-row Units Delivered value. It is separate
from employee credits, channel totals, cumulative delivery summaries and deals
organized by their sale date. Nothing in this slice changes the monthly metric.

## What is implemented

- `readDailyActivityStoreTotals` in the shared parser reads the printed store
  total and optional New/Used dimensions independently. Existing employee mapper
  behavior is preserved. Unsupported or ambiguous layouts are held, including a
  malformed first store row that must never promote the first employee's row
- `api/_report-version.mjs` hashes materialized bytes with SHA-256, separates
  source identity from receipts and parser versions, and proposes an immutable
  typed archive key. It does not store anything
- `api/_daily-deliveries.mjs` validates printed-store identity, business date and
  source provenance, then prepares provisional evidence and a monthly ledger
- `scripts/delivery-reconstruction-dry-run.mjs` reads explicitly supplied local
  PDFs and prints JSON. It has no network client, database calls, output-file
  writer, replay or write flag. It reuses the existing PDF text extractor

The two new helpers are Node-side evidence tooling, not client imports. No
application file, database policy or production row is changed. `ingest.mjs`
has one import-only compatibility change: PDF.js uses its CommonJS default
export so the existing shared extractor also runs on Node 22. Node 24 resolves
the same getDocument and GlobalWorkerOptions objects. Extraction geometry,
arguments and ingestion write behavior are unchanged.
The protective UI remains in place. This is not an ingestion rollout or a
historical application batch, and no owner-notification destination is installed.

## Evidence rules

A printed zero is a known zero. Missing, unreadable or contradictory evidence is
not zero. Employee sums can be retained as reconciliation only; disagreement
never changes the primary total. Missing or conflicting New/Used dimensions stay
null without manufacturing a split from subtraction or scaling.

The Daily Activity business-date contract is the Eastern day sent. Preserve an
actual zoned sent timestamp when available, and reject contradictions with a
printed or filename date. A later receipt across midnight does not move a known
sent date. When no sent timestamp survives, an explicit report/filename date and
matching Eastern receipt date can support the owner-confirmed day-sent/arrival
contract, with that weaker authority recorded. Receipt alone cannot invent a
date. Unresolved delayed or midnight arrivals remain incomplete. Timestamp inputs
must carry an explicit offset; no local-machine timezone is assumed.

The printed store must resolve uniquely to the expected store using its exact
normalized name, ID or an explicit report alias. Prefix guesses do not certify a
historical total. Source bytes are required; an aggregate-only candidate document
or a remembered figure is not a source manifest. The raw-input boundary is the
CLI, which extracts text and hashes the same local bytes. The pure helper assumes
its caller supplies that matching pair; `rawBytesHashed` attests only that bytes
were present and hashed. Serialized candidate JSON cannot independently prove
that its text or totals came from those bytes and must never be accepted as a
production reconstruction instruction.

Every usable count remains provisional/as-received. The as-of field says whether
it is based on a sent timestamp or only the receipt timestamp. Nothing infers a
closing watermark or finality from the hour received.

Identical bytes are one logical source, even if resent or renamed. A receipt is
separate evidence, not an extra delivery. Different versions for the same day
are ordered only by their known sent timestamps. The latest sent report can be
selected provisionally under the same metric and date contract; a decrease is
recorded as a revision, never a negative day's sales. Missing ordering or tied
sent times leave a conflict. Originals and alternative values remain in the
review ledger. No source changes a finalized historical designation here.

## Proposed archive identity, not a persistence change

A proposed physical key is:

`lpc:reportfile:<store>:<Eastern-receipt-day>:v1:<report-type>:<sha256>`

This retains the existing archive prefix and arrival-day position, so the design
does not silently extend the existing 60-day raw-report boundary. Filenames are
metadata, not identity; different types or bytes cannot overwrite one another
merely because they arrived under the same name. Logical source identity omits
the receipt day; repeat receipts can reference the same content. A single raw source
claimed for different business dates is held as a conflict, including across
month boundaries when both candidates are supplied. A resend is not evidence of
a new day. Parser release
identity is separate from content identity.

The proposed key is not written and the archive's current overwrite behavior is
not fixed by merging these helpers alone. Before a future writer is activated,
verify the existing access/retention contract and use an immutable insert or
compare-and-verify operation. A source archive failure must hold the new daily
figure without breaking the existing employee/monthly import. Preserve old
archive rows and compatibility paths; do not delete or migrate them in this slice.

## Local dry run

Keep real PDFs, manifests and ledgers outside the repository. A manifest is:

```json
{
  "schemaVersion": 1,
  "storeId": "fictional-a",
  "month": "2026-09",
  "stores": [{"id": "fictional-a", "name": "Fictional Store Alpha"}],
  "sources": [{
    "path": "report.pdf",
    "reportType": "activity",
    "filename": "scheduled-report-9-30-2026.pdf",
    "sentAt": "2026-10-01T00:01:00Z",
    "receivedAt": "2026-10-01T00:02:00Z"
  }]
}
```

Run `node scripts/delivery-reconstruction-dry-run.mjs --manifest /private/path/manifest.json`.
Only local files within the manifest directory are read. Omit `sentAt` or set it
to null if it was not retained; never manufacture it from the archive timestamp.
`printedDay` is optional corroborating metadata and contradictions are held.
The caller may redirect stdout into a private review file. Parser diagnostics go
to stderr, leaving stdout as machine-readable JSON. Exit 0 means the dry run
completed without source conflicts; missing calendar days can still exist.
Exit 1 means a source failed or needs review; exit 2 means invalid invocation or
manifest. There is no `--write` mode.

Output carries `dryRun: true`, `writes: 0`, the metric and date contract, and one
entry for every day in the requested month. A day has a status, count or null,
as-of basis, finality, selected source ID, original source versions and candidate
reasons. Source records carry hash, byte length, proposed archive key and receipt
provenance, but not raw PDF bytes or employee names. Missing dates stay missing.
Every day has `publicationEligible: false`; the local ledger cannot authorize
application to production.

## Verification and next gates

Synthetic tests cover both supported column widths, header variants, page
continuation, malformed store rows, numeric and unknown cells, independent stock
splits, exact zero, half employee credits, duplicate/conflicting reports,
store mismatch, month/leap-year/DST/midnight boundaries, missing raw bytes,
resends, corrections and local-path restrictions. The CLI is exercised with an
actual generated fictional PDF, not only mocked extracted lines. Existing parser,
ingestion, monthly and UI source guards remain required.

Next, inspect authorized raw sources with retained hashes and receipt metadata,
produce the private review ledger, and resolve source holds. Then separately
implement immutable ingestion persistence and a report-backed calendar reader,
with a concrete visual proposal for reported deliveries and provisional/as-of
states. Keep legacy daily comparisons held. An exact historical application batch
needs review and approval; never allocate cumulative differences over missing days
or revive the retired browser digest writer.
