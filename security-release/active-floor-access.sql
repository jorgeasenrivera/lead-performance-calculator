-- LOCAL REVIEW DRAFT, not a numbered migration or deployment instruction.
-- Clear subset only. Does not repair whole-row writes, public schedules,
-- configuration/audit authority, or event-read scope. Preserve pending-linked floor.
BEGIN;
DO $precondition$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='can_use_store'
      AND pg_get_function_identity_arguments(p.oid)='store text'
      AND p.prosecdef AND p.prorettype = 'boolean'::regtype
      AND p.provolatile = 's' AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig = ARRAY['search_path=""']::text[]
      AND (SELECT array_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END || ':' || a.privilege_type || ':' || a.is_grantable::text ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a)
        = ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']::text[]
      AND p.prosrc=$captured$
  select exists (
           select 1 from public.profiles p
           where p.id = (select auth.uid()) and p.active
             and (p.role = 'admin' or (not p.pending and store = any(p.stores))))
      or exists (
           select 1 from public.floor_people fp
           where fp.user_id = (select auth.uid()) and fp.store = can_use_store.store);
$captured$)
  THEN RAISE EXCEPTION 'can_use_store differs from captured catalog; stop for reconciliation'; END IF;
END
$precondition$;
CREATE OR REPLACE FUNCTION public.can_use_store(store text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.active IS TRUE
      AND (p.role = 'admin'
        OR (NOT p.pending AND can_use_store.store = ANY(p.stores))
        OR EXISTS (SELECT 1 FROM public.floor_people fp
          WHERE fp.user_id = p.id AND fp.store = can_use_store.store))
  );
$function$;
-- CREATE OR REPLACE retains the existing owner and ACL. Do not broaden grants.
COMMIT;
