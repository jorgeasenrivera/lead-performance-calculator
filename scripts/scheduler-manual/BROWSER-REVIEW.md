# Manual browser acceptance preparation

Base carrier63ddf9f9740f59fc9090497c3e73c9a73dad5a79. Local branch codex/manual-browser-acceptance-local. PR497 unchanged. No local browser, container execution, install, push or deployment.

## Scope

Actual ManualManagerEntry and OwnPublishedSchedule, composed manual server, pg transport, capture port and relational gateway. Separate React entry omits production bootstrap, telemetry and service workers. Source production switches and public endpoints unchanged. Synthetic identity tokens only; profile/link/grants checked against disposable fake-data tables. Fixture shape derives from run-pg-sql.mjs at the base commit, with one initial explicit off day for manual editing. This does not test first-month setup or full dashboard navigation.

Dedicated job preserves prior workflows, uses contents:read and same-repository exact carrier-to-main admission. User explicitly approved GitHub preinstalled PostgreSQL16. No PostgreSQL image, download, installation or system service is used. Read-only dpkg inventory and canonical paths locate server binaries; postgres/initdb/pg_ctl/psql must agree on16.x. A private /tmp cluster runs as the non-root host user, rejects TCP authentication and has listen_addresses empty. Host queries verify version, data and socket settings before browser launch.

The existing Playwright1.63.0 noble container has network none and the host user's numeric UID/GID. Only the checkout(read-only), private socket directory and evidence directory are mounted; database files, Docker socket and other host directories are not mounted. No chmod/chown, privilege flag, host network or browser security flags. Existing image/browser tooling remains unchanged. Synthetic fixture owner maintains source/policy tables only in this disposable cluster; actual transport sets and verifies scheduler_runtime. This is not hosted executor/RLS proof.

## Actual verification

- New fixture: real local PG17.11 save/review/publish/own interval540-960, pending denial, revocation and approval re-fetch passed. Actual test-entry Vite build passed. No browser launched.
- Latest cluster /tmp/sage-manual-Xt9Psb stopped, pg_ctl status3, directory removed.
- Final full suite:1765 total,1764passed,0fail,0skip,1existingTODO. The existing generation TODO emits an assertion in the log footer; it is not a newly failing test.
- Final focused tests:2passed,0failed (PG16 preflight refusals and HTTP origin/query/size/control-route boundaries). Exact191-file production carrier contract still passes unchanged.
- JavaScript syntax and bash syntax passed.
- Separate independent_relational_review agent authored none of the patch and performed read-only review. Corrected premature pending/read/replay assertions and cleanup evidence. PG16 alternative independently re-reviewed, no static blocker; cleanup env-i consistency improvement applied; reviewer executed nothing.

## Unexecuted and environment limits

The previous official DockerHub tag lookup returned HTTP403/exit22. It was not retried or bypassed. The PostgreSQL image route and null-digest configuration are removed, superseded by explicit user approval for hostPG16.

This cloud container retains only the previously approvedPG17.11 binaries; no PG16 server has been installed here. Local real-database regression therefore uses explicit170011 and does not prove PG16 compatibility. CI requires an actual16.x preflight and fails closed if absent, root, mismatched or inaccessible. Hosted execution remains pending reviewed publication. No browser execution took place locally.

Browser scenarios are source-prepared only: entry/save, complete-read draft invisibility, review/publish, exact own revision/content, immutable content after subsequent draft, pending403, offline/reconnect, revocation/refetch, replay of old revision after new render, late old-identity response. Timing uses Node controller performance.now from publish response acknowledgement to DOM observation with provisional5000ms bound; no result exists yet. No native/two-device or hosted auth claim.

Teardown independently attempts all JS closes, reports failures, removes only the job-owned browser container, stops the private host cluster, requires pg_ctl status3, then removes its directory. Docker daemon/enumeration failure or unknown cluster status is uncertain cleanup and fails; not treated as confirmed absence. TERM/INT invoke shell cleanup. Abrupt runner loss may prevent artifact delivery; GitHub ephemeral runner destruction is a final boundary, not a claimed observed cleanup.
