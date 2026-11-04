# TV publication proposal, not a migration

This branch is incomplete and must not be deployed. It does not change a database.

The BoardLauncher shows all stores to admins and assigned stores to other
profiles, with a comment explicitly including centralized BDC. Both launcher
variants expose Publish. This is UI evidence of intended scope, not proof of
server authorization. The floor-access document explicitly excludes the monthly
board from its wall-key rules. The historical `has_store` function admits active
profiles assigned to a store, including pending profiles, while `can_use_store`
additionally admits linked floor people. Neither establishes who can publish a
TV board or edit its settings. The historical policies also permit any
authenticated user to write board keys. None
of these facts proves the live policy or the desired authorization. A production
boundary must fail closed until the allowed admin, manager, overseer, pending,
linked-person and service-ingest cases are decided and tested against the actual
schema. The service role's current use by ingest does not itself define what a
browser may do.

The safe transaction must lock and read the current private store and authoritative
configuration, project only allowed board fields on the server, and publish while
protecting the same row against legacy inserts, updates, key changes and deletes.
Settings require field-scoped edits with the original per-field baseline; replacing
an entire stale settings object after reading the latest revision loses edits.
The isolated prototypes in `/tmp/tv-derived-*` demonstrate these concurrency
properties for synthetic data, not the production authorization or payload.
The offline JavaScript projection is not callable in a database transaction and
is not integrated. Its evidence validator checks metadata shape, not authenticity.

A CSV store roll-up counts `Deals Delivered`. The existing parser does not
establish the source period, but `test/parsers.test.mjs` contains a fixture with
a `Delivery Summary` title and an `M/D/YYYY - M/D/YYYY` range. An offline
candidate parser now recognizes only that fixture shape, requires a unique exact
store match and a whole count, and marks its result unverified. The fixture is
not evidence that the live report uses that shape or that its figures are right. The PDF parser skips its date-range preamble and its
summary counts a different delivered/F&I metric. Both publishers discard the
stated total. Obtain an authorized representative report or a documented source
contract and validate store identity, period, metric and completeness before
publishing a whole store count. Legacy metadata and import date alone do not
establish those facts. Verify correct treatment of older-but-valid snapshots and
same-day updates; the current offline gate is deliberately conservative.

Before any migration or integration: choose the authorization matrix; establish
source provenance; implement the full projection in the chosen transaction
boundary with a narrow public whitelist and permissions; verify legacy writers,
first creation, rollback, concurrent source/settings changes, retry and denial
cases against isolated Postgres; and plan the coordinated application rollout so
old clients cannot silently break. The live state, preview, and production are
untested by this branch.

The current board-settings callback already propagates failure, merges six known
keys and rejects unknown changes; `test/board-display-merge.test.mjs` covers this.
That client behavior is not server authorization or atomic board publication.

Further role evidence: the conservative candidate for discussion is active admins
for any store, and active approved managers or overseers for assigned stores.
The UI supports that scope; it does not prove live RLS or authorize a policy
change. Pending or floor-linked staff have no evidenced shared publish right.
The wall reads anonymously and its local gear settings stay local. Trusted ingest
may initiate server-derived publication for the store it actually imported; the
secret must not confer authority to submit a public board payload. Shared-settings
and cross-store rotation rights remain undecided.

Ingest is authenticated by an `x-ingest-secret`, not mapped by sender identity.
It resolves a recipient-address slug for ordinary CSVs, resolves PDF store names,
and for store roll-ups falls back to the address if the printed name does not
match. A future publication boundary must use the confirmed import target, not
claim the sender was verified. Both the browser and service-role ingest write the
whole board row today; ingest also takes `boardDisplay` from its store snapshot,
so its stale snapshot can overwrite newer settings. The rotated TV gear save
writes the visiting store first and the home store second, without a transaction.
If the first succeeds and the second fails, only the first shared update lands.

`scripts/tv-atomic-synthetic/run.sh` reproduces the synthetic database prototype
in a network-disabled, disposable local container. It is not a production
migration, projection or authorization test. Its explicit unsafe control proves
why the whole-settings endpoint must not be exposed.

The synthetic SQL projection covers people, roster, allowed stats, goals and
days off. Nested `prevPct` and `prevUnits` accept only named numeric channels.
The projection is called inside a synthetic transaction that locks its private
source and configuration; it preserves independently written settings. Synthetic
brand colors, threshold defaults and the positive-streak ticker are covered by
a fixture also checked against the current JavaScript helpers. The candidate
still omits display initialization and the unverified total, and its strict
whitelist, full payload parity and lock ordering require review before release. The harness creates only synthetic roles and tables; it
cannot establish Supabase role grants, RLS, real authorization, rollout safety or
SQL/JavaScript parity. No executable production migration is provided.

The synthetic report-period parser accepts only an invented fixture syntax; it
is not wired to imports and proves nothing about actual DriveCentric reports.
The cross-store gear test confirms a visiting-store write can succeed before a
home-store write fails. The local candidate reports that partial success; it
does not make the two writes atomic or grant any new permission.

The candidate status is a safety marker, not cryptographic verification or
authorization. An offline test simulates a separate trusted verification step
and proves the projection retains 0.5 person credits alongside a whole store
count. No real verifier or source-to-publisher integration exists yet.

A same-month large drop is held and marked for verification; identical repeated
reads do not establish that it is correct. This can hold a legitimate correction
until a trustworthy publication mechanism exists, so it is not a finished
correction workflow. The TV separately warns when the board publication timestamp
is missing, implausibly future-dated, or at least two hours old. Two hours is a
warning threshold based on the hourly import schedule, not proof of source-report
freshness. A successful network read updates the last check time; it does not
make an old publication fresh.

The current browser candidate retains a per-store last-displayed baseline while
the screen runs and holds a large drop when rotating back to a store. That
baseline is not a verified source revision and is lost on reload. Report source
freshness is always shown as unverified; a recent board publication or a payload
flag does not establish it.

The isolated `validated-revision.sql` experiment models immutable attestations
from a separate trusted verifier, tied to the current locked private-store
revision and exact synthetic source snapshot. The snapshot is a test-only way
to catch revision reuse; it is not a recommendation to duplicate private data. It can publish an attested downward correction and separately carries a
source as-of timestamp. It does not implement an actual report verifier, real
store authorization, the complete production payload or a deployable migration.
The browser does not trust or consume those synthetic fields. A real design must
establish the verifier's identity and authority, source period and metric,
immutable evidence, atomic revocation or replacement rules, and legacy-writer
exclusion before a revision can release a held correction.

The synthetic attestation additionally binds a report metric and inclusive start
and end dates. The synthetic publisher refuses an unsupported metric, a period
outside the requested month, a period beginning after the first, or an end date
later than the attested as-of date in Eastern time. These checks do not validate
the real report or establish who may attest it.

In the renderer candidate, a held store advances the rotation cursor so later
stores can still appear and the held store is retried on a later cycle. Connection,
source-freshness and held-store conditions are composed into one status; one
condition does not hide another. This remains an in-memory safeguard, not a
verified persistent baseline.

The renderer candidate tracks connection failures per board key. A different
store's successful read does not clear a failed store; a successful read of that
store or its removal from the rotation clears its failure. Removing a store does
not erase its in-memory last-displayed baseline. The synthetic attestation carries
both evidence observation time and the verified report-through date; freshness
comparisons in the fixture use the latter. Neither field is trusted by the app
until a real source verifier and protected publication boundary exist.
