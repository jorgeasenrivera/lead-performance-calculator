# Weekly-hours operational review checkpoint

Preview-only increment after independently reviewed `2959c3f32756ae43a86b007d3c75dfa84e281663`. No formal writer claim renewed or transferred. No production source, persistence, database, credentials, permissions or merge changes.

## Behavior

- One pure `weeklyHoursAudit` resolves the full Monday–Sunday America/New_York week, including adjacent months and years. It unions exact entered minute intervals per person/store, deduplicating repeated/overlapping/shared-team records and retaining split shifts.
- Strictly above 3,000 known minutes warns. At 50:00 there is no excess warning; 50:01 displays 50:01 total and 00:01 excess. Below 40 is neutral; 40–50 is usual context, not a minimum.
- Import candidate review, selected-week review and People use this audit. Initial day quickview stays unchanged. The soft warning does not change assignments, import blocking, coverage eligibility or team-comparison inclusion.
- Hard-cap enforcement remains separate and unchanged. People explicitly labels unconfirmed preview settings and offers confirmation for an individual cap in that monthly draft. Changing availability alone does not silently confirm the fixture default. The audit reports confirmed cap conflicts separately, including the 45-hour cap/48-hour case.
- Missing adjacent-day assignment evidence, unknown durations and unavailable break information remain incomplete. Incomplete known totals use “at least”; below-threshold incomplete totals never claim within range. Entered explicit intervals remain visible even if store closures exclude them from opportunity.

## Important scope of the total

This is **scheduled interval time**, not a calculation of net working or paid hours. The bounded CSV contract has no breaks, and absence of break data is not confirmation of no breaks. Current imported/full-day records therefore retain an incomplete break-information notice. No break deduction, availability, overtime pay or legal classification is inferred. The test-only explicit `breaksKnown` marker exercises complete interval data; the import UI does not fabricate that marker.

## Verification

- Full `npm test`: **1,080 passed, 0 failed**, including nine new boundary/invariance tests and existing hard-cap, atomic import, stale review and no-persistence tests.
- `npm run build`: passed. Isolated preview build: passed, with existing large-chunk warning.
- Frozen-build Chromium and WebKit: **six cases passed**, each at desktop 1440/100% text, narrow 390/100%, and narrow 390/200% CSS text. CSV candidate warning remains non-blocking under an 80-hour confirmed cap; the applied selected week and People show the same 50:01/00:01 result. No page errors, document overflow, observed network requests or storage/IndexedDB writes during review/apply. Six scoped axe scans passed (button names, labels, contrast, valid ARIA attribute values).
- `results.json`, per-case result files and review/People PNGs contain the final matrix. Two earlier probe errors are retained: wrong settings-panel selector, then waiting for a hidden initial mobile day heading. They were corrected in the probe without changing product behavior, assertions or timeouts.
- Local Chromium `feel`: failed unchanged bars, Lunch 73/50 ms, Here 71/50 ms and reduced-motion return 2127/2100 ms. Local WebKit `feel`: Lunch 77/60 ms, then the Home-pane transition timed out at the existing 30 seconds. Logs and captures are retained; root cause is not established. No threshold, timeout or assertion was relaxed. These broad production-harness failures are not an isolated scheduler pass or evidence of a production incident.
- Frozen preview: 54 files; `deployment-manifest.json` SHA-256 `54e503c6f79be55d1a92b43d692767dd0b9648ae499f6748494abcdfb13359be`.
- Exact remote SHA, CI and protected-deployment verification are recorded in the delivery response. No hosted-browser interaction is implied by API identity verification.

## Remaining routing and live-release boundaries

Units and Pace cards/buttons and their distinct metric context must remain. The separate Sold by Day surface is still reachable through the copied phone `BoardRoomPhone` `units`/`pace` popup and the month summary action. The desktop hero popover is already removed. This checkpoint does **not** claim complete removal; next integration work must consolidate only the standalone day-sales surface into scheduler dated Delivered and verify desktop and phone routes.

Scheduler history remains fictional. Legacy live snapshots lacking period/store provenance intentionally produce `daily:null` and `history:{}` in `api/_digest-integrity.mjs`; they are not a ready daily-sales feed. Never derive daily sales from cumulative differences or person credits. Unknown stays unknown; recorded zero stays zero. No live integration is authorized by this checkpoint.

The real workbook sample is pending. CSV remains bounded, same-day America/New_York and in memory; real People integration and persistence are absent. Team balance is an audit, not fair generation; strength stays unavailable. No physical-device, screen-reader or browser-menu zoom verification, and no whole-app accessibility/conformance claim.
