-- Push and Live Activities: the one table they need, and the webhook that feeds
-- /api/queue-changed.
--
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.device_tokens (
  id              text primary key,          -- device_id:store, so one row per phone per store
  device_id       text not null,
  store           text not null,
  -- The ROSTER id, not the account id. Everything that reaches a person on the
  -- floor speaks roster ids: the line is written with them, so a notification
  -- addressed to an account uuid would have nobody to be about. The server
  -- resolves it from floor_people using the session, so a device still cannot
  -- name its own person — it just cannot name it in the other alphabet either.
  -- Text, because a roster id is eight characters of base 36 and never a uuid.
  person_id       text not null,
  platform        text not null check (platform in ('ios','android')),
  apns_token      text,                      -- the device, for the buzz
  apns_pts_token  text,                      -- push-to-start, iOS 17.2+
  activity_token  text,                      -- the running Live Activity, replaced each time one starts
  fcm_token       text,                      -- Android: buzz and ongoing notification alike
  updated_at      timestamptz not null default now()
);

create index if not exists device_tokens_store_person on public.device_tokens (store, person_id);
create index if not exists device_tokens_device on public.device_tokens (device_id);

-- If this table was created before the roster id was the thing being stored, the
-- column is still uuid and every registration fails on insert. Nothing has been
-- written that is worth keeping, so:
--   alter table public.device_tokens alter column person_id type text;

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

/* ---- the webhooks ----
   Two of them, one per table, both pointing at /api/queue-changed with the
   shared secret in a header. Supabase's dashboard has them under
   Integrations → Database Webhooks (it used to be Database → Webhooks). The
   form: table public.queue_public then public.floor_public, events INSERT and
   UPDATE, type HTTP Request, method POST, URL https://www.sageonline.io/api/queue-changed,
   one header x-lpc-secret with the value of QUEUE_HOOK_SECRET.

   Or make them here. A dashboard webhook is nothing but a trigger calling
   supabase_functions.http_request, so this is the same thing without the
   clicking. Replace the secret and run; safe to re-run. */
create extension if not exists pg_net;
create schema if not exists supabase_functions;

drop trigger if exists queue_changed on public.queue_public;
create trigger queue_changed
  after insert or update on public.queue_public
  for each row execute function supabase_functions.http_request(
    'https://www.sageonline.io/api/queue-changed',
    'POST',
    '{"Content-type":"application/json","x-lpc-secret":"REPLACE_WITH_QUEUE_HOOK_SECRET"}',
    '{}',
    '5000'
  );

drop trigger if exists floor_changed on public.floor_public;
create trigger floor_changed
  after insert or update on public.floor_public
  for each row execute function supabase_functions.http_request(
    'https://www.sageonline.io/api/queue-changed',
    'POST',
    '{"Content-type":"application/json","x-lpc-secret":"REPLACE_WITH_QUEUE_HOOK_SECRET"}',
    '{}',
    '5000'
  );

/* The payload Supabase sends carries `record` and `old_record`, which is exactly
   the before-and-after the endpoint diffs. If supabase_functions.http_request
   does not exist yet, open Integrations → Database Webhooks once and press
   Enable webhooks: that installs it. */
