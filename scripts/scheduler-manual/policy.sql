-- Local migration candidate only. No runtime access or manager policy-edit grant.
BEGIN;
CREATE TABLE scheduler_private.manual_policy_history_v1(
 store_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),request_id text NOT NULL,
 old_payload jsonb,new_payload jsonb NOT NULL,writer name NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(store_id,revision),UNIQUE(store_id,request_id));
REVOKE ALL ON scheduler_private.manual_policy_history_v1 FROM PUBLIC,anon,authenticated,service_role,scheduler_runtime,scheduler_executor;
CREATE FUNCTION scheduler_private.manual_policy_valid_v1(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m record;p jsonb;e record;r jsonb;k record;BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR v->>'version' IS DISTINCT FROM 'scheduler-manual-policy/1'
 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key) IS DISTINCT FROM ARRAY['months','version']
 OR jsonb_typeof(v->'months')<>'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v->'months'))>1044 THEN RETURN false;END IF;
 FOR m IN SELECT * FROM jsonb_each(v->'months') LOOP
  IF m.key!~ '^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$' OR m.key<'2014-01' THEN RETURN false;END IF;
  p:=m.value;IF p='null'::jsonb THEN CONTINUE;END IF;
  IF jsonb_typeof(p)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p) key) IS DISTINCT FROM ARRAY['people','requiredRoles']
  OR jsonb_typeof(p->'people')<>'object' OR jsonb_typeof(p->'requiredRoles')<>'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p->'people'))>500 THEN RETURN false;END IF;
  FOR e IN SELECT * FROM jsonb_each(p->'people') LOOP
   IF e.key IN ('__proto__','constructor','prototype') OR length(e.key)>200 OR jsonb_typeof(e.value)<>'object' THEN RETURN false;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(e.value) key WHERE key NOT IN ('eligible','roles')) THEN RETURN false;END IF;
   IF e.value?'eligible' AND jsonb_typeof(e.value->'eligible')<>'boolean' THEN RETURN false;END IF;
   IF e.value?'roles' THEN
    IF jsonb_typeof(e.value->'roles')<>'array' OR jsonb_array_length(e.value->'roles')>50 THEN RETURN false;END IF;
    FOR r IN SELECT value FROM jsonb_array_elements(e.value->'roles') LOOP
     IF jsonb_typeof(r)<>'string' OR length(r#>>'{}')>2000 THEN RETURN false;END IF;
    END LOOP;
   END IF;
  END LOOP;
  FOR k IN SELECT * FROM jsonb_each(p->'requiredRoles') LOOP
   IF k.key IN ('__proto__','constructor','prototype') OR length(k.key)>200 OR jsonb_typeof(k.value)<>'number' THEN RETURN false;END IF;
  END LOOP;
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
CREATE FUNCTION scheduler_private.put_manual_policy_v1(s text,expected jsonb,replacement jsonb,request text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior scheduler_private.manual_policy_history_v1%ROWTYPE;current_payload jsonb;rev bigint;BEGIN
 IF s!~ '^[a-z0-9][a-z0-9_-]{0,63}$' OR request!~ '^[A-Za-z0-9_-]{1,80}$' OR s IS NULL OR request IS NULL
 OR NOT scheduler_private.manual_policy_valid_v1(replacement) THEN RAISE EXCEPTION 'manual-policy:invalid';END IF;
 -- Same table-before-store lock order as snapshot/registration and TRUNCATE.
 LOCK TABLE scheduler_private.capture_inputs_v1 IN ROW EXCLUSIVE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('sage-scheduler:'||s,0));
 SELECT * INTO prior FROM scheduler_private.manual_policy_history_v1 WHERE store_id=s AND request_id=request;
 IF FOUND THEN
  IF prior.old_payload IS DISTINCT FROM expected OR prior.new_payload IS DISTINCT FROM replacement THEN RAISE EXCEPTION 'manual-policy:idempotency-conflict';END IF;
  RETURN prior.revision;
 END IF;
 SELECT payload INTO current_payload FROM scheduler_private.capture_inputs_v1 WHERE store_id=s;
 IF current_payload IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manual-policy:conflict';END IF;
 SELECT COALESCE(max(revision),0)+1 INTO rev FROM scheduler_private.manual_policy_history_v1 WHERE store_id=s;
 INSERT INTO scheduler_private.capture_inputs_v1 VALUES(s,replacement) ON CONFLICT(store_id) DO UPDATE SET payload=EXCLUDED.payload;
 -- Existing trigger invalidates capture in this same transaction.
 INSERT INTO scheduler_private.manual_policy_history_v1 VALUES(s,rev,request,expected,replacement,session_user,clock_timestamp());
 RETURN rev;
END $$;
REVOKE ALL ON FUNCTION scheduler_private.manual_policy_valid_v1(jsonb),scheduler_private.put_manual_policy_v1(text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,scheduler_runtime,scheduler_executor;
COMMIT;
