# Delivered navigation checkpoint

Bounded preview-only increment from `f475eb6cd6f3fc29340a9f788bd08360c52413b9`. PR #478 stays draft on `codex/scheduler-fictional-proposal`. No production source, data model, delivery history, weekly-hours policy, database, credentials, permissions, merge or writer-claim changes. Unrelated `manager-phone-search/` remains untouched.

## Result

Units and Pace controls, displayed values and monthly pace content remain. The preview phone copy no longer renders the standalone Sold by Day grid. Units/Pace retain their own named sheets, with a Month summary context and a **View dated Delivered in Schedule** action. Month summary keeps selling-day, pace and import context; its obsolete daily-unavailable/best-day presentation is removed because dated sales belong in Schedule. No daily value is derived from cumulative totals or person credits.

The originating context unmounts before Schedule opens. Back restores that context and its launching control; Close returns to the originating Performance control. Selected month/day survive round trips. Escape closes the day before Schedule on the phone; a calendar Escape returns to context. Closing Schedule cancels child day motion. Only one outer modal is active; embedded day detail remains a section, not a nested dialog. Store selection applies independently of whether the route supplies a new date.

The desktop calendar entry, side panel, Delivered rows and existing weekly-hours work remain. The copied recap presentation/close marker now uses page memory only; a no-write probe found the inherited storage marker during this flow. This does not change production recap code.

## Verification

- Full tests: **1,083 passed, 0 failed**. Production build and isolated preview build passed; existing large-bundle warnings remain.
- Final browser matrix: **five configurations passed; WebKit desktop blocked before route entry**. Chromium: 390/100%, 320/200%, 1440/100%. WebKit: 390/100%, 320/200% passed. WebKit 1440/100% repeatedly timed out dismissing the existing round-up at the unchanged 15-second click limit. This case is not claimed passed. Seventeen scoped axe scans passed in the five completed configurations; six font-size comparisons measured exactly 2x.
- Focused active-motion interruption: **Chromium passed** at 320 px/200% text with normal motion, observing a live pane before Close and restoring focus to Pace. **WebKit blocked** waiting to observe a live pane after the tap at the unchanged 15-second limit; that stronger temporal check is not claimed passed. The broader WebKit mobile route cases did pass.
- Broad local Chromium feel: one failure, reduced-motion return 2,142 ms against the unchanged 2,100 ms bar. All other reported bars passed. Failure capture and events are retained. No new broad local WebKit run is claimed; the prior checkpoint failure remains retained. Exact remote/CI/protected-deployment results are recorded in the delivery response.
- Frozen preview: 54 files. Manifest SHA-256: `ed03dd1a2cd076795205a4b1b20dad74399b9dfd4dfe81de0ac7268da7b11e64`.

The route probe asserts unchanged Units/Pace values; a known dated Delivered value of 6, Unknown and future Pending; retained Nov 4 selection; Back/Close/Escape focus restoration; no duplicate/nested surfaces; document/context reflow; accessible control names and scoped axe scans. At 320 px, representative context title, metric caption and action text must compute to exactly twice their 100% font sizes. Both page and iframe storage/IndexedDB calls remain forbidden. Only the three enumerated same-origin static font GETs are allowed; all write requests and other requests fail.

## Retained failures and diagnostics

- Initial probe accessed the iframe before it was ready. The probe now waits for the actual planner UI.
- Scoped axe found low-contrast retained context text. The affected Units/Pace/Month summary sheets now use existing readable Sage inks; assertions were retained.
- The no-write assertion found the preview recap seen marker. The copied marker was changed to page memory; production remains unchanged.
- A probe initially counted static font GETs as prohibited requests. It now distinguishes the exact three static reads from network writes and any unrelated request.
- The old isolation test expected one scheduler entrypoint. It now requires exactly the calendar and context handoffs, while additionally asserting absence of the old daily grid/heading; pinned-source and manual-import guards remain.
- WebKit had a generic network-idle setup timeout and repeated initial recap Close stability timeouts. These occurred before the affected route case. Logs are retained. The clock diagnostic observed only 0–1 animation frames in 1.5 seconds under both clock configurations, although the later ordinary clicks passed. It does **not** establish a unique root cause. A fixed-time attempt also stalled on a calendar click. The final probe uses an advancing Date-only offset for the fictional period, leaves native timers/animation frames running, and waits for rendered font readiness; the 15-second click timeout is unchanged. No force-click, skipped assertion or performance-bar change was used.

- The focused interruption probe initially assumed a single motion pane; the existing implementation prepares both neighbors, so its observation waits for the first and still requires a positive count. A full-element screenshot changed the Chromium pointer profile to fine-pointer before the focus assertion. Removing that capture from the interaction sequence restored the intended coarse-pointer case; diagnostic state and failures are retained. Static editor screenshots remain separate visual evidence.

## Current mobile editor evidence for the next increment

`*-390-text100-make-schedule-viewport.png` captures the actual current editor. `*-make-schedule-full.png` captures its full content; `*-editor-contents.json` inventories controls and sections. No editor simplification was included here.

In the visible viewport, Weekly hours review sits near Return to manager view/Sales key; People & coverage introduces six setup actions (Generate month, Import schedule, Teams, Team balance, People, Store hours), alongside the issue count. Monthly demand context and the date calendar follow. The full editor additionally contains selected-day coverage/busyness/assignment controls, team/absence details, roster display, team-balance guidance and review controls. These are observations of competing information and actions, not a redesign recommendation or user-research finding. Collapsible sections are distinct from simultaneously expanded content.

## Limits

Fictional history and People, in-memory preview only. Unknown is not zero. Real workbook sample and live data/persistence remain outside scope; legacy snapshots lacking period/store provenance are not a ready daily feed. Weekly hours remain a scheduled-interval audit with incomplete break evidence, not paid hours or legal overtime. Team balance remains an audit, not fair generation; strength is unavailable. No physical-device, screen-reader or browser-menu zoom verification; scoped automated checks are not whole-app conformance. Hosted interaction may remain inaccessible from this executor even when deployment identity is verified through APIs.
