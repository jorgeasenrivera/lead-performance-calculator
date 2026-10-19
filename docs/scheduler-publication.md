# Scheduler storage boundary, source-only candidate

## Status and scope

H-X55 at `ef717bab4dc31c9243da4d8f122997de93360f9b` authorizes this
local-only five-file candidate. Live remote `main` and ancestry from
`1943864bb44f3e35cf12e042f5f4c8dbcbe959e5` and
`c3102b367a85c2e46e0c8532901ec3475277f88c` were independently checked before
writing. Existing C113, X14/X15, UI, runtime-QA and frozen PR scopes are unchanged.

This is an injected boundary, an injected C113/review contract adapter and
synthetic tests. No provider or persistence adapter is installed in the endpoint.
There is no database adapter, migration, credential lookup, network call,
access-policy change or activated endpoint. The default handler always returns
HTTP 503 `storage-not-configured`.

H-X64 at `2cf92098c42a1b0d37ca227ebf07c59921750e9c` separately permits the
source-only contract module, its test and this bounded documentation update.
Exact provider `5be1a1a2152e4d997cc435ba310e3296a2590851` and original C113 r1
artifacts are injected in the explicit local artifact-test mode. That does not
clear C113's reported r2 raw snapshot consistency, mutable audit data, team-name
coercion or node-budget concerns. No denied security review was retried.

H-X56 at `fdb41291ac46d91c9d78c532813b23e93edd9fa2` separately approves the
branch-local `vercel.json` deployment stops for
`codex/reported-reader-integration` and `codex/scheduler-storage-boundary`.
Its exact record and live remote ancestry were verified before adding those
two entries. Other Vercel configuration and GitHub workflows are unchanged.
The branch was fast-forwarded onto that coordination-only commit before
publication. The earlier daily-sales safeguard permission is not reused.
Independent review cleared the wrapper source. Source publication still
requires checking the exact guarded remote tree, fresh GitHub checks and no
automatic Vercel deployments. No merge, deployment or backend activation is
authorized by this candidate.

## Injected boundary protocol

`handle(req, res, deps)` is the testable HTTP entry point. Its default export
does not invoke it or install dependencies. Injected requests use POST with a
JSON object containing exactly:

- `op`: `read`, `save` or `publish`
- `storeId`, `month`: strings validated by the contract adapter
- `input`: the operation-specific JSON object validated by that adapter
- `requestId`: a nonempty string for save/publish, absent for reads

This envelope is the new wrapper's protocol, not a claim about C113's existing
HTTP API. C113 payloads, expected revisions, review fingerprints, open issues,
adjacent-month review inputs and operation rules stay inside `input` and its
adapter. The wrapper does not normalize dates or reorder array entries.

Prototype transport limits are explicit: at most 1,048,576 UTF-8 bytes for a
raw HTTP JSON string and each serialized boundary value, 50,000 JSON value
nodes, and nesting depth 64 with root depth 0. Object property names and
escaped strings count toward serialized bytes; arrays keep their order.
Root type/field checks precede traversal, widths are capped before sorting,
and depth/node/byte budgets apply during the first copy, before the contract
validator. Oversized requests return 413 `request-too-large`; invalid JSON
types return 400. Nothing is truncated. Malformed or oversized trusted-port
outputs return a sanitized 503. Complete response framing is checked before
staging any mutation, so an oversized result cannot commit and then fail on
every replay. Only `result` and `replayed` leave a mutation transaction.

These are wrapper transport limits, not schedule business rules. Compatibility
with every valid C113 payload remains unverified and must be checked against
the actual artifacts before integration. Do not silently trim a payload to fit
or claim this fixes C113's separate reported node-budget issue.

`authenticate({headers})` supplies trusted identity. It receives no request
body. `authorize({actor, request})` must return exactly `true` for the exact
action, store, month and requested read projection. Missing capabilities deny
access. No existing role policy, pending-account exception or admin bypass is
inferred. Authorization runs before every storage read and receipt lookup,
including a replay. Live authorization consistency, including revocation
during a transaction, needs a separate verified integration.

## Contract adapter, injected and not installed

All four functions are mandatory:

- `validateRequest(request)` returns exactly `true` only for valid scope,
  operation and input. It owns C113 schema validation and appropriate resource
  limits. It receives a detached copy
- `plan({request, actor, now, snapshot})` invokes the reviewed C113 planner with
  trusted actor/time and a trusted snapshot/audit tail. It must never accept a
  client-provided plan. It returns the unchanged C113 plan
- `projectRead({request, actor, snapshot})` returns only the explicitly
  authorized view. Published-only access cannot include draft content, audit
  history, storage metadata or receipts
- `projectResult({request, actor, plan})` returns the mutation's safe JSON
  result. That exact result is stored for replay

The wrapper requires the plan's `atomic: true`, `authorization: 'not-checked'`,
matching store/month, operation list, audit entry and resulting head. It does
not change the authorization marker or reconstruct/interpret operations.
`tx.apply` receives the exact plan object returned by the adapter.

The adapter must reuse C113 serializers/deserializers/validators and planning
functions. Store IDs follow the supplied contract's
`/^[a-z0-9][a-z0-9_-]{0,63}$/`; supported months are 2014 through 2100. These
domain rules are not reimplemented by the wrapper. Membership list order is
preserved. C113 fingerprints/audit hashes are not replaced by request hashing.

### Source-only factory and request contract

`createSchedulerContract({c113, reviewProvider, sha256})` in
`api/_scheduler-contract.mjs` implements the four methods. Missing modules,
exports, the pinned `month-review/1` definition or a trusted server-owned
synchronous SHA-256 function fail closed. Nothing imports owner modules into
the endpoint, and no caller-supplied hash function is accepted from JSON.

Operation inputs are exact:

- read: `{kind: 'draft' | 'published'}`
- save: `{baseRev, draft}`
- publish: `{draftRev, review: {definition, digest}}`

The adapter accepts no client issue count, recomputed fingerprint, context
manifest or transaction acknowledgement. Save uses C113's `persistable` and
validator, then `planDraftSave`; this preserves its deliberate removal of the
two page-local review fields. Publication decodes the saved draft, uses the
shared provider and then calls `planPublication`. Structured C113 results are
unwrapped, and the successful plan is returned unchanged. Actor metadata is
narrowed to exactly `{id}` and trusted time is passed as `at`.

The server fingerprint token is the provider's canonical JSON for
`{definition: 'month-review/1', digest: <verified SHA-256>}`. Actual computed
`openIssues` reaches C113, so a matching digest with open issues cannot publish.
The legacy whole-row string is not used as a server claim. C113 still stores
an FNV checksum of this opaque token. That is not the full digest, an
authentication mechanism or cryptographic provenance.

### Authoritative snapshot and immutable input binding

Read/save snapshots require exact `scope`, `head`, `draftText`, `publishedText`
and `prevAuditHash`. An absent version is explicitly null; a present version
must deserialize under its exact store/month/kind/revision. Draft and published
revisions remain separate.

Publication additionally requires:

- `reviewInput`: the shared provider's complete authoritative input, not a
  browser-submitted replacement
- `adjacentNow` and `neighborDraftTexts`: both calendar neighbors; revision 0
  means absent, null only means outside the supported month range
- `reviewBinding`: exactly `version`, `scope`, `inputVersion`, `inputDigest`,
  `draftRev`, `publishedRev`, `adjacent`, and `sources`

The binding version is `scheduler-input-binding/1`. `inputVersion` is an
immutable input-snapshot reference `{id, revision}`, revision 1 or greater.
`sources` has explicit references for `baseStore`, `teamState`, `baseAssignments`,
`history` and `planningPolicy`; each reference has `{id, revision}` and revision
0 explicitly guards absence. IDs are nonempty strings up to 200 characters.
These are adapter-port references, not chosen database table names.

The scope, head and neighbor revisions must match the trusted snapshot.
`inputDigest` must equal the actual provider's digest of its complete input.
Persisted-field projections of the current and relevant neighboring review
drafts must match decoded C113 versions exactly; comparisons do not save or
silently strip the provider's additional history/policy context. Both calendar
neighbors remain guarded even when complete weeks fit within the current month.

The authoritative loader owns the guarantee that every source reference really
produced the supplied input, including per-month history/policy copies. Merely
inventing matching reference labels is not acceptable. Unknown or omitted
context must block publication, never fall back to fixtures or an empty schedule.

### Transaction-owned context registration

The publication snapshot must carry a transaction-owned `contextTransaction`:
an ID, `capabilities['scheduler-context-cas-and-provenance-v1'] === true`, and
an async `register({binding, bindingDigest})` callback. This function is supplied
by the same persistence transaction that stages the unchanged C113 plan and
receipt. It is never accepted from the request or a separate client handshake.

Before returning a successful plan, the adapter freezes a fresh binding that
also contains the full verified `{definition, digest}`, hashes that binding with
the trusted SHA-256 implementation, and registers it. The acknowledgement must
be exactly `{registered: true, transactionId, bindingDigest}` for that transaction
and digest. Missing capability, callback, references or a mismatched acknowledgement
fails closed.

This acknowledgement is an obligation of a trusted port, not proof of actual
database CAS. The real adapter must atomically revalidate the input-snapshot head,
every contributing source revision/absence and the month/version bindings at
the same commit as plan, audit and receipt. It must also retain the full
definition/digest/input binding as provenance. An out-of-band check or callback
that only returns an acknowledgement does not implement this contract.

The synthetic transaction tests change context after registration and after
staged plan application, then demonstrate rollback of C113 effects and receipt.
No real transaction or durable provenance implementation exists here.

### Two explicit test modes

Ordinary CI runs `node --test test/scheduler-contract.test.mjs` with clearly
labelled interface doubles. This checks adapter enforcement, including a
commit-time context race. It is not reported as actual-artifact coverage.

The separate actual-artifact mode requires all paths and verifies the C113
archive, every original C113 module and the provider's complete imported module
graph before import. Missing paths, unknown mode or any hash mismatch fail the
run; no test silently skips or falls back. Tests never fetch or copy modules.

Run with pre-materialized, unchanged source roots:

```
SCHEDULER_ARTIFACT_MODE=original-r1 \
SCHEDULER_C113_ROOT=/absolute/path/to/verified/extracted \
SCHEDULER_C113_ARCHIVE=/absolute/path/to/verified/source.tar.gz \
SCHEDULER_PROVIDER_ROOT=/absolute/path/to/provider-checkout \
node --test test/scheduler-contract.test.mjs
```

Pinned C113 archive: 59,973 bytes, SHA-256
`909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622`.
Provider commit: `5be1a1a2152e4d997cc435ba310e3296a2590851`, module SHA-256
`3be221ae7e062e1d584d2e7ad3f765715ae5ec7fbf89dea43c539d4ef68b5a2e`.
All dependency hashes are fixed in the test. The actual mode uses the original
fake's `apply` and replays only its own successful synthetic plans into fresh
original fake instances to stage outer transactions; it does not copy that fake's
implementation or claim restart durability.

The shared provider is invoked twice for publication: verification returns only
the digest and issue count, while the second call obtains its full input digest.
Both results must agree. This bounded extra cost is explicit; no second review
algorithm or canonicalization definition is invented.

H-X64 local verification, 19 October 2026:

- Adapter port-double mode: 23 pass, zero skip/fail
- Exact provider/C113 artifact mode: 23 pass, zero skip/fail
- Adapter, existing wrapper/API and source-name guards together: 78 pass
- Full `npm test`: 1,206 total, 1,205 pass, zero fail, one pre-existing TODO
- `npm run build`: passes with existing chunk-size warnings
- Missing required artifact paths and a deliberately wrong provider-file hash
  each terminate artifact mode with exit 1 before import
- Original C113 artifact files, provider checkout and the two endpoint/wrapper
  source hashes remain unchanged. Independent review precedes publication

## Atomic persistence wrapper, no implementation installed

The persistence object must explicitly advertise
`capabilities['scheduler-plan-and-receipt-v1'] === true`, and provide:

- `read(scope)`: a consistent, detached snapshot suitable for the read adapter
- `transaction(scope, callback)`: an atomic, isolated transaction enclosing
  the callback, its C113 plan operations and its receipt

The transaction callback receives `tx` with four mandatory methods:

- `snapshot()`: trusted planning inputs, including required calendar-neighbor
  heads, immutable version text/high-water marks and the audit-chain tail
- `getReceipt(key)`: a detached receipt or null when absent
- `apply(plan)`: stages the unchanged plan; exactly `true` means accepted
- `putReceipt(receipt)`: stages the receipt; exactly `true` means accepted

The outer transaction promise resolves only after durable commit. Exceptions,
false results, failed uniqueness checks or failed expected-head/audit-tail
checks must roll back every staged write, including receipts. Apply success
alone is not a commit. Callback execution and receipt insertion must be
serialized appropriately so duplicate concurrent commands cannot both commit.
A process-local lock is not a production transaction guarantee.

This wrapper surrounds C113's existing fake/plan interface. It must not modify
C113's plan shape or add receipt operations to that list. A future adapter may
compose the unchanged fake inside a larger working copy for tests. Real
database transaction/schema/access feasibility remains unverified.

### Required C113 persistence invariants

- Draft and published revisions are independent safe-integer high-water marks,
  starting at 1. They are store-assigned and never reused
- Immutable store/month/kind/rev versions use first-write insert, never upsert
- Reset/restore, if later authorized, create the next version and never delete
  old versions. This endpoint does not expose those operations
- Publication checks every planner dependency in one transaction, including
  all required calendar neighbors at revision 0 when absent. Only actual range
  endpoint neighbors may be null
- Publication writes its new published version, advances the draft by one
  revision and appends one audit entry atomically
- Draft-save/publish/reset/restore audit entries form an append-only per-store,
  per-month predecessor chain. Commit verifies the trusted predecessor tail
- FNV audit hashes do not authenticate history. No signing keys or security
  claim are introduced here
- High-water allocation, immutable-version insert constraints, every expected
  head and audit predecessor must be validated at commit

## Idempotency and recovery

Receipt keys bind actor ID, store, month and request ID. A SHA-256 fingerprint
streams canonical actor ID, a newline separator and the canonical original
command. Separate bounded inputs avoid an internal-framing penalty on requests
at the transport limit. Object-key order is canonical; array
order is significant. This is equality checking for retry identity, not a
signature or authorization mechanism. Trusted time and generated audit tails
are excluded because they can change between retries.

After authorization, the transaction checks for a receipt before planning or
checking stale command revisions. A matching receipt returns the original
result with `replayed: true`, even after later commits. A changed command with
the same key returns `idempotency-conflict`. A first success returns the result
with `replayed: false`. A lost reply after commit is resolved with the same key.

No receipt expiration, audit truncation or retention policy is invented.
Durability, retention, cross-instance retries and capacity limits need decisions
before a real persistence adapter is installed.

## Verification and limits

The fixtures use synthetic identities, two fictional store names, an opaque
operation list, independent revision counters, and working-copy transactions.
They deliberately do not reproduce C113's algorithms. The transaction fixture
tests a broad commit conflict; it does not prove a database's fine-grained
multi-neighbor isolation or a C113 operation interpreter.

Coverage includes:

- Exact-true authority and atomic capability, denied/cross-store access, explicit
  published projections, safe errors, no-store responses and dormant default
- Unchanged plan identity, separate synthetic revision streams, preserved array
  order, immutable prior fixture versions and actor/time propagation
- Save/publish races, stale revisions, revision-zero neighbor dependencies and
  a simulated neighbor creation before commit
- Apply/receipt/commit failure rollback, lost replies, concurrent duplicates,
  stale successful replay, command-key reuse and permission loss before replay
- Detached input/output/receipt objects and missing/malformed ports or plans
- Exact-limit and oversized bytes/nodes/depth, multibyte/escaped/key byte costs,
  adversarial deep/wide inputs rejected before validation/storage, and complete
  response framing checked before mutation

The separate artifact mode now exercises the adapter's selected real provider/C113
flows. Exhaustive C113 correctness, all r2 findings, restart durability and live
storage/auth guarantees remain unverified. No whole-system security or scheduling
correctness claim follows from these tests.

Baseline before this candidate: `npm test` at the scope SHA reported 1,135 tests,
1,134 pass, zero fail and one existing TODO in
`scripts/scheduler-performance/generation.test.mjs:89`, the known greedy
role-selection limitation. The unchanged lockfile matched the reused local
dependency installation.

Candidate verification on 18 October 2026:

- `node --test test/scheduler-store.test.mjs test/scheduler-api.test.mjs`: 48 pass
- Those tests plus `test/no-duplicates.test.mjs`: 55 pass
- `npm test`: 1,183 total, 1,182 pass, zero fail, the same one existing TODO
- `npm run build`: passes; existing large-chunk warnings remain
- The five approved new source/test/document files plus the two H-X56-approved
  branch-specific deployment stops in `vercel.json`. No other baseline file is
  changed. No UI/browser check is claimed because no screen changes exist

The first fixture pass compared neighbor objects using insertion-order-sensitive
JSON text; it was corrected to deep equality. The first aggregate check found
that the repository's source-name scanner cannot recognize `super()` or an
async object method declaration. The new declarations were rewritten to the
supported function form; the existing guard was not changed. Independent review
then identified an unbounded first JSON copy before adapter validation. The
transport limits and adversarial tests above address that wrapper finding;
review also prompted pre-commit response-framing validation. An independent
recheck reran all 55 focused/source-guard tests and found no remaining concrete
wrapper blocker within this source-only, injected-port scope. Reviewed source
SHA-256 values:

- `api/_scheduler-store.mjs`: `55da636812b0d281c3475c110d098d08a235e308bb90b823c11c827d9dccf84e`
- `api/scheduler.mjs`: `47a37141f37dfbd59f14001ddd4754a7a8f116967c9bf763f3153a118f3ea97a`

This review does not clear the separate C113 integration, real storage/auth,
deployment-suppression or publication gates.

Security reference consulted: [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs).
No ASVS certification or full requirement coverage is claimed.
