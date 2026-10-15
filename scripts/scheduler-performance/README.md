# Performance Schedule proposal

This is an isolated, fictional preview for Jorge's review. Open **Plan next week** in the Performance hero's Schedule area, review the week, then use **Performance** to return. Person and store edits are separate. Escape closes the current sheet first, then returns to Performance. Closing an unfinished sheet discards its edits; applied changes last only in this page.

## Scope and ownership

This dependent proposal preserves standalone draft PR #476 at `d3a07b2620868601c919de5cf76d1a6b84eb6462`. Its production source is main `15ea1a80db1c17e7f5d9b99db026f7fc09b30697`. All changes are under `scripts/scheduler-performance/`. No claims are renewed or transferred. C111/PR #464, Manager, core, shared styles and the standalone candidate are untouched.

The preview mounts the real AppShell, StoreHero, Board and BoardRoomPhone against the repository's fictional demo seed. A build-only transform adds two entry points and retains the existing today/month handlers. The transform pins Manager's SHA-256 and refuses changed source, so another owner's edit cannot silently receive an outdated patch. This is a review mechanism, not a proposed production architecture.

Sage's existing Geist, Space Grotesk and Geist Mono fonts, forest green, warm paper, muted sage surfaces and rounded controls carry into the planner. The new control has a 44-pixel minimum touch height and a visible focus ring. The modal has no entrance animation; its button colour transition respects reduced motion. Browser zoom remains enabled in the preview.

## Fictional boundary

No sign-in flow is mounted. Database environment values are replaced with empty strings at build time, and both documents prohibit network connections with `connect-src 'none'`. The preview only serves local static assets. No real workbook, appointments, database, live SQL or publishing path is used. Performance's other action callbacks are inert fixture callbacks, so this is not a full application demonstration.

The scheduler reuses PR #476's six fictional long-history stores and model unchanged. Forecast ranges are illustrative prior same-weekday delivered-car counts, not validated prediction intervals. Staffing uses entered minimum coverage and optional capacity, with manager overrides. Explicit NA is Closed; missing status is Unknown. Store rules are effective-dated and are never inferred from historical staffing. The manager makes the final decision. The unavailable Claude five-option artifact is not represented as approved choices.

## Run and verify

From the repository root:

```sh
npm test
npm run build
node scripts/scheduler-performance/build.mjs
python3 -m http.server 5190 --bind 127.0.0.1 --directory dist-harness/scheduler-performance
# In another terminal, with Playwright installed:
node scripts/scheduler-performance/probe.mjs
BROWSER=webkit node scripts/scheduler-performance/probe.mjs
```

Set `PLAYWRIGHT_MODULE` if Playwright is not at the workspace tool path. Set `EVIDENCE_DIR` for screenshots elsewhere. The generated fictional `fixture.json` is ignored. Browser dependencies are local tooling, not application dependencies.

The probe checks the actual hero entry, original today control, modal focus containment, return focus, Escape/cancel, repeated edits, unchanged Closed/Unknown status, no page errors or external requests, and horizontal reflow at 1440, 390 and 320 pixels. At each width it tests 100% and 200% text. Computed font sizes on the entry, planner buttons, select and date input must actually double. This is text enlargement testing, not a claim of physical-device or OS zoom testing. Unchanged Performance widgets still include pixel-sized typography; the new planner uses scalable text. The original bottom navigation's large-text wrapping is outside this proposal.

Local results: 937 tests pass, normal build and isolated build pass (existing large-chunk warning). Chromium 151 and WebKit 26.6 each pass all six browser scenarios. WebKit used workspace-local libraries; only the host library-cache preflight was bypassed, not browser execution or assertions. Physical iOS/Android, assistive technology and authenticated hosted rendering remain unverified. No Android KVM diagnostics were run.

The Vercel package is static and must use the existing project's protected preview environment, with no production target, aliases, project-setting changes or protection bypass. The old standalone preview does not contain this integration. Hosted verification must be reported separately from local browser results.
