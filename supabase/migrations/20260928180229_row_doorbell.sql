-- C92: a doorbell anyone may hear, carrying nothing but a time.
-- Applied to the live project on 28 September, after #435 merged.
--
-- The TV learns that a row moved through postgres_changes, which obeys the
-- table's select policy. Once the floor_lock migration closes the tables
-- to the public key, a TV (nobody signed in) would hear nothing and fall back
-- to polling. This rings a public broadcast topic per row instead:
--
--   topic  row:<table>:<id>        e.g. row:floor_public:dm:2026-09-28
--   event  changed
--   body   { "stamp": <updated_at> }
--
-- No part of the row travels; the TV reads it through /api/floor-row, which
-- checks its key. Tickets ring nothing.

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
