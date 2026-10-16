# Desktop and cross-month import review fixes

Starting head: 356721cd3cb9d5d20f3af33991e626346460a77c.

The desktop calendar now receives a 1.6:1 share beside the roster. At 1440px and ordinary text, the geometry probe requires a side-by-side calendar and sticky roster, while checking every Delivered strip for single-line containment and equal dimensions. Existing width/font reflow remains in place for narrower layouts and larger text. No threshold or fit assertion was weakened.

The prior importer evaluated conflicts only on the imported dates. The exact Cedar reproduction uses Alex 1, December 2026 cap 8, December 31 manual 09:00–17:00, January 2027 cap 40, and a January 1 import of 09:00–09:01. The regression test fails against the previous importer because it incorrectly allows the import. It passes against the fix. The retained reproduction log is an expected failure of the prior source, not a current failing check.

Review now evaluates before/after conflicts on all dates in complete affected Monday–Sunday weeks. Each date uses its own monthly settings, so a higher cap in the imported month cannot excuse an invalidated existing shift in the neighboring month. Newly introduced or worsened conflicts on existing assignments are attached to the responsible imported work rows. Atomic Apply remains blocked until those rows are resolved or explicitly skipped. Unrelated, unchanged existing conflicts do not block another person's import.

Unit coverage includes both import directions across December/January, either monthly context having the lower cap, atomic no-change, explicit skip recovery, and an unrelated existing conflict. Browser reproduction checks the visible December conflict, disabled Apply, cancellation with no January assignment, skip recovery for an unaffected person, and preservation of December's manual assignment and 8-hour cap.

Fresh browser matrices cover Delivered geometry (24 cases), import flows (12 cases) and the exact cap reproduction (2 cases). The import cases retain zero-network and zero instrumented Storage/IndexedDB/beacon assertions. Screenshots use fictional data only.

Limits remain: text scaling is root-font scaling, not physical browser menu zoom; no physical-device or screen-reader session; protected hosted rendering depends on the environment proxy. No production modules, database, persistence, credentials, permissions, writer claims or production deployment changed. Older evidence folders describe their own historical runs.
