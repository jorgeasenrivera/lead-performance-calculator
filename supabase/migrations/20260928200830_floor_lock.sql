-- C92: close the day's floor and phone-line rows to the public key.
--
-- Until now floor_public and queue_public let anybody with the site's public
-- key (which is in every copy of the page) read, insert and update any store's
-- any day, and each row carries the day's sign-in code.
--
-- After this:
--   * signed-in staff read and write the rows directly, for their own stores:
--     an admin, the store on an approved profile, or their account linked to
--     a person on that store's floor (can_use_store, the same three ways in as
--     staffMayUse in api/_floor-access.mjs);
--   * tickets, which share queue_public, follow their store column like any
--     other row (NOT NULL; see C98 for why none has been saved until now);
--   * the public key gets nothing. A phone with no account and a TV go through
--     /api/floor-row, which holds the service key and checks today's code or
--     the TV's key.
--
-- APPLY ONLY AFTER the no-account pages and the TVs use /api/floor-row, or
-- the floor goes down for everybody without an account. Undo is
-- 02-lock-undo.sql.

create or replace function public.can_use_store(store text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.profiles p
           where p.id = (select auth.uid()) and p.active
             and (p.role = 'admin' or (not p.pending and store = any(p.stores))))
      or exists (
           select 1 from public.floor_people fp
           where fp.user_id = (select auth.uid()) and fp.store = can_use_store.store);
$$;
revoke all on function public.can_use_store(text) from public, anon;
grant execute on function public.can_use_store(text) to authenticated;

drop policy if exists "floor_public read" on public.floor_public;
drop policy if exists "floor_public write" on public.floor_public;
drop policy if exists "floor_public update" on public.floor_public;
drop policy if exists queue_public_read on public.queue_public;
drop policy if exists queue_public_insert on public.queue_public;
drop policy if exists queue_public_update on public.queue_public;
-- and this file's own, so running it twice is the same as running it once
drop policy if exists floor_staff_read on public.floor_public;
drop policy if exists floor_staff_insert on public.floor_public;
drop policy if exists floor_staff_update on public.floor_public;
drop policy if exists queue_staff_read on public.queue_public;
drop policy if exists queue_staff_insert on public.queue_public;
drop policy if exists queue_staff_update on public.queue_public;

create policy floor_staff_read on public.floor_public for select to authenticated
  using (public.can_use_store(store));
create policy floor_staff_insert on public.floor_public for insert to authenticated
  with check (public.can_use_store(store));
create policy floor_staff_update on public.floor_public for update to authenticated
  using (public.can_use_store(store)) with check (public.can_use_store(store));

create policy queue_staff_read on public.queue_public for select to authenticated
  using (public.can_use_store(store));
create policy queue_staff_insert on public.queue_public for insert to authenticated
  with check (public.can_use_store(store));
create policy queue_staff_update on public.queue_public for update to authenticated
  using (public.can_use_store(store))
  with check (public.can_use_store(store));

revoke all on public.floor_public, public.queue_public from anon;

-- Applied to the live project on 28 September (Jorge: lock now, unlock if a
-- TV that has not been re-linked matters on a given day).
-- Undo: supabase/pending/02-lock-undo.sql, which puts back exactly what was
-- live before this, and is checked by scripts/c92-lock-check.sh.
