-- The nightly copies of each store's own records are kept 30 days (C109,
-- Jorge, 30 September), and the privacy page now says so.
--
-- The app already kept only the newest 14 copies, but only when an admin opens
-- the tool, by count and not by age, and it could not see the two full-copy rows
-- of 13 July, whose key has one part fewer than today's. So a copy could outlive
-- the promise by as long as nobody visited. This runs every day with the other
-- prunes, by age, and keeps the list the restore screen reads in step with what
-- is left: an entry in that list whose row was deleted here would be a restore
-- that fails.
--
-- lpc:backup:<store>:<id>:v1        each store's copy
-- lpc:config:backup:<id>:v1         the settings and audit log taken with it
-- lpc:config:backups-index:v1       the list of what exists (entries carry `t`)
create or replace function public.prune_store_backups() returns void
  language sql
  set search_path to 'public'
as $$
  delete from public.app_data
   where (key like 'lpc:backup:%' or key like 'lpc:config:backup:%')
     and updated_at < now() - interval '30 days';
  update public.app_data
     set value = coalesce((select jsonb_agg(e)
                             from jsonb_array_elements(value) e
                            where (e->>'t')::timestamptz >= now() - interval '30 days'), '[]'::jsonb)
   where key = 'lpc:config:backups-index:v1' and jsonb_typeof(value) = 'array';
$$;

revoke all on function public.prune_store_backups() from public, anon, authenticated;

-- cron.schedule replaces a job of the same name, so this is the same job with
-- one more prune in it.
select cron.schedule(
  'prune-daily',
  '0 9 * * *',
  $$select public.prune_app_errors(); select public.prune_app_vitals(); select public.prune_device_tokens(); select public.prune_store_backups();$$
);
