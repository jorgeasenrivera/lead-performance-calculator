# Desktop performance baseline

X21 measures the actual polished Manager production source at
`7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5`, not the old comparison study.
No application source, pixels, controls, timings, data math or dependencies
change. Nothing is wired into production or collected from real managers.

## What the probe records

At 1440 x 900 and 1920 x 1080, normal motion, three consecutive cycles:
Daily Activity, Live Floor, Phone Line, Performance, Summary, Dashboard,
associate card open/close, schedule/calendar hover and a scripted long-list scroll.
Each width uses both the normal local demo and a response-only fixture with
60 fictional sales associates. Reported store totals stay unchanged; the
larger roster is a stress fixture, not a truthful store report.

The clock starts inside the page's capture-phase click or pointer event,
not before Playwright finishes finding, scrolling to and clicking a control.
Scrolling starts its own clock in the same page callback. No external sampler
polls the loaded page for frames. Each sample lasts at least 2200 ms, extending
until the destination lifecycle settles. A watchdog bounds missing completion
at 10.2 seconds and fails the flow, not a performance score.

- `contentMs`: first rAF observation of the destination marker having a box.
- `settledMs`: two frames with that marker present, the existing navigation
  classes cleared and the associate card not opening/closing. This is a
  conservative DOM lifecycle milestone, not proof of physical presentation.
- Frame median, p95, maximum and gaps over 34 ms: rAF scheduling intervals,
  not literal FPS or GPU dropped frames.
- Long tasks: clipped to the measurement window, unsupported means null.
- Long animation frames, when supported: duration, blocking time and script
  layout time, with bundle filename only. No URLs, tokens or names.

The browser APIs have different coverage. Long tasks alone do not account for
all rendering work. See the [W3C long animation frame specification](https://www.w3.org/TR/long-animation-frames/).
The harness itself reads one destination box per frame and can add measurement
cost. Use the same harness for before/after comparisons; do not treat these
numbers as field telemetry or a guarantee on Jorge's work computer.

Samples from a hidden tab, interrupted interaction, watchdog or incomplete
transition are unusable. No invented performance pass thresholds, no retries,
no lowered existing feel bars. Cold first-navigation and warm cycles remain
separate in the raw results. Browser context, viewport and fixture are recorded.
The scripted scroll is repeatable, but not a wheel/trackpad latency test.

## Running it

CI checks out the exact Signal commit in a second directory, builds it against
the in-memory mock and runs Chromium and WebKit. Service workers are blocked
for fixture isolation; cache/update behavior is not measured. All browser HTTP
requests are limited to the local app and mock origins. No live credentials.

The workflow keeps `results.json`, screenshots and server logs on success or
failure. Unit tests guard percentiles, overlapping task windows, unsupported
APIs, event-clock start, readiness, interruption, background tabs, cleanup and
fictional roster mapping.

For a local manual check, build the pinned source against a separate local mock
on 5434 if 5433 is already occupied, then serve that directory with:

```text
node scripts/desktop-baseline-server.mjs <mock-build-directory> 49218 --clicks
```

The server refuses a production-connected build. The in-page samples are in
`window.__desktopProbe.samples`. Manual clicks capture a 2200 ms window.
This is diagnostic, never a shipped app script.

## Evidence and next decision

Measurement results are pending. A probe being written or a source review is
not a measured improvement. Local Playwright is not installed on Jorge's work
computer; no download is attempted. The connected browser supplies local spot
checks, and CI supplies the repeatable browser matrix.

Local foreground spot samples at 1440 x 900 on 2 October: Daily Activity
content marker at 578 ms, lifecycle at 1279 ms, largest rAF gap 100 ms,
three long tasks; first Floor visit content at 1952 ms, lifecycle at 1992 ms,
largest gap 250 ms, five long tasks. No hidden-tab flag. These are single
normal-roster observations, not the repeatable matrix or a claimed improvement.
The prior local origin served an older cached diagnostic HTML page; a fresh
origin supplied the current probe. CI blocks service workers to avoid that.

After the baseline is verified, select the biggest measured cause. Any fix in
Manager stays on its sole owned branch. Pixel-identical internal work can be
reviewed directly; changed motion or presentation still needs the project's
published proposal. Calendar activation and phone visual release gates stay
separate.
