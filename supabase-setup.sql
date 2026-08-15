-- ============================================================
--  Lead Performance Calculator — one-time database setup
--  Paste this whole file into Supabase → SQL Editor → Run.
-- ============================================================

-- A single key/value table holds everything: config, each store's
-- data, and the audit log. Values are JSON, matching the app's model.
create table if not exists app_data (
  key   text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- Keep updated_at fresh on every write.
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_data_touch on app_data;
create trigger app_data_touch
  before update on app_data
  for each row execute function touch_updated_at();

-- =====================================================================
-- WARNING: THE POLICY BLOCK BELOW IS UNSAFE. DO NOT RUN IT AS IS.
-- =====================================================================
-- These three policies grant `using (true)` for select, insert AND
-- update on app_data. The anon key ships inside the browser bundle by
-- design, so with these live, anyone who opens devtools can read and
-- REWRITE every store document, the config and every backup.
--
-- The comment that used to sit here said the app's own email + PIN +
-- domain gate controls access. That gate is client-side. It is not a
-- security boundary and it never was: RLS is the only thing standing
-- between the anon key and the data.
--
-- HANDOFF_2 section 3 describes a much tighter model that is believed to
-- be live (per-key-pattern policies plus has_store()), which would mean
-- this file is simply stale and was never re-run. That has not been
-- verified. Run supabase-rls-audit.sql, which is read only, to find out
-- what is actually in force before touching anything here.
--
-- COMMENTED OUT ON PURPOSE, AND IT MUST STAY THAT WAY.
-- A warning above executable SQL is not a safeguard. This file was pasted whole
-- into a live SQL editor with the warning sitting right there in it, and the
-- policies ran. Anything in this file that can widen access is now inert text.
-- If you need policies, write them from the output of supabase-rls-audit.sql
-- against what is actually live. Never from this file.
-- =====================================================================
alter table app_data enable row level security;

-- drop policy if exists "app_data read"  on app_data;
-- drop policy if exists "app_data write" on app_data;
-- drop policy if exists "app_data update" on app_data;

-- create policy "app_data read"   on app_data for select using (true);
-- create policy "app_data write"  on app_data for insert with check (true);
-- create policy "app_data update" on app_data for update using (true) with check (true);
