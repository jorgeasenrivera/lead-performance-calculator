-- What kind of account somebody asked for when they signed up.
-- -------------------------------------------------------------------------
-- Two people wait on the "no access yet" screen for opposite reasons. A manager
-- is waiting for stores, which only an admin can grant. A salesperson is waiting
-- to be joined to their name on the floor, which happens in Live Floor → Phones
-- and needs no stores at all. The app asks which at sign-up and puts the answer
-- in the account's own metadata, where it works with no database change.
--
-- Run this and the answer also reaches the admin's approval queue, so nobody has
-- to guess which of the two is standing in it.

alter table public.profiles
  add column if not exists wants text;

-- Carry it across when the account is created. Adjust the function name if your
-- profiles trigger is called something else — this is the usual Supabase one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, wants)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'wants', '')
  )
  on conflict (id) do update
    set wants = coalesce(excluded.wants, public.profiles.wants);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts keep a null `wants`, and the app simply does not show a tag
-- for them rather than inventing one.
