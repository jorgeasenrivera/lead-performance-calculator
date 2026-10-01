# Versioned database changes

This directory contains ten historical migration SQL files. Five filenames are
corrected in the reconciliation draft without changing their SQL bytes. Add new
schema changes in new migrations; keep historical files immutable.

The historical snapshot lives at
[`../reference/2026-09-12-baseline.sql`](../reference/2026-09-12-baseline.sql),
outside automatic migrations. It must not run against an existing project.
Neither that reference nor this directory is a self-sufficient fresh-Supabase
bootstrap. Fresh setup requires a separately reviewed bootstrap and explicit
platform prerequisites.

Filename agreement is not a deployment dry-run. Before release, recheck the
intended target's history and schema, review a no-op deployment plan, and obtain
separate merge/deployment approval. This draft authorizes no history repair,
database push/reset or schema write. See
[the reconciliation plan](../../docs/supabase-migration-reconciliation.md).
