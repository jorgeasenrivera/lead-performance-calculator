# Focused editor checkpoint

Preview-only increment from `232ee4b7b6cd89529b229cef7e835c7a103471d9`, draft PR #478, base `codex/scheduler-fictional-proposal`. The user explicitly authorized this bounded implementation and protected preview. No formal writer claim was renewed or transferred. Repository instructions and coordination files were inspected; no conflicting scheduler claim was found. Unrelated `manager-phone-search/` was left untouched.

## Result

Make Schedule opens the selected month, without automatically opening generation. Generate month, Import and Setup are the three entry actions. Empty months make Generate primary. Setup contains Teams, People and Store hours. Generation remains the existing prefilled form and explicit proposal review; the focused panel hides competing workspace controls. Generation logic is unchanged.

The editing toolbar no longer includes Sales key or the instructional block. Monthly historical range is one collapsed line explicitly labeled not a forecast. Weekly hours and team balance are in Review month, and weekly hours are also available beside the relevant person. The useful desktop calendar/day layout remains.

Selecting a phone date opens one focused editor: date, Back and previous/next, concise applied coverage, visible issues, staffing suggestion and Why, then people grouped by team. Editing groups follow dated membership even when the viewing mode is Individual. Shared members appear once with their memberships explained; bulk controls stay with the team and explain protected exceptions beside affected people. A single intended On/Off/Unknown select replaces the independent checkboxes. Off reason appears only for Off. Applied conflicts and absence sources remain distinct from intended choices.

On preserves every imported interval and source. Removing imported work requires a visible person-specific confirmation. An unrelated person edit preserves split shifts, unknown notes, absence provenance and unrecognized imported identities. Contradictory On/Off input starts unresolved and cannot silently resolve on Apply. Existing absence protection requires explicit clearing before new work; eligibility, weekly hard-cap rules, import atomicity and generation behavior are unchanged. One Apply day and secondary Cancel remain. Back and navigation keep pending choices; Cancel restores only that date's applied choices. Pending choices survive outer Schedule close and reopening while this page lives.

Closed and unknown-hour dates still show entered exact times and sources, without eligible coverage or a suggestion. No duration is inferred. Suggestions retain the existing source and target; current fixture suggestions are minimum-only, with historical range and missing inputs explained. No forecasting or strength claim was introduced.

## Visual evidence

The old full PNG was a host Performance capture, not a full editor capture. This checkpoint replaces that evidence method with actual embedded viewport screenshots at recorded editor scroll positions.

- `chromium-390-before-forced-generation.png`: original source from 232ee4b, automatic generation on entry.
- `chromium-390-before-month.png` and `chromium-390-after-month.png`: same 390 × 900 host, November 2026, initial month selection. Calendar grid top moved from **871.58 to 230 px inside the iframe**, with the outer Schedule header adding about 68 px. Generate moved from 487.19 to 122 px inside the iframe. These are geometry observations, not task-time measurements.
- `chromium-390-after-day-scroll-1.png` through `-3.png`, and corresponding WebKit files: actual scrollable embedded editor. `embedded-results.json` records viewport height, total scroll height and each offset. No full host page is presented as the editor.
- `*-person-controls.png`: imported split intervals, On without Off reason, and Off with vacation/unavailable provenance and reason controls.
- `*-320-text200-*.png`: actual computed 200% CSS text, including person controls and bottom actions.
- `*-1440-text100-month.png` and `*-day-top.png`: desktop layout.

Existing Sage typography, forest/paper/leaf colors, pixel icons, spacing variables and focus are used. Editing surfaces use the existing card radius, controls (including calendar buttons) the existing 10 px control radius, and compact notes the 6 px dense radius. The initial corner assertion expected 6 px calendar buttons, but the existing shared button rule computes to 10 px; the final assertion checks that retained control sizing. The failed expectation is retained. Richness is retained in reasons, source detail, team context, focus and press feedback; broader pill palette and whole-app corner refinement remain separate. Conflict ink reuses `#8c3028` from planner.css. Sources: planner.css, shared-system.css and sage-icons.mjs. Sage UX, design, accessibility and responsive QA skills were read and applied. No whole-app standards-conformance claim is made.

## Verification

- Full suite: **1,086 tests passed, zero failed**. Three new tests cover split interval/provenance/unknown-identity preservation, explicit removal and contradictory intended state. Scheduling, generation, import and cap tests remain unchanged.
- Production build and isolated preview build passed. Existing large-chunk warnings remain.
- Standalone editor: **six configurations passed**, Chromium and WebKit each at 390/100%, 320/200% actual CSS text and 1440/100%. Twelve scoped axe scans passed. Six computed-font comparisons measured 2x. Tests cover generation prefill/proposal/discard, Setup return, import review, exact split intervals, absence guard, team exceptions, pending changes across dates/Back, Cancel, explicit removal and repeated navigation.
- Embedded host: **both engines passed** at 390 × 900. One outer dialog, no nested dialog; keyboard return/focus, pending changes after outer Close/reopen and Cancel verified. Units value and contextual route preserved.
- Exclusions and orientation: **both engines passed**. Closure and unknown hours after import preserve exact times; returning to open restores the same entered work. Pending choices survive 390 → 844 landscape → 390. Keyboard boundary wrapping and Back focus passed. Two additional scoped axe scans passed on the final CSS.
- Delivered/Units/Pace regression at 320/200%: **Chromium passed**, including four scoped axe scans and preserved value/history/context. **WebKit blocked before route entry**, waiting for the host iframe to initialize at the unchanged 15-second limit. The isolated diagnostic reached readiness in 5.33 seconds without page errors or failed requests; it does not establish the root cause or turn the failed route run into a pass.
- No observed storage/IndexedDB or network writes in the editor and embedded flows. The standalone probe allows only enumerated static font and generation-worker dependency GETs; embedded routing allows the three named static font GETs. The initial too-narrow static-read assertion failure is retained as `browser-static-read-failure.log`; no write assertion was relaxed.
- Broad local Chromium feel: **all unchanged bars passed**, reduced-motion return 2,040/2,100 ms; manager phone search checks also passed. See `feel-chromium.log`. No new broad local WebKit run is claimed.
- Frozen preview: **55 files**. Manifest SHA-256 `6a5582e8ea23fa63a212c6f021acf6e70919c2eb57a500ce88bddda01ee20ac4`. Exact pushed SHA, CI and protected deployment identity are recorded in the PR and final delivery.

## Limits and retained blocks

Prior checkpoint WebKit host desktop recap dismissal and observed-active-motion checks remain blocked; neither is claimed fixed by the standalone desktop editor pass. Prior feel failures remain retained. The Individual-view keyboard case exposed nested summaries inside closed details being counted as focus targets because they reported geometry. The focus boundary now excludes descendants of closed details except their own summary. The failed assertion and before-fix focus state are retained; the same boundary assertion is rerun in both engines. No write checks or keyboard assertions were removed; no performance bar or timeout was relaxed, and no force clicks were used. Browser diagnostics do not establish a production incident.

Fictional manager workflow only, no published staff schedule. History and People remain fictional; CSV remains bounded, same-day America/New_York and in memory. Real workbook sample is pending. Unknown is not zero. Weekly hours remain an entered scheduled-interval audit with incomplete break evidence, not paid hours or legal overtime. Team balance remains an audit, not fair generation; strength is unavailable.

Physical phone/WebView, native keyboard, screen reader, browser-menu zoom, offline recovery and whole-app accessibility remain untested. Emulated orientation and CSS text enlargement are explicitly distinguished from those checks. Hosted interaction may be blocked by the executor proxy even when API identity is verified. No production source/deployment, merge, persistence, database, access, credentials, permissions or formal writer-claim changes.
