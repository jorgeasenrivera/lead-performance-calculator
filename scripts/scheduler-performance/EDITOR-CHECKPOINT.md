# Editor checkpoint: simplified day editor and retained month answers

Branch `claude/scheduler-editor-retention`, cut from Codex's checkpoint
`084e733d25e710923803cc872e74f6496d18cbbf` (see `HANDOFF-WIP.md`). Draft, not for
merge or deploy. It sits on top of the unmerged stack #481 to #484 and does not
change any of those branches. Claim: board row X26 on `main`.

## Decision record (Rule 5), what exists and what does not

- Jorge, 17 October 2026 22:59 UTC, in the Codex thread: "The edit area is still
  a little busy, better but still a little busy." That is Jorge's direction that
  the editor should be simpler.
- The simplified editor (selected day, visible warnings, people and status,
  persistent Apply and Cancel, optional details and tools, no smaller text or tap
  areas, draft retention and manual-hours protections kept) was accepted for
  implementation by the coordinator. That is the coordinator's acceptance, not a
  decision by Jorge on a published proposal page.
- **No published proposal page with a decision per item exists for the editor.**
  A phone review by Jorge is still required before any merge.

## Source changes in `month-app.mjs`, validated in Chromium

1. Move/Copy with pending choices wrote its message outside the open editor,
   because the empty alert is hidden by CSS and failed the visibility check. The
   destination is now chosen by whether the editor is active, the text is set
   first, then the alert is focused and scrolled into view.
2. Every render recreates Schedule tools closed, then focused hidden children.
   `focusControl()` reopens the disclosure first, for Generate month, Off-day,
   Setup and Import.
3. Closed and unknown days keep the Applied roster and sales section. No staffing
   suggestion is invented for them.

## Probe changes (setup and design adaptation; no timeout changed)

Setup opens Schedule tools or Day details with the case's own input modality and
does not swallow errors. Adapted to the approved layout: the last control in the
mobile editor is Cancel, the toolbar wraps instead of scrolling sideways, the
calendar key is present while editing, the tools list includes Move / copy
off-day, hours and sources live in Day details, and `planner/off-day-command.mjs`
joins the enumerated static GETs. New `probe-tools-focus.mjs` fails on `82bb1ec`
(focus lost after cancelling off-day) and passes here.

## Run it

```
npm ci
node scripts/scheduler-performance/build.mjs        # do not rebuild while probes run
python3 -m http.server 5190 --bind 127.0.0.1 --directory dist-harness/scheduler-performance &
python3 -m http.server 5203 --bind 127.0.0.1 --directory dist-harness/scheduler-performance &   # probe-embedded-navigation hardcodes this port
export BASE_URL=http://127.0.0.1:5190 EVIDENCE_DIR=/tmp/sage-evidence
```

The probes hardcode `/usr/bin/chromium`, `/workspace/cloud-tools/node_modules/playwright`
and `/workspace/qa-tools/node_modules/axe-core`. Install `playwright` (a version
that matches your browsers) and `axe-core` there, and point `/usr/bin/chromium` at
a Chromium. For WebKit, `PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` as in `HANDOFF-WIP.md`.

Run one probe at a time, in this order, once per engine (`BROWSER=chromium`,
then `BROWSER=webkit`). One at a time keeps the probes from competing for the machine. An
earlier timeout seen while five ran in parallel was first attributed to that load; that
explanation was not established (see the next section).

```
for p in probe-editor probe-guided-recovery probe-history probe-navigation-review \
  probe-editor-embedded probe-embedded-navigation probe-off-day probe-editor-exclusions \
  probe-compatibility probe-editor-focus probe-history-transitions probe-tools-focus; do
  node scripts/scheduler-performance/$p.mjs || echo "FAILED $p"
done
```

`probe-editor-exclusions` and `probe-editor-readiness` also launch WebKit
themselves. Do not relax a timeout or assertion to pass: preserve the trace and
report it.

## Results at `b9511c4`, Chromium only, run one at a time

All pass: `probe-editor` (8 cases), `probe-guided-recovery` (12),
`probe-history` (8), `probe-navigation-review`, `probe-editor-embedded`,
`probe-embedded-navigation` (4), `probe-off-day` (3), `probe-compatibility` (6),
`probe-editor-focus` (3), `probe-history-transitions` (2), `probe-tools-focus` (2).
`probe-editor-exclusions` passes its Chromium case, then exits 1 because WebKit
is not installed here. `npm test`: 1,143 pass. Isolated build passes.

## Not done

- **No WebKit run at all.** Earlier WebKit timeouts on busy rosters (Make Schedule,
  dashboard calendar toggle) are undiagnosed and unretried. `probe-editor-readiness`
  is WebKit only.
- No phone review, no physical device, no screen reader.
- No protected preview. Exact-head CI is not yet checked.
- About 40 older `probe-*.mjs` files fail on the parent `60a757a` as well, so they
  say nothing about this change. They were not touched. Several click Schedule
  tools buttons directly (`probe-teams`, `probe-manager`, `probe-mobile-toggle`,
  `probe-import`, `probe-generation` and others) and would need the same setup
  step before they could be used.

## WebKit run in the supported container (added after the results above)

Scratch workflow commit `7c72b81705276a03ae89a39bb961fc9fcbaf6928` ran the 13 probes in WebKit
one at a time against exactly `6e24ee59865d16899881eba72963d847bf6b3f6a` (run 39087192813, tree
`5aa3c0ae9e0a9dbead879963c42fedae1fe22296`, Playwright 1.63.0 on the `v1.63.0-noble` image). Twelve
probes exited 0. `probe-editor-readiness` read `ready: true` with no page errors or failed requests.

**`probe-editor-exclusions` exited 1 in WebKit.** Its Chromium case passed. In WebKit, the click on
`#day-2026-11-04` right after the viewport goes from 390x900 to 844x390 and back timed out at 15
seconds, with `#mobile-day-dialog` reported as intercepting pointer events. That is the same
interception signature as the earlier Chromium timeout, so the sequential run does not support the
explanation that parallel load caused it. **The cause has not been established.** The failure is
preserved in the run's artifact and is not being treated as flaky.

