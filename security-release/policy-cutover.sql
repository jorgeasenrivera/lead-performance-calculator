-- LOCAL DRAFT ONLY. Requires coordinated-contracts.sql and compatible clients.
-- This file must not be applied to production without separate release approval.
BEGIN;
CREATE FUNCTION sage_private.project(v jsonb,s jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE out jsonb; k text; x jsonb; child jsonb; kind text:=jsonb_typeof(s);
BEGIN
 IF kind='string' THEN
  IF (s#>>'{}')='scalar' AND jsonb_typeof(v) IN ('string','number','boolean','null') THEN RETURN v; END IF;
  IF jsonb_typeof(v)=(s#>>'{}') THEN RETURN v; END IF;
  RETURN NULL;
 ELSIF kind='array' THEN
  IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(z),'[]'::jsonb) INTO out FROM (SELECT sage_private.project(value,s->0) z FROM jsonb_array_elements(v)) q WHERE z IS NOT NULL;
  RETURN out;
 END IF;
 out:='{}'::jsonb;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN out; END IF;
 FOR k,x IN SELECT key,value FROM jsonb_each(v) LOOP
  child:=CASE WHEN s ? k THEN s->k ELSE s->'*' END;
  IF child IS NOT NULL THEN x:=sage_private.project(x,child); IF x IS NOT NULL THEN out:=out||jsonb_build_object(k,x); END IF; END IF;
 END LOOP;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION sage_private.project(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.sage_public_value(k text,v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb; parsed date; day text;
BEGIN
 IF k='lpc:board:stores:v1' THEN RETURN sage_private.project(v,'{"stores":[{"id":"string","name":"string"}],"approvedDomains":["string"],"registrationOpen":"boolean","at":"string"}'::jsonb); END IF;
 IF k ~ '^lpc:board:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:v1$' THEN
  out:=sage_private.project(v,'{"storeId":"string","storeName":"string","ym":"string","updatedAt":"string","icon":"scalar","brand":{"primary":"string","deep":"string","accent":"string"},"thresholds":{"green":"number","yellow":"number","internet":{"green":"number","yellow":"number"},"phone":{"green":"number","yellow":"number"},"showroom":{"green":"number","yellow":"number"},"campaign":{"green":"number","yellow":"number"},"apptVideoDayPct":{"green":"number","yellow":"number"},"engagedVideoPct":{"green":"number","yellow":"number"}},"boardDisplay":{"style":"string","bg":"string","squeeze":"number","pad":"number","tscale":"number","rotate":["string"]},"roles":[{"id":"string"}],"roster":[{"id":"string","name":"string","roleId":"string"}],"people":[{"id":"string","name":"string","roleId":"string"}],"departed":["string"],"goals":{"*":"number"},"ticker":["string"],"months":{"*":{"stats":{"*":{"internetUnits":"number","internetPct":"number","phoneUnits":"number","phonePct":"number","showroomUnits":"number","showroomPct":"number","campaignUnits":"number","internetLeads":"number","phoneLeads":"number","showroomLeads":"number","newUnits":"number","usedUnits":"number","prevPct":{"internet":"number","phone":"number","showroom":"number","campaign":"number"},"prevUnits":{"internet":"number","phone":"number","showroom":"number","campaign":"number"}}}}}}'::jsonb);
  IF out ? 'storeId' AND out->>'storeId'<>split_part(k,':',3) THEN RETURN NULL; END IF;
  out:=jsonb_set(out,'{months}',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(coalesce(out->'months','{}'::jsonb)) WHERE key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),'{}'::jsonb));
  out:=jsonb_set(out,'{brand}',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(coalesce(out->'brand','{}'::jsonb)) WHERE (value#>>'{}') ~ '^#[0-9A-Fa-f]{3,8}$'),'{}'::jsonb));
  out:=jsonb_set(out,'{ticker}',coalesce((SELECT jsonb_agg(replace(replace(value,'<','&lt;'),'>','&gt;')) FROM jsonb_array_elements_text(coalesce(out->'ticker','[]'::jsonb))),'[]'::jsonb));
  RETURN out; END IF;
 IF k ~ '^lpc:board:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:act:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  day:=split_part(k,':',5); BEGIN parsed:=day::date; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  IF to_char(parsed,'YYYY-MM-DD')<>day THEN RETURN NULL; END IF;
  out:=sage_private.project(v,'{"*":{"calls":"number","video":"number","contacted":"number","text":"number","email":"number","tasks":"number","tasksPosted":"number","apptScheduled":"number","apptConfirmed":"number","apptShow":"number","units":"number","visits":"number","rocked":"boolean","uploadedAt":"string","mtd":{"iu":"number","il":"number","pu":"number","pl":"number","su":"number","sl":"number"}},"__hours":{"*":{"*":{"op":"number","ca":"number","ct":"number","ap":"number"}}}}'::jsonb);
  out:=jsonb_set(out,'{__hours}',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(coalesce(out->'__hours','{}'::jsonb)) WHERE key ~ '^(0[0-9]|1[0-9]|2[0-3])$'),'{}'::jsonb));
  RETURN out; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sage_public_value(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_public_value(text,jsonb) TO anon,authenticated,service_role;
CREATE FUNCTION sage_private.manager_config(p public.profiles,v jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT sage_private.project(v,'{"brand":{"*":"string"},"holidays":["scalar"],"tiers":[{"id":"string","name":"string"}],"roles":[{"id":"string","name":"string","color":"string","onBoard":"boolean","coaching":"boolean","tracked":"boolean"}],"support":{"name":"string","role":"string","email":"string","phone":"string","note":"string"}}'::jsonb)||jsonb_build_object(
 'holidays',(SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(h)='object' THEN sage_private.project(h,'{"date":"string","name":"string"}'::jsonb) ELSE h END),'[]'::jsonb) FROM jsonb_array_elements(coalesce(v->'holidays','[]'::jsonb)) h WHERE jsonb_typeof(h) IN ('object','string')),
 'stores',(SELECT coalesce(jsonb_agg(CASE WHEN p.role='overseer' THEN sage_private.project(s,'{"id":"string","name":"string","activityStandards":{"*":"number"},"graceDays":"number","rooms":{"floor":"boolean","line":"boolean"},"hours":{"floor":{"sun":"string","mon":"string","tue":"string","wed":"string","thu":"string","fri":"string","sat":"string"},"line":{"sun":"string","mon":"string","tue":"string","wed":"string","thu":"string","fri":"string","sat":"string"},"open":"string","close":"string"},"fence":{"ring":[{"lat":"number","lng":"number"}],"building":{"ring":[{"lat":"number","lng":"number"}]}},"thresholds":{"green":"number","yellow":"number","internet":{"green":"number","yellow":"number"},"phone":{"green":"number","yellow":"number"},"showroom":{"green":"number","yellow":"number"},"campaign":{"green":"number","yellow":"number"},"apptVideoDayPct":{"green":"number","yellow":"number"},"engagedVideoPct":{"green":"number","yellow":"number"}},"floorPlan":{"stretch":"number","zones":[{"t":"string","x":"number","y":"number","w":"number","h":"number"}],"doors":[{"x":"number","y":"number","main":"scalar"}],"door":{"x":"number","y":"number","main":"scalar"},"cars":[{"x":"number","y":"number","r90":"scalar"}],"tables":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}],"seats":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}]},"stationPlan":{"stretch":"number","zones":[{"t":"string","x":"number","y":"number","w":"number","h":"number"}],"doors":[{"x":"number","y":"number","main":"scalar"}],"door":{"x":"number","y":"number","main":"scalar"},"cars":[{"x":"number","y":"number","r90":"scalar"}],"tables":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}],"seats":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}]},"stationMode":"string","coverAt":"number","brand":{"primary":"string","deep":"string","accent":"string"},"boardDisplay":{"style":"string","bg":"string","squeeze":"number","pad":"number","tscale":"number","rotate":["string"]},"goals":{"*":"number"},"icon":"string","dealer":"string","timezone":"string"}'::jsonb) ELSE s END),'[]'::jsonb) FROM jsonb_array_elements(coalesce(v->'stores','[]'::jsonb)) s WHERE s->>'id'=ANY(p.stores)),
 'standards',(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(coalesce(v->'standards','{}'::jsonb)) WHERE key=ANY(p.stores)))
$$;
REVOKE ALL ON FUNCTION sage_private.manager_config(public.profiles,jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.sage_config_save(jsonb,jsonb,uuid) RENAME TO sage_config_save_internal;
REVOKE ALL ON FUNCTION public.sage_config_save_internal(jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.sage_config_save(p_before jsonb,p_after jsonb,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; p public.profiles;
BEGIN
 result:=public.sage_config_save_internal(p_before,p_after,p_operation_id);
 p:=sage_private.actor();
 IF p.role='manager' THEN result:=result||jsonb_build_object('value',sage_private.manager_config(p,result->'value')); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sage_config_save(jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sage_config_save(jsonb,jsonb,uuid) TO authenticated;
ALTER TABLE sage_private.audit_events ALTER COLUMN actor DROP NOT NULL;
CREATE FUNCTION public.sage_config_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; v jsonb; stores jsonb;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 SELECT value INTO v FROM public.app_data WHERE key='lpc:config:v2';
 IF p.active IS TRUE AND p.pending IS FALSE AND p.role='admin' THEN RETURN jsonb_build_object('value',v); END IF;
 IF p.active IS TRUE AND p.pending IS FALSE AND p.role IN ('manager','overseer') AND cardinality(p.stores)>0 THEN RETURN jsonb_build_object('value',sage_private.manager_config(p,v)); END IF;
 SELECT coalesce(jsonb_agg(s - 'floorConfig' - 'dealershipNorms' - 'daysOff' - 'schedule'),'[]'::jsonb) INTO stores FROM jsonb_array_elements(coalesce(v->'stores','[]'::jsonb)) s
 WHERE p.active IS TRUE AND (EXISTS(SELECT 1 FROM public.floor_people fp WHERE fp.user_id=p.id AND fp.store=s->>'id') OR (p.pending IS FALSE AND s->>'id'=ANY(p.stores)));
 -- Linked staff need operational settings; nested private configuration is selected explicitly below.
 SELECT coalesce(jsonb_agg(sage_private.project(s,'{"id":"string","name":"string","activityStandards":{"*":"number"},"graceDays":"number","rooms":{"floor":"boolean","line":"boolean"},"hours":{"floor":{"sun":"string","mon":"string","tue":"string","wed":"string","thu":"string","fri":"string","sat":"string"},"line":{"sun":"string","mon":"string","tue":"string","wed":"string","thu":"string","fri":"string","sat":"string"},"open":"string","close":"string"},"fence":{"ring":[{"lat":"number","lng":"number"}],"building":{"ring":[{"lat":"number","lng":"number"}]}},"thresholds":{"internet":{"green":"number","yellow":"number"},"phone":{"green":"number","yellow":"number"},"showroom":{"green":"number","yellow":"number"},"campaign":{"green":"number","yellow":"number"},"apptVideoDayPct":{"green":"number","yellow":"number"},"engagedVideoPct":{"green":"number","yellow":"number"},"green":"number","yellow":"number"},"floorPlan":{"stretch":"number","zones":[{"t":"string","x":"number","y":"number","w":"number","h":"number"}],"doors":[{"x":"number","y":"number","main":"scalar"}],"door":{"x":"number","y":"number","main":"scalar"},"cars":[{"x":"number","y":"number","r90":"scalar"}],"tables":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}],"seats":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}]},"stationPlan":{"stretch":"number","zones":[{"t":"string","x":"number","y":"number","w":"number","h":"number"}],"doors":[{"x":"number","y":"number","main":"scalar"}],"door":{"x":"number","y":"number","main":"scalar"},"cars":[{"x":"number","y":"number","r90":"scalar"}],"tables":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}],"seats":[{"n":"scalar","x":"number","y":"number","r":"scalar","s":"string","owner":"string"}]},"stationMode":"string","coverAt":"number"}'::jsonb)),'[]'::jsonb) INTO stores FROM jsonb_array_elements(stores) s;
 IF jsonb_array_length(stores)=0 THEN SELECT coalesce(jsonb_agg(sage_private.project(x,'{"id":"string","name":"string"}'::jsonb)),'[]'::jsonb) INTO stores FROM jsonb_array_elements(coalesce(v->'stores','[]'::jsonb)) x; END IF;
 RETURN jsonb_build_object('value',sage_private.project(v,'{"approvedDomains":["string"],"registrationOpen":"boolean","roles":[{"id":"string","name":"string","color":"string","onBoard":"boolean","coaching":"boolean","tracked":"boolean"}],"brand":{"*":"string"}}'::jsonb)||jsonb_build_object('stores',stores,'holidays',(SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(h)='string' THEN h ELSE h->'date' END),'[]'::jsonb) FROM jsonb_array_elements(coalesce(v->'holidays','[]'::jsonb)) h WHERE jsonb_typeof(h)='string' OR jsonb_typeof(h->'date')='string'),'support',sage_private.project(v->'support','{"name":"string","role":"string","email":"string","phone":"string","note":"string"}'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.sage_config_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_config_read() TO anon,authenticated;

CREATE FUNCTION public.sage_private_key_allowed(k text,writing boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text;
BEGIN
 IF k IS NULL OR writing IS NULL THEN RETURN false; END IF;
 IF k='lpc:config:v2' THEN RETURN NOT writing AND public.sage_approved_admin(); END IF;
 IF k ~ '^lpc:config:(backups-index:v1|backup:[A-Za-z0-9._-]+:v1)$' THEN RETURN public.sage_approved_admin(); END IF;
 IF k ~ '^lpc:(audit|config):' THEN RETURN NOT writing AND public.sage_approved_admin(); END IF;
 IF writing AND k ~ '^lpc:store:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:v1$' THEN RETURN false; END IF;
 IF k ~ '^lpc:store:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:(v[12]|restore:v1|act:[0-9]{4}-[0-9]{2}-[0-9]{2}|digest:[0-9]{4}-[0-9]{2}-[0-9]{2})$'
 OR k ~ '^lpc:backup:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:[A-Za-z0-9._-]+:v1$'
 OR (NOT writing AND k ~ '^lpc:reportfile:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[A-Za-z0-9._-]+$') THEN
  sid:=split_part(k,':',3);RETURN public.sage_manages_store(sid);
 END IF;
 IF writing AND k='lpc:board:stores:v1' THEN RETURN public.sage_approved_admin(); END IF;
 IF writing AND public.sage_public_value(k,'{}'::jsonb) IS NOT NULL THEN RETURN public.sage_manages_store(split_part(k,':',3)); END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.sage_private_key_allowed(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_private_key_allowed(text,boolean) TO authenticated;

DROP POLICY "app_data read" ON public.app_data;
DROP POLICY "app_data write" ON public.app_data;
DROP POLICY "app_data update" ON public.app_data;
DROP POLICY "board rows are readable by anyone" ON public.app_data;
CREATE POLICY sage_public_read ON public.app_data FOR SELECT TO anon,authenticated USING(value=public.sage_public_value(key,value));
CREATE POLICY sage_private_read ON public.app_data FOR SELECT TO authenticated USING(public.sage_private_key_allowed(key,false));
CREATE POLICY sage_managed_insert ON public.app_data FOR INSERT TO authenticated WITH CHECK(public.sage_private_key_allowed(key,true));
CREATE POLICY sage_managed_update ON public.app_data FOR UPDATE TO authenticated USING(public.sage_private_key_allowed(key,true)) WITH CHECK(public.sage_private_key_allowed(key,true));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,MAINTAIN ON public.app_data FROM anon;
REVOKE DELETE,TRUNCATE,MAINTAIN ON public.app_data FROM authenticated;

DROP POLICY floor_staff_read ON public.floor_public;
DROP POLICY floor_staff_insert ON public.floor_public;
DROP POLICY floor_staff_update ON public.floor_public;
CREATE POLICY sage_floor_manager_read ON public.floor_public FOR SELECT TO authenticated USING(public.sage_manages_store(store));
CREATE POLICY sage_floor_manager_insert ON public.floor_public FOR INSERT TO authenticated WITH CHECK(public.sage_manages_store(store));
CREATE POLICY sage_floor_manager_update ON public.floor_public FOR UPDATE TO authenticated USING(public.sage_manages_store(store)) WITH CHECK(public.sage_manages_store(store));
DROP POLICY queue_staff_read ON public.queue_public;
DROP POLICY queue_staff_insert ON public.queue_public;
DROP POLICY queue_staff_update ON public.queue_public;
CREATE POLICY sage_queue_manager_read ON public.queue_public FOR SELECT TO authenticated USING(public.sage_manages_store(store));
CREATE POLICY sage_queue_manager_insert ON public.queue_public FOR INSERT TO authenticated WITH CHECK(public.sage_manages_store(store));
CREATE POLICY sage_queue_manager_update ON public.queue_public FOR UPDATE TO authenticated USING(public.sage_manages_store(store)) WITH CHECK(public.sage_manages_store(store));
REVOKE ALL ON public.floor_public,public.queue_public FROM anon;
REVOKE DELETE,TRUNCATE,MAINTAIN ON public.floor_public,public.queue_public FROM authenticated;

CREATE TABLE sage_private.legacy_public_archive(key text PRIMARY KEY,value jsonb,archived_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE sage_private.legacy_public_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sage_private.legacy_public_archive FROM PUBLIC,anon,authenticated;
-- Preserve originals privately before the proposed removal of historical public fields.
INSERT INTO sage_private.legacy_public_archive(key,value) SELECT key,value FROM public.app_data WHERE key LIKE 'lpc:board:%' AND value IS DISTINCT FROM public.sage_public_value(key,value);
UPDATE public.app_data SET value=public.sage_public_value(key,value) WHERE key LIKE 'lpc:board:%' AND public.sage_public_value(key,value) IS NOT NULL;
-- Unknown historical board namespaces remain archived and hidden by SELECT policy.

CREATE FUNCTION sage_private.public_projection_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE projected jsonb;
BEGIN
 IF NEW.key LIKE 'lpc:board:%' THEN
  projected:=public.sage_public_value(NEW.key,NEW.value);
  IF projected IS NULL THEN RAISE EXCEPTION 'unsupported public namespace' USING ERRCODE='23514'; END IF;
  NEW.value:=projected;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sage_private.public_projection_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sage_public_projection BEFORE INSERT OR UPDATE ON public.app_data FOR EACH ROW EXECUTE FUNCTION sage_private.public_projection_guard();

-- Legacy documents without a stamp remain readable; never accept a conflicting
-- stamp. Service import creates unstamped documents, so requiring a stamp would
-- break that supported writer. The canonical key remains the ownership boundary.
CREATE FUNCTION public.sage_store_identity(k text,v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN k ~ '^lpc:store:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:v2$'
 OR k ~ '^lpc:backup:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:[A-Za-z0-9._-]+:v1$'
 THEN CASE WHEN v IS NULL OR v='null'::jsonb THEN k LIKE 'lpc:backup:%'
 ELSE jsonb_typeof(v)='object' AND (NOT (v ? '__storeId') OR
 (jsonb_typeof(v->'__storeId')='string' AND v->>'__storeId'=split_part(k,':',3))) END
 ELSE true END
$$;
REVOKE ALL ON FUNCTION public.sage_store_identity(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_store_identity(text,jsonb) TO authenticated,service_role;
ALTER TABLE public.app_data ADD CONSTRAINT sage_store_identity CHECK(public.sage_store_identity(key,value) IS TRUE) NOT VALID;
-- Abort for review of poisoned historical documents; never relabel them here.
ALTER TABLE public.app_data VALIDATE CONSTRAINT sage_store_identity;

CREATE FUNCTION public.sage_room_identity(k text,sid text,day text,v jsonb,is_queue boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parsed date;
BEGIN
 IF k IS NULL OR sid IS NULL OR day IS NULL OR v IS NULL OR is_queue IS NULL THEN RETURN false; END IF;

 IF (sid<>'' AND sid !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') OR day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
 BEGIN parsed:=day::date; EXCEPTION WHEN OTHERS THEN RETURN false; END;
 IF to_char(parsed,'YYYY-MM-DD')<>day THEN RETURN false; END IF;
 IF is_queue AND k ~ '^ticket:[A-Za-z0-9_-]+$' THEN RETURN v->>'id'=substring(k FROM 8) AND v->>'store'=sid; END IF;
 IF sid='' THEN RETURN false; END IF;
 RETURN to_char(parsed,'YYYY-MM-DD')=day AND (k=sid||':'||day OR (is_queue AND k=sid||':'||day||':online')) AND v->>'store'=sid AND v->>'date'=day;
END $$;
REVOKE ALL ON FUNCTION public.sage_room_identity(text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_room_identity(text,text,text,jsonb,boolean) TO authenticated,service_role;
ALTER TABLE public.floor_public ADD CONSTRAINT sage_floor_identity CHECK(public.sage_room_identity(id,store,fdate,data,false) IS TRUE) NOT VALID;
ALTER TABLE public.queue_public ADD CONSTRAINT sage_queue_identity CHECK(public.sage_room_identity(id,store,qdate::text,data,true) IS TRUE) NOT VALID;
-- Abort instead of guessing ownership or silently discarding poisoned legacy rows.
ALTER TABLE public.floor_public VALIDATE CONSTRAINT sage_floor_identity;
ALTER TABLE public.queue_public VALIDATE CONSTRAINT sage_queue_identity;

CREATE FUNCTION sage_private.record_managed_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text; object_id text; actor_id uuid:=auth.uid(); old_digest text;
BEGIN
 IF TG_TABLE_NAME='app_data' THEN
  object_id:=NEW.key;
  IF NEW.key='lpc:config:v2' THEN RETURN NEW; END IF;
  sid:=CASE WHEN NEW.key='lpc:board:stores:v1' THEN NULL ELSE split_part(NEW.key,':',3) END;
  IF TG_OP='UPDATE' THEN old_digest:=md5(OLD.value::text); END IF;
 ELSE
  object_id:=NEW.id;sid:=NEW.store;
  IF TG_OP='UPDATE' THEN old_digest:=md5(OLD.data::text); END IF;
 END IF;
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(actor_id,sid,'data.'||lower(TG_OP),jsonb_build_object('table',TG_TABLE_NAME,'id',object_id,'beforeDigest',old_digest,'source',CASE WHEN actor_id IS NULL THEN 'service-or-owner' ELSE 'authenticated' END));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sage_private.record_managed_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sage_store_write_audit AFTER INSERT OR UPDATE ON public.app_data FOR EACH ROW EXECUTE FUNCTION sage_private.record_managed_write();
CREATE TRIGGER sage_floor_write_audit AFTER INSERT OR UPDATE ON public.floor_public FOR EACH ROW EXECUTE FUNCTION sage_private.record_managed_write();
CREATE TRIGGER sage_queue_write_audit AFTER INSERT OR UPDATE ON public.queue_public FOR EACH ROW EXECUTE FUNCTION sage_private.record_managed_write();
CREATE FUNCTION public.sage_store_read(p_store text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=sage_private.actor(); v jsonb; stamp timestamptz; days jsonb;
BEGIN
 IF NOT sage_private.manages(p,p_store) AND NOT (p.active IS TRUE AND p.pending IS FALSE AND p.role='overseer' AND p_store=ANY(p.stores)) THEN RAISE EXCEPTION 'store reports unavailable' USING ERRCODE='42501'; END IF;
 SELECT value,updated_at INTO v,stamp FROM public.app_data WHERE key='lpc:store:'||p_store||':v2';
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p.role='overseer' THEN v:=sage_private.project(v,'{"__rev":"number","__storeId":"string","roster":[{"id":"string","name":"string","roleId":"string","role":"string","position":"string","order":"number"}],"months":{"*":{"stats":{"*":{"internetUnits":"number","internetPct":"number","phoneUnits":"number","phonePct":"number","showroomUnits":"number","showroomPct":"number","campaignUnits":"number","internetLeads":"number","phoneLeads":"number","showroomLeads":"number","newUnits":"number","usedUnits":"number","prevPct":{"internet":"number","phone":"number","showroom":"number","campaign":"number"},"prevUnits":{"internet":"number","phone":"number","showroom":"number","campaign":"number"}}},"stated":{"deliveries":"number","total":"number","deals":"number","new":"number","used":"number","vehicles":{"*":"scalar"},"day":"string","at":"string","file":"string","source":"string"},"updatedAt":"string"}},"goals":{"*":"number"},"departed":["string"],"excluded":["string"],"aliases":{"*":"string"}}'::jsonb); END IF;
 SELECT coalesce(jsonb_object_agg(split_part(key,':',5),value),'{}'::jsonb) INTO days FROM public.app_data WHERE starts_with(key,'lpc:store:'||p_store||':act:') AND key ~ '^lpc:store:[A-Za-z0-9][A-Za-z0-9_-]{0,63}:act:[0-9]{4}-[0-9]{2}-[0-9]{2}$';
 IF p.role='overseer' THEN days:=sage_private.project(days,'{"*":{"*":{"calls":"number","video":"number","contacted":"number","text":"number","email":"number","tasks":"number","tasksPosted":"number","apptScheduled":"number","apptConfirmed":"number","apptShow":"number","units":"number","visits":"number","rocked":"boolean","uploadedAt":"string","mtd":{"iu":"number","il":"number","pu":"number","pl":"number","su":"number","sl":"number"}},"__hours":{"*":{"*":{"op":"number","ca":"number","ct":"number","ap":"number"}}}}}'::jsonb); END IF;
 RETURN jsonb_build_object('value',v,'updated_at',stamp,'activity',days);
END $$;
REVOKE ALL ON FUNCTION public.sage_store_read(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sage_store_read(text) TO authenticated;
-- Preserve the existing signed-out support form as create-only. No anonymous row access.
CREATE TABLE sage_private.ticket_requests(operation_id uuid PRIMARY KEY,request jsonb NOT NULL,ticket_id text NOT NULL);
ALTER TABLE sage_private.ticket_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sage_private.ticket_requests FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.sage_ticket_submit(p_operation_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE clean jsonb; old_request jsonb; sid text; kind text; ticket_id text; person text; note jsonb;
BEGIN
 IF p_operation_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>16000 THEN RAISE EXCEPTION 'invalid support request' USING ERRCODE='22023'; END IF;
 sid:=coalesce(p_input->>'store','');kind:=p_input->>'kind';
 IF kind IS NULL OR kind NOT IN ('problem','figures','standard') OR (sid<>'' AND NOT EXISTS(SELECT 1 FROM public.app_data d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.value->'stores','[]'::jsonb)) v WHERE d.key='lpc:config:v2' AND v->>'id'=sid)) THEN RAISE EXCEPTION 'unknown support context' USING ERRCODE='22023'; END IF;
 IF kind='standard' AND NOT EXISTS(SELECT 1 FROM public.floor_people fp JOIN public.profiles p ON p.id=fp.user_id WHERE p.id=auth.uid() AND p.active IS TRUE AND fp.store=sid) THEN RAISE EXCEPTION 'linked account required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ticket:'||p_operation_id::text,0));
 SELECT request,ticket_requests.ticket_id INTO old_request,ticket_id FROM sage_private.ticket_requests WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF old_request IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'operation changed' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true,'id',ticket_id);
 END IF;
 clean:=sage_private.project(p_input,'{"store":"string","kind":"string","from":"string","reach":"string","body":"string","context":"string","figure":"string","shown":"string","expected":"string","basis":"string","page":"string","agent":"string","snapshot":[{"label":"string","value":"string"}]}'::jsonb);
 IF length(coalesce(clean->>'body',''))>4000 OR length(coalesce(clean->>'reach',''))>300 THEN RAISE EXCEPTION 'support request too long' USING ERRCODE='22023'; END IF;
 IF kind='standard' THEN
  SELECT fp.person_id INTO person FROM public.floor_people fp JOIN public.profiles p ON p.id=fp.user_id WHERE p.id=auth.uid() AND p.active IS TRUE AND fp.store=sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'linked account required' USING ERRCODE='42501'; END IF;
  SELECT n INTO note FROM public.floor_public f CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.data->'goalNotes','[]'::jsonb)) n WHERE f.store=sid AND n->>'id'=person AND n->>'text'=p_input->>'body' AND n->>'forDay'=p_input->>'forDay' ORDER BY n->>'at' DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'saved coaching note required' USING ERRCODE='42501'; END IF;
  clean:=clean||jsonb_build_object('from',note->>'name','who',note->>'who','forDay',note->>'forDay');
 END IF;
 ticket_id:=p_operation_id::text;
 clean:=clean||jsonb_build_object('id',ticket_id,'store',sid,'status','open','at',clock_timestamp(),'reportedByUser',true);
 INSERT INTO public.queue_public(id,store,qdate,data,updated_at) VALUES('ticket:'||ticket_id,sid,(clock_timestamp() AT TIME ZONE 'America/New_York')::date,clean,clock_timestamp());
 INSERT INTO sage_private.ticket_requests VALUES(p_operation_id,p_input,ticket_id);
 RETURN jsonb_build_object('ok',true,'id',ticket_id);
END $$;
REVOKE ALL ON FUNCTION public.sage_ticket_submit(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_ticket_submit(uuid,jsonb) TO anon,authenticated;
CREATE FUNCTION public.sage_ticket_status(p_id text,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text; v jsonb;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('open','closed') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE='22023'; END IF;
 SELECT store,data INTO sid,v FROM public.queue_public WHERE id='ticket:'||p_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sage_manages_store(sid) THEN RAISE EXCEPTION 'ticket unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.queue_public SET data=v||jsonb_build_object('status',p_status,'closedAt',CASE WHEN p_status='closed' THEN clock_timestamp() ELSE NULL END),updated_at=clock_timestamp() WHERE id='ticket:'||p_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sage_ticket_status(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sage_ticket_status(text,text) TO authenticated;
CREATE FUNCTION public.sage_dealer_links(p_store text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.sage_manages_store(p_store) THEN RAISE EXCEPTION 'management required' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(dealership_norm ORDER BY dealership_norm) FROM sage_private.dealer_mapping WHERE store=p_store),'[]'::jsonb);
END $$;
CREATE FUNCTION public.sage_dealer_unmap(p_store text,p_dealership_norm text,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=sage_private.actor(); req jsonb; result jsonb;
BEGIN
 IF NOT public.sage_approved_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
 req:=jsonb_build_object('store',p_store,'dealership',p_dealership_norm);
 result:=sage_private.replay(p.id,p_operation_id,'dealer.unmap',req);IF result IS NOT NULL THEN RETURN result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dealer:'||p_dealership_norm,0));
 IF EXISTS(SELECT 1 FROM sage_private.dealer_mapping WHERE dealership_norm=p_dealership_norm AND store IS DISTINCT FROM p_store) THEN RAISE EXCEPTION 'mapping changed' USING ERRCODE='40001'; END IF;
 DELETE FROM sage_private.dealer_mapping WHERE dealership_norm=p_dealership_norm AND store=p_store;
 INSERT INTO sage_private.audit_events(actor,store,action,detail) VALUES(p.id,p_store,'dealer.unmap',req);
 result:=jsonb_build_object('ok',true);INSERT INTO sage_private.receipts VALUES(p.id,p_operation_id,'dealer.unmap',req,result);RETURN result;
END $$;
CREATE FUNCTION public.sage_deal_events(p_store text,p_since timestamptz) RETURNS SETOF public.deal_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.sage_manages_store(p_store) THEN RAISE EXCEPTION 'management required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.* FROM public.deal_events e JOIN sage_private.dealer_mapping d ON d.dealership_norm=e.dealership_norm WHERE d.store=p_store AND (p_since IS NULL OR e.received_at>p_since) ORDER BY e.received_at LIMIT 300;
END $$;
REVOKE ALL ON FUNCTION public.sage_dealer_links(text),public.sage_dealer_unmap(text,text,uuid),public.sage_deal_events(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sage_dealer_links(text),public.sage_dealer_unmap(text,text,uuid),public.sage_deal_events(text,timestamptz) TO authenticated;
CREATE FUNCTION sage_private.refresh_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 IF NEW.key<>'lpc:config:v2' THEN RETURN NEW; END IF;
 v:=public.sage_public_value('lpc:board:stores:v1',jsonb_build_object('stores',NEW.value->'stores','approvedDomains',NEW.value->'approvedDomains','registrationOpen',NEW.value->'registrationOpen','at',clock_timestamp()));
 INSERT INTO public.app_data(key,value,updated_at) VALUES('lpc:board:stores:v1',v,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sage_private.refresh_directory() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sage_config_directory AFTER INSERT OR UPDATE ON public.app_data FOR EACH ROW EXECUTE FUNCTION sage_private.refresh_directory();
-- Explicitly refuse obsolete staff writes even when row RLS matches no rows.
-- This is a statement-time role gate, not a replacement for store-scoped RLS.
-- Approved managers can still receive zero-row results for foreign stores.
CREATE FUNCTION public.sage_room_direct_writer_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
  AND p.active IS TRUE AND p.pending IS FALSE
  AND (p.role='admin' OR (p.role='manager' AND cardinality(p.stores)>0)));
$$;
REVOKE ALL ON FUNCTION public.sage_room_direct_writer_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sage_room_direct_writer_allowed() TO authenticated;
CREATE FUNCTION public.sage_room_statement_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 -- current_user is evaluated here, before entering the definer helper.
 -- Service-role and authorized definer RPC writes retain their own checks.
 IF current_user='authenticated' THEN
  IF public.sage_room_direct_writer_allowed() IS NOT TRUE THEN
   RAISE EXCEPTION 'approved management write required' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sage_room_statement_write_guard() FROM PUBLIC;
CREATE TRIGGER sage_room_statement_write_guard BEFORE INSERT OR UPDATE ON public.floor_public
 FOR EACH STATEMENT EXECUTE FUNCTION public.sage_room_statement_write_guard();
CREATE TRIGGER sage_room_statement_write_guard BEFORE INSERT OR UPDATE ON public.queue_public
 FOR EACH STATEMENT EXECUTE FUNCTION public.sage_room_statement_write_guard();
COMMIT;
