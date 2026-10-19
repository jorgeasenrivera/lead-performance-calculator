# Dormant scheduler save/read candidate

H-X65 is recorded on main at `77ef5ee3fae23987eb4d94137863ea5174a21ce1`.
This continuation adds only the five named files. The existing wrapper,
contract adapter, endpoint, C113 originals and provider remain unchanged.
The default endpoint still returns `503 storage-not-configured`.

## Trust and composition

`createSchedulerPostgres({ transport, authority, c113 })` has no default
transport, credential lookup, environment lookup or network client. Construct
one instance per request. It accepts only one read or transaction and never
changes its copied authority. A fresh retry requires a fresh authority decision.

The injected authority is exactly `{ actorId, action, storeId, month, readKind }`.
`action` is `save` or `read`; readKind is null for save and draft/published for
read. These values must come from a separately reviewed server authority
provider, never from request JSON. This slice defines no manager/floor/role
policy and does not prove current-profile, store-membership or revocation
checks. A service-role transport does not supply end-user authority.

Use the returned `authorize` comparison helper as the existing wrapper's
authorize port, and the same returned object as its persistence port. The
helper binds the wrapper's actor, operation, scope and read projection to the
trusted injected decision. It is not an authentication or policy implementation.
The original contract adapter still supplies request validation and projections.
A published read uses that projection; internal snapshots are server-only and
must never be returned directly to a client.

Transport is `{ capabilities: { 'scheduler-postgres-save-read/1': true }, rpc }`.
`rpc(name, arguments)` resolves `{ data, error }` only after the database call
finishes. Names are `scheduler_snapshot` and `scheduler_commit`, both defined
in private schema `scheduler_private`. The capability is a trusted declaration,
not proof that an installed service implements the transaction. Private-schema
RPC reachability/exposure and a real authorized execution role remain separate
activation decisions. No grants, public wrappers or SECURITY DEFINER functions
are supplied. No Supabase connection or existing schema was inspected or changed.

Inject original C113 `validStoreId`, `validMonth`, `validRev`,
`deserializeVersion` and `verifyEntry`. Their validation is reused, not copied.
Only the exact original draft-save plan shape is accepted; publication,
recovery and extra operations fail closed. No review-provider capability,
authoritative context manifest or fabricated source revision is supplied.
All original C113 r2 concerns and the previously denied review remain untouched.

## Transaction protocol

1. Reject unsupported authority, wrong scope and publication before any RPC
2. Fetch a receipt and head/version/audit snapshot together. The SQL function
   is STABLE and its data read is one SELECT statement, not several sequential
   reads. Snapshot adds database-owned `auditRevision` to the existing fields
3. Run the existing wrapper callback locally. `apply` and `putReceipt` only
   stage detached values; they do not mutate the database. A callback failure,
   incomplete staging or mismatched speculative result sends no commit RPC
4. Call the commit RPC once. It takes a transaction-scoped per-store advisory
   lock, including absent months. The exact matching receipt wins before any
   stale-head checks. A changed fingerprint on the same key conflicts
5. Without a receipt, compare both independent draft/published high-water
   revisions, audit revision and audit tail. Insert immutable draft text,
   append one audit entry, advance the draft head and insert one receipt in the
   same database statement/transaction. No first-write upsert or revision reset
6. Return only the database result. A concurrent duplicate can replace the
   callback's speculative result with the stored result and `replayed: true`

Receipt keys remain the wrapper's full JSON tuple of actor/store/month/request
ID. The database indexes its SHA-256 digest to avoid oversized index entries,
but also compares the full key before replay. The command fingerprint is the
wrapper's SHA-256, unchanged. Neither hash supplies authorization.

Version text is stored exactly, never reconstructed from jsonb. The original
C113 decoder/verifier checks canonical text and checksum before staging. SQL
checks identity, actor, revision, audit/version linkage and expected heads.
C113's FNV values are not authenticated provenance. An internal database tail
does not substitute for a separately trusted external audit anchor.

There is no receipt expiration, audit truncation, deletion or retention policy.
Update/delete/truncate triggers protect immutable tables; head deletion is
blocked and revisions cannot move backwards. Administrative owner access and
future role/grant design still require independent review.

RPC copying is bounded before its first recursive walk: 8 MiB encoded JSON,
100,000 nodes and depth 64. Receipt key text is at most 1 MiB; version text at
most 4,000,000 UTF-8 bytes in this SQL candidate. These are explicit transport
limits in addition to the wrapper and original C113 limits, not schedule rules.
Over-limit or malformed trusted responses become safe storage errors. A bad
response after a successful commit still requires retry with the same request
ID; production reply/durability behavior is not established by port doubles.

## Verification modes

Default `node --test test/scheduler-postgres.test.mjs` uses explicit RPC/C113
protocol doubles. It establishes request binding, local staging, safe failure,
receipt-result selection and unchanged-wrapper composition, not SQL atomicity.

Separate pinned original-artifact mode:

```sh
SCHEDULER_POSTGRES_ARTIFACTS=original-r1 \
SCHEDULER_C113_ROOT=/absolute/path/to/verified/extracted \
SCHEDULER_C113_ARCHIVE=/absolute/path/to/verified/source.tar.gz \
node --test test/scheduler-postgres.test.mjs
```

It verifies archive SHA-256
`909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622`
and every imported original module before import. Missing or altered artifacts
fail, never silently skip or fall back. It does not fetch/copy modules or clear
C113's outstanding findings. Publication/provider code is not exercised here.

The explicit local SQL runner is
`bash scripts/scheduler-postgres-check.sh --run-local --bin-dir /approved/bin`.
It accepts no remote target or existing cluster. It requires already-approved
binaries, an unprivileged executor, a fresh private temporary directory,
Unix-socket-only access, an allowlisted environment and durable server settings.
It loads only this pending SQL into a fictional database. Failure or missing
prerequisites is nonzero. Cleanup stops its own cluster before removing it.

The prepared real-SQL suite covers a lock-barrier duplicate/absent-month race,
changed-fingerprint rejection, durable receipt replay, version immutability,
final-receipt failure rollback and clean restart. Remaining qualification must
also cover distinct-key absent-month races, every mutation-stage failure,
independent published/audit guards, cross-store concurrency, coherent snapshots
during writes, unprivileged-role ACLs, lost replies and restart replay. A clean
restart is not power-loss durability.

## Current evidence and activation gates

Real SQL execution is **blocked, not passed**. This executor has no PostgreSQL
binaries or Docker. The separately authorized package-setup attempt encountered
an explicit filesystem access denial and stopped. No retry, escalation,
alternate setup route, service startup or SQL execution followed. A separately
supported and approved test environment is required before claiming syntax,
atomicity, concurrency or restart results for the pending SQL.

Local evidence on 19 October 2026, from source base
`7487b58c74589d0a2ebf2b26bf2e5ca801d69d7e`:

- Adapter protocol mode: 17/17 pass
- Pinned original C113 r1 mode: 17/17 pass, with the real wrapper/contract
  published-read projection and a draft-only marker exclusion check
- Combined scheduler and source guards: 95/95 pass
- Full tests: 1,222 pass, zero fail, one existing greedy role-selection TODO
- Build and shell syntax: pass; existing large-chunk warnings remain
- Missing original artifacts and incorrect archive hash: exit 1 before imports
- Unsupported runner target argument: exit 2 before any cluster startup
- Real SQL, lock races, mutation rollback, ACL and restart execution: not run

Source review identified an SQL null-action guard and a malformed replay-result
shape gap. The candidate now explicitly rejects null actions and requires the
save receipt/result's exact head shape. These corrections and their synthetic
checks do not establish executable SQL correctness.

Source/unit/original-artifact tests and a build cannot replace that evidence.
Before activation: complete actual database validation and independent review;
resolve durable schema/role/private-RPC exposure and end-user authority policy;
decide retention/capacity/provenance; resolve C113 r2 findings; review endpoint
wiring separately; and obtain the final production release approval. Schedule
publication remains unsupported and requires the full context/review transaction
design from the earlier contract adapter.

References: [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html),
[function snapshots](https://www.postgresql.org/docs/current/xfunc-volatility.html),
[function privileges](https://www.postgresql.org/docs/current/sql-createfunction.html),
[Supabase database functions](https://supabase.com/docs/guides/database/functions).
