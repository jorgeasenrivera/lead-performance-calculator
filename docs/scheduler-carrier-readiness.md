# Disabled manual scheduling carrier

This is a new local tree based directly on main25d821a6d0a8e3c9b4a700cc5845c574e1c9b837. It assembles selected code from candidate2861377737f2e04a1d7d462793010f2f2e6085c1 and the locally reviewed manual milestone. It does not merge PR485 or PR492, and does not rewrite shared history. Preparation branch is codex/scheduler-carrier-main-local; the only proposed publication branch is codex/scheduler-published-delivery-local, whose deployment guard remains false.

## Why this is larger than a manual-entry form

The75candidate-only commits are source provenance, not75commits being merged. Their scheduler changes include the mountable month editor and People/Hours/Teams setup, immutable C113 drafts, strict codec, draft recovery/leave guards, authenticated store/load lifecycle, shared validation and preview/test infrastructure. Manual scheduling reuses these rather than replacing validation with a toy implementation. Their import/generation/history modules remain shared editor dependencies; automatic generation/forecasting is not enabled by this milestone.

The new publication slice adds explicit dated shifts, immutable publication context, active-approved own-read, refresh, source snapshot/CAS, owner-only policy artifacts, disabled app entry points and synthetic tests. Nothing installs those SQL artifacts automatically. The unrelated observed-sales dashboard enhancement in the fictional preview was removed by exact source-backed reversal.53archived preview screenshots/diagnostics and24local prototype/generated artifacts from the earlier inventory are excluded; refresh.mjs and its direct tests are retained because the actual salesperson component imports them. See lineage.json for all75source commits and exclusions.

All26main-only coordination commits are preserved: original main docs/handoff.md and docs/in-flight.md remain exact prefixes, with a new local scope note appended. No existing owner claim is erased.

## Overlap and ownership

PR494 atb6cd4798 is an ancestor of the source candidate, but targets the old integration branch. PR485 at5bcddfa3 remains an open divergent draft and overlaps Manager.jsx, manager-spacing.yml and scheduler-performance/build.mjs. PR492 at0fcfb0c0 remains an open divergent draft and overlaps ten storage/verification/config paths. Neither PR is marked merged or absorbed. Before any later merge, coordinate these overlapping owners and resolve against then-current main. This carrier is not permission to land their separate policy/presentation decisions. AdminOverview/sales totals and existing non-scheduler APIs are unchanged from main.

## Disabled behavior and live limits

MANUAL_SCHEDULER_ENABLED is hardcoded false. Both public scheduler endpoints return unconditional503; environment credentials cannot inject their factories. The legacy calendar retains its explicit build-time flag. All three branch deployment guards remain false. Preview credentials are shared according to parent metadata, so protected Preview must not be treated as isolated. No Preview is visited here.

The existing build command is vite build, with no added automatic database/grant/ingest/migration hook. Tests use synthetic adapters; local database scripts require explicit execution. Real local pg transport checks establish neither hosted RLS nor production capture-executor permissions. Endpoint/pilot activation, hosted migrations/grants, credentials and production rollout remain separately gated.

## Verification and evidence

Current assembled-tree results are in [verification.json](scheduler-carrier/verification.json). Historic result paths in preparation documents are external local evidence, not bundled files or current acceptance. The mandatory binding fixture remains exactb6cd4798 and missing history fails. The191-file carrier manifest pins runtime sources/imports/SQL; its base field identifies the source candidate, while lineage.json identifies actual main assembly base.

No browser is run locally. Future browser acceptance must use a reviewed same-repository synthetic localhost CI setup, actual manager and employee clients, real publish acknowledgement and rendered revision timestamps from one controller clock. Existing scheduler baseline probes and sales CI results do not prove manual delivery or <=5seconds. Hosted/native/two-device behavior remains unverified.

## Final local result

Selected-tree full suite:1763tests,1762passed,0failed,0skipped,1existing TODO. Mandatory fixture20/20; carrier23/23; Vite build passed with envFile:false and synthetic environment. A separate fake-populated-credential check confirmed both default handlers return503 without inspecting the request, the client remains OFF and no fetch occurs. This checks synthetic variable presence, not real Preview configuration. Independent cumulative read-only review found no new blocker. No browser or hosted runtime acceptance is claimed.

Ready for review and a separately directed safe disabled publication on the exact guarded branch, not activation or merge. PR485/492 overlapping ownership remains unresolved for a future merge, with all their prior claims retained. The local carrier commit has current main as its sole parent; original75-commit scheduler ancestry remains provenance in lineage.json, not rewritten or force-pushed history.
