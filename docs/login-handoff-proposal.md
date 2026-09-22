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

636 tests and the mock build pass. The local feel attempt first rejected the
manager-only mock; after restarting the mock in salesperson mode, it stopped
because the installed Playwright package has no browser executable on this
work computer. CI must supply Chromium and WebKit. Slow and failed network
sign-ins and reduced motion still need browser coverage; cancellation and the
missing-cover fallback have deterministic tests. No phone approval or merge yet.
