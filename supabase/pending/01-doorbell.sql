-- C92, step 1 of 2: a doorbell anyone may hear, carrying nothing but a time.
--
-- The pages learn that a row moved through postgres_changes, which obeys the
-- table's select policy. Once 02-lock.sql closes the tables to the public key,
-- a phone with no account and a TV would stop hearing anything and fall back
-- to polling. This rings a public broadcast topic per row instead:
--
--   topic  row:<table>:<id>        e.g. row:floor_public:dm:2026-09-28
--   event  changed
--   body   { "stamp": <updated_at> }
--
-- No part of the row travels; the page reads it through /api/floor-row, which
-- checks who is asking. Tickets ring nothing.
--
-- Additive and harmless on its own. Apply before the client switch ships, so
-- the switched pages have something to listen to. NOT in supabase/migrations
-- until it is applied, so nothing applies it by accident.

create or replace function public.row_doorbell() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id like 'ticket:%' then return new; end if;
  /* A doorbell that fails must not take the write it announces with it: the
     pages poll underneath, so a missed ring costs seconds, a failed write
     costs the floor. */
  begin
    perform realtime.send(jsonb_build_object('stamp', new.updated_at), 'changed',
                          'row:' || tg_table_name || ':' || new.id, false);
  exception when others then
    raise warning 'row_doorbell: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.row_doorbell() from public, anon, authenticated;

drop trigger if exists floor_doorbell on public.floor_public;
create trigger floor_doorbell after insert or update on public.floor_public
  for each row execute function public.row_doorbell();
drop trigger if exists queue_doorbell on public.queue_public;
create trigger queue_doorbell after insert or update on public.queue_public
  for each row execute function public.row_doorbell();
