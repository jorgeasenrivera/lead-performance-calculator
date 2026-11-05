# Native action readiness checks

From the repository root, ordinary Node regression tests run with:

```sh
node --test native/test/readiness.test.mjs
```

They are also discovered by `npm test`. They need only Node and use its test runner, assertions and VM. They execute the current App.js bridge/flush callbacks with synthetic ports and an explicit hook model. They are not mounted React tests. Negative controls reconstruct the original stale callback and the rejected render-time readiness ref, so each regression has a failing counterpart. Extraction and transformations fail clearly if source boundaries change.

The separate mounted check uses genuine ReactDOM effects:

```sh
node native/checks/mounted-readiness.cjs
```

Prerequisites: installed React 18/ReactDOM development UMD builds from this repository's dependencies, installed Playwright, and an available Chromium executable. The script does not install or download anything. If Playwright is outside normal Node resolution, set `PLAYWRIGHT_MODULE` to its module path. To use an already-installed browser, set `CHROMIUM_EXECUTABLE` to its absolute path. Optionally set `READINESS_OUTPUT` to a new JSON output path; otherwise the script prints results and writes nothing.

Example with an installed system browser:

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium node native/checks/mounted-readiness.cjs
```

Thirty mounted runs compare current source with two negative controls. The checks cover delayed pending reads across readiness, early queue flush, commit ordering, late native storage, speculative rendering, Strict Mode, unmount/remount and event/pending collisions. Native storage and WebView injection are mocks; all browser requests are blocked. The isolated component mounts actual extracted hooks, not the full Expo app. ReactDOM coverage does not establish React Native, Swift/Kotlin, physical-device or real WebView compatibility.

The patch preserves two subscription setups/reads and one cleanup across ordinary false-to-true readiness, and three setups/reads with two cleanups in development Strict Mode. It fixes stale readiness without publishing readiness from an uncommitted render or dropping the recovery read.

Known limitations are intentional test observations, not fixes: duplicate event/pending collision still injects twice; no application acknowledgment, promise cancellation or durable recovery exists; native read/remove can lose an action after process death or dropped injection; account/store/day replay semantics are unchanged. No live endpoint, account, notification, credential or SDK is used.
