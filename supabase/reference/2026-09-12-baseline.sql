-- The schema as the project had it on 2026-09-12, read back from the database
-- and written down. Not for running against that project (everything in it is
-- already there); it is the point of reference the migrations after it build
-- on, and what a fresh project would be given to become the same shape.
--
-- The four supabase-*.sql files at the repo root are how this schema was made
-- by hand, one piece at a time. This file supersedes them as the description
-- of what exists; they stay as the story of why.
--
-- One value is not written down: the shared secret in the two queue webhooks.
-- It is REPLACE_WITH_QUEUE_HOOK_SECRET below and lives in Vercel as
-- QUEUE_HOOK_SECRET.

-- ---- tables ----------------------------------------------------------------
create table if not exists public.app_data (
  key text not null,
  value jsonb,
  updated_at timestamp with time zone default now(),
  constraint app_data_pkey primary key (key)
);

create table if not exists public.app_errors (
  id bigint generated always as identity,
  at timestamp with time zone not null default now(),
  source text not null,
  kind text not null,
  message text not null,
  stack text,
  url text,
  build text,
  store text,
  person_id text,
  user_id uuid,
  device_id text,
  ua text,
  screen text,
  extra jsonb,
  fingerprint text not null,
  constraint app_errors_pkey primary key (id),
  constraint app_errors_source_check check (source = any (array['web'::text, 'shell'::text, 'server'::text]))
);

create table if not exists public.deal_events (
  id uuid not null default gen_random_uuid(),
  received_at timestamp with time zone not null default now(),
  dealership text,
  dealership_norm text,
  event text,
  alert text,
  description text,
  sales text,
  source text,
  raw_subject text,
  created_at timestamp with time zone not null default now(),
  constraint deal_events_pkey primary key (id)
);

create table if not exists public.device_tokens (
  id text not null,
  device_id text not null,
  store text not null,
  person_id text not null,
  platform text not null,
  apns_token text,
  apns_pts_token text,
  activity_token text,
  fcm_token text,
  updated_at timestamp with time zone not null default now(),
  constraint device_tokens_pkey primary key (id),
  constraint device_tokens_platform_check check (platform = any (array['ios'::text, 'android'::text]))
);

create table if not exists public.floor_people (
  id text not null,
  user_id uuid not null,
  store text not null,
  person_id text not null,
  linked_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint floor_people_pkey primary key (id)
);

create table if not exists public.floor_public (
  id text not null,
  store text,
  fdate text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint floor_public_pkey primary key (id)
);

create table if not exists public.profiles (
  id uuid not null,
  email text,
  name text,
  role text not null default 'manager'::text,
  stores text[] not null default '{}'::text[],
  active boolean not null default true,
  pending boolean not null default true,
  onboarded boolean not null default false,
  created_at timestamp with time zone default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_role_check check (role = any (array['admin'::text, 'manager'::text, 'overseer'::text]))
);

create table if not exists public.queue_identity (
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint queue_identity_pkey primary key (id)
);

create table if not exists public.queue_public (
  id text not null,
  store text not null,
  qdate date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint queue_public_pkey primary key (id)
);

-- ---- indexes ---------------------------------------------------------------
create index if not exists app_errors_at on public.app_errors using btree (at desc);
create index if not exists app_errors_device on public.app_errors using btree (device_id, at desc);
create index if not exists app_errors_fp on public.app_errors using btree (fingerprint, at desc);
create index if not exists deal_events_dealer_time_idx on public.deal_events using btree (dealership_norm, received_at desc);
create index if not exists deal_events_sales_idx on public.deal_events using btree (sales);
create index if not exists device_tokens_device on public.device_tokens using btree (device_id);
create index if not exists device_tokens_store_person on public.device_tokens using btree (store, person_id);
create unique index if not exists floor_people_one_per_account on public.floor_people using btree (store, user_id);
create unique index if not exists floor_people_one_per_person on public.floor_people using btree (store, person_id);
create index if not exists floor_public_store_fdate_idx on public.floor_public using btree (store, fdate);
create index if not exists queue_public_store_idx on public.queue_public using btree (store, qdate);

-- ---- functions -------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  first_user boolean;
begin
  select count(*) = 0 into first_user from profiles;
  insert into profiles (id, email, name, role, active, pending)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when first_user then 'admin'  else 'manager' end,
    true,
    case when first_user then false    else true      end
  );
  return new;
end;
$$;

create or replace function public.has_store(sid text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and active
      and (role = 'admin' or sid = any(stores))
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.mark_onboarded() returns void
language sql security definer set search_path to 'public' as $$
  update profiles set onboarded = true where id = auth.uid();
$$;

create or replace function public.prune_app_errors() returns void
language sql set search_path to 'public' as $$
  delete from public.app_errors where at < now() - interval '90 days';
$$;

create or replace function public.prune_device_tokens() returns void
language sql set search_path to 'public' as $$
  delete from public.device_tokens where updated_at < now() - interval '90 days';
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- rls_auto_enable is the platform's own event-trigger function (enable RLS on
-- every new table) and is not ours to define here.

-- ---- who may call what -----------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke execute on function public.has_store(text) from public, anon;
grant execute on function public.has_store(text) to authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.mark_onboarded() from public, anon;
grant execute on function public.mark_onboarded() to authenticated;
revoke execute on function public.prune_app_errors() from public, anon, authenticated;
revoke execute on function public.prune_device_tokens() from public, anon, authenticated;

-- ---- triggers --------------------------------------------------------------
create extension if not exists pg_net;
create schema if not exists supabase_functions;
create trigger app_data_touch before update on public.app_data for each row execute function touch_updated_at();
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create trigger queue_changed after insert or update on public.queue_public for each row execute function supabase_functions.http_request(
  'https://www.sageonline.io/api/queue-changed', 'POST',
  '{"Content-type":"application/json","x-lpc-secret":"REPLACE_WITH_QUEUE_HOOK_SECRET"}', '{}', '5000');
create trigger floor_changed after insert or update on public.floor_public for each row execute function supabase_functions.http_request(
  'https://www.sageonline.io/api/queue-changed', 'POST',
  '{"Content-type":"application/json","x-lpc-secret":"REPLACE_WITH_QUEUE_HOOK_SECRET"}', '{}', '5000');

-- ---- row security ----------------------------------------------------------
alter table public.app_data enable row level security;
alter table public.app_errors enable row level security;
alter table public.deal_events enable row level security;
alter table public.device_tokens enable row level security;
alter table public.floor_people enable row level security;
alter table public.floor_public enable row level security;
alter table public.profiles enable row level security;
alter table public.queue_identity enable row level security;
alter table public.queue_public enable row level security;

-- app_data: config, audit and board rows for any signed-in account; store and
-- backup rows for accounts with that store; board rows readable without one
-- (the TV).
create policy "app_data read" on public.app_data for select to authenticated using (
  (key like 'lpc:config:%') or (key like 'lpc:audit:%') or (key like 'lpc:board:%')
  or ((key like 'lpc:store:%') and has_store(split_part(key, ':', 3)))
  or ((key like 'lpc:backup:%') and has_store(split_part(key, ':', 3))));
create policy "app_data write" on public.app_data for insert to authenticated with check (
  (key like 'lpc:config:%') or (key like 'lpc:audit:%') or (key like 'lpc:board:%')
  or ((key like 'lpc:store:%') and has_store(split_part(key, ':', 3)))
  or ((key like 'lpc:backup:%') and has_store(split_part(key, ':', 3))));
create policy "app_data update" on public.app_data for update to authenticated using (
  (key like 'lpc:config:%') or (key like 'lpc:audit:%') or (key like 'lpc:board:%')
  or ((key like 'lpc:store:%') and has_store(split_part(key, ':', 3)))
  or ((key like 'lpc:backup:%') and has_store(split_part(key, ':', 3)))) with check (
  (key like 'lpc:config:%') or (key like 'lpc:audit:%') or (key like 'lpc:board:%')
  or ((key like 'lpc:store:%') and has_store(split_part(key, ':', 3)))
  or ((key like 'lpc:backup:%') and has_store(split_part(key, ':', 3))));
create policy "board rows are readable by anyone" on public.app_data for select to anon using (key like 'lpc:board:%');

create policy deal_events_read on public.deal_events for select to authenticated using (true);

create policy floor_people_read_own on public.floor_people for select to authenticated using (user_id = (select auth.uid()));

-- The public rooms: the phone line and the floor are used from sign-in pages
-- that have no account (a token in the link is the key), so their rows are
-- open to read and write, and nothing in them is a secret. Deletes are not
-- granted to anybody.
create policy "floor_public read" on public.floor_public for select to public using (true);
create policy "floor_public write" on public.floor_public for insert to public with check (true);
create policy "floor_public update" on public.floor_public for update to public using (true) with check (true);
create policy queue_identity_read on public.queue_identity for select to public using (true);
create policy queue_identity_insert on public.queue_identity for insert to public with check (true);
create policy queue_identity_update on public.queue_identity for update to public using (true) with check (true);
create policy queue_public_read on public.queue_public for select to public using (true);
create policy queue_public_insert on public.queue_public for insert to public with check (true);
create policy queue_public_update on public.queue_public for update to public using (true) with check (true);

create policy "profiles read" on public.profiles for select to authenticated using (id = (select auth.uid()) or is_admin());
create policy "profiles insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles update" on public.profiles for update to authenticated using (is_admin()) with check (is_admin());
create policy "profiles delete" on public.profiles for delete to authenticated using (is_admin());

-- app_errors and device_tokens: server only. RLS on, no policies, on purpose.

-- ---- table grants ----------------------------------------------------------
-- The platform's defaults give the API roles every privilege on every table
-- and row security does the real deciding; the three privileges row security
-- cannot see are taken back.
revoke all on public.device_tokens from anon, authenticated;
revoke all on public.app_errors from anon, authenticated;
revoke insert, update, delete on public.floor_people from anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
