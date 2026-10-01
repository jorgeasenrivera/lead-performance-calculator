# Reported calendar reader

X20, source-only dependent draft after #462. Nothing imports this reader into
the application. Pixels and production behavior are identical. The endpoint
remains draft #456; no live session, HTTP request or database query was tested.

## Boundary

`createReportedMonthReader({auth, fetchImpl, timeoutMs})` takes the existing
client's opt-in auth adapter from #462. It owns only its subscription to that
adapter and one attempt at a time. It never disposes the shared adapter/client.

- `getSnapshot()` returns stable frozen status, days and non-secret request
  context: storeId, month and principalEpoch. No token, raw response, source
  identity, diagnostic or fetch time enters public state.
- `subscribe(listener)` returns cleanup.
- `setContext({storeId, loadedStoreId, month, active})` synchronously invalidates
  the old attempt and visible values when these fields change. Equivalent
  contexts do nothing. Close or loaded-store mismatch is idle with no values.
- `retry()` synchronously starts a new generation and current-token attempt.
  Failed requests do not retry automatically. Auth changes start a fresh
  generation and clear values immediately, even at the same store.
- `dispose()` aborts pending work, clears values and unsubscribes once.

There is no React hook in this slice. A future `useReportedMonth` integration
must mask context-mismatched snapshots during render, before the layout effect
updates the controller. Otherwise a new selected store could paint an old
store's values for a frame. The sole Manager writer owns this integration after
#459's remaining production checks. The approved interface maps the controller
to `{status, days, retry}` and the current auth epoch.

## Transport and validation

One monotonic five-second deadline starts before credential acquisition and
continues through fetch, JSON decoding and validation. Expiration aborts the
request and publishes unavailable. Checkpoints reject late completion even
when the deadline callback has not run. Epoch, generation and cancellation
are checked after every asynchronous boundary and before fetch/publication.

Only a current header-safe bearer token allows a relative same-origin GET to
`/api/daily-deliveries?store=...&month=...`. Requests use no-store, AbortSignal,
same-origin credentials and redirect:error. Still-current missing session and
401/403 are denied. Cancelled lookup causes no request and no stale error.
Other HTTP states, unavailable route, network failure, invalid JSON and invalid
response are unavailable, never successful empty data. Error bodies are not
decoded or displayed.

The projector follows #456's `publicDailyMonth`, not the proposal fixture.
Store/month identity must match exactly. The response must contain every valid
date in the month once. Sort dates only after validation. Provisional counts
are finite nonnegative numbers, including explicit zero. New/Used is either
two nulls or a valid nonnegative pair summing to the count. Missing, incomplete
and conflict days carry null count, both null split values and null asOf.

Provisional asOf is the original canonical UTC `{timestamp, basis}` pair,
with basis report_sent or report_received. Unknown dates have null asOf.
No fetch timestamp is manufactured. Extra fields are dropped, not forwarded.
Projected days, splits and asOf are frozen so a consumer cannot corrupt the
reader's retained snapshot.

`easternBusinessMonth()` uses the actual Eastern clock and its daylight-savings
rules. It is not wired to any fixture date or screen in this pass.

## Verification and gates

The synthetic suite covers complete/leap months, zero vs unknown, identity and
shape faults, timestamp basis, strict splits, Eastern month boundaries, status
handling and private-safe failures. It also covers token lookup cancellation,
account replacement during decoding, loaded-store mismatch, store/month changes,
same-store retry and close/reopen, disposal, late failures, hung lookup/fetch/
decode, and one deadline rather than sequential budgets.

These tests run no network. A real endpoint, session, store permission change,
React mount lifecycle and phone screen remain unverified. Independent review
of request checkpoints and schema parity precedes integration. No merge,
backend activation, ingestion rollout, historical write or deployment is
authorized by these synthetic results.
