-- Local coordinated contract draft. Not an activation migration.
-- Must follow active-floor-access.sql in a reconciled schema. No production use.
BEGIN;
CREATE SCHEMA sage_private;
REVOKE ALL ON SCHEMA sage_private FROM PUBLIC, anon, authenticated;
CREATE FUNCTION sage_private.actor() RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id=(SELECT auth.uid()) FOR SHARE;
  IF NOT FOUND OR p.active IS NOT TRUE THEN RAISE EXCEPTION 'active account required' USING ERRCODE='42501'; END IF;
  RETURN p;
END $$;
CREATE FUNCTION sage_private.manages(p public.profiles,sid text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(p.active IS TRUE AND p.pending IS FALSE AND
 (p.role='admin' OR (p.role='manager' AND sid=ANY(p.stores))), false);
$$;
CREATE FUNCTION public.sage_approved_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid())
 AND active IS TRUE AND pending IS FALSE AND role='admin');
$$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.sage_approved_admin(); $$;
CREATE FUNCTION public.sage_manages_store(sid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND sage_private.manages(p,sid));
$$;
REVOKE ALL ON FUNCTION sage_private.actor(),sage_private.manages(public.profiles,text),public.sage_approved_admin(),public.sage_manages_store(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_approved_admin(),public.sage_manages_store(text) TO authenticated;
-- Prevent a missing-profile self insert from supplying management privileges.
-- Deployed signup trigger is not captured and remains a separate release gate.
DROP POLICY "profiles insert" ON public.profiles;
CREATE POLICY "profiles insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK
 (public.sage_approved_admin() OR (id=(SELECT auth.uid()) AND role='manager' AND active IS TRUE AND pending IS TRUE AND stores='{}'::text[]));
DROP POLICY "profiles update" ON public.profiles;
CREATE POLICY "profiles update" ON public.profiles FOR UPDATE TO authenticated
 USING(public.sage_approved_admin()) WITH CHECK(public.sage_approved_admin());
DROP POLICY "profiles delete" ON public.profiles;
CREATE POLICY "profiles delete" ON public.profiles FOR DELETE TO authenticated USING(public.sage_approved_admin());

CREATE TABLE sage_private.audit_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL,
 store text, action text NOT NULL, detail jsonb NOT NULL, correction_of bigint REFERENCES sage_private.audit_events(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sage_private.receipts(
 actor uuid NOT NULL, operation_id uuid NOT NULL, operation text NOT NULL,
 request jsonb NOT NULL, response jsonb NOT NULL, PRIMARY KEY(actor,operation_id));
CREATE TABLE sage_private.schedule_publications(
 store text NOT NULL, month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 revision bigint NOT NULL CHECK(revision>0), source_revision bigint NOT NULL,
 people jsonb NOT NULL CHECK(jsonb_typeof(people)='object'),
 published_by uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(store,month));
CREATE TABLE sage_private.dealer_mapping(
 dealership_norm text PRIMARY KEY CHECK(dealership_norm ~ '^[a-z0-9]+( [a-z0-9]+)*$'),
 store text NOT NULL CHECK(store ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE sage_private.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_private.schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_private.dealer_mapping ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sage_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sage_private FROM PUBLIC,anon,authenticated;

-- Serialize duplicate requests before reading their receipt. Authentication is
-- rechecked first, so a revoked actor cannot replay an old authorized response.
CREATE FUNCTION sage_private.replay(actor_id uuid,op_id uuid,op text,req jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r sage_private.receipts;
BEGIN
 IF op_id IS NULL THEN RAISE EXCEPTION 'operation id required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||op_id::text,0));
 SELECT * INTO r FROM sage_private.receipts WHERE actor=actor_id AND operation_id=op_id;
 IF FOUND THEN
  IF r.operation<>op OR r.request<>req THEN RAISE EXCEPTION 'operation id reused with different request' USING ERRCODE='22023'; END IF;
  RETURN r.response;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.sage_schedule_read(p_store text,p_month text,p_view text DEFAULT 'own') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; s sage_private.schedule_publications; person text;
BEGIN
 p:=sage_private.actor();
 IF p.pending IS NOT FALSE THEN RAISE EXCEPTION 'approval required' USING ERRCODE='42501'; END IF;
 IF p_store IS NULL OR p_store !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'store and month required' USING ERRCODE='22023'; END IF;
 IF p_view IS NULL OR p_view NOT IN ('own','manager') THEN RAISE EXCEPTION 'invalid view' USING ERRCODE='22023'; END IF;
 IF p_view='manager' AND NOT sage_private.manages(p,p_store) THEN RAISE EXCEPTION 'approved store manager required' USING ERRCODE='42501'; END IF;
 IF p_view='own' THEN
  SELECT person_id INTO person FROM public.floor_people WHERE user_id=p.id AND store=p_store FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not linked to this store' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO s FROM sage_private.schedule_publications WHERE store=p_store AND month=p_month;
 IF NOT FOUND OR (person IS NOT NULL AND NOT s.people ? person) THEN
  RETURN jsonb_build_object('state','unpublished','store',p_store,'month',p_month,'subject',person);
 END IF;
 RETURN jsonb_build_object('state','published','store',p_store,'month',p_month,'subject',person,
  'revision',s.revision,'sourceRevision',s.source_revision,'publishedAt',s.published_at,
  'people',CASE WHEN person IS NULL THEN s.people ELSE jsonb_build_object(person,s.people->person) END);
END $$;

CREATE FUNCTION public.sage_schedule_publish(p_store text,p_month text,p_source_revision bigint,p_previous_revision bigint,p_reviewed_people jsonb,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; doc jsonb; people jsonb:='{}'; a jsonb; dates jsonb; d text;
 sid text; previous bigint; req jsonb; result jsonb;
BEGIN
 p:=sage_private.actor();
 IF NOT sage_private.manages(p,p_store) THEN RAISE EXCEPTION 'approved store manager required' USING ERRCODE='42501'; END IF;
 IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'month required' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('store',p_store,'month',p_month,'source',p_source_revision,'previous',p_previous_revision,'people',p_reviewed_people);
 result:=sage_private.replay(p.id,p_operation_id,'schedule.publish',req); IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT value INTO doc FROM public.app_data WHERE key='lpc:store:'||p_store||':v2' FOR UPDATE;
 IF NOT FOUND OR doc IS NULL OR COALESCE((doc->>'rev')::bigint,0) IS DISTINCT FROM p_source_revision THEN
  RAISE EXCEPTION 'draft changed; review again' USING ERRCODE='40001'; END IF;
 SELECT revision INTO previous FROM sage_private.schedule_publications WHERE store=p_store AND month=p_month FOR UPDATE;
 previous:=COALESCE(previous,0);
 IF previous IS DISTINCT FROM p_previous_revision THEN RAISE EXCEPTION 'publication changed; review again' USING ERRCODE='40001'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(doc->'roster','[]')) LOOP
  sid:=a->>'id';
  IF sid IS NULL OR sid='' OR people ? sid THEN RAISE EXCEPTION 'invalid or duplicate roster identity' USING ERRCODE='22023'; END IF;
  dates:='[]';
  FOR d IN SELECT jsonb_array_elements_text(COALESCE(doc->'daysOff'->sid,'[]')) LOOP
   IF d LIKE p_month||'-%' THEN
    IF d !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(d::date,'YYYY-MM-DD')<>d THEN RAISE EXCEPTION 'invalid schedule date' USING ERRCODE='22023'; END IF;
    IF NOT dates ? d THEN dates:=dates||jsonb_build_array(d); END IF;
   END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO dates FROM jsonb_array_elements(dates) x;
  people:=people||jsonb_build_object(sid,jsonb_build_object('offDates',dates));
 END LOOP;
 IF people IS DISTINCT FROM p_reviewed_people THEN RAISE EXCEPTION 'draft differs from reviewed schedule' USING ERRCODE='40001'; END IF;
 IF people='{}'::jsonb THEN RAISE EXCEPTION 'review a roster before publishing' USING ERRCODE='22023'; END IF;
 INSERT INTO sage_private.schedule_publications(store,month,revision,source_revision,people,published_by)
 VALUES(p_store,p_month,previous+1,p_source_revision,people,p.id)
 ON CONFLICT(store,month) DO UPDATE SET revision=EXCLUDED.revision,source_revision=EXCLUDED.source_revision,
 people=EXCLUDED.people,published_by=EXCLUDED.published_by,published_at=clock_timestamp();
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,p_store,'schedule.publish',jsonb_build_object('month',p_month,'revision',previous+1,'sourceRevision',p_source_revision));
 result:=jsonb_build_object('ok',true,'revision',previous+1,'sourceRevision',p_source_revision);
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'schedule.publish',req,result);
 RETURN result;
END $$;

CREATE FUNCTION public.sage_dealer_map(p_dealership_norm text,p_store text,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; req jsonb; result jsonb; old_store text;
BEGIN
 p:=sage_private.actor();
 IF p.pending IS NOT FALSE OR p.role<>'admin' THEN RAISE EXCEPTION 'approved administrator required' USING ERRCODE='42501'; END IF;
 IF p_dealership_norm IS NULL OR p_dealership_norm !~ '^[a-z0-9]+( [a-z0-9]+)*$' OR p_store IS NULL THEN RAISE EXCEPTION 'canonical dealership and store required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_data d, jsonb_array_elements(d.value->'stores') s WHERE d.key='lpc:config:v2' AND s->>'id'=p_store) THEN RAISE EXCEPTION 'unknown store' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('dealership',p_dealership_norm,'store',p_store);
 result:=sage_private.replay(p.id,p_operation_id,'dealer.map',req); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dealer:'||p_dealership_norm,0));
 SELECT store INTO old_store FROM sage_private.dealer_mapping WHERE dealership_norm=p_dealership_norm FOR UPDATE;
 INSERT INTO sage_private.dealer_mapping VALUES(p_dealership_norm,p_store,p.id,clock_timestamp())
 ON CONFLICT(dealership_norm) DO UPDATE SET store=EXCLUDED.store,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,p_store,'dealer.map',jsonb_build_object('dealership',p_dealership_norm,'previousStore',old_store));
 result:=jsonb_build_object('ok',true);
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'dealer.map',req,result);
 RETURN result;
END $$;
CREATE FUNCTION public.sage_event_read_allowed(dealer text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN sage_private.dealer_mapping m ON m.dealership_norm=dealer
 WHERE p.id=(SELECT auth.uid()) AND sage_private.manages(p,m.store));
$$;
DROP POLICY deal_events_read ON public.deal_events;
CREATE POLICY deal_events_read ON public.deal_events FOR SELECT TO authenticated USING(public.sage_event_read_allowed(dealership_norm));

CREATE FUNCTION public.sage_audit_read(p_store text) RETURNS SETOF sage_private.audit_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles;
BEGIN
 p:=sage_private.actor();
 IF NOT sage_private.manages(p,p_store) THEN RAISE EXCEPTION 'approved store manager required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM sage_private.audit_events WHERE store=p_store OR (p.role='admin' AND p_store IS NULL) ORDER BY id DESC LIMIT 400;
END $$;
CREATE FUNCTION public.sage_audit_correct(p_event_id bigint,p_note text,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; e sage_private.audit_events; req jsonb; result jsonb; new_id bigint;
BEGIN
 p:=sage_private.actor();
 SELECT * INTO e FROM sage_private.audit_events WHERE id=p_event_id;
 IF NOT FOUND OR NOT sage_private.manages(p,e.store) THEN RAISE EXCEPTION 'event not available' USING ERRCODE='42501'; END IF;
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'correction required' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('event',p_event_id,'note',p_note);
 result:=sage_private.replay(p.id,p_operation_id,'audit.correct',req); IF result IS NOT NULL THEN RETURN result; END IF;
 INSERT INTO sage_private.audit_events(actor,store,action,detail,correction_of)
 VALUES(p.id,e.store,'audit.correct',jsonb_build_object('note',p_note),e.id) RETURNING id INTO new_id;
 result:=jsonb_build_object('ok',true,'id',new_id);
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'audit.correct',req,result);
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sage_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sage_schedule_read(text,text,text),public.sage_schedule_publish(text,text,bigint,bigint,jsonb,uuid),public.sage_dealer_map(text,text,uuid),public.sage_event_read_allowed(text),public.sage_audit_read(text),public.sage_audit_correct(bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_schedule_read(text,text,text),public.sage_schedule_publish(text,text,bigint,bigint,jsonb,uuid),public.sage_dealer_map(text,text,uuid),public.sage_event_read_allowed(text),public.sage_audit_read(text),public.sage_audit_correct(bigint,text,uuid) TO authenticated;
CREATE FUNCTION public.sage_config_save(p_before jsonb,p_after jsonb,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; current_doc jsonb; merged jsonb; wanted jsonb; old_store jsonb; now_store jsonb;
 sid text; idx integer; k text; req jsonb; result jsonb; changed_stores text[]:='{}'; allowed text[]:=ARRAY['activityStandards','floorConfig','graceDays','rooms','hours','fence','thresholds','goals','floorPlan','stationPlan','stationMode','coverAt'];
BEGIN
 p:=sage_private.actor();
 IF p.pending IS NOT FALSE OR p.role NOT IN ('admin','manager') OR (p.role='manager' AND cardinality(p.stores)=0) THEN RAISE EXCEPTION 'approved management required' USING ERRCODE='42501'; END IF;
 IF p_before IS NULL OR p_after IS NULL OR jsonb_typeof(p_before)<>'object' OR jsonb_typeof(p_after)<>'object' THEN RAISE EXCEPTION 'configuration required' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('before',p_before,'after',p_after);
 result:=sage_private.replay(p.id,p_operation_id,'config.save',req); IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT value INTO current_doc FROM public.app_data WHERE key='lpc:config:v2' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'configuration initialization requires maintenance' USING ERRCODE='40001'; END IF;
 merged:=current_doc;
 IF p.role='admin' THEN
  IF current_doc IS DISTINCT FROM p_before THEN RAISE EXCEPTION 'configuration changed; reload' USING ERRCODE='40001'; END IF;
  merged:=p_after;
 ELSE
  IF (p_before-ARRAY['stores','standards']) IS DISTINCT FROM (p_after-ARRAY['stores','standards'])
    OR jsonb_array_length(p_before->'stores')<>jsonb_array_length(p_after->'stores') THEN
   RAISE EXCEPTION 'organization settings require administrator' USING ERRCODE='42501'; END IF;
  FOR wanted IN SELECT value FROM jsonb_array_elements(p_after->'stores') LOOP
   sid:=wanted->>'id';
   SELECT value INTO old_store FROM jsonb_array_elements(p_before->'stores') WHERE value->>'id'=sid;
   IF NOT FOUND THEN RAISE EXCEPTION 'store identity change denied' USING ERRCODE='42501'; END IF;
   IF wanted IS DISTINCT FROM old_store THEN
    IF NOT sage_private.manages(p,sid) OR (wanted-allowed) IS DISTINCT FROM (old_store-allowed)
     OR wanted->'floorConfig'->'dealershipNorms' IS DISTINCT FROM old_store->'floorConfig'->'dealershipNorms' THEN
      RAISE EXCEPTION 'store settings outside authority' USING ERRCODE='42501'; END IF;
    SELECT value,ordinality::integer-1 INTO now_store,idx FROM jsonb_array_elements(current_doc->'stores') WITH ORDINALITY WHERE value->>'id'=sid;
    IF NOT FOUND OR now_store IS DISTINCT FROM old_store THEN RAISE EXCEPTION 'store settings changed; reload' USING ERRCODE='40001'; END IF;
    merged:=jsonb_set(merged,ARRAY['stores',idx::text],wanted,false);
    changed_stores:=array_append(changed_stores,sid);
   END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_before->'standards','{}')||COALESCE(p_after->'standards','{}')) LOOP
   IF p_before->'standards'->k IS DISTINCT FROM p_after->'standards'->k THEN
    IF NOT sage_private.manages(p,k) THEN RAISE EXCEPTION 'other store standards denied' USING ERRCODE='42501'; END IF;
    IF current_doc->'standards'->k IS DISTINCT FROM p_before->'standards'->k THEN RAISE EXCEPTION 'standards changed; reload' USING ERRCODE='40001'; END IF;
    IF p_after->'standards'->k IS NULL THEN RAISE EXCEPTION 'removing store standards requires administrator' USING ERRCODE='42501'; END IF;
    merged:=jsonb_set(merged,ARRAY['standards'],COALESCE(merged->'standards','{}')||jsonb_build_object(k,p_after->'standards'->k),true);
    changed_stores:=array_append(changed_stores,k);
   END IF;
  END LOOP;
 END IF;
 UPDATE public.app_data SET value=merged,updated_at=clock_timestamp() WHERE key='lpc:config:v2';
 IF p.role='admin' THEN
  INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,NULL,'config.save',jsonb_build_object('scope','organization'));
 ELSE
  FOR sid IN SELECT DISTINCT unnest(changed_stores) LOOP
   INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,sid,'config.save',jsonb_build_object('scope','store'));
  END LOOP;
 END IF;
 result:=jsonb_build_object('ok',true,'value',merged);
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'config.save',req,result);
 RETURN result;
END $$;
CREATE FUNCTION public.sage_audit_append(p_store text,p_action text,p_detail text,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; req jsonb; result jsonb; next_id bigint;
BEGIN
 p:=sage_private.actor();
 IF NOT sage_private.manages(p,p_store) THEN RAISE EXCEPTION 'approved store manager required' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR length(p_action) NOT BETWEEN 1 AND 120 OR length(COALESCE(p_detail,''))>2000 THEN RAISE EXCEPTION 'invalid audit note' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('store',p_store,'action',p_action,'detail',p_detail);
 result:=sage_private.replay(p.id,p_operation_id,'audit.note',req); IF result IS NOT NULL THEN RETURN result; END IF;
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,p_store,'user.note',jsonb_build_object('action',p_action,'detail',p_detail)) RETURNING id INTO next_id;
 result:=jsonb_build_object('ok',true,'id',next_id);
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'audit.note',req,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sage_config_save(jsonb,jsonb,uuid),public.sage_audit_append(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_config_save(jsonb,jsonb,uuid),public.sage_audit_append(text,text,text,uuid) TO authenticated;
-- Only the authenticated server command handler may call this commit primitive.
-- It rechecks and locks actor/link inside the same transaction as the mutation.
-- Recover a durable result before mutable roster, date or station gates run.
-- The service derives actor/person; current approval is not required for linked floor participation.
CREATE FUNCTION public.sage_room_receipt(p_actor uuid,p_person text,p_store text,p_room text,p_date date,p_operation_id uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; linked text;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=p_actor FOR SHARE;
 IF NOT FOUND OR p.active IS NOT TRUE THEN RAISE EXCEPTION 'active account required' USING ERRCODE='42501'; END IF;
 SELECT person_id INTO linked FROM public.floor_people WHERE user_id=p_actor AND store=p_store FOR SHARE;
 IF NOT FOUND OR linked IS DISTINCT FROM p_person THEN RAISE EXCEPTION 'person link changed' USING ERRCODE='42501'; END IF;
 IF p_store IS NULL OR p_store !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_date IS NULL OR p_room IS NULL OR p_room NOT IN ('floor','line','online') THEN RAISE EXCEPTION 'invalid room' USING ERRCODE='22023'; END IF;
 RETURN sage_private.replay(p.id,p_operation_id,'room.command',jsonb_build_object('person',p_person,'store',p_store,'room',p_room,'date',p_date,'command',p_request));
END $$;
REVOKE ALL ON FUNCTION public.sage_room_receipt(uuid,text,text,text,date,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_room_receipt(uuid,text,text,text,date,uuid,jsonb) TO service_role;
CREATE FUNCTION public.sage_room_commit(p_actor uuid,p_person text,p_store text,p_room text,p_date date,p_expected timestamptz,p_next jsonb,p_operation_id uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; linked text; key_id text; old_stamp timestamptz; result jsonb; req jsonb; person_name text; activity jsonb;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=p_actor FOR SHARE;
 IF NOT FOUND OR p.active IS NOT TRUE THEN RAISE EXCEPTION 'active account required' USING ERRCODE='42501'; END IF;
 SELECT person_id INTO linked FROM public.floor_people WHERE user_id=p_actor AND store=p_store FOR SHARE;
 IF NOT FOUND OR linked IS DISTINCT FROM p_person THEN RAISE EXCEPTION 'person link changed' USING ERRCODE='42501'; END IF;
 IF p_store IS NULL OR p_store !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR p_date IS NULL OR p_room IS NULL OR p_room NOT IN ('floor','line','online') OR jsonb_typeof(p_next) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid room' USING ERRCODE='22023'; END IF;
 req:=jsonb_build_object('person',p_person,'store',p_store,'room',p_room,'date',p_date,'command',p_request);
 result:=sage_private.replay(p.id,p_operation_id,'room.command',req); IF result IS NOT NULL THEN RETURN result; END IF;
 key_id:=p_store||':'||p_date::text||CASE WHEN p_room='online' THEN ':online' ELSE '' END;
 IF p_room='floor' THEN
  SELECT updated_at INTO old_stamp FROM public.floor_public WHERE id=key_id AND store=p_store AND fdate=p_date::text FOR UPDATE;
 ELSE
  SELECT updated_at INTO old_stamp FROM public.queue_public WHERE id=key_id AND store=p_store AND qdate=p_date FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'room not available' USING ERRCODE='42501'; END IF;
 IF old_stamp IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'room changed; retry' USING ERRCODE='40001'; END IF;
 IF p_next->>'store' IS DISTINCT FROM p_store OR p_next->>'date' IS DISTINCT FROM p_date::text THEN RAISE EXCEPTION 'row identity mismatch' USING ERRCODE='22023'; END IF;
 IF p_request->>'action'='offday-denied' THEN
  IF p_room<>'floor' OR p.pending IS DISTINCT FROM false OR NOT EXISTS(SELECT 1 FROM sage_private.schedule_publications sp WHERE sp.store=p_store AND sp.month=to_char(p_date,'YYYY-MM') AND (sp.people->p_person->'offDates') ? p_date::text) THEN
   RAISE EXCEPTION 'published own offday required' USING ERRCODE='42501';
  END IF;
  SELECT v->>'name' INTO person_name FROM public.app_data d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.value->'roster','[]'::jsonb)) v WHERE d.key='lpc:store:'||p_store||':v2' AND v->>'id'=p_person;
  IF person_name IS NULL THEN RAISE EXCEPTION 'authoritative person unavailable' USING ERRCODE='22023'; END IF;
  SELECT value->lower(regexp_replace(trim(person_name),'\s+',' ','g')) INTO activity FROM public.app_data WHERE key='lpc:store:'||p_store||':act:'||p_date::text;
  IF activity IS NULL OR NOT (coalesce((activity->>'calls')::numeric,0)>0 OR coalesce((activity->>'video')::numeric,0)>0 OR coalesce((activity->>'units')::numeric,0)>0) THEN RAISE EXCEPTION 'reported activity unavailable' USING ERRCODE='22023'; END IF;
  activity:=jsonb_build_object('calls',activity->'calls','video',activity->'video','units',activity->'units');
  -- Evidence remains in the manager-only room record, never the staff projection.
  -- Replace legacy same-person claims with validated evidence; receipts prevent repeat stamping.
  p_next:=jsonb_set(p_next,'{presence}',coalesce(p_next->'presence','{}'::jsonb)||jsonb_build_object('events',coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(coalesce(p_next->'presence'->'events','[]'::jsonb)) v WHERE (v->>'kind'='offday' AND v->>'personId'=p_person) IS NOT TRUE),'[]'::jsonb)));
  IF true THEN
   p_next:=jsonb_set(p_next,'{presence}',coalesce(p_next->'presence','{}'::jsonb)||jsonb_build_object('events',coalesce(p_next->'presence'->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',p_person||':off:'||p_operation_id::text,'kind','offday','personId',p_person,'label',person_name,'at',floor(extract(epoch FROM clock_timestamp())*1000),'activity',activity,'resolved',false))));
  END IF;
 END IF;
 IF p_room='floor' THEN
  UPDATE public.floor_public SET data=p_next,updated_at=greatest(clock_timestamp(),old_stamp+interval '1 microsecond') WHERE id=key_id;
 ELSE
  UPDATE public.queue_public SET data=p_next,updated_at=greatest(clock_timestamp(),old_stamp+interval '1 microsecond') WHERE id=key_id;
 END IF;
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,p_store,'room.command',jsonb_build_object('person',linked,'room',p_room,'date',p_date,'action',p_request->>'action'));
 result:=jsonb_build_object('ok',true,'row',p_next-'presence');
 INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'room.command',req,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sage_room_commit(uuid,text,text,text,date,timestamptz,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_room_commit(uuid,text,text,text,date,timestamptz,jsonb,uuid,jsonb) TO service_role;
-- Historical coaching reads expose only the linked person's evidence by default.
CREATE FUNCTION public.sage_floor_days(p_store text,p_from date,p_to date,p_view text DEFAULT 'own') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=sage_private.actor(); linked text; result jsonb;
BEGIN
 IF p_view IS NULL OR p_view NOT IN ('own','manager') OR p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>60 THEN RAISE EXCEPTION 'invalid history range' USING ERRCODE='22023'; END IF;
 IF p_view='manager' THEN
  IF NOT sage_private.manages(p,p_store) THEN RAISE EXCEPTION 'management required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',fdate,'row',data) ORDER BY fdate DESC),'[]'::jsonb) INTO result FROM public.floor_public WHERE store=p_store AND fdate BETWEEN p_from::text AND p_to::text AND id=p_store||':'||fdate;
 ELSE
  SELECT person_id INTO linked FROM public.floor_people WHERE user_id=p.id AND store=p_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'person link required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',fdate,'row',jsonb_build_object(
    'line',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v->>'id')) FROM jsonb_array_elements(coalesce(data->'line','[]'::jsonb)) v WHERE v->>'id'=linked),'[]'::jsonb),
    'goalNotes',coalesce((SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(note_key,note_value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END) AS note_field(note_key,note_value) WHERE note_key=ANY(ARRAY['at','forDay','who','id','by','name','text','missed','of']) AND jsonb_typeof(note_value) IN ('string','number','boolean','null'))) FROM jsonb_array_elements(coalesce(data->'goalNotes','[]'::jsonb)) v WHERE v->>'id'=linked),'[]'::jsonb),
    'goalLifts',coalesce((SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(note_key,note_value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END) AS note_field(note_key,note_value) WHERE note_key=ANY(ARRAY['at','forDay','who','id','by','why']) AND jsonb_typeof(note_value) IN ('string','number','boolean','null'))) FROM jsonb_array_elements(coalesce(data->'goalLifts','[]'::jsonb)) v WHERE v->>'id'=linked),'[]'::jsonb)
   )) ORDER BY fdate DESC),'[]'::jsonb) INTO result FROM public.floor_public WHERE store=p_store AND fdate BETWEEN p_from::text AND p_to::text AND id=p_store||':'||fdate;
 END IF;
 IF EXISTS(SELECT 1 FROM public.floor_public f WHERE store=p_store AND fdate BETWEEN p_from::text AND p_to::text AND (
   id IS DISTINCT FROM p_store||':'||fdate OR data->>'store' IS DISTINCT FROM p_store OR data->>'date' IS DISTINCT FROM fdate OR
   NOT EXISTS(SELECT 1 FROM generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d WHERE to_char(d,'YYYY-MM-DD')=f.fdate))) THEN
  RAISE EXCEPTION 'history identity requires repair' USING ERRCODE='22023';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sage_floor_days(text,date,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sage_floor_days(text,date,date,text) TO authenticated;
COMMIT;
