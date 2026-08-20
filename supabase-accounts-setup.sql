-- Salesperson accounts, and the link between an account and a person on the floor.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS TABLE EXISTS
-- There are two ids for a salesperson and they are not interchangeable. The
-- account they sign in with is a uuid in auth.users. The id the LINE uses is the
-- roster id published from the store's own roster, and that is what every queue
-- entry is written with. Anything that wants to reach the person standing at
-- position 3 has to speak roster ids.
--
-- Joining them is a decision a manager makes once, and it is recorded rather than
-- guessed. Matching on name would put a customer in the wrong hands the first
-- time a store hires a second Chris.

create table if not exists public.floor_people (
  id          text primary key,            -- store:user_id
  user_id     uuid not null,               -- auth.users.id, the account
  store       text not null,
  person_id   text not null,               -- the roster id the queue writes
  linked_by   uuid,                        -- the manager who made the call
  updated_at  timestamptz not null default now()
);

-- One account per person, and one person per account, within a store. Two
-- accounts on one person means two phones both believing they are up, and
-- whichever answers second finds the customer already gone.
create unique index if not exists floor_people_one_per_person on public.floor_people (store, person_id);
create unique index if not exists floor_people_one_per_account on public.floor_people (store, user_id);

alter table public.floor_people enable row level security;

-- A salesperson may read their own link and nothing else: it tells their app who
-- it is on the floor. Writes go through /api/link-person, which checks the caller
-- manages that store by reading their profile server-side. A role sent from a
-- browser is worth nothing.
drop policy if exists floor_people_read_own on public.floor_people;
create policy floor_people_read_own on public.floor_people
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.floor_people from anon, authenticated;

-- HOW AN ACCOUNT COMES INTO EXISTENCE
-- Invite from the Supabase dashboard (Authentication, Invite user) or with the
-- admin API. The salesperson sets a password once, and the session persists on
-- their phone from then on, so day to day they never sign in again. The PIN on
-- the podium screen is unaffected and stays as it is: it is for a shared device,
-- where a persistent session belonging to one person would be wrong.
