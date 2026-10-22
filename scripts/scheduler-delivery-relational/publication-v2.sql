-- ADDITIVE DISABLED PROPOSAL. Disposable local testing only; never auto-applied.
-- Requires existing scheduler-draft-structure objects and floor_people schema.
BEGIN;
CREATE TABLE scheduler_policy.publication_scope_v2 (
 store_id text PRIMARY KEY CHECK(store_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE scheduler_policy.publication_grants_v2 (
 actor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
 store_id text REFERENCES scheduler_policy.publication_scope_v2(store_id),
 enabled boolean NOT NULL DEFAULT false, PRIMARY KEY(actor_id,store_id)
);
CREATE TABLE scheduler_private.publication_contexts_v2 (
 context_id text PRIMARY KEY CHECK(context_id ~ '^[0-9a-f]{64}$'),
 context_text text NOT NULL CHECK(octet_length(context_text)<=8000000),
 body jsonb NOT NULL,
 CHECK(body=context_text::jsonb),
 CHECK(context_id=encode(sha256(convert_to(context_text,'UTF8')),'hex')),
 CHECK(body->>'version' IS NOT DISTINCT FROM 'scheduler-publication-context/2'),
 CHECK(scheduler_private.object_keys(body,ARRAY['version','scope','sourceEpoch','inputText','inputDigest','review','binding','expected','plan','projection'])),
 CHECK(jsonb_typeof(body->'inputText') IS NOT DISTINCT FROM 'string'),
 CHECK(jsonb_typeof(body->'inputDigest') IS NOT DISTINCT FROM 'string'),
 CHECK(body->>'inputDigest'=encode(sha256(convert_to(body->>'inputText','UTF8')),'hex'))
);
-- Trusted source-capture owns these rows. Runtime receives no INSERT/UPDATE.
-- No capture endpoint or implicit grant is installed by this proposal.
CREATE TABLE scheduler_private.publication_source_heads_v2 (
 store_id text NOT NULL, month text NOT NULL, epoch bigint NOT NULL CHECK(epoch>0),
 context_id text NOT NULL REFERENCES scheduler_private.publication_contexts_v2,
 PRIMARY KEY(store_id,month)
);
CREATE TABLE scheduler_private.publication_bindings_v2 (
 store_id text NOT NULL, month text NOT NULL, rev bigint NOT NULL,
 context_id text NOT NULL REFERENCES scheduler_private.publication_contexts_v2,
 PRIMARY KEY(store_id,month,rev),
 FOREIGN KEY(store_id,month) REFERENCES scheduler_private.heads
);
CREATE TRIGGER immutable_context_v2 BEFORE UPDATE OR DELETE ON scheduler_private.publication_contexts_v2
 FOR EACH ROW EXECUTE FUNCTION scheduler_private.immutable_record();
CREATE TRIGGER immutable_binding_v2 BEFORE UPDATE OR DELETE ON scheduler_private.publication_bindings_v2
 FOR EACH ROW EXECUTE FUNCTION scheduler_private.immutable_record();
ALTER TABLE scheduler_policy.publication_scope_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_policy.publication_grants_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.publication_contexts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.publication_source_heads_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.publication_bindings_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY executor_read_v2 ON scheduler_policy.publication_scope_v2 FOR SELECT TO scheduler_executor USING(true);
CREATE POLICY executor_lock_v2 ON scheduler_policy.publication_scope_v2 FOR UPDATE TO scheduler_executor USING(true) WITH CHECK(false);
CREATE POLICY executor_read_v2 ON scheduler_policy.publication_grants_v2 FOR SELECT TO scheduler_executor USING(true);
CREATE POLICY executor_lock_v2 ON scheduler_policy.publication_grants_v2 FOR UPDATE TO scheduler_executor USING(true) WITH CHECK(false);
CREATE POLICY executor_read_v2 ON scheduler_private.publication_contexts_v2 FOR SELECT TO scheduler_executor USING(true);
CREATE POLICY executor_read_v2 ON scheduler_private.publication_source_heads_v2 TO scheduler_executor USING(true) WITH CHECK(false);
CREATE POLICY executor_binding_v2 ON scheduler_private.publication_bindings_v2 TO scheduler_executor USING(true) WITH CHECK(true);
REVOKE ALL ON scheduler_policy.publication_scope_v2,scheduler_policy.publication_grants_v2,
 scheduler_private.publication_contexts_v2,scheduler_private.publication_source_heads_v2,scheduler_private.publication_bindings_v2 FROM PUBLIC,anon,authenticated,service_role,scheduler_runtime;
GRANT SELECT,UPDATE ON scheduler_policy.publication_scope_v2,scheduler_policy.publication_grants_v2 TO scheduler_executor;
GRANT SELECT ON scheduler_private.publication_contexts_v2 TO scheduler_executor;
GRANT SELECT,UPDATE ON scheduler_private.publication_source_heads_v2 TO scheduler_executor;
GRANT SELECT,INSERT ON scheduler_private.publication_bindings_v2 TO scheduler_executor;
GRANT UPDATE(published_rev) ON scheduler_private.heads TO scheduler_executor;
GRANT SELECT(stores) ON public.profiles TO scheduler_executor;
GRANT SELECT,UPDATE(id) ON public.floor_people TO scheduler_executor;
CREATE POLICY scheduler_v2_link_read ON public.floor_people FOR SELECT TO scheduler_executor
 USING(EXISTS(SELECT 1 FROM scheduler_policy.publication_scope_v2 s WHERE s.store_id=floor_people.store AND s.enabled));
CREATE POLICY scheduler_v2_link_lock ON public.floor_people FOR UPDATE TO scheduler_executor
 USING(EXISTS(SELECT 1 FROM scheduler_policy.publication_scope_v2 s WHERE s.store_id=floor_people.store AND s.enabled)) WITH CHECK(false);
CREATE POLICY scheduler_v2_link_no_update ON public.floor_people AS RESTRICTIVE FOR UPDATE TO scheduler_executor USING(true) WITH CHECK(false);
CREATE POLICY scheduler_v2_profile_read ON public.profiles FOR SELECT TO scheduler_executor
 USING(EXISTS(SELECT 1 FROM scheduler_policy.publication_scope_v2 s WHERE s.enabled AND
 (s.store_id=ANY(profiles.stores) OR EXISTS(SELECT 1 FROM public.floor_people f WHERE f.user_id=profiles.id AND f.store=s.store_id))));
CREATE POLICY scheduler_v2_profile_lock ON public.profiles FOR UPDATE TO scheduler_executor
 USING(EXISTS(SELECT 1 FROM scheduler_policy.publication_scope_v2 s WHERE s.enabled AND
 (s.store_id=ANY(profiles.stores) OR EXISTS(SELECT 1 FROM public.floor_people f WHERE f.user_id=profiles.id AND f.store=s.store_id)))) WITH CHECK(false);

CREATE FUNCTION scheduler_gateway.publish_v2(a jsonb,context_id_arg text,p_plan jsonb,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p record; g record; src record; c jsonb; h scheduler_private.heads%ROWTYPE;
 r scheduler_private.receipts%ROWTYPE; v_store text; v_month text; uid uuid; kh text;
 op jsonb; expected jsonb; pub jsonb; moved jsonb; entry jsonb; envelope jsonb; n bigint; count_put integer:=0;
BEGIN
 IF NOT scheduler_private.object_keys(a,ARRAY['actorId','action','storeId','month','readKind'])
 OR a->>'action' IS DISTINCT FROM 'publish' OR a->'readKind' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 uid:=(a->>'actorId')::uuid;v_store:=a->>'storeId';v_month:=a->>'month';
 SELECT id,role,stores,active,pending INTO p FROM public.profiles WHERE id=uid FOR SHARE;
 IF NOT FOUND OR p.active IS DISTINCT FROM true OR p.pending IS DISTINCT FROM false OR p.role NOT IN('manager','admin')
 OR (v_store=ANY(p.stores)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 PERFORM 1 FROM scheduler_policy.publication_scope_v2 WHERE store_id=v_store AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 PERFORM 1 FROM scheduler_policy.publication_grants_v2 WHERE actor_id=uid AND store_id=v_store AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 IF NOT scheduler_private.object_keys(p_receipt,ARRAY['key','fingerprint','result']) OR
 jsonb_typeof(p_receipt->'key') IS DISTINCT FROM 'string' OR (p_receipt->>'fingerprint') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 -- Existing key validator binds actor/store/month; action is checked above.
 PERFORM scheduler_private.require_key(a,p_receipt->>'key');
 kh:=encode(sha256(convert_to(p_receipt->>'key','UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('sage-scheduler:'||v_store,0));
 SELECT * INTO r FROM scheduler_private.receipts WHERE store_id=v_store AND month=v_month AND actor_id=uid::text AND key_digest=kh;
 IF FOUND THEN
 IF r.request_key IS DISTINCT FROM p_receipt->>'key' OR r.fingerprint IS DISTINCT FROM p_receipt->>'fingerprint' THEN RAISE EXCEPTION 'scheduler:idempotency-conflict';END IF;
 RETURN jsonb_build_object('result',r.result,'replayed',true); END IF;
 SELECT * INTO src FROM scheduler_private.publication_source_heads_v2 WHERE store_id=v_store AND month=v_month FOR SHARE;
 IF NOT FOUND OR src.context_id IS DISTINCT FROM context_id_arg THEN RAISE EXCEPTION 'scheduler:conflict';END IF;
 SELECT body INTO c FROM scheduler_private.publication_contexts_v2 WHERE context_id=context_id_arg;
 IF c->'scope' IS DISTINCT FROM jsonb_build_object('storeId',v_store,'month',v_month)
 OR c->'sourceEpoch' IS DISTINCT FROM to_jsonb(src.epoch) OR c->'plan' IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 SELECT * INTO h FROM scheduler_private.heads WHERE store_id=v_store AND month=v_month FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scheduler:conflict';END IF;
 expected:=jsonb_build_object('head',jsonb_build_object('draftRev',h.draft_rev,'publishedRev',h.published_rev),'prevAuditHash',h.last_audit_hash,'auditRevision',h.audit_revision);
 IF c->'expected' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'scheduler:conflict';END IF;
 IF NOT scheduler_private.object_keys(p_plan,ARRAY['kind','storeId','month','atomic','authorization','ops','auditEntry','publishedRev','resultingHead'])
 OR p_plan->>'kind' IS DISTINCT FROM 'publication' OR p_plan->>'storeId' IS DISTINCT FROM v_store OR p_plan->>'month' IS DISTINCT FROM v_month
 OR p_plan->'atomic' IS DISTINCT FROM 'true'::jsonb OR p_plan->>'authorization' IS DISTINCT FROM 'not-checked'
 OR p_plan->'resultingHead' IS DISTINCT FROM jsonb_build_object('draftRev',h.draft_rev+1,'publishedRev',h.published_rev+1)
 OR p_plan->'publishedRev' IS DISTINCT FROM to_jsonb(h.published_rev+1)
 OR p_receipt->'result' IS DISTINCT FROM jsonb_build_object('head',p_plan->'resultingHead') THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 IF jsonb_typeof(p_plan->'ops') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'ops') NOT BETWEEN 4 AND 5 THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_plan->'ops') LOOP
 IF op->>'storeId' IS DISTINCT FROM v_store THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 IF op->>'op'='expect-head' THEN
  IF op->>'month' NOT IN(to_char((v_month||'-01')::date-interval '1 month','YYYY-MM'),to_char((v_month||'-01')::date+interval '1 month','YYYY-MM')) THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
  SELECT draft_rev INTO n FROM scheduler_private.heads WHERE store_id=v_store AND month=op->>'month';
  IF op->'draftRev' IS DISTINCT FROM to_jsonb(COALESCE(n,0)) THEN RAISE EXCEPTION 'scheduler:conflict';END IF;
 ELSIF op->>'op'='put-version' THEN
  count_put:=count_put+1;envelope:=(op->>'text')::jsonb;
  IF op->>'month' IS DISTINCT FROM v_month OR op->>'kind' NOT IN('draft','published')
  OR op IS DISTINCT FROM jsonb_build_object('op','put-version','kind',op->>'kind','storeId',v_store,'month',v_month,'expectedRev',CASE WHEN op->>'kind'='draft' THEN h.draft_rev ELSE h.published_rev END,'rev',CASE WHEN op->>'kind'='draft' THEN h.draft_rev+1 ELSE h.published_rev+1 END,'text',op->>'text')
  OR envelope->>'format' IS DISTINCT FROM 'sage.scheduler.version' OR envelope->'version' IS DISTINCT FROM '1'::jsonb
  OR envelope->>'storeId' IS DISTINCT FROM v_store OR envelope->>'month' IS DISTINCT FROM v_month OR envelope->'rev' IS DISTINCT FROM op->'rev' OR envelope->'kind' IS DISTINCT FROM op->'kind'
  THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
  IF op->>'kind'='published' THEN pub:=envelope;ELSE moved:=envelope;END IF;
 ELSIF op->>'op'='append-audit' THEN
  IF op IS DISTINCT FROM jsonb_build_object('op','append-audit','storeId',v_store,'month',v_month,'entry',p_plan->'auditEntry') THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 ELSE RAISE EXCEPTION 'scheduler:invalid';END IF;
 END LOOP;
 entry:=p_plan->'auditEntry';
 IF count_put<>2 OR pub IS NULL OR moved IS NULL OR pub->'payload' IS DISTINCT FROM moved->'payload'
 OR pub->'payload' IS DISTINCT FROM (SELECT version_text::jsonb->'payload' FROM scheduler_private.versions WHERE store_id=v_store AND month=v_month AND kind='draft' AND rev=h.draft_rev)
 OR entry->>'action' IS DISTINCT FROM 'publish' OR entry->'actor' IS DISTINCT FROM jsonb_build_object('id',uid::text)
 OR entry->>'storeId' IS DISTINCT FROM v_store OR entry->>'month' IS DISTINCT FROM v_month
 OR entry->'fromRev' IS DISTINCT FROM to_jsonb(h.draft_rev) OR entry->'toRev' IS DISTINCT FROM to_jsonb(h.draft_rev+1)
 OR entry->'prevHash' IS DISTINCT FROM to_jsonb(h.last_audit_hash)
 OR entry->'subject' IS DISTINCT FROM jsonb_build_object('kind','published','rev',h.published_rev+1,'digest',pub->'hash'->'value')
 THEN RAISE EXCEPTION 'scheduler:invalid';END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_plan->'ops') WHERE value->>'op'='put-version' LOOP
 INSERT INTO scheduler_private.versions VALUES(v_store,v_month,op->>'kind',(op->>'rev')::bigint,op->>'text'); END LOOP;
 INSERT INTO scheduler_private.audit VALUES(v_store,v_month,h.audit_revision+1,entry);
 UPDATE scheduler_private.heads SET draft_rev=h.draft_rev+1,published_rev=h.published_rev+1,audit_revision=h.audit_revision+1,last_audit_hash=entry->>'hash' WHERE store_id=v_store AND month=v_month;
 INSERT INTO scheduler_private.publication_bindings_v2 VALUES(v_store,v_month,h.published_rev+1,context_id_arg);
 INSERT INTO scheduler_private.receipts VALUES(v_store,v_month,uid::text,kh,p_receipt->>'key',p_receipt->>'fingerprint',p_receipt->'result');
 RETURN jsonb_build_object('result',p_receipt->'result','replayed',false);
END $$;

CREATE FUNCTION scheduler_gateway.own_published_v2(actor uuid,store_arg text,month_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p record; person text; days jsonb; v_rev bigint;
BEGIN
 SELECT id,role,stores,active,pending INTO p FROM public.profiles WHERE id=actor FOR SHARE;
 IF NOT FOUND OR p.active IS DISTINCT FROM true OR p.pending IS DISTINCT FROM false THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 PERFORM 1 FROM scheduler_policy.publication_scope_v2 WHERE store_id=store_arg AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scheduler:forbidden';END IF;
 SELECT person_id INTO STRICT person FROM public.floor_people WHERE user_id=actor AND store=store_arg FOR SHARE;
 SELECT h.published_rev INTO v_rev FROM scheduler_private.heads h WHERE h.store_id=store_arg AND h.month=month_arg;
 IF COALESCE(v_rev,0)=0 THEN RETURN jsonb_build_object('version','scheduler-own/2','revision',0,'days','[]'::jsonb);END IF;
 SELECT item->'days' INTO STRICT days FROM scheduler_private.publication_bindings_v2 b
 JOIN scheduler_private.publication_contexts_v2 c ON c.context_id=b.context_id,
 LATERAL jsonb_array_elements(c.body->'projection') item
 WHERE b.store_id=store_arg AND b.month=month_arg AND b.rev=v_rev AND item->>'personId'=person;
 RETURN jsonb_build_object('version','scheduler-own/2','revision',v_rev,'days',days);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'scheduler:forbidden';
END $$;
REVOKE ALL ON FUNCTION scheduler_gateway.publish_v2(jsonb,text,jsonb,jsonb),scheduler_gateway.own_published_v2(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION scheduler_gateway.publish_v2(jsonb,text,jsonb,jsonb),scheduler_gateway.own_published_v2(uuid,text,text) TO scheduler_runtime;
GRANT scheduler_executor TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA scheduler_gateway TO scheduler_executor;
ALTER FUNCTION scheduler_gateway.publish_v2(jsonb,text,jsonb,jsonb) OWNER TO scheduler_executor;
ALTER FUNCTION scheduler_gateway.own_published_v2(uuid,text,text) OWNER TO scheduler_executor;
REVOKE CREATE ON SCHEMA scheduler_gateway FROM scheduler_executor;
REVOKE scheduler_executor FROM CURRENT_USER;
COMMIT;
