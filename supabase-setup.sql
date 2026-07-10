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

-- Turn on row-level security, then allow the public (anon) key to
-- read and write. The app's own email + PIN + domain gate is what
-- controls access; this mirrors how the artifact shared storage worked.
alter table app_data enable row level security;

drop policy if exists "app_data read"  on app_data;
drop policy if exists "app_data write" on app_data;
drop policy if exists "app_data update" on app_data;

create policy "app_data read"   on app_data for select using (true);
create policy "app_data write"  on app_data for insert with check (true);
create policy "app_data update" on app_data for update using (true) with check (true);
