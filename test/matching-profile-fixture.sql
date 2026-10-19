-- Synthetic verified catalog shape only, never production account data.
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),role text NOT NULL DEFAULT 'manager' CHECK(role IN('admin','manager','overseer')),stores text[] NOT NULL DEFAULT '{}',active boolean NOT NULL DEFAULT true,pending boolean NOT NULL DEFAULT true,onboarded boolean DEFAULT false);
CREATE TABLE public.app_data(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO authenticated;
CREATE POLICY self_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
-- Matches the supplied pre-existing weak self-insert policy, unchanged.
CREATE POLICY self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK(id=auth.uid());
GRANT ALL ON public.profiles,public.app_data TO service_role;
INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO public.profiles(id,role,stores,active,pending) VALUES('00000000-0000-4000-8000-000000000001','manager',ARRAY['pilot-a'],true,false);
-- An unrelated user's profile is deliberately absent for self-insert tests.
