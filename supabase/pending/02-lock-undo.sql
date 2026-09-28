-- C92: undo 02-lock.sql, back to exactly what the live project had on
-- 28 September before the lock: the six open policies and the public key's
-- four grants, read from the live project that day (pg_policies and
-- role_table_grants), not retyped from the baseline file.
--
-- For a day when a TV that has not been re-linked matters more than the lock.
-- Running 02-lock.sql again puts the lock back; scripts/c92-lock-check.sh runs
-- lock, undo, undo, lock and checks each state.
--
-- can_use_store() is left in place: nothing calls it once its policies go,
-- and the lock recreates it anyway.

drop policy if exists floor_staff_read on public.floor_public;
drop policy if exists floor_staff_insert on public.floor_public;
drop policy if exists floor_staff_update on public.floor_public;
drop policy if exists queue_staff_read on public.queue_public;
drop policy if exists queue_staff_insert on public.queue_public;
drop policy if exists queue_staff_update on public.queue_public;

drop policy if exists "floor_public read" on public.floor_public;
drop policy if exists "floor_public write" on public.floor_public;
drop policy if exists "floor_public update" on public.floor_public;
drop policy if exists queue_public_read on public.queue_public;
drop policy if exists queue_public_insert on public.queue_public;
drop policy if exists queue_public_update on public.queue_public;

create policy "floor_public read" on public.floor_public for select to public using (true);
create policy "floor_public write" on public.floor_public for insert to public with check (true);
create policy "floor_public update" on public.floor_public for update to public using (true) with check (true);
create policy queue_public_read on public.queue_public for select to public using (true);
create policy queue_public_insert on public.queue_public for insert to public with check (true);
create policy queue_public_update on public.queue_public for update to public using (true) with check (true);

grant select, insert, update, delete on public.floor_public, public.queue_public to anon;
