# Manager performance: first batch

21 September 2026. X2, approved after the manager optimization audit.

## What changes

Five lines come out of `StoreHero`: three unused `useCountUp` calls and their
comment. Their values had no readers. They still scheduled frames and set
state on the whole hero, whose passive effect copies the tube after each render.
Visible `CountUp` components elsewhere remain. The CRT snapshot and scan code
remain byte-for-byte unchanged. No styles, data paths or motion timings change.
The intended pixels are identical; the settled hero's entire `outerHTML` and
text matched exactly between the two builds in the local browser.

Do not optimize the snapshot effect's dependency list in this patch. It needs
to preserve the complete previous picture, including edits unrelated to sold
units. Restricting it to the sold count without testing those states would be
a different, riskier change.

## Repeatable local recorder

`scripts/manager-performance.mjs` serves a production build on loopback and
injects a probe into its HTML response only. It does not edit built files and
is not imported by the app. Build with the README's local mock URL and key,
then run the mock **without** `SALESPERSON=1` for a manager account:

```sh
node scripts/mock-supabase.mjs
node scripts/manager-performance.mjs dist 49175
```

Open the printed URL and sign in with the README's demo credentials. The
hidden `#manager-performance-results` element contains JSON after the hero
lands. It counts tube clones from mount through 2.2 seconds after reveal,
records their synchronous copy time, and samples animation-frame intervals
and supported long-task entries during that reveal window. Reload for another
sample. It restores the native clone method and stops sampling afterwards.

The frame clock measures callback intervals, not GPU presentation or proven
dropped frames. Samples that report `hidden: true` are unsuitable for frame
comparisons. Keep viewport, fixtures, build mode, hardware and workload fixed.
The local server deliberately does not emulate Vercel API routes. Do not use
it to validate server behavior or production request latency.

## Evidence and limits

Baseline application: `00300ca`. Both builds used identical demo data,
1280 by 720, Windows in-app Chromium 153, normal motion. Three samples per
build: first login, then two signed-in refreshes. No CPU throttling.

| Sample | Baseline tube copies | After | Baseline copy time | After |
|---|---:|---:|---:|---:|
| First login | 14 | 3 | 11.0 ms | 4.7 ms |
| Refresh 1 | 8 | 2 | 6.7 ms | 2.4 ms |
| Refresh 2 | 5 | 3 | 8.4 ms | 2.5 ms |

The hero contains 257 descendants in both builds. The DOM comparison is
stronger evidence of unchanged hero output than two screenshots taken at
different points in the ambient animation. Screenshots were also inspected.

These runs establish less copying, not a percentage improvement in overall
speed. Frame timing was noisy and slow: the first-login median was 66.6 ms
before and 67.0 ms after; the first refresh was 49.9 ms and 50.2 ms. Long tasks
remain. This is not a 60 fps pass, and not evidence about an iPhone. Do not
promote desktop WebKit or a narrow Chromium viewport to real-device evidence.

The remaining baseline work needs an ordinary computer browser and a real
iPhone Safari timeline, larger-store fixtures, repeated navigations, and
network conditions representative of the stores. Login and navigation timing,
bundle splitting and paint-heavy effects are separate later batches.

## Checks

- Regression guard demonstrated failing before the five-line removal.
- All 598 Node tests pass after it, including the local recorder's path and
  response tests. Build passes with the existing PDF and chunk-size warnings.
- Local manager sign-in and settled hero verified against the demo mock.
- This Windows computer has neither Playwright's Chromium nor WebKit binary.
  The salesperson feel run needs its own mock mode, distinct from this manager
  probe. Browser checks that cannot run locally remain CI gates, not passes.
- No production backend was used or changed.
- Chromium and WebKit feel results and the second-reader review must be
  checked on the pull request before merge. No bar is loosened here.
