# Reported deliveries calendar proposal

An isolated, fictional-data proposal using the actual Signal BoardRoomPhone and StoreHero components. It changes no production source file and is not connected to production data, authentication or an endpoint.

## Source boundary

The owner source is pinned to commit 0f165a2e5d7c7c55fe569619553b800893b97122 from PR #459. source-contract.json pins Manager, the Signal stylesheet/helper, the shared core, demo generator and font declarations by SHA-256. Every build verifies those bytes before and after applying nine in-memory calendar transforms. A changed source fails clearly instead of silently rendering a different design.

The fixture mounts the actual Shell, invokes the real ownManagerSignalSurface lifecycle with cleanup, and loads the exact Signal stylesheet and fonts. The active desktop schedule uses .sg-schedule-trigger and .sg-schedule-details.

## Decisions shown for review

1. Name the metric Reported deliveries, with printed store count context
2. Show provisional values and explicit zero; keep missing, held and conflict days neutral
3. Show New/Used only when available, and distinguish report sent from receipt-only timestamps in Eastern time
4. Use real phone day selection and desktop schedule/stock details
5. Show loading and request-error/retry states while guarding store, month and display generation

Report counts never enter the legacy dayUnits path. Monthly total, stock mix, pace, goals, recap holds, best-day holds and daily comparison holds stay separate. The fictional monthly totals remain Alpha 61 and Beta 83. The toolbar is study tooling, not a proposed product control. Its report-month selector does not change the frozen September monthly hero.

Six synthetic endpoint responses cover positive, zero, missing split, missing data, coverage hold, conflict, receipt-only time, today, later correction, a different store and an empty following month. No real report bytes, store IDs or employee figures are included.

## Run in an isolated executor

With this repository's dependencies installed, place the pinned source checkout at .calendar-source, or set SIGNAL_SOURCE_ROOT to that verified checkout. PROPOSAL_DEPENDENCIES_ROOT may point to the installed node_modules directory.

```sh
node --test scripts/daily-calendar-proposal/signal-calendar-proposal/proposal-check.mjs
node scripts/daily-calendar-proposal/signal-calendar-proposal/build.mjs
node scripts/daily-calendar-proposal/signal-calendar-proposal/serve.mjs
```

The server serves only the built fixture on http://127.0.0.1:49217/. In another process with the permitted Playwright installation:

```sh
FEEL_BROWSER=chromium node scripts/daily-calendar-proposal/signal-calendar-proposal/capture.mjs
FEEL_BROWSER=webkit node scripts/daily-calendar-proposal/signal-calendar-proposal/capture.mjs
```

FEEL_PLAYWRIGHT optionally identifies the installed Playwright package directory. The capture runner rejects non-loopback targets and unexpected network requests.

The workflow has contents:read, uses no repository secrets, checks out the exact owner commit with persist-credentials:false, and uploads fictional browser evidence plus the standalone built preview. It does not merge, deploy, publish an app, write business data or change the backend.

## Verification and remaining review

Local source-preservation/request tests and the isolated build pass. Browser results are established only by the workflow artifact for the exact PR commit, not by this statement. Inspect each engine's result.json and PNGs before treating rendering or interactions as verified.

The capture matrix includes 390, 700, 701 and 1280 CSS px; positive, zero, missing split, receipt-only, missing, held, conflict, loading, request error and retry; store/month races; same-identity phone reopening and desktop unmount/remount; and enlarged-text/reduced-motion captures. The month reader checks identity and display generation even when the fake transport ignores abort.

Desktop schedule dismissal keeps the mounted StoreHero reader alive and hides only its details. Phone popup dismissal and component unmount invalidate generations. A different desktop refresh-on-open policy would need its own decision.

Review actual screenshots for typography, clipping, contrast, focus and touch behavior. Item-by-item visual approval still precedes production integration. Source PR readiness, merge, deployment, real authentication and historical report application are outside this proposal.
