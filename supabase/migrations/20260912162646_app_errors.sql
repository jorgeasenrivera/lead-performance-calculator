-- Applied 2026-09-12 through the Supabase access; kept here so the repo says
-- what the database has. The error feed: every crash, failed write and server
-- fault, as a row. Written only by the server (service role) through
-- /api/client-error and the functions' own catch blocks. Nothing in the browser
-- reads or writes it: the anon key is in every copy of the app, and an error
-- row carries a stack.
create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  source      text not null check (source in ('web', 'shell', 'server')),
  kind        text not null,                  -- error | rejection | render | write | api | handler
  message     text not null,
  stack       text,
  url         text,                           -- the page path, or the api route
  build       text,                           -- the git sha the build was made from
  store       text,
  person_id   text,                           -- roster id, when the phone knows it
  user_id     uuid,                           -- the account, when signed in
  device_id   text,
  ua          text,
  screen      text,                           -- room or screen, when the page knows it
  extra       jsonb,
  fingerprint text not null                   -- kind + message + first frame, for grouping
);
create index if not exists app_errors_at on public.app_errors (at desc);
create index if not exists app_errors_fp on public.app_errors (fingerprint, at desc);
create index if not exists app_errors_device on public.app_errors (device_id, at desc);

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

-- Ninety days is long enough to see a pattern and short enough that the table
-- never becomes the biggest thing in the database.
create or replace function public.prune_app_errors() returns void
language sql security invoker set search_path = public as $$
  delete from public.app_errors where at < now() - interval '90 days';
$$;
revoke all on function public.prune_app_errors() from public, anon, authenticated;
