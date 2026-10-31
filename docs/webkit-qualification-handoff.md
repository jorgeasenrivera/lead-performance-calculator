# WebKit qualification plumbing: handoff for the independent reviewer

Base: PR 501 head `23dbdb7d84c8ec328a7fb6056dabad34e2ebeeef`. Branch: `nonprod/webkit-qualification-plumbing`. Candidate only. Nothing imports it. `scripts/ci-fixture.sh` still refuses WebKit with exit 5, and a test pins that.

## Status: BLOCKED, and every receipt says so

Every receipt has `qualifying: false` and a constant `blocked` list. No run, mocked or real, can change that. This is deliberate, after the exact-30f7 review rejected the first version.

Why it is blocked:

- **No attestation verifier.** The attestation is checked for shape and freshness only. Its `evidenceSha256` is not verified and is not bound to the binary, the Playwright version or the runner. `records.evidenceBound` is always `false`.
- **The executable hash is narrow.** It covers the one file at the verified path. The reviewer reports that this is the `pw_run.sh` launcher, not the WebKit binaries it starts. I have not checked what that file does. The path must now be canonical (the real path equals the recorded path), but that only stops a symlink hop. It does not widen what is hashed.
- **No process-tree proof and no runtime sandbox proof** exist for WebKit. The real binding supplies no descendants check, so `descendants` is `unproven` after a launch.
- **The "real" binding proves nothing.** `realWebkitDeps` accepts any driver directory. It only sets `bindingKind: "real-binding-unreviewed"`. A test points it at a synthetic driver with forged, well-shaped records and checks the receipt is still non-qualifying.

Qualification needs an external verifier and a runtime proof. That is a new reviewed change, not a flag in this file.

## What changed since 30f7aae (findings 1, 2, 4, and 6)

- **1. Close before start or during STARTING.** `close()` and `cancel()` are now one terminal path. Before start, they stop `start()` from ever launching. During STARTING or CONNECTING, the run's step is allowed to settle (bounded), the run sees the stop request, takes ownership of whatever the step produced, closes it, and only then does `close()` return. A later `close()` returns the same terminal receipt.
- **2. Forged records plus close during STARTING.** The receipt can no longer be `qualifying`, can no longer say `descendants: none-observed` for a run that launched, and can no longer say `ownership: none` for a server that was produced and closed.
- **4. Cancel returning early.** `cancel()` resolves only at the terminal state.
- **6. Expiry.** Freshness is rechecked after start and before READY, not only once up front.
- **A step that never settles.** `close()` waits `lateWait` (bounded) for it. If it still has not settled, the run is `UNCERTAIN` with `unresolved` listing the work (`start-unresolved` or `connect-unresolved`). If the handle arrives later, it is still closed, but `UNCERTAIN` never turns into anything else. A receipt only ever gains reasons.
- **Finding 5 (canonical path).** Partly addressed: a non-canonical path is refused. The launcher-only hash scope is stated and not fixed.
- **Finding 3.** Not fixed. Stated as a blocker above.

## Lifecycle guarantees (synthetic tests only)

The 28 tests use fakes. No real browser is started. One test builds a throwaway driver directory of synthetic JavaScript to exercise the real binding, and removes it afterwards.

- Launch is only called after both records pass shape and freshness and the machine matches them (canonical path, executable path, sha256, Playwright version). Callers pass no launch options.
- Every wait is bounded. Close is single-flight. A close that throws or hangs is a failure and escalates to `kill()` on the owned server handle only. Nothing is killed by name, pattern or guessed pid.
- An exit that was not observed is `UNCERTAIN`.
- `ok` means the lifecycle was clean (reached READY and closed with no reasons and nothing unresolved). It is not a qualification.
- Receipts carry closed-vocabulary codes, state names, booleans and numbers. No error text, paths or hashes.

## Not proven by anything here

- That WebKit is sandboxed on any runner.
- How many processes WebKit starts, and whether any survive close.
- That `launchServer` and `connect` behave as the upstream docs say on the runner. `realWebkitDeps` has never been run against a real browser.
- That Playwright's default signal handlers (`handleSIGINT`, `handleSIGTERM`, `handleSIGHUP` default to true) are acceptable here. They are left at their defaults.
- The pinned Playwright version for this repo was not read. The upstream docs were read from `main`.

## Process notes

- `AGENTS.md` asks for a claim row on `docs/in-flight.md` on `main` before starting. This work was scoped to new files on a separate branch with `main` untouched, so no claim was made. Add one if this goes forward.
- `CLAUDE.md` names `Claude Opus 5` in the commit trailer. The commit uses the trailer the session was configured with, which names the model actually used.
