-- =====================================================================
-- LPC — restore the three app_data policies the setup file destroyed
-- =====================================================================
-- WHAT HAPPENED
-- supabase-setup.sql was pasted into the SQL editor on a live database.
-- Its policy block began with:
--     drop policy if exists "app_data read"  on app_data;   (etc)
-- and the real policies were named exactly that, each carrying the key
-- pattern list. They were dropped and replaced with using (true).
--
-- The audit afterwards showed only lpc:board:% and lpc:backup:% still
-- had real rules, because those live in separately named policies. There
-- was NO policy left for lpc:config:%, lpc:audit:% or lpc:store:%, which
-- is why dropping the open three on their own would take the app down
-- rather than secure it. This does both halves in one transaction.
--
-- Patterns are from HANDOFF_2 section 3. has_store() is confirmed to
-- exist: the surviving backup policies call it.
-- =====================================================================

begin;

drop policy if exists "app_data read"   on app_data;
drop policy if exists "app_data write"  on app_data;
drop policy if exists "app_data update" on app_data;

-- Signed-in users only. The one thing a signed-out browser still needs is
-- the board, and that is served by the separate anon policy which was not
-- touched: "board rows are readable by anyone".
create policy "app_data read" on app_data
  for select to authenticated
  using (
        key like 'lpc:config:%'
     or key like 'lpc:audit:%'
     or key like 'lpc:board:%'
     or (key like 'lpc:store:%'  and has_store(split_part(key, ':', 3)))
     or (key like 'lpc:backup:%' and has_store(split_part(key, ':', 3)))
  );

create policy "app_data write" on app_data
  for insert to authenticated
  with check (
        key like 'lpc:config:%'
     or key like 'lpc:audit:%'
     or key like 'lpc:board:%'
     or (key like 'lpc:store:%'  and has_store(split_part(key, ':', 3)))
     or (key like 'lpc:backup:%' and has_store(split_part(key, ':', 3)))
  );

create policy "app_data update" on app_data
  for update to authenticated
  using (
        key like 'lpc:config:%'
     or key like 'lpc:audit:%'
     or key like 'lpc:board:%'
     or (key like 'lpc:store:%'  and has_store(split_part(key, ':', 3)))
     or (key like 'lpc:backup:%' and has_store(split_part(key, ':', 3)))
  )
  with check (
        key like 'lpc:config:%'
     or key like 'lpc:audit:%'
     or key like 'lpc:board:%'
     or (key like 'lpc:store:%'  and has_store(split_part(key, ':', 3)))
     or (key like 'lpc:backup:%' and has_store(split_part(key, ':', 3)))
  );

commit;

-- =====================================================================
-- CHECK IMMEDIATELY AFTER RUNNING, IN THIS ORDER
-- =====================================================================
-- 1. Re-run supabase-rls-audit.sql. No policy on app_data should have a
--    using_expr or with_check of plain `true` any more.
-- 2. Sign in as a manager. Their store must load and save.
-- 3. Open a TV board URL in a private window. It must still render, which
--    proves the anon board policy survived.
-- 4. A signed-out browser must NOT be able to read a store row.
-- 5. The hourly ingest is unaffected either way: it uses the service role
--    key, which bypasses RLS entirely.
--
-- ONE THING THAT MAY REGRESS, AND THE FIX
-- The anonymous sign-in pages (The Line, Online, Live Floor) read
-- lpc:config:v2 for the support contact and the store's activity
-- standards. Under `to authenticated` that read is refused, and the code
-- swallows the failure, so the pages still work but fall back to default
-- standards and lose the Help contact. If that matters, add exactly this
-- and nothing wider:
--
--   create policy "config readable by anyone" on app_data
--     for select to anon using (key like 'lpc:config:%');
--
-- Read only, config only. Do not extend it to lpc:store:%.
-- =====================================================================
