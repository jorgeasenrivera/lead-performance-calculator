# Daily-sales protection

Jorge approved all four visual decisions below on 30 September after reviewing
the fictional-data screenshots, and requested implementation and publication.
X13 now applies the approved protection to production Manager code. No database
writes, data deletion, archive backfill or reconstructed daily values are included.

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
digest result appearing under store B. Safe diagnostic codes carry the validated
source store ID and day, including after an out-of-order response. Invalid
identifiers, report figures and backend error messages never reach the optional
hook. This is the daily-digest boundary, not a rewrite of the whole app's store
transition or its monthly data handling.

`src/Manager.jsx` now contains the approved protection. The after build in
`scripts/daily-sales-integrity-proposal.mjs` mounts the checked-in Manager
components directly, with no after transform. The before fixture reads Manager
from immutable reviewed commit `8d2befb7db44fb8ab8dcd855a5d09ccd62005906`,
verified against blob `e306078d145c3cb7816a14543147367580e76b89`. CI checks
that source out separately, avoiding a Git trust-setting change in the container.
Both use fictional Store A and Store B. The probe pins the clock to 22 September
2026, checks monthly totals of 61 and 83 respectively, and preserves the original
Daily Activity display. Fingerprint guards protect the existing Daily Activity,
import and monthly stock-split source. LeadPerformanceCalculator.jsx is unchanged.

## Verification

- Pure regressions cover gaps, decreases, equal and zero snapshots, missing
  baselines, invalid identity, month/year/DST boundaries, retry after error,
  timeout, bounded caches and cached/uncached store switches
- The separate read-only CI workflow checks Chromium and WebKit at 390, 700,
  701 and 1280 pixels, including calendar, selected day, channel popup, recap,
  repeated opening, role privacy, failed reads and store switching
- Browser requests are intercepted locally. Even the unmodified before build
  cannot write a database. Every protected-build digest mutation makes the probe fail
- Before/after screenshots and a machine-readable result are CI artifacts
- Production tests and build remain separate required checks. All four visual
  decisions were approved against the final proposal screenshots. The production
  patch must pass the same browser assertions before publication is complete

Run `node scripts/daily-sales-integrity-proposal.mjs` to build the two isolated
bundles. The dedicated workflow serves them and runs
`node scripts/daily-sales-integrity-probe.mjs`. Local Chromium in the current
cloud workspace cannot open its required process socket; that is a verification
limit, not a browser-test pass.

## Rollout and remaining work

The approved Manager change removes the old digest builder and writer. The
stock-split guard therefore expects the two real monthly readers, the hero and
phone board, rather than counting the removed builder as a third reader.

Refresh or reopen Sage to load this protection. A client still running the old
bundle can still execute its old writer until it refreshes; this is not a
server-enforced write ban. The protected UI rejects those rows regardless. No
Supabase policies or stored records change. Reconstruction from verified reports
is separate work, and unknown days remain unknown until supported by evidence.

Private diagnostic delivery is not installed. The optional internal hook carries
only validated store/day identity and safe reason codes; it does not notify all
admins or expose investigation details to staff.
