-- Drop public.queue_identity.
--
-- It held the salesperson PIN: an id, a jsonb blob, a timestamp. The PIN stage
-- came out of sign-in in #326, picking a name is the whole of it now, and
-- nothing has read or written this table since. Verified before writing this:
-- six rows, last touched 2026-08-22 17:10 UTC, and the only references left
-- anywhere are the baseline's own definition, the three policies below, and a
-- guard in test/feel.test.mjs asserting the app does not touch it.
--
-- The six rows go with it, and they are not archived anywhere. They are PIN
-- material for a feature that no longer exists, so keeping a copy would be
-- keeping a credential for no reason, and putting one in this repository would
-- be worse. Jorge approved the drop on 15 September knowing the rows go too.
--
-- This cannot be undone. If the PIN ever comes back it comes back as a new
-- table with a new shape, not as this one restored.

drop policy if exists queue_identity_read   on public.queue_identity;
drop policy if exists queue_identity_insert on public.queue_identity;
drop policy if exists queue_identity_update on public.queue_identity;

drop table if exists public.queue_identity;
