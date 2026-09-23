# Login lightspeed comparison

Proposal only, 23 September 2026. Open http://127.0.0.1:49210/ while the
local comparison and fictional-data servers are running. This is not deployed
to production and does not change either application source file.

## Decisions

1. Approve, adjust, or keep current: hold scrolling through the landing, reserve
   the scrollbar's space, and suppress accidental hover cards until the person
   moves their pointer or interacts after landing.
2. Approve B, adjust B, or keep A's motion: a shorter outward flight with less
   rebound. The tunnel, Sage mark, white cover, colors and final dashboard stay.

The page has a control for each decision. Those selections stay on the page;
they are not submitted or applied. Jorge communicates the choice in chat.

## What is being compared

### Creative follow-up: C, Through the light

Jorge asked for a more creative direction after seeing A and B. C keeps both
for comparison and adds a destination-like arrival: foreground blocks approach
together from 78% scale, with a shared 40 ms delay rather than the distance
stagger. Their travel is 20% of the existing radial vectors, overshoot is only
0.6% of each vector, and peak scale is 1.003. The background stays full-screen
and settles from a shallower 32 px descent. One translucent green-white scan
passes downward in 860 ms, once, and disappears. No blur, repeated flicker,
new particle system or animation library. The scan is a separate decision.

The first C draft scaled the whole app. Browser replay showed pale borders
around the shrinking backdrop, so that was removed. C now moves only the
foreground. Reduced Motion disables the scan and background motion and uses
an opacity-only radial keyframe. No device motion setting is overridden.

At 778 px the corrected full C replay held body width at 763.200 CSS px
through release, with no sampled unlocked landing frame. Full replay and
landing-only replay both returned to Ready to replay. B and C settled captures
were compared together at 778 x 698 and retained the same finished layout.
The browser also recorded two timed-out reads of the fictional floor row;
they did not stop playback, but this is not a clean-console claim or a claim
that the local data harness has production-like timing. See design-qa.md.

The application build remains unchanged. All changes live in this proposal.

A uses the existing radial motion with preview-only scroll and hover repairs.
B adds alternative keyframes, using the same animation names and the same
animation list ordering so the underlying cardIn does not restart at cleanup.

| Detail | A | B |
| --- | --- | --- |
| Initial element scale | 0.10 | 0.42 |
| Initial radial travel multiplier | 0.94 | 0.65 |
| Travel beyond final position | 10% of vector | 1.5% of vector |
| Largest element scale | 1.06 | 1.012 |
| Whole-page starting scale | 1.022 | 1.008 |
| Radial duration | 680 ms | 680 ms |

This is a smaller, firmer arrival, not a faster authentication claim. The
existing distance stagger, worker tunnel and covered preparation are unchanged.

Full replay uses the actual app's login handler and the existing mock backend.
Only the local mock auth entry is reset. The demo's daily round-up is marked
read so it cannot cover the comparison. Landing only invokes the existing
Replay intro control; it deliberately does not include the tunnel or cover.
One iframe runs at a time, and no package was added.

## Evidence

- Full local suite: 657 tests passed. Build passed with the existing large-chunk
  and PDF dependency warnings.
- Actual browser: A full sign-in, B full sign-in, B landing replay, repeated
  sign-in, narrower manager view, and 390 px control/layout check.
- At 1280 px, A and B both held body width at 1264.800 CSS px through the full
  sign-in, landing and release. No sampled landing frame unlocked scrolling.
- At 778 px, B held body width at 763.200 CSS px through release, also with no
  sampled unlocked landing frame.
- No warning or error entries returned by the connected browser check.
- At 390 px the proposal document's scroll width was 390 px. Its controls and
  the app's existing mobile manager layout remained accessible.
- Initial harness defects fixed before handoff: the daily round-up covered the
  result; landing replay targeted an aria-label the button did not have. The
  width recorder originally read documentElement.clientWidth, which changes
  when a classic scrollbar is painted even with a reserved gutter. It now
  measures the actual body layout and includes the post-release measurement.
- The first test run failed because Node fetch normalized the Host header used
  by a server guard test. The test now sends a real HTTP Host header; the guard
  itself was not loosened.

These are browser samples, not a 60/120 FPS claim. Screenshot capture adds
overhead. This does not establish iPhone Safari performance or phone approval.
The existing local feel harness remains unavailable because this machine has
no installed Playwright browser. No browser was downloaded and no check limit
was changed. Reduce Motion is read from the device and not overridden; this
session's live setting was full motion, so reduced-motion playback is not
claimed visually verified.

## Basis

- [MDN: scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter):
  reserve classic-scrollbar space rather than shift the content when it returns.
- [Google: high-performance animations](https://web.dev/articles/animations-guide):
  use transforms and opacity; no new per-frame layout animation or particle library.
- [Apple: Motion](https://developer.apple.com/design/human-interface-guidelines/motion):
  make the arrival purposeful and preserve the reduced-motion path.

## Run again

Build with VITE_SUPABASE_URL=http://127.0.0.1:5433 and
VITE_SUPABASE_ANON_KEY=mock-anon-key. Start scripts/mock-supabase.mjs with
SALESPERSON=0, then run scripts/motion-compare.mjs dist 49210. The comparison
server binds only to loopback, rejects a non-mock bundle, refuses write
requests and prevents a service worker from being installed on this origin.

No application change should be copied out of this harness until the two
decisions are recorded. An approved repair needs application-owned lifecycle
cleanup, regression coverage, CI in both engines, Claude review and Jorge's
phone check before merge. This local injection is a proposal, not that repair.
