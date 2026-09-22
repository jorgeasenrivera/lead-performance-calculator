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
