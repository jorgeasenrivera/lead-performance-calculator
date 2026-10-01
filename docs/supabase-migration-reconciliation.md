# Migration references and filename reconciliation, draft only

The historical baseline is now reference material outside executable migrations.
This draft also corrects five historical filenames. All SQL bytes, application
behavior and pixels are unchanged. Keep draft; merge and deployment require
separate approval.

## Filename corrections

| Migration | Previous filename version | Corrected filename version |
|---|---|---|
| app_errors | 20260912160000 | 20260912162646 |
| lock_functions_and_tidy_policies | 20260912163000 | 20260912163656 |
| no_truncate_for_api_roles | 20260912164500 | 20260912164025 |
| app_vitals | 20260912203000 | 20260912203722 |
| drop_queue_identity | 20260915170900 | 20260915170915 |

The SQL body and comments of all ten executable migration files remain
byte-for-byte unchanged. These names describe historical versions; this draft
does not reapply their SQL.

## Reference-only baseline

`supabase/migrations/00000000000000_baseline.sql` has moved unchanged to
`supabase/reference/2026-09-12-baseline.sql`. Its SHA-256 remains
`5e9d35fa1f56cf2dce2f33d38775e5c19474b3b5b15db9f07e962716826ccf26`.
The lock-check harness reads the new reference path. Offline guards preserve the
snapshot and reject copies in the executable migration directory.

Do not run the snapshot against an existing project. No mark-applied operation
is part of this approach. Matching historical filenames or normalized SQL bodies
does not justify any migration-history write.

The tradeoff is explicit: the reference snapshot is not a self-sufficient
fresh-Supabase bootstrap, and the ten remaining migrations do not initialize an
empty project by themselves. Fresh setup needs a separately reviewed bootstrap,
explicit platform prerequisites and isolated verification. Auth objects, roles,
extensions, custom event triggers, grants/default grants, publications and jobs
must be accounted for. Any isolated fixture must use fictional configuration
and block outbound callbacks. Modeled platform behavior does not establish full
Supabase equivalence.

## Release gates

1. Recheck the exact intended target and recorded migration versions. Explain any
   missing, extra or changed version without replaying historical SQL.
2. Compare intended schema and operational objects, including policies, grants,
   functions, triggers, sequences, publications and scheduled jobs. Resolve
   platform prerequisites separately from application migrations.
3. Review deployment integration and execution order. Require a current no-op
   migration plan showing that no historical SQL is queued. Source checks and
   read-only catalog comparison are not a completed CLI deployment dry-run.
4. Keep paid preview provisioning disabled unless separately authorized. Obtain
   separate approval before any target history write, schema/security change,
   merge or deployment. Do not repair history merely to make a check pass.
5. Run exact-head checks and verify the approved deployment when it is separately
   authorized. Other feature drafts retain their own release gates.

## Source verification

Offline guards check all ten SQL byte hashes, the five removed old filenames,
unique fourteen-digit versions, the preserved reference snapshot, its exclusion
from executable migrations and the lock harness's reference path. They allow new
migration files while keeping these historical files immutable.

Full repository tests and the production build are required before publication;
the PR records their result for the published head. No application or visual
change is included. These source checks do not prove a successful database
migration, a full fresh-project bootstrap or a no-op deployment.
