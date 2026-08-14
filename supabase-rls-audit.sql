-- =====================================================================
-- LPC — Row Level Security audit
-- =====================================================================
-- READ ONLY. Every statement here is a SELECT. Nothing is created,
-- altered or dropped, so this is safe to paste into the Supabase SQL
-- editor on a live database.
--
-- WHY THIS EXISTS
-- supabase-setup.sql in this repo grants:
--     for select using (true)
--     for insert with check (true)
--     for update using (true) with check (true)
-- on app_data. If that is what is actually live, then anyone holding the
-- anon key can read AND REWRITE every store document, the config, and
-- every backup. The anon key ships in the browser bundle by design; RLS
-- is supposed to be the boundary. The comment in that file says the app's
-- own email + PIN + domain gate controls access, but that gate is
-- client-side and is not a boundary.
--
-- HANDOFF_2 section 3 describes a much tighter live model, so the setup
-- file may simply be stale. Nobody has verified which is true. That is
-- the only question this script answers.
-- =====================================================================


-- 1. WHAT POLICIES ACTUALLY EXIST -------------------------------------
-- Look at the "qual" (USING) and "with_check" columns. Any policy on
-- app_data whose qual is literally "true" for select, insert or update
-- is the wide-open case described above.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual        as using_expression,
  with_check  as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;


-- 2. IS RLS EVEN TURNED ON ---------------------------------------------
-- A table with rowsecurity = false ignores every policy above it.
-- forcerowsecurity matters only for the table owner.
select
  c.relname                as table_name,
  c.relrowsecurity         as rls_enabled,
  c.relforcerowsecurity    as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;


-- 3. DOES has_store() EXIST, AND WHAT IS IT -----------------------------
-- HANDOFF_2 says the live policies call has_store(split_part(key,':',3)).
-- If this returns no rows, that model is NOT live here, and any policy
-- set that calls it would fail. Read the body before trusting it: this
-- function is what decides who can touch a store's data.
select
  p.proname                        as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_functiondef(p.oid)        as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('has_store', 'is_admin', 'current_store_ids')
  and n.nspname in ('public', 'auth');


-- 4. WHAT THE ANON ROLE CAN REACH ---------------------------------------
-- The TV boards and the salesperson sign-in pages are signed out, so anon
-- MUST be able to select lpc:board:% and must not be able to do anything
-- else. Anything here granting anon insert or update on app_data is a way
-- for a stranger to write to the database.
select
  policyname,
  cmd,
  roles,
  qual       as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'app_data'
  and ('anon' = any(roles) or 'public' = any(roles))
order by cmd;


-- 5. TABLE GRANTS, WHICH SIT UNDERNEATH RLS -----------------------------
-- RLS filters rows; grants decide whether the role may issue the
-- statement at all. Both have to be right.
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'public')
group by table_name, grantee
order by table_name, grantee;


-- 6. THE KEY SHAPES THE APP ACTUALLY USES -------------------------------
-- Every prefix below was read out of the source, so a correct policy set
-- has to cover all of them and nothing wider. Run this to see what is
-- really in the table and confirm nothing unexpected has been written.
--
--   lpc:config:v2                     app + ingest read, app writes
--   lpc:config:backup:{stamp}:v1      app
--   lpc:config:backups-index:v1       app
--   lpc:audit:v1                      app
--   lpc:store:{id}:v2                 app + ingest
--   lpc:store:{id}:act:{date}         app + ingest
--   lpc:board:{id}:v1                 app + ingest write, ANON READS
--   lpc:board:{id}:act:{date}         app + ingest write, ANON READS
--   lpc:backup:{storeId}:{stamp}:v1   app
--
-- Note lpc:intro-played, lpc:intro-count, lpc:disp:{storeId} and
-- lpcq:list:... are localStorage on the device, NOT rows in app_data.
select
  split_part(key, ':', 2) as area,
  count(*)                as rows,
  min(key)                as example_key,
  max(updated_at)         as most_recent
from app_data
group by 1
order by 1;


-- =====================================================================
-- IF SECTION 1 SHOWS using (true)
-- =====================================================================
-- Do not paste a replacement policy set from memory, and do not let an
-- assistant write one for you without seeing the output above first. Two
-- ways to get it wrong, both bad:
--
--   Too tight  -> every save fails for every manager, immediately.
--   Too loose  -> you are back where you started and think you are not.
--
-- The correct set depends on has_store() existing and on how a signed-in
-- user's store list is resolved, which section 3 answers. Send the output
-- of sections 1, 3 and 4 to whoever writes the replacement, apply it to a
-- branch or a staging project first, and check in this order:
--
--   1. A manager can still load and save their own store.
--   2. A manager CANNOT read a store they are not assigned to.
--   3. A signed-out browser can still read lpc:board:{id}:v1
--      (open a TV board URL in a private window).
--   4. A signed-out browser CANNOT write anything.
--   5. The hourly email ingest still writes, since it uses the service
--      role key and bypasses RLS entirely, so it should be unaffected.
-- =====================================================================
