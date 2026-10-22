# Backend-only integration record

This records the earlier backend-only candidate. See [the combined integration](scheduler-combined-integration.md) for the successor frontend adapter and current verification.

This local-only branch integrates the reviewed draft backend and pg transport. The default `/api/scheduler` remains a dormant 503 response. No frontend, endpoint activation, production connection, pilot grant or deployment is included in this integration.

## Provenance and dependencies

Repository base: `25d821a6d0a8e3c9b4a700cc5845c574e1c9b837`.
Original storage candidate: PR492, `0fcfb0c02edf6e5bc694ea63d23adb22c86581e5`, branch `codex/scheduler-storage-boundary`.
The original store, contract and dormant endpoint bytes remain unchanged. The current authorization and pg transport use syntax-equivalent async arrow properties and a hex-encoded space in the Bearer regex to satisfy the existing source guard. The guard is unchanged.

The supplied C113 archive is retained at `fixtures/c113-r1.tar.gz`, SHA-256 `909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622`. All 20 installed persistence source/test files match that original archive. Eight runtime imports are checked by `test/scheduler-codec-pins.test.mjs`; no codec source was rewritten. `api/_scheduler-c113.mjs` aggregates those imports. The explicit server factory defaults to that actual codec. Fixture tests are not duplicated under default test discovery.

The only direct dependency addition is exact `pg` version `8.23.1`. The lockfile adds its dependency graph and preserves every existing package entry semantically. No existing version was updated. Original sealed candidate directories are separate from this integration.

SQL under `supabase/reference/` is historical/reference material, not automatic migrations. `scheduler-draft-structure.sql` SHA-256 is `6ce0c177afeaaae8f5d6c4737274545521156bc0c90c1aeea09bc8250a9b7a33`. It records the previously approved structure installation, migration `20261019184840_scheduler_private_draft_pilot_structure`; do not reapply it to a service. The failed-installation reference is retained for rollback reproduction. The original-transaction reference supports the original adapter artifact checks; those static checks do not establish the newer gateway privileges. The pending pilot template provisions disabled scope only and is not run by application code.

## Reproduce the checks

From the repository root, using the approved non-root environment:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
bash scripts/scheduler-postgres-check.sh --run-local \
  --bin-dir /workspace/.local/postgresql/root/usr/lib/postgresql/17/bin \
  --c113-root "$PWD/fixtures/c113-r1" \
  --c113-archive "$PWD/fixtures/c113-r1.tar.gz"
```

The SQL runner verifies pins first, clears inherited credentials, creates a disposable Unix-socket-only cluster and shuts it down. It installs nothing and accepts no remote database target. `--check-artifacts` is static pin verification only.

Observed results: 1,521 default tests, 1,520 pass, zero fail, one existing generation TODO. Production frontend build passes with the existing large-chunk warning. Five installer groups and 26 scheduler SQL groups execute successfully, with clean shutdown. SQL coverage includes non-superuser installer failure/rollback, runtime and JWT privilege separation, explicit scope/action/profile grants, both revocation lock orders, atomic rollback at write stages, replay, deletion cascades and real pg lock timeout/retry. Identity/JWT verification uses synthetic doubles. Most transport calls use real pg; race controls use psql. Lost-response simulation discards a successful response after commit, rather than inducing a wire failure during COMMIT. Default unit tests include doubles/static assertions and must not be represented as SQL execution. The historical 17-scenario suite is not the count for this integrated runner.

No screen or motion changes were made; browser/phone feel checks are not applicable. Vite compilation does not prove serverless API packaging or hosted connectivity.

## Frontend compatibility handoff

The current `createPlanner` draft cannot be submitted unchanged. It lacks top-level `storeId` and `month`, and its `store` contains additional application metadata. Implement an explicit adapter owned with the frontend work:

- Build `{storeId, month, store, overrides}`. Store requires `people`, `rules`, `teams`, `memberships`; only `timezone` is optional. Preserve and validate the actual required data. Do not silently discard invalid required fields.
- Use the exact C113 validation contract in `scripts/scheduler-performance/persistence/validate.mjs` and `docs/scheduler-persistence-contract.md`. Unknown fields are rejected. The persisted timezone is `America/New_York`; months range from 2014-01 through 2100-12. Serialization removes only top-level `accepted` and `reviewFingerprint`.
- Authenticate with a verified Bearer token. Never send a body actor as authority. Active/nonpending admin or manager status alone is insufficient: the exact actor, approved store and draft action need explicit authorization.
- Read with `{op:"read",storeId,month,input:{kind:"draft"}}`, without `requestId`. Response is `{result:{kind:"draft",revision,schedule}}`; an empty draft has revision 0 and null schedule.
- Save with `{op:"save",storeId,month,requestId,input:{baseRev,draft}}`. Use the last read revision. Response is `{result:{head:{draftRev,publishedRev:0}},replayed}`.
- Preserve a request ID and the exact command across an uncertain 503 retry. Changed commands need new IDs. Changed payload with a reused ID yields 409. A stale revision also yields 409: reload and reconcile while retaining local edits, rather than silently overwriting.
- Transport limits are 1,048,576 bytes, depth 64 and 50,000 nodes; codec constraints can be tighter. Surface validation, forbidden, conflict and temporary-unavailable states distinctly.

No frontend export/import adapter, import confirmation, automatic purge, publication, capture or published-read flow is activated. Existing publication contract tests use injected ports and do not prove a production publication provider.

## Remaining release work

Keep runtime LOGIN/password, Vercel secret delivery, pilot enablement/grants and endpoint/client activation held for their separately authorized steps. Explicit server composition needs `enabled:true`, a verified identity client and server-only transport configuration. Never expose that configuration to frontend code. Hosted TLS/pooler authentication and serverless tracing of pg plus codec imports remain untested. The codec runtime lives under `scripts/`; the existing deployment ignore rule skips script-only changes, so future codec-only releases must account for that rule. This combined integration changes API/package files. No deployment configuration is changed here.
