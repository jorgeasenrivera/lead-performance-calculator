# One continuous arrival

## Revision 2: a stronger flight, same destination

Jorge selected Adjust for launch/landing, Adjust for recovery and Approve for
the CRT scan. His follow-up clarified that recovery felt too plain and detached
from lightspeed. Those selections were read from his open preview, not inferred.

This revision keeps the scan and the final dashboard. Changes remain inside the
isolated proposal build:

- The actual logo stays visible until the canvas reports its first painted frame.
  Previously the real logo and ground dots were hidden during the 320 ms hurry
  lead, before their canvas replacements existed.
- The sideways dot kick and bowed downward gathering path are gone. A shorter
  anticipation leads into a 720 ms straight pull toward the smaller launch mark.
- The form starts receding at the opening beat instead of waiting for the gather.
- The existing field fades into Sage's deep green as its own dots brighten.
  Streak length follows distance, with the inner quarter kept clear instead of
  every streak turning into a spoke through the centre. Particle count, canvas
  count and pixel density have not increased. The new gradient is cached once.
- Recovery fades over the actual stopped flight. Its final canvas frame remains
  even when the application unmounts its failed login. Retry and Cancel unload
  that iframe and its retained frame. Reduced Motion uses a solid quiet ground.

Visual QA caught two issues in the first refinement: burst trails converged into
long spokes, and the app's failed-login cleanup removed the recovery backdrop.
Both were corrected before handoff. Final Interrupted capture had one retained
canvas, no landing timestamp, no underlying error-page bleed, and legible controls.
678 tests and the proposal and normal builds pass. The existing device-performance
and physical-iPhone gaps below still apply. More contrast is a visual choice for
Jorge to judge, not a measured frame-rate improvement.

Final Slow check: waiting at 5012 ms, prepared at 5318 ms, landing at 5705 ms,
completed at 7210 ms. Body width stayed at 763.2 px; no unlocked landing frames.

---

Proposal only. Open http://127.0.0.1:49211/ on Jorge's computer while the
local preview and fictional-data server are running. Nothing has been deployed.

## The experience

The actual Sage wordmark gathers into its launch point. The existing background
dots become the streaks. The destination label settles without its previous
continuous wobble. The dashboard is built during travel, beneath the cover.
Successful store data, a mounted dashboard, loaded fonts, decoded header images
and two layout frames must all precede the landing.

If the destination takes longer than the cruise cap, drawing stops and a clear
waiting screen takes over. The white cover is for the handoff, not an indefinite
loading screen. A failed load never deliberately reveals an empty dashboard.
The foreground lands together using proposal C's restrained inertia. The ground
stays full-screen and one soft scan passes downward.

Three decisions on the page: the shorter launch and unified landing, the waiting
and recovery states, and the one-time scan. Choices are not submitted anywhere.
Jorge approves or adjusts them in chat before implementation.

## Try it

- Fast uses the real local mock requests with no added delay.
- Slow delays the initial store-connection window by four seconds, not every
  sequential follow-up read. Once that window ends, requests flow normally.
- Interrupted returns HTTP 503 for store reads. Restore connection & retry
  starts a fresh Fast preview. It is a simulated recovery, not a network repair.
- Cancel unloads the preview. Replay starts a fresh ordinary mock sign-in.
- Reduced motion can be previewed in the notes. This option cannot turn off the
  device's own Reduce Motion setting. No tunnel or scan plays on the short path.

## Isolation

`scripts/arrival-prototype.mjs --build` uses exact, checked in-memory transforms
on the core source during a separate Vite build. It never writes to `src/`.
Output is `dist-harness/arrival-prototype`, not the normal production directory.
The server refuses bundles without both the mock address and proposal marker.
It binds to loopback, rejects writes and foreign Host headers, and does not serve
a service worker. The iframe clears only its local mock auth and cache keys.

Run the existing `scripts/mock-supabase.mjs`, then the build command above,
then `scripts/arrival-prototype.mjs`. No package or browser download was needed.

## Verification, 23 September local time

677 repository tests pass, including seven new proposal tests. The separate
proposal build and the unchanged normal application build both pass. Existing
large-chunk and PDF dependency warnings remain.

Connected Chromium browser at 1280 x 720:

| Scenario | Evidence |
| --- | --- |
| Fast, initial capture | Dashboard prepared at 3789 ms, landing at 4473 ms, finished at 6038 ms |
| Slow, corrected simulation | Prepared at 4983 ms, landing at 5352 ms, finished at 6902 ms; waiting state before reveal |
| Interrupted | No data received, no prepared or landing timestamp; recovery screen at 4699 ms |
| Retry after interruption | Prepared at 2666 ms, landing at 3257 ms, finished at 4703 ms |
| Reduced motion | Prepared at 1108 ms, landing at 1203 ms, finished at 1596 ms; scan computed display was none |
| Cancel | Iframe unloaded and status said preview stopped |

Body width stayed at 1264.8 CSS px with zero unlocked landing frames in these
samples. These are single-run observations, not frame-rate benchmarks.

The first Slow draft delayed every matching request separately. It reached the
dashboard but a later store load exceeded the app's 12-second protection limit.
That was a simulation defect, not hidden or called a pass. The corrected shared
delay window reached the dashboard without that warning or a new console error.
Interrupted intentionally produces failed-read logs. A successful initial Fast
run had no captured warnings or errors.

The normal `feel` browser harness was not run: this workstation has no local
Playwright package/browser installation. The connected-browser checks above are
not a substitute for its Chromium and WebKit performance bars. No new packages
were installed on Jorge's work computer.

## Before this can ship

- Jorge decides the three proposal items.
- Move the approved behavior into normal application code, with React-owned
  readiness and error state instead of this disposable preview's DOM observer.
- Bound and clean up the engine's waiting scheduler and all readiness resources.
  This prototype stops canvas drawing while waiting, but its scheduler still ticks.
- Preserve actual auth, offline-cache and store-mismatch recovery. Only a store
  request interruption was simulated here, not every auth or asset failure.
- Measure cold and warm sign-ins, CPU pressure, main-thread fallback, reduced
  motion, rapid cancellation and retry in Chromium and WebKit.
- Five minutes on a real iPhone and a typical office PC before a visual merge.

An animation can conceal normal preparation. It cannot promise to hide every
network or hardware failure, and it must never pretend failed data is ready.
