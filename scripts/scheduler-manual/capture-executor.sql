-- REVIEW-ONLY migration candidate. Never automatically applied or hosted-tested.
-- Prerequisites: draft structure, publication-v2.sql, capture.sql, policy.sql.
BEGIN;
CREATE ROLE scheduler_capture_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,scheduler_private,scheduler_policy,scheduler_gateway TO scheduler_capture_executor;

-- Same current authority and lock order as publish_v2. No grant-table exposure.
CREATE FUNCTION scheduler_gateway.publication_permission_v1(actor uuid,s text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p record;BEGIN
 IF actor IS NULL OR s IS NULL OR s !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN RETURN false;END IF;
 SELECT id,role,stores,active,pending INTO p FROM public.profiles WHERE id=actor FOR SHARE;
 IF NOT FOUND OR p.active IS DISTINCT FROM true OR p.pending IS DISTINCT FROM false
 OR p.role NOT IN('manager','admin') OR (s=ANY(p.stores)) IS DISTINCT FROM true THEN RETURN false;END IF;
 PERFORM 1 FROM scheduler_policy.publication_scope_v2 WHERE store_id=s AND enabled FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM scheduler_policy.publication_grants_v2 WHERE actor_id=actor AND store_id=s AND enabled FOR SHARE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION scheduler_gateway.publication_permission_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION scheduler_gateway.publication_permission_v1(uuid,text) TO scheduler_runtime,scheduler_capture_executor;
-- Ownership transfer uses the same temporary installer membership convention as v2.
GRANT scheduler_executor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA scheduler_gateway TO scheduler_executor;
ALTER FUNCTION scheduler_gateway.publication_permission_v1(uuid,text) OWNER TO scheduler_executor;
REVOKE CREATE ON SCHEMA scheduler_gateway FROM scheduler_executor;
REVOKE scheduler_executor FROM CURRENT_USER;

-- Non-login definer can read source rows but cannot change source data or policy.
GRANT SELECT ON public.app_data TO scheduler_capture_executor;
CREATE POLICY capture_store_rows_v1 ON public.app_data FOR SELECT TO scheduler_capture_executor
 USING(key ~ '^lpc:store:[a-z0-9][a-z0-9_-]{0,63}:');
GRANT SELECT ON scheduler_private.heads,scheduler_private.versions,scheduler_private.capture_inputs_v1 TO scheduler_capture_executor;
CREATE POLICY capture_heads_read_v1 ON scheduler_private.heads FOR SELECT TO scheduler_capture_executor USING(true);
CREATE POLICY capture_versions_read_v1 ON scheduler_private.versions FOR SELECT TO scheduler_capture_executor USING(true);
ALTER TABLE scheduler_private.capture_inputs_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY capture_inputs_read_v1 ON scheduler_private.capture_inputs_v1 FOR SELECT TO scheduler_capture_executor USING(true);
ALTER TABLE scheduler_private.capture_generation_v1 ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON scheduler_private.capture_generation_v1 TO scheduler_capture_executor;
CREATE POLICY capture_generation_read_v1 ON scheduler_private.capture_generation_v1 FOR SELECT TO scheduler_capture_executor USING(true);
CREATE POLICY capture_generation_insert_v1 ON scheduler_private.capture_generation_v1 FOR INSERT TO scheduler_capture_executor WITH CHECK(true);
GRANT SELECT,INSERT ON scheduler_private.publication_contexts_v2 TO scheduler_capture_executor;
CREATE POLICY capture_context_read_v1 ON scheduler_private.publication_contexts_v2 FOR SELECT TO scheduler_capture_executor USING(true);
CREATE POLICY capture_context_insert_v1 ON scheduler_private.publication_contexts_v2 FOR INSERT TO scheduler_capture_executor WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON scheduler_private.publication_source_heads_v2 TO scheduler_capture_executor;
CREATE POLICY capture_source_head_v1 ON scheduler_private.publication_source_heads_v2 TO scheduler_capture_executor USING(true) WITH CHECK(true);
GRANT EXECUTE ON FUNCTION scheduler_private.object_keys(jsonb,text[]) TO scheduler_capture_executor;

CREATE FUNCTION scheduler_gateway.capture_snapshot_v2(actor uuid,s text,m text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT scheduler_gateway.publication_permission_v1(actor,s) THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 IF m IS NULL OR m !~ '^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$' OR m<'2014-01' THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 RETURN scheduler_private.capture_snapshot_v1(s,m);
END $$;
CREATE FUNCTION scheduler_gateway.register_capture_v2(actor uuid,expected jsonb,txt text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;s text;m text;h jsonb;BEGIN
 IF txt IS NULL OR octet_length(txt)>8000000 OR expected IS NULL THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 c:=txt::jsonb;s:=expected->'scope'->>'storeId';m:=expected->'scope'->>'month';
 IF m IS NULL OR m !~ '^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$' OR m<'2014-01' THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 IF NOT scheduler_gateway.publication_permission_v1(actor,s) THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 h:=expected->'heads'->m;
 IF NOT scheduler_private.object_keys(c,ARRAY['version','scope','sourceEpoch','inputText','inputDigest','review','binding','expected','plan','projection'])
 OR c->>'version' IS DISTINCT FROM 'scheduler-publication-context/2'
 OR c->'scope' IS DISTINCT FROM jsonb_build_object('storeId',s,'month',m)
 OR c->'sourceEpoch' IS DISTINCT FROM expected->'epoch'
 OR c->'plan'->'auditEntry'->'actor'->>'id' IS DISTINCT FROM actor::text
 OR c->'expected' IS DISTINCT FROM jsonb_build_object('head',jsonb_build_object('draftRev',h->'draft_rev','publishedRev',h->'published_rev'),'prevAuditHash',h->'last_audit_hash','auditRevision',h->'audit_revision')
 OR jsonb_typeof(c->'projection') IS DISTINCT FROM 'array'
 OR jsonb_typeof(c->'plan'->'ops') IS DISTINCT FROM 'array'
 OR jsonb_typeof(c->'inputText') IS DISTINCT FROM 'string'
 OR c->>'inputDigest' IS DISTINCT FROM encode(sha256(convert_to(c->>'inputText','UTF8')),'hex')
 THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 -- Strict JS assembly/review is still a trusted server capability. SQL does not
 -- independently recompute planner review or projection. Raw register stays private.
 RETURN scheduler_private.register_capture_v1(expected,txt);
END $$;
CREATE FUNCTION scheduler_gateway.capture_context_v2(actor uuid,s text,m text,id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE c record;BEGIN
 IF NOT scheduler_gateway.publication_permission_v1(actor,s) THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 SELECT context_text,body INTO c FROM scheduler_private.publication_contexts_v2 WHERE context_id=id;
 IF NOT FOUND OR c.body->'scope' IS DISTINCT FROM jsonb_build_object('storeId',s,'month',m)
 OR c.body->'plan'->'auditEntry'->'actor'->>'id' IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 RETURN c.context_text;
END $$;
REVOKE ALL ON FUNCTION scheduler_gateway.capture_snapshot_v2(uuid,text,text),scheduler_gateway.register_capture_v2(uuid,jsonb,text),scheduler_gateway.capture_context_v2(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION scheduler_gateway.capture_snapshot_v2(uuid,text,text),scheduler_gateway.register_capture_v2(uuid,jsonb,text),scheduler_gateway.capture_context_v2(uuid,text,text,text) TO scheduler_runtime;
GRANT scheduler_capture_executor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA scheduler_private,scheduler_gateway TO scheduler_capture_executor;
ALTER FUNCTION scheduler_private.capture_snapshot_v1(text,text) OWNER TO scheduler_capture_executor;
ALTER FUNCTION scheduler_private.register_capture_v1(jsonb,text) OWNER TO scheduler_capture_executor;
ALTER FUNCTION scheduler_gateway.capture_snapshot_v2(uuid,text,text) OWNER TO scheduler_capture_executor;
ALTER FUNCTION scheduler_gateway.register_capture_v2(uuid,jsonb,text) OWNER TO scheduler_capture_executor;
ALTER FUNCTION scheduler_gateway.capture_context_v2(uuid,text,text,text) OWNER TO scheduler_capture_executor;
REVOKE CREATE ON SCHEMA scheduler_private,scheduler_gateway FROM scheduler_capture_executor;
REVOKE scheduler_capture_executor FROM CURRENT_USER;
COMMIT;
