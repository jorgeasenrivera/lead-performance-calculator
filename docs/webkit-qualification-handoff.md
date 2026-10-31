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

The 33 tests use fakes. No real browser is started. One test builds a throwaway driver directory of synthetic JavaScript to exercise the real binding, and removes it afterwards.

- Launch is only called after both records pass shape and freshness and the machine matches them (canonical path, executable path, sha256, Playwright version). Callers pass no launch options.
- Every wait is bounded. Close is single-flight. A close that throws or hangs is a failure and escalates to `kill()` on the owned server handle only. Nothing is killed by name, pattern or guessed pid.
- An exit that was not observed is `UNCERTAIN`.
- There is no `ok` field. `lifecycleOk` means only that this run reached READY and closed with no reasons and nothing unresolved. It is not a qualification and not a pass. `verdict` is the constant `NOT_QUALIFIED`. `start()` resolves `ready`, meaning only that READY was reached.
- Receipts carry closed-vocabulary codes, state names, booleans and numbers. No error text, paths or hashes.

## Failure semantics for any future integration

- `webkitRunFailed(anything)` is the one to use. It returns true for every input, always, including a wholly fabricated receipt that says `qualifying: true` and `verdict: "QUALIFIED"`, and a genuine clean receipt with only its labels flipped. A receipt is plain data anyone can write and there is no verifier to check one against, so none can be believed. When a real verifier exists, this becomes a new reviewed change that calls it. No verifier is added here.
- `lifecycleFailed(receipt)` is lifecycle only. It is for diagnosing a run, and must not be used to decide a WebKit result.
- Nothing calls either. No caller is wired, and `ci-fixture.sh` still refuses WebKit.

## Bookkeeping faults (8f63e00 follow-up)

- An injected clock that throws or returns a non-number is recorded once as `clock-fault`. The last good time is used, freshness fails closed, and cleanup is still attempted. The run is never clean.
- Any unexpected fault in the run or the close path is recorded as `internal-fault` and ends `UNCERTAIN`. The fallback makes one bounded best-effort close only of an owned handle the normal path had not already attempted. A handle whose close or kill was already attempted (including one that timed out or threw) is never closed or killed a second time. A produced handle that cannot be inspected is unresolved, so the run stays `UNCERTAIN`.
- The fallback's branch for a handle that was not yet attempted is defensive. I found no way to reach it through the injected dependencies without adding a test harness, so it is not exercised by a test. The tests prove the part that matters: nothing is closed twice.
- `start()`, `close()` and `cancel()` never reject, and a failed close is no longer cached as a rejected promise.
- A test faults the clock at every read of a full clean run and checks each case: the server is closed, the fault is in the reasons, the state is `REFUSED`, `FAILED` or `UNCERTAIN`, and a second `close()` returns the same receipt.

## Cancel and close are bounded, not prompt

They wait for the step in flight (preflight up to 2 x `preflight`, start up to `start + startGrace`, connect up to `connect + startGrace`, health up to `health`). Then the close path runs: `lateWait` for a timed-out start and again for a timed-out connect, browser close, server close, kill, `exitObserve`, and a descendants check if one was supplied. The worst case is the longest in-flight step plus that close path, a sum of the configured timeouts, roughly a minute with the defaults. A caller that needs a hard deadline must set its own.

## Playwright source evidence (as reported by the independent reviewer; not read by me)

Playwright v1.63.0, commit `1b025d7e20a026371cd5f98ba0cdce48892737c8`, `packages/utils/processLauncher.ts`:

- `handleSIGINT`, `handleSIGTERM` and `handleSIGHUP` default to true. They are left at their defaults here.
- `close()` waits for the child to close and for temp cleanup.
- `kill()` sends SIGKILL to the process group and waits, with no timeout of its own. The only bound is this kit's `kill` timeout.
- A group kill does not prove that descendants which left the group are gone. So `descendants` stays `unproven`, and a clean exit of the direct child is not process-tree evidence.

## Not proven by anything here

- That WebKit is sandboxed on any runner.
- How many processes WebKit starts, and whether any survive close.
- That `launchServer` and `connect` behave as the upstream docs say on the runner. `realWebkitDeps` has never been run against a real browser.
- That Playwright's default signal handlers are acceptable here. They are left at their defaults.
- Whether the Playwright version this repo pins matches v1.63.0. I did not read the repo's pin. The upstream docs I read myself were from `main`.

## Process notes

- `AGENTS.md` asks for a claim row on `docs/in-flight.md` on `main` before starting. This work was scoped to new files on a separate branch with `main` untouched, so no claim was made. Add one if this goes forward.
- `CLAUDE.md` names `Claude Opus 5` in the commit trailer. The commit uses the trailer the session was configured with, which names the model actually used.
