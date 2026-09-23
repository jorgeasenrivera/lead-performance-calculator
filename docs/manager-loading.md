# Manager loading: X3

The dashboard no longer downloads the standalone TV document before it needs
one. The document is the same 1,490-line function, moved verbatim out of
`Manager.jsx`, with its only external value, `PIX`, passed as an argument.
No dependency was added. Dashboard and board pixels, copy and motion are unchanged.

## What the measurement says

Controlled Vite 5.4.21 builds, local mock configuration, the same fixed version
stamp and gzip calculation, compared with the claimed main commit `5726a97`:

| JavaScript | Before | After | Difference |
|---|---:|---:|---:|
| Manager chunk, gzip bytes | 362,271 | 335,476 | 26,795 fewer |
| Core + vendor + manager, gzip bytes | 711,200 | 684,576 | 26,624 fewer |
| Core + vendor + manager, uncompressed bytes | 2,399,937 | 2,315,603 | 84,334 fewer |
| Deferred TV chunk, gzip bytes | included above | 26,792 | paid when opened |

The initial manager JavaScript reduction is about 3.7%. This is less code to
transfer and parse on entry, not evidence of a frame-rate improvement. The TV's
first opening adds a chunk request. Subsequent calls reuse the downloaded module.
The tiny shared loader adds about 171 compressed bytes to the core in this build.
The TV chunk has no imports and is not a static dependency of either entry or
manager. Existing service-worker asset caching keeps it after first use; it is
not newly precached. First-time offline board opening is not promised.

## Failure and navigation behavior

- The popup is still opened synchronously from the user's click. Safari's
  activation requirement is preserved.
- Its existing document is not erased until the new HTML is ready. Closing the
  popup while loading prevents a later write or fallback navigation.
- A failed template download sends that popup to the existing `?board=` route
  for the same store. That route already has loading, error and retry states.
  Claude's review identified C84: this recovery does not preserve the popup's
  sibling-store list, so it is equivalent to a cast TV, not the full rotating
  popup. That limitation is separate from the per-store sizing repair in X4.
- Concurrent template requests share a promise; a rejected download is cleared
  so another request can try. No cache-busting imports or reload loop were added.
- `BoardScreen` marks success only after rendering the template, rejects stale
  results after leaving a store, and does not start overlapping retry requests.
- The TV page keeps its existing error sentence and 60-second retry. That
  sentence mentions the database even for a template failure. The console names
  the board loading failure; more specific user-facing copy needs approval.

## Verification

- 610 Node tests passed, including 12 new loading/lifecycle tests. The existing
  TV color/glyph guard now reads the moved file with the same assertions.
- Production build passed. Existing large-chunk and PDF library warnings remain.
- Compared the entire extracted function against `5726a97`: identical except
  `export` and the `PIX` parameter. Three payload fixtures generated identical
  HTML, including an empty board, decimal units and a Unicode name with siblings.
- Local browser: manager dashboard and TV launcher rendered; opening the board
  published the demo row; `?board=sage-demo` rendered the leaderboard, its
  associate rows and dot glyphs. No console errors detected on either page.
- The in-app browser did not expose the popup as a controllable tab. Its actual
  window was not visually verified. Popup ordering, success, failure, blocked
  windows and mid-download closes are covered by tests executing the real handler.
- Local feel harness could not launch because its Playwright browser binary is
  absent on this work PC. Do not treat this as a pass. Chromium, WebKit and phone
  screenshots must finish in CI before merge. Physical iPhone testing remains
  distinct from CI WebKit testing.

## Other candidates, not implemented

Moving four report-guide images out of JavaScript saved about 49 KB gzip in an
isolated experiment, but weakened the guide's first-use offline guarantee.
Separating the manager stylesheet saved only about 9 KB gzip once the new CSS
request was counted, with much broader styling/order risk. Neither belongs in
this small change. The hero clone effect Claude noted after X2 is another
candidate for a measured follow-up, not part of this patch.

References: [Vite async chunks](https://v5.vite.dev/guide/features#async-chunk-loading-optimization)
and [popup activation](https://developer.mozilla.org/en-US/docs/Web/API/Window/open).
