-- SEPARATE, UNEXECUTED PROPOSAL. Requires verified Jorge auth UUID and an
-- explicit single-store scheduler scope; general profile assignments stay unchanged.
-- psql variables pilot_actor_id (UUID) and pilot_store_ids_json (JSON array).
-- Stage remains disabled; enabling is a separate activation approval.
BEGIN;
CREATE TEMP TABLE approved_pilot_input ON COMMIT DROP AS
 SELECT :'pilot_actor_id'::uuid AS actor_id, :'pilot_store_ids_json'::jsonb AS stores;
DO $$
DECLARE a record; p record; ids text[];
BEGIN
 SELECT * INTO a FROM approved_pilot_input;
 IF jsonb_typeof(a.stores) IS DISTINCT FROM 'array' OR jsonb_array_length(a.stores)<>1
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.stores) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR (x#>>'{}') !~ '^[a-z0-9][a-z0-9_-]{0,63}$') THEN RAISE EXCEPTION 'pilot configuration invalid';END IF;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM jsonb_array_elements_text(a.stores) x;
 IF ids IS DISTINCT FROM ARRAY['driver-s-mart-winter-park']::text[] THEN RAISE EXCEPTION 'pilot store not approved';END IF;
 SELECT id,role,active,pending INTO p FROM public.profiles WHERE id=a.actor_id FOR SHARE;
 IF NOT FOUND OR p.active IS DISTINCT FROM true OR p.pending IS DISTINCT FROM false OR p.role NOT IN('admin','manager') THEN RAISE EXCEPTION 'pilot identity not eligible';END IF;
 INSERT INTO scheduler_policy.pilot_scope(singleton,actor_id,approved_store_ids,enabled) VALUES(true,a.actor_id,ids,false);
 INSERT INTO scheduler_policy.draft_grants(actor_id,store_id,permission,enabled)
 SELECT a.actor_id,s,permission,false FROM unnest(ids) s CROSS JOIN (VALUES('draft-read'),('draft-save')) v(permission);
END $$;
COMMIT;
