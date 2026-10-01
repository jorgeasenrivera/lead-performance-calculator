-- Applied 2026-09-12 through the Supabase access; kept here so the repo says
-- what the database has. The security advisor's findings, and the policy tidy
-- from the performance one.
--
-- 1. SECURITY DEFINER functions run as their owner, so who may call them is
--    the whole question. The auth trigger is for the auth server alone; the
--    RLS event trigger is nobody's to call; the three helpers the app and its
--    policies use are for signed-in accounts. Anonymous callers (the anon key
--    is in every copy of the app) get none of them.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.has_store(text) from public, anon;
grant execute on function public.has_store(text) to authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.mark_onboarded() from public, anon;
grant execute on function public.mark_onboarded() to authenticated;

-- 2. A function without a pinned search_path resolves names in whatever path
--    the caller set. These two never needed anything but public.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create or replace function public.prune_device_tokens() returns void
language sql set search_path = public as $$
  delete from public.device_tokens where updated_at < now() - interval '90 days';
$$;
revoke execute on function public.prune_device_tokens() from public, anon, authenticated;

-- 3. profiles: for signed-in accounts only (nothing anonymous reads it), and
--    auth.uid() read once per query rather than once per row.
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (id = (select auth.uid()) or is_admin());
create policy "profiles insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles update" on public.profiles for update to authenticated using (is_admin()) with check (is_admin());
create policy "profiles delete" on public.profiles for delete to authenticated using (is_admin());

-- 4. floor_people: the same once-per-query read.
drop policy if exists floor_people_read_own on public.floor_people;
create policy floor_people_read_own on public.floor_people for select to authenticated using (user_id = (select auth.uid()));

-- 5. app_data: three policies per action where one already said everything.
--    "app_data read/write/update" cover the board and backup prefixes with
--    the same conditions the narrower policies repeated, so those go. The
--    anonymous board read is a different role and stays.
drop policy if exists "backup rows follow store access" on public.app_data;
drop policy if exists "board rows writable by signed-in users" on public.app_data;
drop policy if exists "backup rows readable with store access" on public.app_data;
drop policy if exists "backup rows updatable with store access" on public.app_data;
drop policy if exists "board rows updatable by signed-in users" on public.app_data;

-- Not SQL, and still open: leaked-password protection is a switch under
-- Authentication → Providers → Email in the dashboard.
