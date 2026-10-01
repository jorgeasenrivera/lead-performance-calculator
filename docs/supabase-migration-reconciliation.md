# Migration filename reconciliation, draft only

This separate draft corrects five historical migration filenames and adds
offline guards. It changes no SQL bytes, application behavior or pixels.
It is not approved for merge, deployment or any target migration-history write.

## Filename corrections

| Migration | Previous filename version | Corrected filename version |
|---|---|---|
| app_errors | 20260912160000 | 20260912162646 |
| lock_functions_and_tidy_policies | 20260912163000 | 20260912163656 |
| no_truncate_for_api_roles | 20260912164500 | 20260912164025 |
| app_vitals | 20260912203000 | 20260912203722 |
| drop_queue_identity | 20260915170900 | 20260915170915 |

The SQL body and comments of every renamed file are byte-for-byte unchanged.
The other migration files are unchanged. These names record the versions used
for those historical migrations; this draft does not reapply their SQL.

## The historical baseline needs a separate decision

`00000000000000_baseline.sql` remains byte-for-byte unchanged. Its existing header
says that it describes a historical schema and must not run against the existing
project. Filename reconciliation does not establish that this snapshot is a safe
bootstrap or that any target's migration plan is a no-op.

Do not merge this draft while the baseline decision is unresolved. Do not run the
baseline against an existing database. Do not mark migrations applied or reverted
merely to make a deployment check pass. Migration history, schema state and safe
fresh-database replay are different things to verify.

## Options to evaluate before release

- Keep a verified historical baseline in the migration chain. First replay the
  intended chain in an isolated disposable environment and compare all intended
  schema and operational objects with the target. Any decision to record an
  existing baseline as applied is a separate target-specific history write and
  needs explicit approval. It must not execute the baseline SQL.
- Keep the snapshot as reference material outside automatic migrations. That
  requires updating the lock-check harness, baseline guard and documentation,
  plus providing a separately reviewed bootstrap for fresh databases. Moving a
  file alone does not make later migrations self-sufficient.
- Prepare a separately reviewed, sanitized replacement bootstrap and an explicit
  history-reconciliation plan. Do not commit an unreviewed live schema capture
  or operational credentials to this repository.

No option is selected by this draft. No baseline mark-applied action is currently
recommended. Filename-only changes are useful, but the remaining proof and
approval gates are still required.

## Required proof and approvals

1. Recheck the exact target and migration history immediately before a proposed
   reconciliation. Account for all missing, additional or changed versions.
2. Replay in an isolated disposable environment with explicit platform
   prerequisites and fictional configuration. Disable outbound delivery; never
   aim a test database's callbacks at production. Do not provision paid resources
   or create persistent access without approval.
3. Compare the full intended schema and operational objects, including policies,
   grants and default grants, functions, triggers, sequences, publications and
   scheduled jobs. Explain every difference. Matching filenames or normalized
   SQL hashes alone do not prove equivalence.
4. Choose the baseline treatment and obtain explicit approval for each exact
   remote-history action and target. Separately approve any schema or security
   changes if later work establishes that they are needed.
5. Review the deployment integration and execution order. Do not merge filename
   corrections and then discover that historical SQL is queued for execution.
   Require a reviewed no-op plan after the approved history-only treatment.
6. Obtain separate merge/deployment approval, run the exact-head checks, and
   verify the resulting deployment without weakening a check to make it pass.

[Supabase's repair reference](https://supabase.com/docs/reference/cli/supabase-migration-repair)
explains that applied/reverted repairs change history records. They do not prove
schema equivalence. No repair, migration push, reset or database write was run
while preparing this draft.

## Verification and limits

- Five rename pairs are 100% identical in Git's diff
- Seven offline migration guards pass: original SQL byte hashes, no old filename
  copies, unique fourteen-digit versions, and the unchanged historical baseline
- All 859 repository tests pass on Node 24.19.0
- Production build passes with its existing large-chunk warning
- `git diff --check` passes
- Full isolated database replay was not run: this executor has no Postgres,
  psql, Docker or Supabase CLI available

The guards allow new migration files; already-applied files should remain
immutable. A new migration is the place for a new database change. Application
CI and these offline tests do not establish a successful database deployment.
Other feature drafts retain their own review and activation gates.
