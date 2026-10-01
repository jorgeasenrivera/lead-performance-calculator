# Historical schema reference

`2026-09-12-baseline.sql` is the unchanged historical snapshot formerly stored
as `supabase/migrations/00000000000000_baseline.sql`. It is reference material,
not an executable migration. Never run it against an existing project or record
it as applied merely to reconcile filenames.

SHA-256: `5e9d35fa1f56cf2dce2f33d38775e5c19474b3b5b15db9f07e962716826ccf26`.

The snapshot is not a self-sufficient fresh-Supabase bootstrap. Its platform
prerequisites and operational objects need a separately reviewed setup with
fictional configuration and blocked outbound callbacks. Moving it here does not
make the remaining migrations sufficient to initialize an empty database.

`scripts/c92-lock-check.sh` reads selected definitions here for its disposable
fixture. That focused check is not full platform or deployment verification.
See [the reconciliation plan](../../docs/supabase-migration-reconciliation.md).
