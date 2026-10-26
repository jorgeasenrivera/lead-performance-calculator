# Coordinated security, import and recovery draft

Local qualification base: b8478e9f45654a03cc1f2212896a4eb59a491366.
Frozen application patch SHA256: 043cb8514cbaede5072b19565379d204811b6604c1be12ef0f2e3a7870573f39 (55 files,416577 bytes). CI scaffolding is separate from the release payload.

This draft is not approved for merge or deployment. Its exact branch disables automatic Git deployment in vercel.json. Manual/CLI/API deployment and live database/Auth tests are prohibited. No SQL here has been applied to production.

## Existing qualification

Node22.23.4 selected118files:1525pass,2protectedfingerprintfail,1TODO; isolatedbuildpass.75focusedrecovery tests included in that count. Three suites excluded: schedule-daterows (known real-derived fixture), ingest-routing and repair-sticks (unverified provenance). Synthetic replacements do not completely cover date-row parsing, routing ambiguity or historical repair/reimport behavior. CI must preserve failures, not claim a full suite.

SQL contracts SHA256 d26a326f49886505857bb6abc2f531c6e82de421c37f715313ee71fe92bbea53; cutover SHA256 2cef6230f625a3418da69d1f5d079c4185fdb2de1b2642d752e976dcc2689f60. Isolated synthetic PostgreSQL17.11/PostgREST16.5 evidence:357SQLsteps,122HTTPchecks,23stronger service-no-sub checks,9mixed-transition cases,2concurrency and2poisoned-migration rollback cases, then2observer-confirmed lock-contention cases. Sets overlap. Services stopped. This is not actual Supabase Auth or deployed-schema equivalence proof. Approved managers' wrong-store legacy PATCH may still return204/no mutation; ordinary obsolete staff direct writes now403 in synthetic qualification.

## X26 owner review required

Core SHA256 73dce2c9079bad61b63e23ec0854cf1d92370f46931cd1ac491875369d4834d2.
Manager SHA256 25caf912baacbf1e7b78f0c3a39742ae3e88e6fcadf6a8799c778732040b6c53.
Protected builder unchanged SHA256 582f8483acaaacb29375624e2e17cdeb70bc1fe19fbb13fa387f171721f7c640.

Review full base-to-head core and Manager diffs plus scripts/scheduler-performance/{build,shared-transform,isolation.test,shared-system.test,delivery-routing.test}.mjs. Existing two positive transform paths intentionally refuse final source until owner review. Do not update pins without X26 disposition. Preserve appended-newline, delivery-marker and sliced-boundary negative controls.

usePhoneLayout remains585bytes, SHA25643b54b8f4fff3ab1085deb0abdba198afb3c135b4c09fc4300d399ba51f3d9b1, exact anchor once. Ten Manager anchors remain unique and six replaced regions unchanged. That does not establish whole-file transformation correctness: inspect new recovery-controller imports/initialization, authorization/projection/publication changes and shared-transform behavior. Preview substitution of SignalSchedule does not exercise actual changed ScheduleRoom publishing.

## Evidence boundaries

Recovery marker carries nonsecret UI continuity only, never password-write proof. Actual live attempt/guard identity governs responses. Tests use synthetic Auth/storage/DOM; real BFCache, native iPad, visual/focus behavior and live provider outcomes remain separate gates. Legacy native word-only requests retain the queue-action adapter wire format. That adapter generates a server operation ID, so durable deduplication across separate HTTP retries is not established. The modern room-command contract carries a client operation ID. Actual native integration remains unproved.

Ordinary CI/performance checks are distinct from the dedicated strict sandbox browser evidence. Do not claim a browser pass from source assertions, parsed reports, or the earlier inline-button capability canary. Production preflight, coordinated SQL/client order and forward recovery remain separately approved release work; do not restore permissive policies as rollback.
