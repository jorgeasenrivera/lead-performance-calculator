# Bounded WebKit diagnostic checkpoint

Source and remote head tested: `492037d419c0485fbb0815ef4e1bb68133c8040e`. Runtime remains `80611a8f82ed8359ad025cc48e5fe8f1d51b4bbb`. All 47 existing preview build files matched the saved deployment manifest before execution. This checkpoint changes evidence only. No application fix is justified by this run.

## Results

One case at a time, once each, in the requested order:

| Case | Target click duration from trace | Result |
| --- | --- | --- |
| Teams 320 px / 100% | First Apply 1,921 ms; validation Apply 222 ms | Full single case passed; prior timeout not reproduced |
| Imports 390 px / 100% | Workspace 1,644 ms | Full single case passed; prior timeout not reproduced |
| Delivered 720 px / 100% | Edit day 2,757 / 2,258 / 2,984 / 2,942 ms, in interaction order | Full single case passed, including both store-switch edits; prior timeout not reproduced |

Original assertions and 15-second teams / 12-second imports and Delivered action limits were retained. No force click, increased timeout, application patch, repeated successful matrix or concurrent browser run was used. Case selection was the only change to the original probe loops; diagnostic hooks surrounded target clicks. These scheduler probes are separate from green feel-webkit CI.

## Captured evidence and limits

Adjacent JSON files preserve case results, pre-click geometry, enabled/connected state, computed styles, viewport/scroll positions, dialog geometry, hit stacks and captured pointer/mouse/click/submit/focus/scroll events. Teams Apply and imports Workspace were unobstructed top hit-test targets before the clicks. Their event histories show the target click, submission where applicable, and focus returning to the day heading. Process samples were taken every second. `process-summary.json` reports lifetime-average CPU observations, not instantaneous CPU or proof of resource contention. No timeout, blocker overlay or browser crash was demonstrated in these runs.

Delivered removes the Edit day control on entering edit mode. The post-click locator snapshot therefore hit its separate 3-second diagnostic deadline. This did not fail the probe, but added delay between interactions. The action duration table uses Playwright trace start/end timestamps, excluding those capture delays. Event evidence for earlier Delivered clicks is retained in the next pre-click snapshots; a complete post-click snapshot for the final removed control is unavailable. Before snapshots can precede automatic scrolling, so an offscreen/clamped hit stack must not be interpreted as an overlay at the eventual click position.

Tracing and extra reads change timing. A successful instrumented run cannot clear a prior intermittent failure or establish its cause. There was no uninstrumented confirmation run and no retry-to-green loop.

Raw traces, API logs, process samples and exact temporary runner copies are retained privately at `/workspace/sage-webkit-diagnostic-evidence/`. The three trace SHA-256 values are in `summary.json`. Raw trace source and screenshots are not committed because an existing import fixture includes security-review input. No private reproduction details are published here. Linux x64, Node 24.19.0, Playwright 1.63.0, WebKit WPE build 2359, 4-core CPU quota; extracted local WebKit libraries and host-validation skip are inherited from the prior environment, not access changes.

## Recovery and remaining stage

The prior [recovery checkpoint](../review-corrections/RECOVERY.md) and its failures remain valid. Do not mark the full preservation matrices passed. Unexecuted cases from the stopped runs remain: teams 320/200; imports 390/200 and 320 at both text sizes; Delivered 720/200 and 390/320 at both text sizes. This bounded stage did not authorize or run those additional cases.

Next diagnostic stage, if requested: inspect these traces, then reproduce the original sequential probe history with per-action failure capture and a post-click page snapshot that does not re-resolve a removed locator. Capture a failing action before proposing any source fix. If that failure is reproducible, compare the same interaction on starting source `2ae0f14b106fc8ac6dea46dc5c7780ff48b6760f` in an isolated worktree. Do not widen limits or force clicks. Do not repeat successful matrices just to obtain a green result.

The protected preview remains unchanged: `dpl_5TKZdtxHGxxnbQKgmnVNmr2RVoMz`, metadata SHA `492037d419c0485fbb0815ef4e1bb68133c8040e`, https://lead-performance-calculator-6h6hyq2j4-jorge-asencio-rivera-org.vercel.app/. Hosted access was not retested in this bounded stage; the previous proxy block remains a gap. No production, merge, database, credentials, permissions, formal claims or deployment changes. No admission or execution blocker occurred.
