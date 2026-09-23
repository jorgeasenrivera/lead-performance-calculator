-- The three prunes were written and never called (C90, 23 September): error
-- reports were meant to go at 90 days, speed readings at 30, and a device's
-- notification details 90 days after it was last seen, and nothing ran them.
-- The privacy policy now promises those times, so they run once a day, at
-- 09:00 UTC, which is five in the morning on the lot: nobody is signed in.
-- cron.schedule replaces a job of the same name, so running this twice is
-- harmless.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'prune-daily',
  '0 9 * * *',
  $$select public.prune_app_errors(); select public.prune_app_vitals(); select public.prune_device_tokens();$$
);
