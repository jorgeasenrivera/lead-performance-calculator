# lead-performance-calculator
## Checks

- `npm test` runs the unit tests, including `test/feel.test.mjs`, which holds the phone's feel in the source: no control greyed out for a round trip, a curtain of one quick sweep, taps committed before the server answers, rails that spring on transform.
- `npm run check` runs the tests and a build.
- `npm run feel` measures the phone in a real browser against the local mock (`scripts/mock-supabase.mjs`), with a dealership's 400 ms on every data request, and fails over the bar: a tab under 150 ms, a tap drawn under 100 ms, two taps in one round trip ending on the second, a press that gives under the finger with one tick, a return sign-in in about a second. The header of `scripts/feel.mjs` says how to set it up.
- The same measurement runs on every push and pull request (`.github/workflows/checks.yml`, the `feel` job), in Playwright's browser image so the numbers come from the same machine every time. On a pull request the table is posted as a comment, so every diff says what it did to the phone.
- In the field, the phone reports how fast it felt: INP (the slowest tap on a page), LCP (the first screen's paint) and CLS (whether anything jumped) go to `public.app_vitals` through `/api/vitals`, each with the build, the room and the store (`src/report.js`, `reportVital`). Vercel's Speed Insights gets the same numbers by route for its dashboard, once it is switched on for the project.
- The motion is written down as tokens (`--t-press`, `--t-release`, `--t-exit`, `--t-swap`, `--t-settle`, `--t-wipe`, and `MOTION` in the script). A new surface uses these, not a number; `test/feel.test.mjs` holds the two copies together.
- The type is the app's own: Geist, Geist Mono and Space Grotesk are served from `public/fonts` and kept on the phone by the worker, so a lot with no signal still draws Sage in Sage's faces.
