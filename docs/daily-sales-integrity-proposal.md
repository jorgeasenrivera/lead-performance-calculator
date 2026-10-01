# Daily-sales protection proposal

X13 is an isolated approval study. No production application source changes,
database writes, data deletion, archive backfill or deployment are included.

## Decisions

1. Calendar and day detail: retain the calendar and monthly stock mix. Use
   “Daily totals unavailable” where visit-time snapshots cannot establish a
   daily count. Do not invent zeroes or a best-day result.
2. Recap: preserve monthly totals, goals, pace and recorded activity. Replace
   snapshot-derived yesterday sales with the same neutral line.
3. Comparisons: keep the existing monthly report history. Hold unsupported
   day-based closing and standing comparisons, and remove promises that the
   old snapshots will become reliable after two visits.
4. Browser writer: stop producing the unverified snapshots. Opening or
   switching stores is not evidence of a finished reporting day. Keep existing
   rows for audit. A report-backed daily source is a separate proposal.

Detailed findings stay in the private conversation. The adapter has an optional
safe diagnostic hook, with no notification destination installed. A manager or
another admin gets no technical warning or private investigation details.

## Boundary

`api/_digest-integrity.mjs` distinguishes loading, missing, incomplete, rejected
identity and read errors. All legacy input remains unavailable for daily sales,
even consecutive dates, matching date fields or equal totals. The read-only
adapter returns no usable history, keeps a bounded short successful-read cache,
deduplicates pending reads, times out stalled reads and never caches errors.
The selection generation and render-time identity gate prevent a late store A
result appearing under store B. No report figures or backend error messages are
sent to the optional diagnostic hook.

`scripts/daily-sales-integrity-proposal.mjs` applies the prospective change to
an in-memory copy of Manager.jsx. Its fixture mounts the actual Manager
components with fictional Store A and Store B. The probe pins the clock to
22 September 2026, checks monthly totals of 61 and 83 respectively, and preserves
the original Daily Activity display. Both production application files remain
byte-for-byte unchanged.

## Verification

- Pure regressions cover gaps, decreases, equal and zero snapshots, missing
  baselines, invalid identity, month/year/DST boundaries, retry after error,
  timeout, bounded caches and cached/uncached store switches
- The separate read-only CI workflow checks Chromium and WebKit at 390, 700,
  701 and 1280 pixels, including calendar, selected day, channel popup, recap,
  repeated opening, role privacy, failed reads and store switching
- Browser requests are intercepted locally. Even the unmodified before build
  cannot write a database. Every proposed digest mutation makes the probe fail
- Before/after screenshots and a machine-readable result are CI artifacts
- Production tests and build remain separate required checks. Browser results
  and visual decisions must be recorded before this proposal is called approved

Run `node scripts/daily-sales-integrity-proposal.mjs` to build the two isolated
bundles. The dedicated workflow serves them and runs
`node scripts/daily-sales-integrity-probe.mjs`. Local Chromium in the current
cloud workspace cannot open its required process socket; that is a verification
limit, not a browser-test pass.

If the visual decisions are approved, apply the reviewed transform to
Manager.jsx and update the stock-split guard from three readers to two because
the removed digest builder is no longer a reader. Re-run all checks against
that exact production patch. Approval of this study does not authorize merge
or deployment.
