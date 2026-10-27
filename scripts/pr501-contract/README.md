# PR501 versioned fingerprint contract (v1, 119 rows)

Adds a check INSIDE the existing `manager-spacing` job, for ONE case only: a pull request from this repository whose head branch is
`codex/nov1-security-recovery-integration`. For that case the original-manifest step (which compares the 106-row manifest with the PR tree)
is replaced by this contract; the original 106 rows are still enforced, against the frozen #469 tree, inside the contract. Every other
event and branch runs the default guard exactly as before. `scripts/search-runtime.sha256`, `vercel.json` and all application files are untouched.

- `contract/search-runtime.pr501-final3-v1.sha256`: 119 rows = the 106 originals (89 unchanged, 17 rehashed) + 13 named additions.
- `contract/candidate.meta.json`, `original-search-runtime.sha256.reference`, `vercel.guarded.json`, `composed-scalars.json`, `composed.canonical.git.patch`: the exact inputs bound by the external contract digest.
- `validator/validate-candidate.mjs`: the validator, unchanged bytes.
- `ci-verify.mjs`: the runner (baseline exports, binding, pins, default guard, composed proof, exact delta, merge checkout).
- `workflow-insert.template.yml`: the one reviewed insertion into `manager-spacing.yml`, with pin placeholders.
- `DELTA.sha256`: sha256 of every file here except itself. The workflow pins its sha256 and checks all of them BEFORE any code runs.

The workflow supplies the pins and is the single bootstrap exception (independent diff review). The runner recomputes it: old blob 6d3044a4... plus the template
rendered with the supplied pins must equal the head file byte for byte. CI never claims the checkout equals the composed tree 15ad95a6bf8ce30a0bf81e6edf72752f93b62d00;
it proves checkout = composed tree + exactly this declared delta (including that one in-place workflow edit), and nothing else.

Routing is decided by one step that compares branch, event and repository CASE-SENSITIVELY in the shell (values come through env, never interpolated into the script) and outputs a fixed `contract=true` or `contract=false`; the default guard and every contract step consume only that output.

Each baseline is authenticated against the object database of its OWN dedicated checkout (a separate checkout does not add objects to the head checkout): the frozen #469 export against the frozen checkout, the main export against the main checkout, and the composed base against the 47757af checkout. The head repository is never the source of baseline objects.

`integration-delta.json` is the one reviewed map of the exact existing files the final fixture packet changes (tests, CI) and any exact new paths: for each existing path the old Git mode and blob (which must equal the composed final3 tree) and the new mode and sha256; for each new path its mode and sha256. No wildcards, no prefixes, no "other changes". It can never name a contract row, the original 106 manifest, `vercel.json`, the core / Manager / build pins, `scripts/search-runtime.sha256`, the workflow or anything under `scripts/pr501-contract/`; those are protected by the existing proofs. While its status is `PENDING` the runner refuses it. `integration-delta.mjs` evaluates it as pure functions; `integration-delta.test.mjs` holds the focused tests. The map is listed in `DELTA.sha256`, so the workflow and the runner both hash-check it before it is used.

Forward diagnostics (existing job only, no new job, no matrix, no permission, no `continue-on-error`): the workflow carries fixed-vocabulary annotations, a stage marker before checkout, hash, install, verify, build and measurement; the verify step keeps the runner's exact exit status and annotates only a closed class of it (`exit=0|1|2|3|other`); and a final `always()` step prints the fixed outcome words of the contract steps and the job (`success|failure|cancelled|skipped|unknown`). No step output, error text, URL or secret is ever read. The head workflow is the old blob 6d3044a4 plus three reviewed insertions (`workflow-insert.template.yml` with the five pins, `workflow-insert-measure.yml`, `workflow-insert-final.yml`) composed by `workflow-compose.mjs`; `workflow-compose.test.mjs` holds the pure tests.
