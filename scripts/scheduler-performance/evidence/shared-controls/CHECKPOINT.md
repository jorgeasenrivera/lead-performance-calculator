# People-inspired shared controls checkpoint

This checkpoint follows the independently reviewed d61ee2f editor preview. It is a fictional, in-memory, stacked preview on PR #478, not a live operational scheduler or a production release.

## Changes

Shared selectors, menus, buttons and the bottom navigation now use the existing People palette: warm role-header wash (#F6E3C3), selected-row wash (#E8F1EA), sage action (#567D61), and blue account wash (#EAF2FF). Blue/violet family accents remain decorative. Team headers and intended On controls carry this treatment into the scheduler editor. Coverage, conflicts, absence reasons and unknown values keep their meanings.

The corner family is 6 px compact grid/details, 12 px controls, 20 px cards and navigation shells, and 28 px sheets. Selector capsules are 14 px inside a 20 px shell with 6 px padding. Full-viewport embedded editor pages, circles and intentional pills remain exceptions. Selected labels use paper ink, persistent underlines and existing pressed/current semantics. Legacy moving plates are hidden so each selection has one visible owner. Selection color changes immediately; shadow feedback uses 200 ms, press feedback 80 ms, and sheet movement 220/240 ms. Reduced motion removes travel and preserves immediate state feedback.

The phone bottom navigation remains four equal columns without horizontal scrolling. Enlarged labels wrap and increase its height; ResizeObserver measures content clearance. Rooms stays anchored above the bar. The account popup uses nonmodal dialog semantics, focuses its first available action, restores trigger focus on dismissal, and paints above the section strip.

Press feedback cancels movement and crossing the control boundary, including an edge exit below the movement threshold. Browser :active styling cannot retain the inset treatment after cancellation. The existing buzz service, tick and global owner remain; no blanket touch listener or native shell change was added. Physical haptic tuning remains a separate checkpoint.

No production source, scheduling algorithms, persistence, database, credentials, access, permissions or formal writer claim changed. Disabled connected destinations remain disabled. Dated membership, import review, provenance, exclusions, weekly-hours warnings and audit-only team balance are preserved.

## Evidence interpretation

`people-palette-reference.png` is explicitly a local read-only sample of existing People CSS, not a connected People screen. `before-*` images show the previous published checkpoint. Browser images use fictional data.

Initial failures are retained: inherited selector color interpolation, account-role contrast at enlarged text, and the compact calendar corner losing to a more specific control selector. These were corrected in preview CSS without weakening assertions. A WebKit text diagnostic records root font size changing to 32 px before a descendant changed from 12 to 24 px on the next paint. The navigation probe waits two animation frames and still requires exactly doubled labels.

The unchanged 15-second WebKit desktop host recap-dismissal timeout occurred in the first controls matrix at 1024 px and an intermediate matrix at 768 px. The final controls matrix passed all twelve cases, but that does not establish a root-cause fix for the earlier host failures. It is separate from standalone editor success. Earlier host iframe readiness and stronger active-motion observation limitations remain recorded in prior checkpoints; a later successful sample is not a general resolution of those intermittent limits.

A later cancellation probe also caught residual CSS interpolation after drag-out. A visual cancellation marker now lasts until release, removing the transition immediately; both browser engines passed the same assertion. The service disconnection stopped local servers and caused three connection-refused runs before app entry. Their logs remain; services were restarted, with no approval bypass or production action.

## Validation and artifact

- 1,087 unit tests passed; production and isolated preview builds passed.
- Twelve controls configurations passed in Chromium/WebKit: 320, 390, 768 and 1440 px, plus actual 200% text at 320 and 1024 px. Thirty-six scoped axe scans, equal four-column geometry, label fit, menu paint order, icon sizes and focus restoration passed (`accepted-controls/results.json`).
- The twelve-configuration shared interaction matrix passed (`shared-final/results.json`), including mouse/touch, reduced motion, interrupted exit, rapid reopening and focus restoration. After the final cancellation correction, both 390 px pointer flows passed again with six axe scans and the stricter immediate drag-out check (`recovered-motion/results.json`).
- Six final standalone editor configurations passed: Chromium/WebKit at 390/100%, 320/200% text and 1440/100%, including twelve scoped axe scans, measured 2x text, split shifts, import provenance, generation review, protected exceptions and pending/Cancel behavior (`recovered-editor/results.json`).
- Both embedded mobile editors passed measured corners, keyboard boundary, one-dialog ownership, pending edits across Close/reopen, and Cancel (`accepted-embedded/embedded-results-final.json`).
- Both engines passed closure/unknown-hours preservation and orientation checks (`exclusions/exclusions-results.json`). Both 320 px/200% Units/Pace/Delivered routing flows passed after service recovery (`recovered-routing/results.json`). No observed network or persistence writes in the scoped editor/routing flows.
- Local broad Chromium salesperson feel **failed** before press/reduced-return checks: `.fba-btn.fly` did not detach within the unchanged 15-second limit after the mock status reset. Earlier timing bars passed. Captured events show floor/queue polling timeouts. A subsequent mock read was responsive; this does not establish the browser timeout root cause. Failure log, event capture and screenshot are retained in `feel-failure/`. This uses the unchanged production build with a fictional mock, not the isolated preview control transforms. No new local broad WebKit pass is claimed. CI is reported separately.
- Frozen static manifest contains 55 files. SHA-256: `c7574dec41815d2c76db13e2650f8df6268e0bd34ac7abb81592b6368053b0ff`. The PR records deployed identity and CI for the published source.

Redundant passing screenshots from intermediate runs were removed; failure logs, failure images, result JSON and final visual evidence remain.

## Scope limits

Real workbook sample pending. CSV is bounded, same-day America/New_York, in-memory preview only. Unknown is not zero. Strength remains unavailable without valid data; team balance is an audit, not fair generation. Weekly scheduled intervals are not paid hours or legal overtime. Suggestions remain minimum-only, not forecasts. Real People integration is absent.

Physical devices/WebView, native keyboard, screen readers, browser-menu zoom, offline recovery and whole-app accessibility are not certified. Actual CSS text doubling and scoped axe results are narrower evidence. Existing production bundle-size warnings remain. Protected hosted interaction from this executor is subject to its CONNECT-proxy block; API identity verification is not a hosted interaction pass. No merge or production action is included.
