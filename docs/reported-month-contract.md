# Reported calendar reader contract

Source-only preparation, X19. No application import, report HTTP request,
visual change, backend activation or production data write is included.
The approved display is #460. The server reader remains unmerged draft #456.
The Signal production review remains #459 and is not modified here.

## Auth boundary

`createReportedAuthAdapter(existingClient)` owns one removable subscription to
the existing client's auth events. It does not create a second Supabase client,
change global `apiCall`, sign anyone in/out, or write auth metadata.

- `getSnapshot()` returns a stable frozen `{principalEpoch, disposed}` object.
- `subscribe(listener)` returns cleanup. Every auth event increments the epoch,
  including same-account sign-in and token refresh. This conservative policy
  intentionally invalidates same-store results even when user identity looks
  unchanged. No user id, token, timestamp or claims are in the snapshot.
- `getAccessToken({expectedEpoch, signal})` reads the current SDK session per
  attempt. It returns the access token only to the caller. Missing session is
  null. Abort, epoch change or disposal returns null and ignores late completion.
  SDK failure, malformed session and the bounded five-second auth budget throw
  a fixed `REPORTED_AUTH_UNAVAILABLE` error, with no raw diagnostic or cause.
- `dispose()` invalidates pending attempts synchronously and unsubscribes once.

Token acquisition starts in a macrotask, not inside the synchronous auth
callback. Listener callbacks must stay synchronous and must not await SDK calls.
The SDK's underlying `getSession` promise cannot be aborted, but an abandoned
result is never returned. Neither the adapter nor any display state stores a
token. The caller must still check its display generation and current epoch
before making a report request or publishing the result.

The existing code already calls `supabase.auth.getSession()` in `getTokens` and
uses `onAuthStateChange` in `onAuthChange`. Neither existing helper changes.
The SDK session is a credential source only, not an authorization decision.
The server must validate the bearer session and current active store membership.

Official auth reference checked on 1 October:
[session access](https://supabase.com/docs/reference/javascript/auth-getsession)
and [auth notifications and cleanup](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
The skill's Markdown changelog endpoint could not be read by the web tool; the
[HTML changelog](https://supabase.com/changelog) was checked instead. No SDK or
lockfile upgrade is part of this pass.

## Reader interface proposed by Dot

`useReportedMonth({storeId, loadedStoreId, month, active, principalEpoch,
getAccessToken})` returns `{status, days, retry}`. This hook is not implemented
or wired by X19. Its states are idle, loading, ready, denied and unavailable.

The future transport is a same-origin authenticated GET to
`/api/daily-deliveries?store=...&month=...`. It preserves HTTP status, uses
`cache: no-store` and an AbortSignal, and never requests a report without a
current token. The entire attempt, including token acquisition, shares one
bounded deadline. The auth budget must not be added after a separate fetch
budget. No generic `apiCall` diagnostic output enters this reader.

Response shape: `{storeId, month, days:[{date, status, count,
vehicles:{new,used}, asOf}]}`. Accept only the selected store/month when selected
and loaded store identities agree. Reject duplicate or invalid dates, malformed
numbers, unknown statuses, and store/month mismatches. Project only display
fields. Do not forward source identifiers, raw records or diagnostics.

Day states remain provisional, missing, incomplete and conflict. Known zero
stays zero. Unknown count and unavailable New/Used components stay null. `asOf`
is null or `{timestamp, basis: 'report_sent' | 'report_received'}`, not a bare
timestamp. Preserve the report's timestamp and its source basis, never substitute
the fetch timestamp. Use the real Eastern
business month, not a fixture clock or the browser's UTC month.

401/403 map to denied. Missing route, 503, malformed payload, timeout and network
failure map to unavailable. Cancellation must not publish an error over the
next generation. Store, month, session, close/reopen and retry changes invalidate
the visible values synchronously and advance a monotonic display generation.
No reuse of values from another principal, including at the same store.

## Gates

Synthetic auth tests verify cancellation, late resolution, timeout, refresh,
same-store account changes and lock-safe credential acquisition. This does not
verify a live SDK session, deployed endpoint, database policy or visual flow.
Dot cleared the source-only adapter interface at #462 comment 5937644095.
Her timestamp-basis clarification is incorporated above. Calendar
screen changes stay with the sole Manager writer, after #459 is settled.
Backend activation and historical application remain separate decisions.
