# Desktop board profiling

X22 follows the independently accepted X21 desktop baseline. Jorge selected
desktop first and authorized this investigation on 2 October.

The target is the actual Signal source at
`7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5`. No app file, dependency or motion
changes. The immutable accepted driver at `abcc33d` supplies every fictional
fixture, isolation/readiness guard and lifecycle sample. Five exact in-memory
driver hooks attach diagnostics. A SHA-256 guard rejects a changed driver.
The accepted runner is never edited and remains the unprofiled speed baseline.

The profile covers Performance, associate opening and scripted scrolling at
1440 x 900 and 1920 x 1080, demo and 60-sales rosters, three cycles each.
That is 36 profiles. Chromium supports the required diagnostic protocol;
WebKit's accepted baseline remains separate, not a fake Chromium substitute.

## What this can establish

CPU sampling supplies approximate self-time at generated function positions.
Original numeric samples/deltas are retained. Chrome can deliver samples out
of timestamp order; cumulative timestamps are validated against the profile
window, then timestamp/sample pairs are sorted together, as in
[Chrome DevTools](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/cpu_profile/CPUProfileDataModel.ts).
No sample is dropped or negative delta clamped. Approximate weights use each
ordered sample's interval to the next sample, with the last tail to profile
stop. The unobserved interval before the first sample is reported separately.
This final-tail estimate is explicit, not a claim to reproduce DevTools' full
profile model or an exact executing-function duration.
Hidden local source maps identify original source files and positions. A plain
build is served; its JavaScript, CSS and HTML must match the mapped build
byte-for-byte before any profiling. Neither maps nor diagnostics ship.

Timeline evidence carries event name, start, duration and thread IDs only.
All event arguments, network headers, text and URLs are discarded. CPU URLs
become local bundle filenames; arbitrary function names are bounded/filtered.
Local fake services are the only permitted browser network destinations.
No real store, login or live service is accessed. Trace/event and CPU caps are
20,000; loss or incomplete recording fails evidence validation, not a speed bar.

Per-category timeline durations union overlapping events on the renderer main
thread. Categories nest, so their totals must not be added together. A missing
main-thread marker means unavailable evidence, never zero paint/layout cost.
Performance counters are deltas; absent or reset counters are null.
Duration counters retain the protocol's seconds; timeline and CPU summaries
are explicitly milliseconds.

Profiles start before the driver prepares the interaction and stop after its
complete lifecycle sample. They include automation preparation and diagnostic
overhead. Their times are not comparable to unprofiled baseline times, literal
FPS or real-manager latency. CPU samples can miss short functions. Main-thread
painting is not GPU presentation. A source position is a profiling lead, not
proof that a function should be changed or that a CSS effect is unnecessary.

Each recording waits for the trace's terminal buffer before saving. Invalid
or aborted diagnostics remain in the artifact alongside the driver's partial
samples, failures and screenshots. The final report requires all 36 valid
profiles and all four original driver cases before drawing a target conclusion.

Protocol references: [CPU profile](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/),
[tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/),
[performance counters](https://chromedevtools.github.io/devtools-protocol/tot/Performance/).

## Result and next decision

The first profiling run, `37038369663` at `d59ff02`, failed with `invalid CPU
samples` on the first Performance recording. Its artifact retained invalid
status and a complete loss-free trace, but not the rejected numeric CPU
samples. That observability gap is corrected: failure records now retain
bounded numeric node IDs, sample IDs and time deltas, with specific validity
errors. This is evidence collection,
not a retry to get green or proof of an app defect. Regular CI at that head
passed in run `37038369699`.

Run `37039822921` at `c740bba` then isolated the failure: 71 negative
deltas among 3,105 samples, zero unknown node IDs, zero non-finite deltas and
zero cumulative timestamps outside the profile window. My nonnegative-delta
assumption was wrong. The reader now validates and sorts timestamp/sample
pairs without losing their associations. Missing IDs, non-finite times,
out-of-window timestamps, caps, incomplete coverage and lost traces still
fail. Both failed artifacts remain evidence, not accepted profiling results.

Evidence is pending. Board evaluation repeats in ranking, filtering, sorting,
counts and row construction. That is a source hypothesis, not the established
cause of the measured desktop delay. Profiles distinguish script cost from
layout and paint before a fix is chosen. No app performance improvement is
claimed by this diagnostic PR.

Any later application change stays on X11's sole owned Manager branch. A
pixel-identical internal refactor can proceed through review; different pixels,
controls or motion first need the published proposal required by AGENTS.md.
Calendar activation, production release and physical-phone approval stay
separate. Local browsers are not installed on Jorge's work computer; CI supplies
the official browser image without a local download.
