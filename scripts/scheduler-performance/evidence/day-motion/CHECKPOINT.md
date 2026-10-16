# Selected-day motion checkpoint

The isolated scheduler adds Sage roster cards, counts and team icons. Date, On, Off, optional Unconfirmed and the single Delivered row retain their hierarchy. Desktop calendar and side-panel geometry is unchanged. Warning and sales meanings remain separate.

Touch navigation follows displacement with adjacent opaque panes. Pointer/keyboard navigation remains anchored at every width. Edge starts, vertical intent, selection, interactive children, multiple touches and cancellation are excluded. Rapid reversal and repeated requests do not queue. Reduced motion changes apply while open, including cancelled transitions. Closing restores calendar focus/scroll and parent closure cancels child motion. Embedded details remain a region inside one modal.

## Evidence and corrections

- Full local suite: 1,066 tests passed. Production and isolated builds passed, retaining the existing bundle-size warning.
- Standalone Chromium/WebKit: 390px normal, 320px at 200% text and 390px reduced motion. Scoped WCAG A/AA scans, overflow, keyboard/mouse alternatives, focus restoration, boundaries, reversals and live reduced motion are asserted.
- Embedded Chromium/WebKit: desktop, phone and 200% text. No nested dialogs; desktop geometry matches the prior baseline. Closing Performance releases the child surface and cancels its transitions.
- Chromium native CDP touch dispatch samples drag/settle frames, checks full opacity and bounded travel, and captures the incoming pane. This is not a physical touchscreen test.
- Visual inspection caught an incoming-heading offset that settled screenshots missed. The incoming pane now shares the live panel class. Both the synthetic matrix and native check assert heading alignment. `native-before-alignment.png` preserves the rejected visual.
- `initial-failure.log` records an unexplained WebKit reverse-swipe failure. A diagnostic recognized the gesture, but does not prove the original cause. Moving repeated month calculations off the drag path reduced measured synthetic drag work; this is not proof that the original failure was exclusively performance-related. Final checks retain their original assertions and timing thresholds.
- `feel-missing-mock-config.log` records a setup failure before sign-in: the ordinary build contained no local mock service URL. The documented local mock environment was supplied for the subsequent feel run. No credentials, database or access-control settings were changed.

## Local repository feel failures

The configured Chromium run failed the existing background-blend bar (28, limit 24), then timed out on reduced-motion sign-in with `activeEngineSend is not a function` (minified as `Tt`). Read-only inspection maps the stack to `tellArrivalReady` in unchanged `src/LeadPerformanceCalculator.jsx`: the first callback invocation can finish arrival and clear the callback before the second invocation. Evaluating the existing function with a callback that clears itself reproduces the TypeError. The production arrival path was not edited; resolving it requires separately scoped owner work. This does not establish a production incident.

The configured WebKit run passed the two tap rows, then timed out waiting for the Home pane before the ground measurement. Its cause remains unproven. No retries, bars, access-control checks or assertions were relaxed. Raw sanitized logs and captures are retained; exact-head CI is reported on the draft PR separately from these local failures.

## Limits

No physical iOS/Android, screen-reader or browser-menu zoom result is claimed. Automated accessibility scans are scoped checks, not conformance certification. Hosted browser access was blocked by this executor's CONNECT proxy in the preceding checkpoint; API deployment identity does not establish a hosted interaction pass.

Prior original-review fixes, private-name tests, bounded CSV/import review, dated membership, excluded-assignment audit and generator limitations remain documented in the earlier checkpoint. Strength stays unavailable. No production source, deployment, database, credentials, permissions, merge or writer claim changes.

Shared application motion and control-system changes are separate and are not represented as complete by this scheduler checkpoint.
