# lead-performance-calculator
## Checks

- `npm test` runs the unit tests, including `test/feel.test.mjs`, which holds the phone's feel in the source: no control greyed out for a round trip, a curtain of one quick sweep, taps committed before the server answers, rails that spring on transform.
- `npm run check` runs the tests and a build.
- `npm run feel` measures the phone in a real browser against the local mock (`scripts/mock-supabase.mjs`), with a dealership's 400 ms on every data request, and fails over the bar: a tab under 150 ms, a tap drawn under 100 ms, two taps in one round trip ending on the second, a press that gives under the finger with one tick, a return sign-in in about a second. The header of `scripts/feel.mjs` says how to set it up.
