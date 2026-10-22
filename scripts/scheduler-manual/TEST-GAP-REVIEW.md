> Historical preparation record. Result filenames and temporary cluster paths below refer to external local evidence, not files promised in this carrier. Current portable verification and limitations are recorded in `docs/scheduler-carrier-readiness.md` and `docs/scheduler-carrier/verification.json` (repository-root paths). Historical counts do not certify this assembled tree.

# Focused baseline test-review follow-up

No implementation or authorization policy changed. pg installation remains pending. No browser execution.

Confirmed codec gap: the old refusal test compared an untouched planner rather than the object sent to codec.encode. It could pass even if the codec mutated the rejected input. The revised test snapshots the actual malformed argument and asserts it unchanged for encode and decode; structural failures also cover verify. Separate tests establish that verify validates the document's own scope, while encode/decode enforce caller-supplied scope. Valid output must be detached from subsequently mutated input. Nine focused tests passed.

Race inventory before additions:
- relational/run-sql already observes blocked active-profile, employee-link and publish-grant revocation. These were not duplicated.
- manual SQL already denies pending accounts sequentially and revokes a manager during capture, but those are not profile-lock pending/role/store-narrowing races.
- source-capture SQL already tests coherent source snapshots under in-flight writes and lock ordering. Baseline scheduler-postgres integration also contains existing/absent snapshot-versus-write cases. These were not duplicated.
- Missing: draft snapshot authorization reads during pending/role/pilot-scope changes and publication replay during manager role/profile-store narrowing.

New manual SQL cases observe the revoker holding its changed row before starting the request, then observe synthetic-rpc blocked on a database lock before the revoker commits. They assert denial after commit and access restoration afterward:
1. Pending employee versus own published read.
2. Manager role narrowed to overseer versus publication receipt replay.
3. Manager profile stores removed versus publication receipt replay.
4. Manager pending versus draft snapshot read.
5. Manager role narrowed to overseer versus draft snapshot read.
6. Explicit pilot single-store scope retargeted away from the requested store versus draft snapshot read.

The final case intentionally uses pilot_scope.approved_store_ids, not profiles.stores: the existing draft-only contract uses explicit pilot grants. Own read remains based on approved active identity and unique linked employee/store, not invented role restrictions. Tests do not broaden policy or infer new expected denials.

Actual SQL results and cluster cleanup are in sql-results.json. Earlier full-suite totals are not rerun claims for this test-only delta. Current patch still requires release review; the independent Claude baseline audit was not review of this unpublished implementation.

## Actual focused verification (2026-10-22)

- Codec: 9 tests passed, 0 failed (`node --test test/scheduler-draft-codec.test.mjs`).
- Disposable PostgreSQL: 16 grouped checks passed (`node scripts/scheduler-manual/run-sql.mjs`), including all six newly observed authorization races. Same publication replay also succeeds immediately before and after the two publication authorization races.
- Cleanup: cluster `/tmp/sage-delivery-zf5Wpd` stopped; pg_ctl status exit 3; owned directory removed, as recorded in sql-results.json.
- Initial run: five new races passed, then the sixth fixture incorrectly used an empty approved-store list, violating the existing singleton CHECK. An unhandled promise rejection interrupted automatic cleanup. Cluster `/tmp/sage-delivery-Tdhn8X` was explicitly stopped, status exit 3 verified, and removed. Fixture now uses a different valid singleton store. Immediate rejection handlers preserve later error propagation and allow runner cleanup on barrier failure.
- Independent reviewer `/root/independent_relational_review` read the test-only changes, identified the singleton fixture defect, then re-reviewed the corrections and found no remaining narrow blocker. Reviewer did not author changes or run tests. Its remaining note: the 1.5-second barrier window can fail under load, but cannot pass without an observed blocked request.

No driver installation, browser run, hosted request, live access change, or upload occurred. Existing full-suite missing-pg failures remain unresolved; these focused results do not supersede them or prove hosted/native/five-second delivery.
