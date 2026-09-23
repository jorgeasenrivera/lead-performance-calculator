# Repair the login handoff

X6, 22 September 2026. Approved for implementation, not yet released.

## Confirmed defect

The tunnel hands over assuming a full-screen cover hides the switch. PR #279
removed that cover's styling, but left the element and transition code in place.
The local browser confirmed a transparent, zero-height, statically positioned
element with no animation. The intended cover cannot draw.

## Decision 1: restore the original cover

Restore the original brief white cover, including its reduced-motion exception.
Keep the tunnel visible until the cover is opaque, then replace it with the
dashboard and let the cover clear. Do not redesign the logo, tunnel or cards.

**Approved by Jorge on 22 September: "Restore the original cover."** This
includes retaining Reduce Motion. No softer replacement or new design is approved.

The original rise reached full opacity at 26% of 340 ms, about 88 ms.
The current code waits two animation frames plus 20 ms before handing over.
Those are not the same guarantee on different displays. The repair must prove
the cover is opaque before it exposes the replacement, not just put the CSS back.

## Decision 2: retain the existing landing and round-up for now

The earlier desktop sample recorded main-thread tasks up to 254 ms after reveal.
That establishes stalls, not their cause. Separate animation clocks and the
round-up are investigation targets, not proven explanations for those stalls.
No removal of the round-up, new delays or new easing is proposed without evidence.

**Recommended: instrument and measure first. No production instrumentation.**

The local recorder in `scripts/login-performance.mjs` captures the press, tunnel
phases, cover state, dashboard reveal, round-up and timestamped long tasks. It
does not record credentials, change preferences or contact a live service. Its
server refuses a build that does not point at the local mock.

## Before release

- Prove the cover is viewport-sized and opaque at the handoff.
- Check normal login, slow response, failed login, cancellation and Reduce Motion.
- Keep saved-session refresh separate. X5, playing the arrival every sign-in,
  is a separate decision and has not been implemented by this repair.
- Run tests, build and Chromium/WebKit checks.
- Publish a preview for Jorge to try on an iPhone before any merge.
- Report remaining stalls honestly. Restoring a cover does not fix main-thread work.

## Implemented and measured, 22 September

The cover CSS is restored with its original rise and fade. The fade is scoped
to a full login that actually raised the cover, so a saved-session refresh or
short sign-in does not acquire a new white flash. The tunnel remains until
computed opacity reaches one and a further animation frame has been allowed.
Cancellation can now stop this wait. A one-second bound reports a missing or
unstyled cover and releases sign-in rather than trapping a person indefinitely.

The local recorder, in foreground desktop Chromium at 1280 by 720, observed:

| Event | Time after pressing Sign in |
|---|---:|
| Tunnel mounted | 384 ms |
| Cruise began | 3,047 ms |
| Hero mounted under the tunnel | 4,031 ms |
| Cover began | 5,033 ms |
| Tunnel removed and dashboard revealed | 5,343 ms |
| Round-up opened | 7,643 ms |

At tunnel removal and dashboard reveal, the cover was fixed, white and at
opacity 1. Afterwards its opacity returned to 0, its animation stopped, the
canvas was removed and all temporary arrival classes cleared. No warnings or
errors were captured. This verifies the handoff, not an iPhone frame rate.

Remaining work is real: the largest recorded task after reveal was 156 ms.
One 506 ms animation frame during the covered mount included 323 ms of forced
layout attributed to the framework scheduler. That attribution is not enough
to name a component as the cause. The previous 254 ms sample used a different
recorder, so these numbers are not an A/B improvement claim. This recorder also
adds observation overhead. Profile the component before changing its behavior.

637 tests and the mock build pass. The local feel attempt first rejected the
manager-only mock; after restarting the mock in salesperson mode, it stopped
because the installed Playwright package has no browser executable on this
work computer. CI must supply Chromium and WebKit. Slow and failed network
sign-ins and reduced motion still need browser coverage; cancellation and the
missing-cover fallback have deterministic tests. No phone approval or merge yet.

Review correction: scoping only the fade was not enough. The short-login path
can set `sage-flash-hold` while authentication is still pending, so the rise
must require `sage-cover-active` too. Both selectors now require a full jump.

The first CI run passed tests/build, Chromium feel and WebKit screenshots.
WebKit feel measured Floor to Phone at 112 ms against its 110 ms bar and failed.
That is a real failed check, not a browser crash. No threshold was changed and
no job was retried. The remaining check must be resolved before merge.

## Follow-up repair, 23 September

Jorge asked to address the login flash and laggy landing without removing the
arrival. The cleanup timer previously removed `signin-gone` before scheduling
React to remove the login form. That leaves an unsafe interval when React is
busy. The form now stays hidden until the commit that removes it. A local trace
shows the class staying through cleanup. Neither the before nor after recording
captured an exposed login card, so this is a repaired ordering defect, not a
claim that a recording reproduced every reported flash.

The full landing now prepares its first pose under the opaque cover, with its
existing animations paused for a paint opportunity. The next frame releases
the cover and motion together, and only then starts the cleanup clock. The
tunnel, easing, cards and round-up remain. Short sign-in and uncovered arrival
skip this preparation. Reduce Motion still uses the short path.

Two foreground recordings used the same fictional manager fixture at 1280 by
720. Before this change, the largest task after dashboard exposure was 228 ms.
Afterwards the 297 ms first-paint task was inside the covered preparation
interval (5,563 to 5,938 ms after the press). The largest recorded task after
motion started was 133 ms. This moves work behind the cover; it does not remove
all of it. One sample per version, recorder overhead and the embedded browser
make these diagnostic observations, not an improvement percentage or device
frame-rate claim. The recorder now reports preparation and motion separately.

No console warnings or errors were captured. The final dashboard and round-up
rendered, and signing out returned the form normally. New regression tests
cover the two-frame preparation, cancellation, short-path exclusion and keeping
the form hidden through timer cleanup. The remaining landing stalls still need
profiling. This is not a declaration of 60 fps, much less 120 fps. The preview
still needs Jorge's iPhone check before merge.

The follow-up repeat-login check did reproduce an exposed login card for about
122 ms. Unlike the first-login recordings, this is a captured flash. The short
path inherited `jumpLanded = true` from the previous session and did not own its
entrance. Both paths now reset the latch and take ownership before branching;
short-path cleanup releases that ownership too. A regression executes the
actual short path starting with the stale latch. The final local suite has
643 passing tests and the mock build passes.

Final browser coverage: sign-in, sign-out, repeat sign-in and saved-session
refresh complete. Later recordings ran at roughly one frame per second despite
the page reporting visible, even after explicitly bringing it forward. A full
arrival hit the existing one-second cover safety escape. These later recordings
cannot establish frame-level absence of the repeat flash or smoothness and are
excluded from performance evidence. The local feel attempt stopped at browser
launch because no Playwright executable is installed. Hosted browser checks
and a foreground phone recording are still required; nothing was retried in CI
and no timing bar was relaxed.
