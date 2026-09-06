-- Realtime for the floor and the line.
--
-- The salesperson pages, the desk and the wall boards subscribe to changes on
-- their own row of these two tables so a call-up lands on the phone as the desk
-- clicks it. Postgres only publishes changes for tables that are in this
-- publication; until they are, every subscription opens fine and never hears
-- anything, and the pages fall back to polling every five seconds.
--
-- The column list is the point of this file, not an afterthought. A change
-- message carries whatever columns are named here, so naming `data` would push
-- the whole floor row to every phone on the floor on every change: twenty
-- phones times a few hundred changes a day is a bigger bill than the polling
-- this replaces. Named this way the message says only "row <id> moved at
-- <time>", a few bytes, and each page then does its own stamp-gated read.
--
-- Run once in the Supabase SQL editor. Safe to run again.

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'floor_public') then
    alter publication supabase_realtime drop table public.floor_public;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'queue_public') then
    alter publication supabase_realtime drop table public.queue_public;
  end if;
end $$;

alter publication supabase_realtime add table public.floor_public (id, updated_at);
alter publication supabase_realtime add table public.queue_public (id, updated_at);

-- Check: both tables listed, and the column list on each is id and updated_at.
select tablename, attnames from pg_publication_tables where pubname = 'supabase_realtime';
