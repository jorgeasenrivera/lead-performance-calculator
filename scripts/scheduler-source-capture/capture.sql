-- LOCAL DISABLED PROPOSAL. Requires v2 and public.app_data(key text,value jsonb).
-- No runtime grants, LOGIN, endpoint or supplemental production writer.
BEGIN;
CREATE TABLE scheduler_private.capture_generation_v1(store_id text PRIMARY KEY,epoch bigint NOT NULL CHECK(epoch>0));
CREATE TABLE scheduler_private.capture_inputs_v1(store_id text PRIMARY KEY,payload jsonb NOT NULL);
REVOKE ALL ON scheduler_private.capture_generation_v1,scheduler_private.capture_inputs_v1 FROM PUBLIC,anon,authenticated,service_role,scheduler_runtime,scheduler_executor;
CREATE FUNCTION scheduler_private.invalidate_capture_v1(s text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF s !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'capture:invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sage-scheduler:'||s,0));
 INSERT INTO scheduler_private.capture_generation_v1 VALUES(s,1) ON CONFLICT(store_id) DO UPDATE SET epoch=capture_generation_v1.epoch+1;
 DELETE FROM scheduler_private.publication_source_heads_v2 WHERE store_id=s;
END $$;
-- Transition tables collect all affected stores before taking locks in sorted order.
-- Capture/registration never locks app_data rows, avoiding source-row/advisory inversion.
CREATE FUNCTION scheduler_private.capture_app_changed_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE keys text[];s text;BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(key) INTO keys FROM new_rows;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(key) INTO keys FROM old_rows;
 ELSE SELECT array_agg(key) INTO keys FROM (SELECT key FROM old_rows UNION SELECT key FROM new_rows) q;END IF;
 FOR s IN SELECT DISTINCT id FROM (
 SELECT split_part(k,':',3) id FROM unnest(keys) k WHERE k ~ '^lpc:store:[a-z0-9][a-z0-9_-]{0,63}:'
 UNION SELECT store_id FROM scheduler_private.capture_generation_v1 WHERE EXISTS(SELECT 1 FROM unnest(keys) k WHERE k LIKE 'lpc:config%')
 ) q ORDER BY id LOOP PERFORM scheduler_private.invalidate_capture_v1(s);END LOOP;RETURN NULL;
END $$;
CREATE TRIGGER capture_app_insert AFTER INSERT ON public.app_data REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_app_changed_v1();
CREATE TRIGGER capture_app_update AFTER UPDATE ON public.app_data REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_app_changed_v1();
CREATE TRIGGER capture_app_delete AFTER DELETE ON public.app_data REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_app_changed_v1();
CREATE FUNCTION scheduler_private.capture_supplement_changed_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE stores text[];s text;BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(store_id) INTO stores FROM new_rows;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(store_id) INTO stores FROM old_rows;
 ELSE SELECT array_agg(store_id) INTO stores FROM (SELECT store_id FROM old_rows UNION SELECT store_id FROM new_rows) q;END IF;
 FOR s IN SELECT DISTINCT x FROM unnest(stores) x ORDER BY x LOOP
 PERFORM scheduler_private.invalidate_capture_v1(s);END LOOP;RETURN NULL;END $$;
CREATE TRIGGER capture_supplement_insert AFTER INSERT ON scheduler_private.capture_inputs_v1 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_supplement_changed_v1();
CREATE TRIGGER capture_supplement_update AFTER UPDATE ON scheduler_private.capture_inputs_v1 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_supplement_changed_v1();
CREATE TRIGGER capture_supplement_delete AFTER DELETE ON scheduler_private.capture_inputs_v1 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_supplement_changed_v1();
CREATE FUNCTION scheduler_private.capture_truncated_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE s text;BEGIN
 FOR s IN SELECT store_id FROM scheduler_private.capture_generation_v1 ORDER BY store_id LOOP PERFORM scheduler_private.invalidate_capture_v1(s);END LOOP;RETURN NULL;END $$;
CREATE TRIGGER capture_app_truncate AFTER TRUNCATE ON public.app_data FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_truncated_v1();
CREATE TRIGGER capture_supplement_truncate AFTER TRUNCATE ON scheduler_private.capture_inputs_v1 FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.capture_truncated_v1();

-- Single source snapshot under the same store lock as draft/publication writes.
CREATE FUNCTION scheduler_private.capture_snapshot_v1(s text,m text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result jsonb;BEGIN
 IF s !~ '^[a-z0-9][a-z0-9_-]{0,63}$' OR m !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'capture:invalid';END IF;
 -- Table locks precede advisory locks so concurrent TRUNCATE cannot invert them.
 LOCK TABLE public.app_data,scheduler_private.capture_inputs_v1 IN ACCESS SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('sage-scheduler:'||s,0));
 INSERT INTO scheduler_private.capture_generation_v1 VALUES(s,1) ON CONFLICT DO NOTHING;
 SELECT jsonb_build_object('version','scheduler-source-snapshot/1','scope',jsonb_build_object('storeId',s,'month',m),
 'epoch',(SELECT epoch FROM scheduler_private.capture_generation_v1 WHERE store_id=s),
 'rows',COALESCE((SELECT jsonb_object_agg(key,value) FROM public.app_data WHERE left(key,length('lpc:store:'||s||':'))='lpc:store:'||s||':'),'{}'::jsonb),
 'supplement',(SELECT payload FROM scheduler_private.capture_inputs_v1 WHERE store_id=s),
 'heads',COALESCE((SELECT jsonb_object_agg(month,to_jsonb(h)-'store_id'-'month') FROM scheduler_private.heads h WHERE store_id=s AND month BETWEEN to_char((m||'-01')::date-interval '1 month','YYYY-MM') AND to_char((m||'-01')::date+interval '1 month','YYYY-MM')),'{}'::jsonb),
 'versions',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.month,v.kind,v.rev) FROM scheduler_private.versions v JOIN scheduler_private.heads h USING(store_id,month) WHERE v.store_id=s AND v.month BETWEEN to_char((m||'-01')::date-interval '1 month','YYYY-MM') AND to_char((m||'-01')::date+interval '1 month','YYYY-MM') AND ((kind='draft' AND rev=h.draft_rev) OR(kind='published' AND rev=h.published_rev))),'[]'::jsonb)) INTO result;
 RETURN result;END $$;
-- Trusted server-only registration. Input must be produced by the strict JS adapter.
-- Snapshot equality binds all source rows, absent rows, supplements and neighbor heads.
CREATE FUNCTION scheduler_private.register_capture_v1(expected jsonb,txt text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;id text;s text;m text;current_snapshot jsonb;BEGIN
 c:=txt::jsonb;s:=expected->'scope'->>'storeId';m:=expected->'scope'->>'month';
 current_snapshot:=scheduler_private.capture_snapshot_v1(s,m);
 IF current_snapshot IS DISTINCT FROM expected THEN RAISE EXCEPTION 'capture:conflict';END IF;
 IF c->'scope' IS DISTINCT FROM expected->'scope' OR c->'sourceEpoch' IS DISTINCT FROM expected->'epoch' THEN RAISE EXCEPTION 'capture:invalid';END IF;
 id:=encode(sha256(convert_to(txt,'UTF8')),'hex');
 INSERT INTO scheduler_private.publication_contexts_v2 VALUES(id,txt,c) ON CONFLICT DO NOTHING;
 INSERT INTO scheduler_private.publication_source_heads_v2 VALUES(s,m,(expected->>'epoch')::bigint,id)
 ON CONFLICT(store_id,month) DO UPDATE SET epoch=EXCLUDED.epoch,context_id=EXCLUDED.context_id;
 RETURN id;END $$;
REVOKE ALL ON FUNCTION scheduler_private.invalidate_capture_v1(text),scheduler_private.capture_app_changed_v1(),scheduler_private.capture_supplement_changed_v1(),scheduler_private.capture_truncated_v1(),scheduler_private.capture_snapshot_v1(text,text),scheduler_private.register_capture_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role,scheduler_runtime,scheduler_executor;
COMMIT;
