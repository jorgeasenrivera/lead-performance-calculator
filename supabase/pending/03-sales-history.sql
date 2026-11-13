-- C111, 2 October: twelve years of daily deliveries per store, and the dated
-- staffing settings the schedule tool reads (decided by Jorge, 2 October:
-- T1 a, two tables; T2 a, managers read and only the server writes).
--
-- NOT APPLIED. Applies together with the load, after Jorge has settled the
-- workbook's open days. When it is applied it moves to supabase/migrations
-- under the version the project records for it, like every other file there.
--
-- sales_daily: one row per store per day that is KNOWN. A day nobody knows
--   has no row (unknown is not zero); a day the store was closed is a row with
--   closed = true and no count (the workbook's NA is not a zero either). The
--   source says where the number came from, so the daily report can top it up
--   later without overwriting a hand-checked figure by accident.
-- schedule_rules: a manager's days off, hours and least cover for a store,
--   with the date they take effect. A change is a new row, never an edit, so
--   what the rules were on any past day can be read back. The history is not
--   learned from: the rules have changed too much over the years.
--
-- Who reads: an ACTIVE, APPROVED profile (not pending) that is an admin or
-- names the store. A pending profile reads nothing, admin or not: the same rule
-- as mayReadDaily in api/daily-deliveries.mjs (#456), so the table and the
-- endpoint that will read it cannot disagree. This is stricter than
-- can_use_store, which lets an active admin in while pending, and it leaves out
-- the salesperson linked through the floor, on purpose. Who writes: the service
-- role only, from the server. No insert, update or delete policy exists, and the
-- grants to the signed-in and public roles are select only (the service role
-- bypasses row security and keeps Supabase's default grants).
-- No new function, so the advisors gain no new line.

create table public.sales_daily (
  store text not null check (store ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  day date not null,
  units integer check (units between 0 and 1000),
  closed boolean not null default false,
  source text not null check (length(source) between 1 and 80),
  loaded_at timestamptz not null default now(),
  primary key (store, day),
  constraint sales_daily_known check (
    (closed and units is null) or (not closed and units is not null))
);

create table public.schedule_rules (
  store text not null check (store ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  effective_from date not null,
  rules jsonb not null check (jsonb_typeof(rules) = 'object' and pg_column_size(rules) <= 20000),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (store, effective_from, set_at)
);

alter table public.sales_daily enable row level security;
alter table public.schedule_rules enable row level security;
revoke all on public.sales_daily, public.schedule_rules from anon, authenticated;
grant select on public.sales_daily, public.schedule_rules to authenticated;

create policy sales_daily_read on public.sales_daily for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and not p.pending
      and (p.role = 'admin' or sales_daily.store = any(p.stores))));

create policy schedule_rules_read on public.schedule_rules for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and not p.pending
      and (p.role = 'admin' or schedule_rules.store = any(p.stores))));
