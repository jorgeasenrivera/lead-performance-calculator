-- Applied 2026-09-12 through the Supabase access; kept here so the repo says
-- what the database has. The vitals feed: how fast the phone felt, one row
-- per measurement. INP (the slowest tap on a page), LCP (the first screen's
-- paint) and CLS (whether anything jumped), each with the build, the room,
-- the store and the device, so a build can be held against the one before it.
-- Written only by the server (service role) through /api/vitals. Nothing in
-- the browser reads or writes it.
create table if not exists public.app_vitals (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  name        text not null check (name in ('INP', 'LCP', 'CLS', 'FCP', 'TTFB')),
  value       numeric not null,                -- ms, or a unitless score for CLS
  rating      text check (rating in ('good', 'needs-improvement', 'poor')),
  nav         text,                            -- navigate | reload | back-forward | prerender
  target      text,                            -- the element under the slowest tap
  interaction text,                            -- pointer | keyboard
  url         text,
  build       text,                            -- the build stamp the page was made from
  store       text,
  person_id   text,
  device_id   text,
  ua          text,
  screen      text,                            -- room or screen, when the page knows it
  shell       boolean not null default false   -- inside the phone app, or a browser
);
create index if not exists app_vitals_at on public.app_vitals (at desc);
create index if not exists app_vitals_build on public.app_vitals (build, name, at desc);

alter table public.app_vitals enable row level security;
revoke all on public.app_vitals from anon, authenticated;

-- Thirty days: enough to compare a few builds, never the biggest table.
create or replace function public.prune_app_vitals() returns void
language sql security invoker set search_path = public as $$
  delete from public.app_vitals where at < now() - interval '30 days';
$$;
revoke all on function public.prune_app_vitals() from public, anon, authenticated;
