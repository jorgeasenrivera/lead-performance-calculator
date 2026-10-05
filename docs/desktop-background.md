# Desktop backdrop write-scope experiment

X23 follows the completed X22 profiles and Jorge's request to continue desktop
work while fixing the trace-end regression. It changes no app file or approved
motion. Nothing in src imports this experiment. It cannot ship an override.

The actual Signal build is pinned at `7fdf5ae`; the immutable accepted fictional
driver at `abcc33d`, and the repaired CPU/trace recorder at `ec1ca53`. Five
profile hooks are unchanged. A single checked cohort anchor narrows this
experiment to 1920 x 1080 and 60 fictional sales. Both variants run all 30
original lifecycle interactions, with fresh isolated mocks and contexts. The
original network bounds, seeded identities, split-day refresh and readiness
assertions stay intact. Data is fictional, not a live account or store.

The browser-only setter wrapper intercepts exactly root `--bgy` writes. The
control sends the original value/priority to the original root setter. The
variant sends that same value/priority to the sole `.bg-live` node. All other
style writes pass through unchanged. Unexpected shells retain original behavior
but invalidate the scoped evidence. The original inertia coefficients, idle
schedule, colours, backdrop blur, animation durations and reduced-motion code
are not edited. Each browser/context owns its wrapper, so no other tab changes.

After each selected profile completes, one computed-style check verifies the
backdrop uses the requested value and preserves its translation-only matrix.
It never polls geometry during a timed frame. Counter deltas verify no writes
are lost and the scoped cohort performs no root/fallback writes. The scripted
scroll must actually exercise parallax. These are value/transform equivalence
checks, not full pixel or physical-motion certification.

There are nine profiles per variant, 18 total, with three cycles each for
Performance, associate open and scripted scroll. Both complete cohorts must
retain seed 10, 62 rendered rows, 45 completed split reads and zero page errors.
All recordings must be valid and required counters available; missing counters
are not zero. Original numeric CPU samples, source maps and trace loss/cap
guards remain. Plain/mapped assets must match byte-for-byte before comparison.

Root runs first, backdrop second. This is one ordered Chromium diagnostic
comparison, including automation and profiling overhead. Ordering, native
scroll work, geometry probes and backdrop blur can influence the counters.
It does not establish field latency, literal FPS, phone performance or a
released speed improvement. A later optimization needs a controlled unprofiled
before/after benchmark in both engines, review and visual/motion equivalence.

CI supplies the browser image because none is installed on the work computer.
The full flow is fictional sign-in, dense roster and split refresh, original
screen interactions, complete lifecycle/profile, write-scope/transform guards,
then retained evidence. No credential, Supabase schema, shared mock, data math,
calendar activation or dependency changes. The existing service stand-in is
reused unchanged. Supabase guidance reinforces keeping this experiment offline.

The first run stopped before its first selected profile: the init hook read the
HTML root before the parser created it. That was my diagnostic setup error,
not an app failure. The hook now observes document children until the root
exists, disconnects, and installs before deferred app code. A deterministic
early-document regression covers that ordering. Failed evidence is retained
in run 37045930890, artifact 11243459607. No result from it is a comparison.

The corrected startup run completed all nine root profiles but rejected backdrop
profile 3: the next Performance screen's replacement backdrop lost the prior
`0.0px` value. Its CSS fallback was zero, but the exact retention guard correctly
rejected the candidate. Source comments confirm the root was chosen to survive
shell replacement. Run 37046651010 and artifact 11244896168 retain the mismatch.
No complete comparison or speed result is accepted from it.

Both diagnostic variants now observe child-list changes, not style attributes.
The candidate transfers the exact last value and priority to a replacement
before paint, counting those restorations separately from app frame writes.
An already-connected backdrop skips the query and write. Deterministic guards
cover replacement and stable-shell behavior. This extra diagnostic observer
cost is included, and is not a proposed shipped implementation.

## Completed diagnostic comparison

Measured head `6f365d4364e1662fc28263e55e94cc3a203a74c4` passes the full
comparison in [run 37047666024](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/37047666024),
[artifact 11245382114](https://github.com/jorgeasenrivera/lead-performance-calculator/actions/runs/37047666024/artifacts/11245382114).
All 18 profiles, 60 original interactions, 45 split reads per variant,
seed 10 and 62 rendered rows validate. Page errors, trace loss, event caps and
root/fallback writes in the candidate are zero. Four shell restorations are
separately counted. Exact computed values and translations pass. Local artifact
revalidation reproduced the saved comparison. Standard run 37047666107 passes
tests/build, Chromium feel, WebKit feel and screenshots.

Mean style-recalculation counter deltas in milliseconds, three cycles each:

| Interaction | Root | Backdrop |
|---|---:|---:|
| Performance | 168.02 | 169.38 |
| Associate opening | 1489.01 | 26.82 |
| Scripted scroll | 1531.30 | 34.06 |

Dot's [final independent review](https://github.com/jorgeasenrivera/lead-performance-calculator/pull/467#issuecomment-5958929107)
on the measured head found no diagnostic blocker and separately inspected both
completed PR and push artifacts. The push run agreed qualitatively. These
ordered profiled Chromium measurements support investigating write scope. They
do not certify physical presentation, all pixels, touch, reduced motion or a
released improvement. The review includes no merge or deployment approval.

## Unprofiled verification, pending

The next bounded phase reuses the exact driver and build with CPU, trace and
performance-counter recording disabled. Its session cannot open CDP, including
in WebKit. Both Chromium and WebKit run root-first and backdrop-first orders,
with fresh browser, context and mock processes for every variant. Each order
retains all 30 original interactions and the same nine post-recording parity
checks. No checks, animation durations, windows or readiness bars are relaxed.

Evidence is separated by browser, order and variant. Each complete report needs
120 usable interactions per engine, all original labels/cycles, dense fixture
counts, split reads, zero page errors and exact parity. It keeps all six timing
values per interaction/variant, plus medians. Unavailable browser API evidence
stays null, not zero. rAF measures main-thread scheduling, not literal GPU FPS.
Automation, lifecycle probes, setter interception and matched shell observers
remain included, so this is not a real-device or field-latency claim.

The existing Supabase service stand-in stays unchanged and isolated. Fetching
the skill's changelog index was unavailable through the documentation tool.
No Supabase API, auth, schema or production feature is being implemented here.

## Proposed application boundary, not implemented

Any later application change belongs on X11's sole owned branch, after the core
file ownership is explicitly reconciled with C103 on the coordination board.
No application edits are part of X23. The narrowly scoped candidate is:

1. Keep the retained parallax value outside the replaceable shell. Register the
   live backdrop through its actual lifecycle, transfer the exact last value
   on replacement before paint, and unregister safely on teardown. Do not ship
   the diagnostic prototype override or document-wide mutation observer.
2. Change only where each inertia frame writes the existing value on verified
   non-touch desktops. Preserve the original phone/touch/uncertain-device and
   reduced-motion paths. Retain `0.15`, `0.07`, `0.4`, the terminal snap, 700 ms
   idle delay, 4000 ms wake, class ownership and all cleanup semantics.
3. Preserve shell swaps, navigation, card motion, colours, blur, glyphs, source
   data, search, recap holds, no-browser-writer safeguards and C103 flags. Do
   not change the application's source of store/date identity or save logic.
4. Verify lifecycle races and transitions, actual production renderer in both
   engines, reduced motion and desktop/touch boundary cases. Compare matching
   visual states and motion parameters before calling the refactor identical.
   Use the unchanged unprofiled baseline for before/after timing, not the
   profiler's counters as a release speed score.

If implementation changes pixels or motion, stop for the published per-item
proposal required by AGENTS.md. Any phone visual change still needs Jorge's
physical-phone approval. Review, exact-head green CI and release authority
remain separate gates.
