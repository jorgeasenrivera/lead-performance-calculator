# WebKit qualification plumbing: handoff for the independent reviewer

Base: PR 501 head `23dbdb7d84c8ec328a7fb6056dabad34e2ebeeef`. Branch: `nonprod/webkit-qualification-plumbing`. Candidate only. Nothing imports it.

## What is here

- `scripts/strict-webkit-kit.mjs`: a dependency-injected launcher and lifecycle state machine, and the qualification contract it enforces.
- `scripts/strict-webkit-kit.test.mjs`: 22 synthetic tests. Fakes only. No browser, no launch, no network, no install.
- This file.

Not touched: `scripts/ci-fixture.sh` (still exits 5 for WebKit), `.github/workflows/*`, `docs/in-flight.md`, `docs/handoff.md`, `main`, and every other file. A test pins the refusal line and that nothing references the new kit.

## The contract

1. Two records come from outside this repository's tests: a prerequisites record and a sandbox attestation. Both must say `VERIFIED`, be complete, be current, and the attestation must be of kind `real-sandbox` for engine `webkit`. Anything else refuses before any launch call.
2. The machine must match the record: executable path, its sha256, and the Playwright version.
3. Callers pass no launch options. The only options are the verified `executablePath`, `headless: true` and a timeout. No WebKit flags are guessed.
4. Launch uses `BrowserType.launchServer` then `BrowserType.connect` with a timeout, because `BrowserServer` gives an owned handle (`process()`, `wsEndpoint()`, `close()`, `kill()`), as documented upstream. The endpoint must be loopback.
5. Every wait is bounded. A start or connect that outlives its bound is UNCERTAIN, and a late handle is adopted and closed.
6. Close is single-flight and shared with cancel. Escalation is `kill()` on the owned server handle only. Exit is read from the direct child's `exitCode` or `signalCode`; not observed means UNCERTAIN.
7. Receipts carry closed-vocabulary codes, state names, booleans and numbers. No error text, no paths, no hashes of the records.
8. Only dependencies built by `realWebkitDeps()` can give `qualifying: true`. Fakes always give `evidenceClass: "synthetic-unit-test"` and `qualifying: false`.

## Runtime gaps (not proven by anything here)

- That WebKit is sandboxed on any runner. The attestation is an input, not something this code checks.
- How many processes WebKit starts, and whether any survive close. Descendants are reported `unproven` and the real binding supplies no check. So a real run cannot be `qualifying` until a reviewed `verifyNoDescendants` exists.
- That `launchServer` and `connect` work for WebKit on the runner the way the docs say. `realWebkitDeps` has never been called.
- The signal handlers Playwright installs by default (`handleSIGINT`, `handleSIGTERM`, `handleSIGHUP` default to true) were left at their defaults. Whether that is acceptable here is a reviewer decision.
- Pinned Playwright version for this repo: not read. The upstream docs were read from `main`.
- `qualifying` is a claim about one run for a reviewer. It is not an approval.

## Process notes

- `AGENTS.md` asks for a claim row on `docs/in-flight.md` on `main` before starting. This work was scoped by the requester to new files on a separate branch with `main` untouched, so no claim was made. The reviewer or owner should add one if this is taken forward.
- `CLAUDE.md` names `Claude Opus 5` in the commit trailer. The commit here uses the trailer the session was configured with, which names the model actually used.
