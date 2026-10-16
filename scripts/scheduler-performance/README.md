# Monthly Performance Schedule proposal

Open the **month/year calendar** in the Performance hero to inspect the manager month and day views. Day details show the day, teams or individual on/off/unknown counts, then **Units Delivered**. **Make Schedule** opens the actual monthly editing workspace with person availability, store rules and daily assignments. **Return to manager view** preserves local changes; **Performance** closes the workspace and restores hero focus. Reopening from Performance starts in inspection mode. Future-month navigation works in both modes.

## Monthly drafts

Each fictional store/month owns its availability, dated store rules, exceptions, overrides and review state. Switching months or returning to Performance retains applied edits in memory. Refreshing or closing the page loses all drafts. Reset affects only the selected store/month. Closing a sheet discards its unfinished edits.

Each new monthly draft starts with its own copy of the fictional defaults. Settings are not automatically carried into another month's draft. Rules take effect on their entered date inside that draft; exceptions are exact dates in that month. Earlier dates keep the earlier rule. Person limits remain Monday–Sunday weekly limits. Every affected Monday–Sunday week includes entered shifts from both adjacent months. Missing assignments never consume hours. Editing either neighboring month can invalidate a review; manual assignments remain intact. Editing a future month never changes an earlier month's draft.

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

## Expandable mobile hero calendar

The accepted desktop calendar is unchanged. On the phone, the mini-card defaults to month/year, today's date, Units Delivered, and red/orange labeled scheduling warnings. Show calendar / Hide calendar is a separate keyboard-operable toggle with aria-expanded and aria-controls. The existing calendar entry remains the single control opening the manager schedule. Expansion preserves date numbers, current day, month and planner selection, and never animates or delays controls. Warnings stay visible in both states and update after an assignment is applied to Cedar's current month.

The mobile entry's accessible name comes from its visible content plus a screen-reader-only action description, avoiding an overriding name that omits a warning. The frame, fonts, day gaps and sales heat colors are retained. The custom pixel warning icons explicitly use forest ink on the warm-paper chips because the inherited phone hero otherwise forces white ink. Compact and expanded screenshots and keyboard/state-preservation checks are in `evidence/mobile-toggle/` via `probe-mobile-toggle.mjs`.

Only the Sage design guide was exposed and read in this executor. The additional installed Sage skills were authorized but not available in the active skills catalog at this checkpoint. No inaccessible skill or Claude package is claimed as applied or validated.

Final mobile checks: 957 tests and both builds passed; all 12 toggle cases, 12 manager cases, three actual Chromium 32px planner cases and 12 monthly-editor regressions passed. The final icon-ink correction is covered by the toggle matrix. One earlier WebKit startup click timed out; no OOM was recorded and the instrumented full run passed without changing assertions or timeouts. Its root cause remains unconfirmed. The visible-fit probe excludes deliberately clipped screen-reader text, while keeping visible-date checks unchanged.

## Independent review corrections

Starting head: `28eb3b9593e8dd94ed1fe6d0334addd9fdc438a9`. The three reproduced design/logic problems are corrected together:

- The compact hero now distinguishes **Month Units Delivered: 65** from **Today 14: Unknown**. A month total is never labeled as today's observation. Missing daily data remains unknown.
- `createPlanner` owns a single entered-assignment source. A manual record overrides an explicit fictional default; otherwise the date is unassigned. Inspection, editing, review fingerprints, hero warnings and weekly calculations use those same records. Suggestions are separate, unsaved choices; asking for them does not consume hours or overwrite manual on/off selections.
- Complete Monday–Sunday totals include earlier and later neighboring-month entries and deduplicate each person per full-day shift. Days off, insufficient or unknown availability, unknown weekly limits, exceeded weekly caps and unknown neighboring shift durations cannot count toward eligible coverage. Invalid manual assignments remain visible, with their reasons. Review is blocked by those conflicts. Counts distinguish eligible on, confirmed off, unknown and conflicting people; team Conflict does not invent a per-team minimum. Store-wide minimum coverage remains the entered requirement, and daily-sales capacity suggestions remain advisory.

Month/day selection survives editor/inspection return and responsive remounts. Hero expansion and warning summaries survive phone/desktop resize. The hero updates its date at store midnight without changing a manually selected future month/day. Focus returns to the current calendar entry even if resize replaced its previous DOM node. Neighboring-month edits also refresh the current-month hero warning summary. A 320px/200% editor overflow was reproduced in the native team selector and fixed with a bounded fieldset/select width.

Relevant exposed skills applied: Sage design guide, product UX, accessibility, responsive QA, scheduling correctness, and performance/release QA. No skill grants live publication or permission changes. The new `probe-review-corrections.mjs` covers the manager flow, assignment agreement, explicit conflicts, rejected review, unsaved suggestions, future manual choices, actual resize/remount, midnight, keyboard focus, contrast/name checks and narrow/text-scaled layouts. Earlier `probe-manager.mjs` and `probe-polish.mjs` describe prior candidates' semantics; use the new correction probe for this candidate, plus the updated monthly regression probe.

This remains an offline full-day, whole-hour fixture. Store role/interval requirements beyond that fixture are not represented or replaced by team status. Breaks, partial/overnight shifts, DST-crossing shift-hour policies, live publish/auth/storage, stale-write recovery and Claude r2 remain unimplemented/unvalidated. Date-only New York midnight/DST conversion is unit-tested; that is not validation of overnight shift duration. Physical devices and actual screen readers remain untested. Automated accessibility checks are scoped checks, not a conformance claim.

Final correction checks: 963 unit tests, production and isolated builds, 12 correction browser cases and 12 monthly-editor regression cases passed. Chromium and WebKit cover 1440/390/320px at 100%/200% text, including actual responsive remount, midnight and October-to-November boundary. Evidence is in `evidence/review-corrections/`. The local Node benchmark is diagnostic only; changed scheduling semantics prevent a production performance comparison.

## Compact scheduler simplification

Starting head: `c514cff372313b501d4cc7634104d143fe863df5`. The mobile hero now has one calendar entry: the existing pixel calendar glyph, month/year and Open calendar. It opens the manager schedule directly; the prior mobile expansion toggle, totals and warning chips are superseded. The desktop hero stays unchanged.

The scheduler has one visible Schedule heading, a named Store selector and Make Schedule action, then previous/month-picker/next navigation. Today is inside the month picker. Sales key opens a labeled popover explaining the separate recorded-sales strip, unknown, zero, closed and future values. Fixture modes are under Demo options. The month total is a compact, explicitly scoped summary. Saved fictional assignments are qualified as In this page only and Lost on refresh.

Day-card surfaces use tints of the existing `#E5473C` and `#C77800` warning colors mixed with warm paper, with concise inline status text and the existing pixel glyphs. Sales heat colors apply only to the sales strip. Existing forest/paper, Geist and Space Grotesk tokens and assets are reused from `planner.css`, `entry.css` and `sage-icons.mjs`; production tokens are untouched. All three correctness fixes and manual-assignment behavior from the preceding checkpoint are retained. No scheduling policy has been expanded.

The resolved private Library screenshot could not be downloaded through the supported helper, including one bounded consumer-local retry. This executor did not inspect its pixels. The implementation follows Jorge's explicit text instructions and the parent's reported pixel inspection. No private screenshot is committed or deployed.

`probe-simplification.mjs` replaces the older hero-toggle assumptions while retaining the correction flow. It checks compact entry, popover keyboard/Escape/focus, Today/month navigation, demo options, separate staffing/sales surfaces, editor return, future manual assignments, complete-week conflicts, responsive remounts and midnight/month rollover. The updated monthly regression probe retains its scheduling, date readability, focus and isolation assertions with the month input now reached through its picker. Reduced motion is enabled in both matrices. Automated accessibility checks are scoped name/label/contrast checks, not screen-reader or conformance certification.

Remaining prototype limits: differing month-specific caps in a boundary week need a policy; retained closed-day assignments lack direct day-sheet removal controls; shifts are full-day/whole-hour only. Interval/role coverage, overnight/partial shifts, breaks, DST shift-hour policy, durable persistence, live access/audit/publication and Claude r2 certification remain unimplemented/unvalidated. Physical devices and actual screen readers remain untested. This is a protected fictional preview only.

The same revision also replaces the long staffing sentence inside day cards and day details with shared visual groups. Each card uses the same hierarchy at every size: date, inline staffing status, named teams with On/Off/Partly on/Unknown/Conflict states, deduplicated additional-person counts, then a separate Units Delivered strip. Individual mode counts all people; team mode does not repeat them as additional people. Pixel users/check/close/question/warn glyphs supplement text, never replace it. Long labels wrap within their group without reducing font size or hiding essential text.

The user's reported overlap was not assumed to have one cause. A synthetic long unbroken team name reproduced horizontal overflow on the preceding candidate at 390px/200% text: the document widened to 644px, with card scroll width 629px versus 360px client width. The new layout uses bounded flex/grid groups and explicit long-label wrapping. `probe-card-layout.mjs` checks every rendered card's text rectangles for overlap and containment, date readability, document/card overflow, mixed/team/individual modes, partial-team truth, deduplication, long person names in conflict/editor content, and unknown/zero/closed sales. Its matrix covers 320, 360, 390, 430, 768 and 1440px at 100%/200% text in Chromium and WebKit. The long labels exist only in intercepted local test fixtures, not in the published fictional data.

For scanability with depth, the card's primary date/status/team/count/sales hierarchy stays visible. Opening a day keeps actual conflict reasons visible and offers Team members and sales context for the underlying fictional roster, each person's truthful On/Off/Unknown/Conflict state, entered full-day minimum versus eligible people, and the meaning of that day's actual known/unknown/closed/future sales record. This adds no historical analytics or scheduling policy. The long-label matrix also opens this detail section and verifies its containment.

Final validation: 963 tests and both builds passed. The final artifact passed 12 simplification cases, 12 monthly regressions and 24 card-layout cases (48 total). Full flows cover 1440/390/320px; long-label cards also cover 360/430/768px. Both engines use 100%/200% text and reduced motion. The native month field clipped its year at 320px/200%; the final popover uses a fully visible YYYY-MM field with the existing range validator. WebKit long-name editor overflow was isolated to the team selector prompt and fixed by the concise Set status prompt. Two concurrent WebKit runs timed out on the pre-existing round-up close control before scheduler entry. A focused diagnostic showed visible, stable geometry across five frames and a successful normal click at the same timeout; no OOM was recorded. The final WebKit suites passed sequentially, but the intermittent startup cause remains unconfirmed. Failures, diagnostic, before/after screenshots and hashes are under `evidence/simplification/`.

## Compact text-scaling correction

Independent review found identical WebKit compact screenshots at 100% and 200% on `7fc8e3a8d004aa6c6213a742b423d98713fbf392`. The earlier button-font check was insufficient: the button grew, but its visible month/CTA labels stayed at 16px/14px. Those earlier WebKit compact 200% images are invalid evidence of enlarged text, despite the suite passing.

A local factor check isolated this to reduced-motion mode, not the fake clock. WebKit retained an inherited near-zero font-size transition at the starting value. The preview now disables animations/transitions on the mobile calendar entry and its descendants under reduced motion. No production stylesheet or desktop hero styling changes. The correct computed sizes are 16px to 32px for month/year and 14px to 28px for Open calendar.

`probe-compact-scaling.mjs` explicitly asserts both visible labels' growth, no text clipping, visible focus and keyboard entry/return, across 320/360/390/430px, 100%/200% text, both motion preferences and both engines (32 cases). The main simplification probe now also asserts both label sizes rather than only the button size. Current scaling evidence supersedes the old compact images and is recorded under `evidence/compact-scaling/`. The 24 card-layout cases from `7fc8e3a` remain applicable: their planner/model/style sources are unchanged by this compact-only fix.

Follow-up checks: all 963 tests, production and isolated builds, 32 compact-scaling cases and 24 fresh simplification/monthly flow cases passed. The 24 unchanged-planner card-layout cases from 7fc8e3a are retained, not claimed as rerun. Final CI and verified protected deployment identity are recorded on PR #478. The prior WebKit compact 200% claim is withdrawn and superseded by computed-label growth assertions and new screenshots.

## Calendar-first mobile follow-up

This pass starts at `3b7b810c47461fe70d508c0263fa502065240667` and preserves the inherited, preview-only successor diff for Jorge's three requests. The mobile pixel calendar icon and month/year now form one toggle at the bottom of the Performance hero, after all percentage metrics. No visible Open calendar CTA or collapsed alerts remain. Enter/Space expands or collapses the dates; the toggle exposes its name, controlled panel and expanded state, retains a gold keyboard focus ring, and remains at least 48px high. Expansion survives responsive remounts. The full calendar button opens Schedule with a descriptive name; closing restores visible focus.

The phone scheduler opens on month navigation, store/Make Schedule controls and a compact seven-column month. The 320x640, 390x844 and 430x932 ordinary-text cases include the six-week November grid. Staffing keeps its full-cell red/orange treatment, with symbols, a text key and full-date/status accessible names. Recorded sales stay separate in day details and month context. At 200% root text the dates intentionally reflow to two columns; this is not a one-screen claim. Month controls remain sticky and the enlarged-text toolbar stacks to avoid clipping. Day details retain the full team/individual information and separate Units Delivered. Desktop retains its accepted hero, toolbar and day-card layout.

Additional people are now shown by name with On, Off, Unknown or Conflict. Team members are excluded and duplicate IDs collapse to one person. The first three names are visible. Day details use a native keyboard-operable disclosure for the remainder, with an expanded-state relationship; desktop cards show the first three plus a count directing to day details, avoiding nested controls inside a date button. Test-only routed synthetic fixtures exercise 0, 1, 3 and 4 additional people, overlapping teams, repeated assignment IDs, all four states and long names. Manager and editor use the same projection.

Current probes are `probe-hero-bottom.mjs` (16 hero placement, motion, text, keyboard and restoration cases), `probe-calendar-first.mjs` (12 ordinary-height calendar/detail cases), `probe-additional-people.mjs` (32 named-person cases, including eight scoped axe scans) and the updated `probe-monthly.mjs` (12 existing planning/regression cases including desktop). The monthly probe's retained-record assertions use textContent because compact dates deliberately hide card prose; calendar-first and additional-people probes separately assert visible labels, accessible status and detail content. Earlier compact CTA and mobile tall-card screenshots/probes describe superseded layouts, not the current mobile design. The previous WebKit reduced-motion font fix remains in place.

Design sources remain the production Signal hero/pixel icon components, the preview's accepted forest/paper tokens and grouped day cards. No production source is changed. Browser viewport and root-font emulation do not establish physical-device, screen-reader or OS-zoom support. Fictional drafts remain memory-only; missing operational policies and earlier scheduling limitations still apply. No private attachment is included.

The fresh pass caught and fixed the 320px enlarged-text toolbar overflow, an inherited vertical icon/month stack, and backward keyboard focus hidden under the sticky month bar. WebKit required a post-focus scroll correction in addition to CSS scroll padding. An initial spacing adjustment reduced the month heading's enlarged size; the existing scaling regression rejected it, and exact doubling was restored. The 200% viewport check requires a readable date row below the controls, not an arbitrary toolbar-height cutoff. These failures are not counted as passing cases; the final matrices use the corrected build.

Final verification: 967 unit tests, production/isolated builds, and all 72 fresh browser cases pass. Eight scoped axe scans pass. The unmodified individual-mode fixture also expands three names to all six. See `evidence/hero-calendar-first/manifest.json` for the exact matrices, source/artifact hashes, evidence and limits. Final remote SHA, CI and protected deployment identity are recorded on PR #478.

## Continuous calendar flow, touch and desktop reflow

Starting head: `743f5ba55e7ee57b7ffa020c86d21d6b1a32658a`. The expanded phone hero now contains real date buttons. A date opens its own details in the hero's store, rather than a generic month destination. The icon/month toggle remains below all percentages with no visible CTA. Desktop retains its existing calendar entry.

Day details show team members directly within their team, then additional people (first three plus accessible expansion), and recorded sales. Previous/next-day buttons browse without returning to the month. Edit day enters the same deliberate scheduling editor. Its save and cancel return to the selected day; entering Make Schedule from a selected day also keeps that day. General month editing retains its mode after applying a day, with the updated day still open. Explicit Back/Cancel actions discard unsubmitted form choices as stated in the form; applied assignments remain local until refresh. Critical conflicts and concise fictional/not-published/lost-on-refresh truth remain visible.

Today is directly beside month controls. Sales key consolidates icon meanings, sales definitions and month context. The repeated compact legend, Month details disclosure and team/sales-context disclosure are removed. Compact staffing indicators use the exact existing Sage dot-rendered SVG glyphs: warn, users, check, close and question, with full-date/status accessible names. Staffing surfaces and recorded-sales shading stay separate.

Touch browsing accepts a deliberate horizontal gesture on calendar headings, the enlarged-text pixel-arrow strip, or noninteractive day detail content. It ignores screen-edge starts, interactive controls, text selection, multiple touches, stale context, vertical gestures and all editing states. No gesture writes an assignment. Visible buttons provide every navigation action. The safe strip appears only when a coarse pointer is available; fine-pointer compact layouts do not imply touch. Navigation updates immediately without added motion, including reduced motion.

The production width-only usePhoneLayout hook is transformed only inside the fictional build, behind a SHA-256 guard. A fine-pointer/hover desktop keeps the desktop Performance component at narrow CSS widths; its rail stacks rather than squeezing or forcing horizontal scrolling. Touch-primary phone layouts retain the requested phone hero. Shared navigation and content still reflow where space demands. There is no user-agent sniffing, fixed desktop minimum width, disabled zoom, or production source edit. Hybrid hardware and physical browser zoom remain untested; automated tests separate fine-pointer viewport reductions (1440x900, 720x450, 360x225 and 320x200) from additional 200% root text. These are zoom-equivalent layout tests, not a claim of real browser menu-zoom execution.

Before/after action counts are traced from the starting implementation and exercised in the new flow: collapsed hero to a selected day 3→2 taps; reveal team members 1→0 extra taps; Today 2→1; adjacent day 2→1 or a swipe; save and see the same day 2→1. Edit day remains one action, now beside the date rather than in the distant global toolbar. Swipes are optional shortcuts, not hidden requirements.

Current checks are `probe-coherent-flow.mjs`, `probe-input-reflow.mjs`, `probe-native-touch.mjs`, `probe-additional-people.mjs` and the adapted `probe-monthly.mjs`. Earlier hero-bottom/calendar-first probes target the former generic mobile entry and are historical. Chromium CDP touch input checks real browser gesture delivery and vertical scrolling; WebKit uses synthetic gesture-handler events because its test runtime rejects the native Touch constructor. Neither establishes physical iOS/Android support. Existing scheduling policy, closed-assignment-removal and memory-only persistence limitations remain.

Skill access: Sage design, product UX and accessibility were freshly read for this revision. The catalog then became unavailable; additional responsive, scheduling, release and security skill reads returned unavailable. Previously read responsive/scheduling/release guidance was retained; no fresh security-skill read is claimed.

Short zoomed viewports let month navigation scroll instead of covering the content, and retain Schedule as the accessible dialog title without a redundant second visual header row. Day navigation stops at the selected month's boundaries; month navigation changes that context. Native touch testing caught the browser's early scrolling decision, so horizontal intent is detected before that decision while navigation still requires a 60px deliberate swipe. A separate test-fixture correction targets the enlarged-text swipe strip rather than an off-screen grid midpoint. Fine-pointer reflow checks caught and corrected the fixed hero rail and the last narrow date clipping case. Failed intermediate candidates are not counted as passes.

Final continuous-flow verification: 968 unit tests, production/isolated builds, 76 fresh browser cases and 20 scoped axe scans pass. The final short-viewport correction also makes the shared Tools bar scroll normally below 400px height so it cannot cover the hero entry. See `evidence/coherent-flow/manifest.json` for current matrices, source/artifact hashes, screenshots, logs and verification limits. The 72-case result above belongs to the prior revision. Exact remote SHA, CI and protected deployment identity are recorded on PR #478.

## Connected month, roster and people/coverage workspace

This revision starts at `52ae5d930a59156f000ce90c318601f4b9402b8f` and implements Jorge's selected direction: connected month and persistent day context on desktop (C), compact month with the selected roster immediately below it on mobile (A), and deliberate people/coverage editing inside Make Schedule (B). The reference patterns were supplied in the task description; no competitor assets, private PDF pages or private attachments are included. This remains an isolated fictional preview.

The month never disappears when a day is selected. A single store/month/date state drives calendar selection, roster and editor. Date buttons keep focus and announce the updated roster; Selected day and Month calendar provide keyboard/touch jump controls. Desktop panes stack when available space relative to text size becomes too small, without adding a mobile-only disclosure. Both panes scroll normally in short viewports. The existing hero entry, manual Import routes and phone toggle remain intact.

Make Schedule exposes named on/off assignments, team bulk controls, configured required coverage, applied eligible people and the remaining gap. Invalid or unavailable assignments do not count as eligible. The existing deduplicated assignment projection and scheduling model are unchanged. Day edits and unapplied person/store settings are kept separately in memory across navigation. Apply changes the local draft; Cancel discards the corresponding unapplied choices. Invalid on/off combinations retain the form values. Explicit reset clears only the selected store/month's local draft and pending choices. Settings continue to apply only to that month. Nothing is published or persisted across refresh.

### Demand context

The existing daily estimator is now visible in Make Schedule. It uses the observed minimum and maximum of the latest eight prior known same-weekday delivery counts, requiring at least four. True zero remains zero; unknown and closed observations are excluded. The preview shows sample count, comparable dates, age of the latest comparable, fixture history cutoff and uncertainty in progressive disclosure. The range is an illustration, not a calibrated forecast or confidence interval; no hourly or role demand is inferred.

Monthly context compares the latest three prior observed instances of the same calendar month. Each comparison identifies recorded, closed and unknown days. A full-month range requires at least two complete comparable months; partial totals never substitute for complete months. This historical comparison is not a forecast of the target month's sales. Synthetic observations end 13 October 2026 and no live history connection is claimed.

Staffing remains the existing policy: the hard configured minimum is separate from the optional demand-linked recommendation target. Capacity adjustment defaults to off, so the visible suggestion is explicitly minimum-only and history-based staffing is unavailable. When the manager enables the entered capacity, the existing calculation uses the upper daily range divided by that capacity, rounded up and bounded by the minimum. Applied eligible coverage, suggested staffing and their gap are displayed separately. Use suggestion only adds eligible candidates to unapplied choices and preserves manual choices. It never applies or publishes automatically. Insufficient history cannot silently become zero demand.

Visual sources are the existing `src/manager-signal.css` forest/warm-paper language, preview `planner.css` tokens and `sage-icons.mjs` pixel glyphs. The workspace uses those colors, typography and controls. Numeric layout breakpoints are fit constraints, not a new brand system. Sage design, UX, accessibility, responsive and scheduling skills were read successfully at the start of this revision; the cloud catalog later became unavailable. No additional authority was inferred from those skills.

Current verification probes are `probe-connected-workspace.mjs`, `probe-demand.mjs`, and adapted monthly, coherent-flow, additional-people and native-touch probes. Older screenshots and totals above are historical. Automated desktop/touch-capable viewport emulation is separate from physical hybrid hardware. The scope still excludes physical iOS/Android, screen readers, real browser-menu zoom, live schedules and backend rollout. Full-day-only planning, cross-month policy limitations and the lack of direct closed-day assignment removal remain as documented above.

Final connected-workspace verification: 973 unit tests, production and isolated builds, all 100 browser cases and 68 scoped axe scans pass. Final enlarged-text metric labels stack without word fragmentation. Evidence, source/artifact hashes, screenshots, matrices and intermediate findings are in `evidence/connected-workspace/manifest.json` and `verification-notes.md`. The final remote SHA, CI and protected deployment identity are recorded on PR #478.

### Delivered row cleanup

The calendar sales strip and connected day roster now say Delivered. Label and value share one row with consistent dimensions across dates; zero remains zero, missing stays Unknown, and future observations say Pending with an accessible explanation. The desktop calendar takes the full workspace width when two panes would squeeze that row. At larger text or intermediate widths, cards reflow with weekday labels. The compact phone month keeps its date-only layout and shows Delivered in the connected roster and applied-roster disclosure.

The visible monthly actuals summary, store selector and memory-only notice are removed. Sales key remains available beside Make Schedule. Internal store context, isolated drafts, month navigation, historical demand guidance and daily sales remain intact. This adds no persistence.

Focused evidence is in `evidence/delivered-row/manifest.json`. The geometry fixture deliberately includes 0, 123456, missing, closed and future states; screenshots using it are stress-test evidence, not changed sales history. Actual browser menu zoom, physical devices and screen readers are not covered. Hosted rendering remains subject to the protected-preview access boundary.

Final cleanup checks: 973 tests, production and isolated builds, 24 Delivered layout cases and 12 coherent-flow regressions passed. All 36 scoped axe scans passed. Final remote SHA, CI and protected deployment identity are recorded on PR #478.
