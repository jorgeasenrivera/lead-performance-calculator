# The database, as files

Files after the baseline record schema changes through versioned SQL files.
Their filename versions must match the intended migration history. The first
five filenames are corrected in the reconciliation draft without changing SQL.

`00000000000000_baseline.sql` is a historical snapshot from when this directory
began. Its header says it must not run against the existing project. Keeping it
here does not establish a safe replay or a no-op deployment. Do not merge the
reconciliation draft until its baseline and approval gates are resolved. See
[`docs/supabase-migration-reconciliation.md`](../../docs/supabase-migration-reconciliation.md).

Applying is done from a session with the Supabase access (the migration tool),
and the file is committed in the same change. The security and performance
advisors are read after every schema change.
