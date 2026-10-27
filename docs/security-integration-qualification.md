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

## Follow-up of 27 October 2026: CSV roll-up, recovery backup, strict browser cases

This section supersedes the hashes and counts above where they differ; the text above describes head 82e59f924020e11148a6d07fe41ff75f6de7d6f7. No merge, deployment, production database, live Auth, email or password operation is part of it, and the branch deployment guard in vercel.json is unchanged.

Changes: the cross-check reads a blank, whitespace or dash roll-up cell as unknown and not zero (Manager only, explicit zero and 0.5 kept, text that is not a number unchanged); the daily admin backup no longer runs while a password reset is unresolved, pending, visible, failed or interrupted, runs once after the reset is saved or left, and stops writing when the account, profile, recovery generation or mount changes; the owner's two-literal builder pin (patch SHA256 78f71caf42a828599b50f63c4ec200883e688c5031833c2cccd0b0c29af0b3a0) for the new core and Manager; and a strict-sandbox browser workflow, kit, synthetic backend and cases. The owner proof was 133 of 133 with no transform change.

Source SHA256: core deb49061d44e72920797307f1449dae0ca37a06de722c091e93daed8ed3824f0, Manager a43ca55c7be25431461f94ce5a0d59d6e8fbe09a11a06befeda9e226e2ba4b31. The pin was applied once, unmodified, in a disposable integrated copy; the pre-pin tree was not touched, so results before and after the pin are different trees.

Local qualification: the approved selected list of 121 files (security-integration-selected-tests.mjs) ran 1594 tests, 1593 pass, 0 fail, 1 TODO. The three excluded suites (schedule-daterows, ingest-routing, repair-sticks) are NOT passes. That count includes 19 Manager source tests for the roll-up, 21 actual-source lifecycle tests for the backup (deferred promises held at the real awaits), and 26 strict-kit and workflow tests. npm run build and the isolated preview build both exited 0.

Mounted browser cases ran locally on Chrome 141.0.7390.37 and Playwright 1.56.1, with the browser run as an unprivileged user, the sandbox on and every request outside two loopback origins refused: 35 observations from an earlier driver revision, plus a strengthened A6 and A12 (second password write held, no write allowed until its release, completion read from the screen) that pass 2 of 2 on the unchanged core, with both failing on the unmodified base build as negative controls. The unmodified base also fails the recovery cases by design: it writes the backup as the recovery session before the reset completes. The write timeline records writes after the harness released the held password write; it does not show that the SDK accepted it.

Not established: the pinned hosted run (Chrome 153.0.8010.12, Playwright 1.63.0) has not run, so hosted CI is unknown; no physical phone, no real BFCache, no SQL or RLS guarantee (the synthetic schedule read mirrors the SQL contract and is not the SQL); the backup is not guaranteed to run (an entry whose account never again becomes the queuing admin is discarded, and the next admin open makes a new one). Known and unchanged: the morning round-up is drawn over the reset form for a manager account, and the cross-check line "Every name and every figure matches" can show beside unknown records.
