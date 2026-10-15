# Monthly Performance Schedule proposal

Open the **month/year calendar** in the Performance hero to inspect the manager month and day views. Day details show the day, teams or individual on/off/unknown counts, then **Units Delivered**. **Make Schedule** opens the actual monthly editing workspace with person availability, store rules and daily assignments. **Return to manager view** preserves local changes; **Performance** closes the workspace and restores hero focus. Reopening from Performance starts in inspection mode. Future-month navigation works in both modes.

## Monthly drafts

Each fictional store/month owns its availability, dated store rules, exceptions, overrides and review state. Switching months or returning to Performance retains applied edits in memory. Refreshing or closing the page loses all drafts. Reset affects only the selected store/month. Closing a sheet discards its unfinished edits.

Each new monthly draft starts with its own copy of the fictional defaults. Settings are not automatically carried into another month's draft. Rules take effect on their entered date inside that draft; exceptions are exact dates in that month. Earlier dates keep the earlier rule. Person limits remain Monday–Sunday weekly limits. The first week includes earlier dates from the previous month's draft, or fictional defaults if no draft exists. Changing an earlier month can change later boundary-week suggestions and invalidate their review; saved overrides remain intact. Editing a future month never changes an earlier month's draft.

Month selection supports January 2014 through December 2100. Month lengths, year crossings and leap years are calculated from dates. Missing store status stays Unknown; entered closures stay Closed. Staffing uses entered coverage and optional capacity, with manager overrides, never sales alone.

## Sales and month context

The actual Sage implementations were inspected: Month at a Glance contains calendar, pace, best-day and import context; Sold by Day uses recorded store deliveries and explicitly distinguishes unavailable daily totals. The prototype brings those concepts into one selected-month workspace without copying personal totals into sales history.

The month summary shows the sum of known fictional recorded deliveries and discloses missing days. A collapsed Month at a Glance adds completeness and best recorded day. Selecting a date shows its recorded sales separately from its planning range and staffing. Future dates say **Sales not yet available**, even if a source accidentally contains a future row. Missing sales are Unknown; known zero is zero; recorded Closed is distinct from planned closure. No monthly sales goal is supplied for these scheduling fixtures, so goal-based pace is not invented. The six synthetic histories end on 13 October 2026; future ranges reuse available history and are not validated forecast intervals.

The separate Sold by Day popover beneath the desktop new/used spread is removed in this preview; the spread metric remains. A compact calendar in the hero now opens Schedule on desktop and phone. Month at a Glance and Sold by Day information lives in the selected month and day details. Production source remains unchanged. The monthly period and advance planning follow Jorge's correction; layout defaults remain proposals, not approved Claude choices. The original five-option artifact is unavailable.

## Isolation and ownership

Production source is main `15ea1a80db1c17e7f5d9b99db026f7fc09b30697`. Standalone draft #476 remains at `d3a07b2620868601c919de5cf76d1a6b84eb6462`. The preceding weekly integration is preserved at `f5b7a6566ef779ea156b06849c14c79e845e5097`, with its original screenshots/results still in `evidence/`. The previous monthly candidate is `0c0798470e65ae567c70ef4b4f4275a0eaffe3bd`, with its evidence preserved in `evidence/monthly/`. Calendar refinement evidence is retained in `evidence/calendar-refinement/`. The larger hero calendar evidence is in `evidence/hero-calendar/`.

Only `scripts/scheduler-performance/` changes. The real AppShell, StoreHero, Board and BoardRoomPhone mount against fictional demo data through a SHA-256-pinned build-only transform. This refuses changed Manager source rather than silently patching another owner's work. Manager, core, shared styles, C111/#464, claims and the standalone candidate are unchanged. Other Performance actions use inert fixture callbacks. This is not a full application demonstration or a proposed production architecture.

No sign-in flow is mounted. Database build values are blank, and both documents prohibit network connections with `connect-src 'none'`. There is no private workbook, database storage, live SQL, publishing, credential change or protection bypass. The preview supports full store-hour shifts only, not appointments, partial shifts, breaks or overtime policy.

## Run and verify

From the repository root:

```sh
npm test
npm run build
node scripts/scheduler-performance/build.mjs
python3 -m http.server 5190 --bind 127.0.0.1 --directory dist-harness/scheduler-performance
# In another terminal:
node scripts/scheduler-performance/probe-monthly.mjs
BROWSER=webkit node scripts/scheduler-performance/probe-monthly.mjs
node scripts/scheduler-performance/probe-timezone.mjs
```

Set `PLAYWRIGHT_MODULE`, browser paths and `EVIDENCE_DIR` for your environment. The old `probe.mjs` belongs to the preserved weekly candidate and should not be run against the monthly build. The generated fictional fixture is ignored.

Local verification: 946 tests, normal build and isolated build pass, with the existing large-chunk warning. The nine monthly model tests cover every valid date from 2014 through 2100, leap/century rules, year navigation, draft isolation/reset, dated rules/exceptions/overrides, weekly boundary hours recorded/future sales semantics, weekday-aligned calendar cells, and New York midnight/DST/year boundaries. Standard CI runs these unit tests, build and the repository's usual feel/shots checks. It does **not** currently run the scheduler-specific browser probe.

The separate local probe runs Chromium 151 and WebKit 26.6 at 1440, 390 and 320 pixels with 100% and 200% text. Computed sizes of the entry and actual planner controls must double. It checks one Schedule entry with no Who's on popup, no standalone spread sales popover, a full-width hero calendar, no overlap with Performance units, seven weekday-aligned desktop columns and exact leading blanks, period/store/reset focus, complete forward/reverse iframe focus cycles at desktop and narrow enlarged text, sheet interactions, Escape/cancel/return, year crossings, February/leap dates, independent drafts, selected-month reset, Today navigation, reload loss, sales/estimate separation, no page errors/external requests and no horizontal planner overflow. Screenshots are inspected separately. WebKit uses workspace-local libraries; only its host library-cache preflight is bypassed.

Physical iOS/Android, screen readers and OS zoom remain unverified. Unchanged Performance widgets still include pixel-sized text and existing large-text navigation wrapping. No Android KVM diagnostics or grants were used. Hosted rendering must be reported separately: the executor proxy previously rejected the protected preview hostname before Vercel. Static deployment hashes and READY status do not establish an authenticated hosted-browser pass.

## Calendar refinement

The normal desktop layout has seven Monday-first columns with weekday headings and noninteractive leading/trailing blanks. Phones and enlarged text switch intentionally to a dated list when seven readable columns cannot fit. The month summary is one compact strip; additional context is collapsed below the calendar. Selecting a day replaces the calendar with its detail sheet until Back to month is used. The month, future planning and draft logic are unchanged.

Schedule's Today date, initial month, future-sales comparison and hero calendar use `America/New_York`, independent of the browser timezone. Date-only rule keys still identify calendar dates. Ten unit cases cover New York midnight across year-end and both DST offsets. Four additional browser scenarios check the hero and workspace near New Year midnight in Chromium and WebKit while the browser timezone is Tokyo or Los Angeles. The dates are decorative inside one accessible, full-size calendar button.


## Larger hero calendar

Starting head: `8a5b27652d84c3c43da4e6ed29649f9782b7101c`. The hero now shows only month/year and the dates, without visible Schedule or Staffing & Sales labels. The accessible name says “Open Schedule for [month/year], staffing and daily sales”. One focusable button retains the visible gold focus ring and opens the unchanged monthly planner.

The preview-only transform removes the hero import reminder and its redundant calendar wrapper. Manual Import components, phone header and drawer routes remain; their existing fictional-preview callbacks are still inert. The desktop rail scales with text size and the calendar uses its remaining height. Dates use 0.8125rem (13px at default size, 26px at 200%), seven flexible columns, no digit wrapping and reduced padding. The phone calendar remains below the Performance metrics.

The browser probe checks the absent labels/reminder, descriptive accessible name, visible keyboard focus, doubled date font size and absence of clipped dates at all six width/text combinations. It also retains the full monthly planning, future-month draft, recorded sales and focus-cycle regressions. Text resizing means a 200% root font size, not OS zoom. Existing unrelated Performance text and navigation retain their previous limitations. Local WebKit runtime libraries were extracted into the workspace, with only its host-library-cache validation skipped.

Final local checks: all 946 tests, normal/isolated builds, 12 Chromium/WebKit monthly scenarios, four timezone scenarios and four phone keyboard activation/return/Import-presence checks pass. Hero screenshots at desktop, 390px, 320px and 200% text were inspected. The first enlarged-text inspection caught wrapped digits; the rail now scales and the regression checks date clipping. WebKit also exposed an inherited transition during resizing; decorative dates now have no transition. See `evidence/hero-calendar/manifest.json` for source and evidence hashes.


## Planner date readability follow-up

Independent QA correctly found a missed regression in the previous candidate: at 320px and 200% CSS text, list rows could split weekday names and two-digit dates inside their first column. The earlier no-overflow checks did not prove readable dates.

The list now stacks date and details when its actual container is at most 20rem wide. Date tokens do not break; wrapping between complete tokens is allowed. Desktop calendar layout and planner state/sales logic stay unchanged. `date-readability.mjs` inspects rendered Range fragments for every weekday/date/Today token, rejecting split lines, clipped tokens and overlap. It failed against the previous candidate before the CSS fix and passes afterward. The monthly probe invokes it across month navigation; `probe-date-readability.mjs` is a focused 12-scenario reproduction and screenshot check. Run it with the same browser environment as the monthly probe; EVIDENCE_DIR can keep final-head checks outside the checkout.

946 unit tests, normal/isolated builds, both full monthly browser matrices and the focused readability matrix pass. New evidence is retained in `evidence/date-readability/`, including October 17 and the Today marker at desktop, 390px, 320px and 100%/200% text. Existing physical-device, screen-reader, OS-zoom and hosted-browser limitations still apply.

The standard screenshot job in run 38771827959 initially reported page/browser loss at the largest-text sign-in wait after 10 captures, with no OOM kill. After inspecting the stage, logs and unchanged production source, one retry of the failed job passed without code or test changes. That supports a transient failure; its underlying cause remains unknown. Final-commit CI status is reported on PR #478.


## Sage heatmap and QA corrections

This pass starts from `c6429f66f0c90fdd21b19fb848fc2ae505582e1b`. The hero calendar now sits on the existing forest surface with wider day gaps. Both calendars shade **recorded sales only** from Sage forest green to its brighter mint. Each selected store/month uses five levels between zero and its largest known observation. A text label and trophy mark every tied best day, including honest ties when all known values are zero. Missing, recorded Closed, future and known zero stay distinct through labels, borders/markers and color. No planning range enters the heatmap. Date, staffing and sales numbers are unchanged.

The planner uses Signal’s warm paper, forest controls, mono labels and exact PIX glyph patterns from `src/LeadPerformanceCalculator.jsx`, with a source-equality test. Below-target counts gain a warning label without changing scheduling calculations. Sheets use a 160ms opacity/3px entrance; reduced motion removes it. Inputs and actions stay enabled immediately, initial focus remains stable, and applied edits get live change feedback.

### Reproduced and repaired findings

- **F1:** Set October 15 minimum to three, reopen the default October 1 sheet and set October 23 Open. The old cell stayed Closed while Existing entries said Open. Exceptions now update the rule actually governing their date. Existing entries and status selection use effective exceptions across versions. The October 15 minimum remains three; earlier dates retain two. Unit and Chromium/WebKit UI regressions cover this sequence.
- **F2:** The old day aria-label replaced visible staffing, sales and issues, producing 31 axe label-content-name-mismatch violations. Day buttons now derive names from their full visible contents, with the month/year and opening instruction supplied as a description. The browser probe verifies each visible name and runs axe naming/label/contrast checks.
- **F3:** `:root` now uses 100% rather than fixed 16px. A Chromium profile with a real 32px default font keeps the planner root and Month input at 32px without an injected style. The same profile reproduces the old stylesheet’s forced 16px behavior. Both engines also receive the independent 100%/200% CSS scaling matrix.
- **CSP hardening:** Both built document heads are finalized with their existing policies before scripts. Head attributes, uppercase and multiline head tags are accepted. Missing, duplicate, reversed or malformed heads and unexpected CSPs reject the build. `connect-src 'none'` is unchanged; no access/protection setting changes.

Run `node scripts/scheduler-performance/probe-polish.mjs` with the browser environment above and axe-core 4.10.3 via `AXE_PATH` (default `/workspace/qa-tools/node_modules/axe-core/axe.min.js`). `BASELINE=1` reproduces F1/F2 from the prior head. Results, screenshots, source/evidence hashes and the baseline reproduction are in `evidence/sage-heatmap/`. Standard CI still does not run these separate scheduler probes.

### Boundary for the next model integration

| Requirement | Current preview | Next contract/integration |
| --- | --- | --- |
| Individual schedules and overrides | Existing in-memory individual assignments, month-local settings, visible warnings | Structured override reasons and warning classifications |
| Low coverage | Existing assigned/needed counts plus a visible warning label | Separate advisory recommendation warnings from availability/hour-cap constraints |
| Uncovered intervals | Full store-hour shifts only; counts do not prove interval coverage | Claude’s interval-aware model and precise uncovered spans |
| Holiday policy | Store/month-specific exact-date Open, Closed and Unknown exceptions; no automatic closure by holiday name | Holiday hours, partial/split schedules and policy precedence |
| Team and mixed schedules | Not represented | Claude’s team membership/assignment contract; unique-person resolution and deduplication |
| Sales-informed recommendations | Entered minimum plus optional cars-per-person/full-shift capacity; range of up to eight prior known same-weekday observations, minimum four | Explainable comparable-day samples, freshness and adjustable assumptions with advisory-only classification |
| Audit and edit access | No actor history or access enforcement | Later fictional audit/access flows, based on the separate contract; no real accounts, grants, storage or permissions here |

The sensible sequence is this bounded visual/QA pass, then integration of Claude’s pure model/contracts/fixtures/tests, then clearly labeled fictional audit/access UI. No new team/interval/holiday-hours algorithm is duplicated in this branch. No production integration, report automation, schema or permission work is included. Remaining browser/device limits from earlier sections still apply.

Final checks for this pass: 952 tests and both builds pass. Both six-case monthly matrices pass. Twelve additional axe/name/contrast/date-layout cases plus three real 32px Chromium default-font cases pass. F1/F2 were reproduced on the previous head; the same 32px profile proves the old 16px root suppression and the corrected 32px result. Both generated document policies were checked before scripts. See the new manifest for source/evidence hashes. Final-head CI and publication details are recorded on PR #478.

## Hero mini-card correction

From `2ebfe568e25d94985f967a24958962738bdf3f61`, restore a subtle Sage enclosing frame using exterior shadows so the calendar keeps its existing content width. Remove the visible recorded-sales explanation and state legend from the hero. Month/year, dates, heat colors, best-day value, accessible name and focus outline remain. The monthly planner is unchanged. No pending model package was integrated.

A padded border initially clipped dates in Chromium at 320px/200%; the exterior frame passes all 12 Chromium/WebKit monthly cases with the existing assertions unchanged. All 952 tests and production/isolated builds passed. Evidence is in `evidence/mini-card/`. The supplied Library image could not be materialized because its download returned 403; this correction follows the explicit text instruction, not an inspection of that image. No private attachment is included.

## Manager inspection and editing separation

Starting head: `78d1a4fb439e3237aaae65d67c860d0a88c52522`. This pass uses the Sage design guide and existing palette/spacing/fonts in `planner.css`, hero frame in `entry.css`, and the exact pixel assets in `sage-icons.mjs`. Red `#E5473C` and amber/orange `#C77800` come from the existing tokens in `src/LeadPerformanceCalculator.jsx`; they are confined to labeled staffing indicators, separate from sales heat colors. No production token file is edited.

The fixture-mode selector demonstrates team, individual and mixed views of the same explicit synthetic assignments. `assignment-view.mjs` is a small independent preview adapter, not Claude r2. It deduplicates person IDs, excludes all team members from additional-individual counts, and requires every team member to be on before calling that team On. Other teams can be Partly on, Off or Unknown. Unassigned people are unknown, never assumed off. Future months have no pre-saved assignments. Closed store dates have no missing-schedule warning. A null assignment record on an open date means Needs schedule; a saved record below entered minimum full-day coverage means Low staff. Optional sales-capacity recommendations remain advisory in the separate editor, not manager-view hard coverage requirements.

The editing workspace can set a team's full-day status or individual on/off states. Conflicting on/off choices are rejected; unchecked people remain unknown. Use suggestion populates unsaved choices for review. Saving applies an in-memory record for that store/month; inspection reflects it. There is no durable storage, live permissions, publish action, audit history or r2 contract claim. The existing dated-rule/person editor remains available only in editing mode.

The hero store roll-up now derives deliveries and its new/used split from the same Cedar daily-history fixture used by the calendar: October 2026 totals 65 in both places instead of 37 versus 65. Daily observations, day numbers and heatmap source values are unchanged. Other Performance activity widgets retain their unrelated synthetic data. Fixtures are not live data and history still ends October 13.

Deferred: corrected Claude r2 remains inaccessible/unexecuted; no bundle was integrated. Interval coverage, partial shifts, breaks, holiday hours/policy, production scheduling contracts, access grant/revoke, audit history and validated sales recommendations remain future work. This full-day preview adapter does not validate them. Loading, network failure, stale server state and permission-limited live workflows are not implemented in this static offline fixture. Physical-device and screen-reader behavior remains untested. User Library screenshots were not accessed or published.

Run `probe-manager.mjs` for the inspection/editing, modes, deduplication display, saved-vs-unscheduled status, actual sales reconciliation, future-month, return-path, focus and axe checks. The older monthly probe now explicitly enters Make Schedule before exercising its unchanged editor regressions. Evidence and exact results are under `evidence/manager-view/`.

Validation: 957 unit tests and both builds passed. All 12 Chromium/WebKit manager cases and 12 existing monthly-editor regression cases passed at 1440/390/320px and 100%/200% text. Three actual Chromium 32px default-font cases passed without CSS scaling. The manager cases include axe visible-label/name and contrast checks; a toolbar primary-button contrast issue was fixed before the final pass. Reduced-motion and immediate controls were checked. Source and evidence hashes are in the manager-view manifest.
