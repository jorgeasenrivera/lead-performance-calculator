# The database, as files

Every change to the Supabase project's schema is a file here, named by the
moment it was applied, applied through the project's own migration record so
the two never drift. `00000000000000_baseline.sql` is the shape the project had
when this directory began; the files after it are the changes since, in order.

Applying is done from a session with the Supabase access (the migration tool),
and the file is committed in the same change. The security and performance
advisors are read after every schema change.
