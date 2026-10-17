# Unvalidated scheduler WIP handoff

This checkpoint preserves paused work for review. It is not release-ready and is
not approval to merge or deploy. No further implementation was performed for
this handoff. No writer claim was renewed or transferred.

Base: `60a757a8bc1eaa3e2079ea58b8cb9a30bdb01f06`.
Handoff branch: `codex/scheduler-wip-handoff`.
PR #484's branch, `codex/scheduler-history-heatmap`, is unchanged.

## Exact preserved file list

All paths below are relative to `scripts/scheduler-performance/`. These seven
files are byte-identical to the paused handoff artifacts:

- `generation-ui.mjs`
- `month-app.mjs`
- `planner.css`
- `probe-guided-recovery.mjs`
- `probe-history.mjs`
- `probe-navigation-review.mjs`
- `probe-editor.mjs` (previously untracked)

This handoff document is the only additional file.

## Changes awaiting review

Month navigation captures current raw generation answers and retains them under
the source month, normalizing that saved month field. The regression separately
edits November and December, retains an unfinished minimum and checks Cancel.

The editor places warnings and people/status controls before optional Day details,
with distinct suggestion, team actions, hours/sources, applied roster/sales and
history sections. Apply and Cancel occupy a separate persistent action row.
Required inputs, recovery guidance, removal confirmation and person-level
Move/Copy stay outside collapsed details. Month actions use Schedule tools.

The last two corrections focus/scroll to the editor in the enlarged desktop
layout and contain WebKit's native long-option overflow on the Move/Copy Person
label. They were built but have not received final browser verification. The
last probe edit adds actual field focus and focused native-select evidence; it
also remains unexecuted.

## Recorded validation, synthetic fixtures only

- Passed: 1,143 unit tests, zero failures/skips/todos; normal and isolated builds;
  whitespace check. Existing build warnings remain. These do not establish final
  browser readiness.
- Before the editor changes: month-retention guided recovery passed 12 cases in
  Chromium and 12 in WebKit. Focused Chromium Back/Forward and discard safeguards
  passed.
- Intermediate editor: Chromium guided recovery passed 12 cases; calendar,
  geometry, history ordering and scoped accessibility passed eight cases.
- Baseline editor tasks: Chromium passed eight cases. WebKit passed three, then
  failed horizontal-overflow detection for a long-name roster at 390px/200%
  text in Move/Copy. Remaining baseline WebKit cases did not run.
- Intermediate editor tasks: Chromium passed six, then failed Apply initially
  visible at 1440px/200% because date selection left the editor below the
  calendar. This prompted the last local focus correction. WebKit passed one,
  then timed out at 12 seconds clicking Make Schedule for the busy roster.
- Another WebKit navigation run timed out before planner entry at the dashboard
  calendar toggle. A separate instrumented busy-roster diagnostic measured
  8.21 seconds click elapsed and 4.09 seconds in the handler; this does not
  explain all timeouts. No timeout or assertion was relaxed.
- A driver mistakenly expecting Schedule tools against the older build produced
  a setup failure; it is not an app result.

Measured intermediate default control counts fell from 28 to 16, and the
12-person long-name fixture from 40 to 22. Person-level Move/Copy accounts for
two controls above the proposed default of 14. Apply was initially visible in
completed normal-layout cases. Automation duration is not human usability data.

## Pending

Review the last focus/overflow corrections, including native select behavior and
focus visibility. Run the combined editor, guided-recovery and navigation
safeguard matrix in Chromium/WebKit, plus applicable calendar, accessibility and
embedded navigation checks. Preserve and diagnose failures. Final browser checks,
exact-head CI review and any new protected preview identity are not complete.
There was no publication or deployment of these changes before this WIP handoff.

The probes use local synthetic fixtures and environment-specific Playwright,
Chromium and axe paths. `BASE_URL`, `BROWSER` and `EVIDENCE_DIR` select the server,
engine and output directory. WebKit in the originating environment uses
`PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers` and
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`. Build with
`node scripts/scheduler-performance/build.mjs`; do not rebuild static output
while browser checks read it. No raw traces, private data or security reproduction
examples are included in this handoff commit. The publication review inspected
the patch/new probe and found no secrets or private data; this is not a full
security audit.
