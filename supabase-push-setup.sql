-- Push and Live Activities: the one table they need, and the webhook that feeds
-- /api/queue-changed.
--
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.device_tokens (
  id              text primary key,          -- device_id:store, so one row per phone per store
  device_id       text not null,
  store           text not null,
  person_id       uuid not null,             -- auth.users.id: taken from the session, never from the client
  platform        text not null check (platform in ('ios','android')),
  apns_token      text,                      -- the device, for the buzz
  apns_pts_token  text,                      -- push-to-start, iOS 17.2+
  activity_token  text,                      -- the running Live Activity, replaced each time one starts
  fcm_token       text,                      -- Android: buzz and ongoing notification alike
  updated_at      timestamptz not null default now()
);

create index if not exists device_tokens_store_person on public.device_tokens (store, person_id);
create index if not exists device_tokens_device on public.device_tokens (device_id);

alter table public.device_tokens enable row level security;

-- Nothing in the browser ever reads or writes this table: registration goes
-- through /api/register-device with the service role, which is what lets the
-- server insist the person_id matches the session. No policies are granted on
-- purpose — a device token is a way to reach somebody's pocket, and the anon key
-- is in every copy of the app.
revoke all on public.device_tokens from anon, authenticated;

-- Tokens rot. A phone that has not checked in for three months is not coming
-- back, and sending to it is a slow tax on every queue change.
create or replace function public.prune_device_tokens() returns void language sql as $$
  delete from public.device_tokens where updated_at < now() - interval '90 days';
$$;

/* The webhook, set up in the dashboard rather than here:
     Database → Webhooks → Create
       table   public.queue_public
       events  INSERT, UPDATE
       type    HTTP Request, POST
       URL     https://<your-app>/api/queue-changed
       header  x-lpc-secret: <the value of QUEUE_HOOK_SECRET>
   The payload Supabase sends carries `record` and `old_record`, which is exactly
   the before-and-after the endpoint diffs. */
