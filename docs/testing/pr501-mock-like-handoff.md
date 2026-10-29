# PR501 mock filtering handoff

Base: `a91f1c4e553ed10d315f9534dabb4a81982a9f6b`.

The mock ignored PostgREST `like` filters. Backup pruning therefore selected unrelated activity rows and nulled them. A later strict RPC fixture read correctly refused those values with `read-shape`. The six-line mock correction limits selection to the requested pattern. It does not alter application code, RPC refusal checks, measurement thresholds, or timeouts.

Reviewed mock-only patch SHA-256: `2629d5cb30cfba046b0743cdba1e09a68ec9072c0e6267bcfc5a5d187a67949d` (original unified patch artifact, not the Git commit patch).

## Evidence

- Independent API-level reproduction used the actual baseline pruning function from `e6d087c203bb88685159efbc272e04ce868e4c89`, exact freshness callback, unchanged adapter and an owned loopback mock: original 184 writes and `read-shape`; corrected two intended backup writes and all 45 activity days readable. Injecting a null activity value afterward still refused.
- Retained `test/mock-supabase-like.test.mjs` executes the actual mock HTTP handler, current pruning function, exact freshness callback and unchanged adapter in memory. No sockets, browsers, live services or credentials. It checks retained backups/activity, intended obsolete backups, literal regex characters, wildcard aliases, null keys, and refusal/latch behavior for a genuine null activity value.
- `node --test test/mock-supabase-like.test.mjs test/rpc-fixture-adapter.test.mjs`: 55 tests passed, zero failures.
- Both new tests fail against the original mock (pruning six rows instead of two). The independent reviewer repeated this negative control and approved the final test, SHA-256 `a423c82154dcf6cda3da42b092452d6c78d9b376dc7f114a1673010a87b5cb68`.
- `npm test`: 2091 tests, 2059 passed, zero failures, 31 skipped, one existing TODO; exit 0.
- `npm run build`:passed; existing large-chunk warning. `git diff --check`:passed.

This supports the demonstrated fixture failure mechanism, not identification of the exact CI rejection subcase or browser/spacing qualification. SQL LIKE backslash escapes are outside this small mock's support; current fixture calls use unescaped prefixes. No parser expansion is needed for this fix.

## Integration

Cherry-pick only the fix/test/evidence parent. Its guard-only child adds a false deployment entry for `codex/pr501-spacing-mock-handoff` and is not part of the PR501 source fix. Preserve the existing integration branch guard.

The integration owner must declare the exact old mode/blob and new hash for `scripts/mock-supabase.mjs` plus exact new test/evidence paths in `scripts/pr501-contract/integration-delta.json`, refresh `DELTA.sha256` and its workflow digest using the reviewed composition process, and verify the resulting exact head. Runtime source manifests/core/Manager pins need no replacement for this mock-only change. Do not relax contract/deployment checks. The handoff branch itself is not a qualified PR501 composition.

Rerun the existing strict Chromium/WebKit spacing workflow after integration. No browser was launched for this handoff; it is not release qualification. No changes to PR501, production, credentials or infrastructure are included.
