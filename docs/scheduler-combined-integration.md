# Local combined scheduler draft candidate

This successor combines verified frontend commit `9a5fe8a2fafda81d57c977a098768b9a5bbe4831` with backend commit `c38c4f57100799f2a0fc7002a932970ae24226ef`, applied as `b6694df`. The frontend tree is exactly `519ed45a1bf0173270e9cd6b8a78bf6c8fc0ef87`, based on published PR494 commit `b6cd4798d6daa0ab950f6e8e142f6df6479521f4`. The older backend base did not contain the editor, so this candidate uses the verified frontend head as its baseline. Earlier sealed candidates remain unchanged.

The authorized Library transfer failed twice without producing bytes. Fetching the published Git branch succeeded. The generated binary diff from b6cd479 to9a5fe8a has SHA-256 `12e140ed4982e684a2325fe3e7e74e03f495ef078bc76cc9ae2c2a906c7d58da`, which differs from the Library artifact's hash. Exact commit/tree verification is the provenance used here; the two patch serializations are not claimed byte-identical.

## Composition and compatibility

`src/scheduler-draft-codec.mjs` supplies the concrete codec for the opt-in frontend transport and desktop composition. Pass `schedulerDraftCodec` as the transport's `codec` and desktop's `draftCodec`. It validates the complete detached editor projection with the original pinned C113 validator. It never drops unknown fields, changes absence kinds, infers availability or normalizes a timezone. The C113 source bytes and eight runtime pins are unchanged.

Supported unknown availability remains null, and supported provenance survives save/read/hydration. Legacy absence kind `legacy-off`, arbitrary extra fields, unknown-person annotations, unsupported timezones and wrong scopes are refused. Some editor inputs accepted for local editing therefore cannot be stored. This is an explicit compatibility limitation, not a migration or a silent conversion. Import and off-day transfer controls are already disabled in the supplied draft-saving desktop view. Other local editor callers retain their defaults.

The auth adapter, server identity reader, explicit actor/store/action grants and original request token are still required. The browser test supplies synthetic auth at this seam; it does not verify a real identity provider. Controller retries retain the exact request ID, bytes and editor acknowledgement token. Pending controls cannot be saved. Stale revisions preserve local state and require explicit recovery. Each month saves independently; this is not a cross-month transaction.

No application entrypoint imports the new desktop composition or concrete codec. The production scheduler endpoint remains the original dormant 503 handler. No LOGIN, credential, production grant, activation or deployment is included.

## Reviewed pin changes

Only five entries in `scripts/search-runtime.scheduler-v1.sha256` change:

- `month-app-core.mjs`: opt-in draft save controls, disabled import/transfer entry guards and pending-day recovery. Default option remains false.
- `month-model.mjs`: capture and recheck expected store/month before and after hydration verification, before mutating a draft.
- `scheduler-editor.jsx`: forward the opt-in controls, expected hydration scope and pending-day review; include the option in the mount effect lifecycle.
- `package.json` and `package-lock.json`: the previously reviewed exact `pg@8.23.1` addition. Every preexisting non-root lockfile package entry remains semantically identical.

The three frontend files remain exact bytes from9a5fe8a. All other manifest entries remain unchanged. The historical binding fixture pinned to b6cd479 stays historical, while new codec tests use the current planner and actual C113. No source guard or pin check was disabled.

## Reproduction

Use a non-root approved environment, with the exact published b6cd479 Git object present for historical tests:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
node scripts/scheduler-performance/build.mjs
sha256sum --check scripts/search-runtime.scheduler-v1.sha256
FEEL_PLAYWRIGHT=/workspace/cloud-tools/node_modules/playwright \
 FEEL_CHROME=/usr/bin/chromium \
 PROBE_EVIDENCE_DIR=/workspace/sage-combined-evidence/editor \
 node scripts/probe-scheduler-editor.mjs
bash scripts/scheduler-postgres-check.sh --run-local \
 --bin-dir /workspace/.local/postgresql/root/usr/lib/postgresql/17/bin \
 --c113-root "$PWD/fixtures/c113-r1" \
 --c113-archive "$PWD/fixtures/c113-r1.tar.gz" \
 --browser-probe /workspace/cloud-tools/node_modules/playwright/index.mjs
```

The optional browser probe uses the approved installed `/usr/bin/chromium`. It builds a temporary opt-in desktop fixture, serves only loopback HTTP and connects through pg to the runner's verified disposable Unix socket. The fixture's synthetic grants and login changes occur only inside that disposable database. The runner clears inherited environment credentials and shuts down/removes its own cluster. Browser requests outside the fixture origin are blocked and counted. No installation or external service connection occurs.

## Evidence and limits

Evidence is recorded outside the repository at `/workspace/sage-combined-evidence`. Full unit discovery: 1,714 tests, 1,713 pass, zero fail/skip, one existing generation TODO. Eight explicit compatibility tests use actual C113. The production frontend and isolated scheduler builds pass with existing chunk-size warnings. The source manifest passes. Existing browser editor checks pass with no external requests.

Five installer groups and 26 SQL groups exercise real PostgreSQL, including permissions, revocation lock ordering, rollback, revision/replay and timeouts. Static pin checks and unit doubles are separately labeled; they are not SQL execution. The opt-in browser probe checks the actual desktop composition through HTTP, real pg transport and real C113. The deterministic uncertainty case returns truncated JSON after a successful commit; it does not induce a failure during COMMIT. An earlier socket-close experiment caused Chromium to retry transparently and the server replayed the command; that experiment could not assert the explicit retry button and is retained as failed harness evidence. The initial fixture also failed due to omitted SQL column names; the final fixture names columns explicitly. An extended probe initially tried to click the correctly disabled Save button for an unapplied form; it now asserts that prevention. Final Chromium desktop execution passed all ten scenarios with 17 local requests, zero external requests and zero page errors, then clean database shutdown. The visible People form edit saved revision 2 and reloaded into its controls. New draft-saving desktop checks were not run in WebKit or on a physical phone.

| Boundary | Evidence |
| --- | --- |
| Authorized synthetic admin, explicit store, draft read/save | Local HTTP/pg/browser and SQL suite |
| Admin without explicit action/store grant | SQL denial |
| Wrong store or principal change | Browser denial/invalidation and unit tests |
| Direct anon/authenticated/service role gateway access | SQL denial |
| Published read, capture and publication | Draft-only boundary denies; no live publication proof |
| Real JWT provider, hosted TLS/pooler and serverless packaging | Untested |

OWASP ASVS 5.0.0 was consulted as verification guidance (https://owasp.org/projects/asvs); this scoped check is not an ASVS certification. Capacity/coverage optimization, DST and business scheduling policy are unchanged and are not newly certified by storage tests.

Hosted identity, secret delivery, serverless tracing and pooler/TLS checks remain release gates. Endpoint/client activation and any production runtime LOGIN or pilot grant require their separately authorized steps. No push, merge or deployment is part of this local candidate.
