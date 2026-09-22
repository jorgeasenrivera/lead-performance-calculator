# The arrival, every sign-in

Proposal X5, 22 September 2026. No app changes have been made.

Jorge's direction: "I'd want it to be everytime."

## One decision

**Replay the existing full arrival whenever Sign in is pressed and sign-in succeeds.**
Remove the once-per-day limit, not the animation. Keep the logo, tunnel,
destination, flash and dashboard landing exactly as they are. Keep the same
timing and the existing loading overlap. A failed sign-in still cancels the
arrival and brings the form back with its error.

| Situation | Today | Proposed |
|---|---|---|
| First sign-in today | Full arrival | Same full arrival |
| Sign out and sign in again | Short path | Same full arrival |
| Another account signs in using this browser today | Short path | Same full arrival |
| Reduce Motion is enabled | Short path | Short path, unchanged |
| Refresh or reopen with a saved session | Existing refresh entrance | Unchanged, no login tunnel |

**Decision: awaiting approval of this page.** Reply "Approve X5" to approve
the scope above. The requested frequency is already clear; this page fixes the
boundaries before implementation, as required by the project's visual-change rule.

## Cost

Repeat sign-ins will take the same several-second visual journey as the first
one. This does not make the network faster or slower. It removes the shortcut
that currently lets returning users reach the dashboard sooner.

## Verification before release

- Two successful sign-ins on the same day must both run the full arrival.
- A stored mark from an older version must not suppress it.
- Reduce Motion, failed sign-in and saved-session refresh must keep their behavior.
- Preserve the worker-driven animation and dashboard loading overlap.
- Update the once-per-day test to cover the approved behavior, without weakening
  unrelated performance checks. If a speed check times the deliberately removed
  shortcut, document that changed expectation separately.
- Run tests, build and both browser checks. Provide a preview for Jorge to try
  on an iPhone before merging. No redesign or new animation is part of this item.

## Implementation boundary

The daily gate is `arrivalShort()` in `src/LeadPerformanceCalculator.jsx`.
It reads `lpc:jump:day`; `runJump()` uses that result, and `landDashboard()`
shares it. The change removes the day read and write while retaining the
reduced-motion decision. Clean up the conflicting old comments that claim the
arrival already plays every time. Do not change authentication, store data,
room transitions or the separate TV sizing repair in #410.
