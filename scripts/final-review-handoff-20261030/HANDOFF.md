# Exact derivation source handoff, local only

Base: c002127db3357fdc4a6040edb30acf9e51f38a39, confirmed PR501 head on2026-10-30.
Proposed branch: codex/final-review-handoff-20261030. Not pushed.

The derive.mjs and complete-fictional-proposal.json are byte-identical to the reviewed derivation packet. All original evidence is retained. The original test is renamed test/derive.original.mjs.txt to avoid automatic test discovery of its workspace-absolute fixture path; SHA256.json is the historical packet manifest, with that original path now found under this archival filename. The runnable derive.portable.test.mjs differs only by resolving the included exact fixture with import.meta.url. No source logic or assertions changed. Ten portable tests passed.

No customer data, credentials, containment packet, application activation, UI, API, SQL, CI or hosting changes are included. Fictional mixed-case identities in the historical fixture exercise case preservation, not actual registry compatibility. trusted and publicationAuthorized remain false.

The repository is PUBLIC per GitHub metadata. Branches inherit repository visibility; this is not a private sharing route. Publishing requires explicit public-source handoff approval.

Existing vercel.json only disables Git deployments for codex/nov1-security-recovery-integration, not this proposed branch. Its ignoreCommand excludes scripts, so this scripts-only parent diff returns0 under the command's local comparison. This is not a branch deployment guard and does not prove that Git integration cannot create a deployment before an ignored build. Existing project Git configuration and target environment are not attested here. No promote call exists in the changed files.

checks.yml runs on every branch push and would run ordinary suite/build/browser jobs for this new ref. Other branch-specific push workflows do not match this proposed ref; native push is main-only. deploy-watch reacts to deployment_status and can write issues/comments if deployment occurs. No workflow exclusion has been prepared or authorized.

Safest next step: retain local patch for review. Before any push obtain explicit public-handoff approval, inspect exact remote ref absence/current baseline, and approve/review branch-specific no-deployment controls plus disposition of push browser jobs. Never reuse old branch-specific approvals. No changes to guards or CI in this packet.
