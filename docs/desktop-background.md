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

Evidence and review are pending. No application cause or improvement is claimed.
Any app change remains on X11's sole owned branch. Changed pixels or motion
need the published proposal required by AGENTS.md.
