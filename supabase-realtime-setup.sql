-- Realtime for the floor and the line.
--
-- The salesperson pages, the desk and the wall boards subscribe to changes on
-- their own row of these two tables so a call-up lands on the phone as the desk
-- clicks it. Postgres only publishes changes for tables that are in this
-- publication; until they are, every subscription opens fine and never hears
-- anything, and the pages fall back to polling every five seconds.
--
-- Run once in the Supabase SQL editor. Safe to run again.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'floor_public') then
    alter publication supabase_realtime add table public.floor_public;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'queue_public') then
    alter publication supabase_realtime add table public.queue_public;
  end if;
end $$;

-- Check: both tables should be listed.
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
