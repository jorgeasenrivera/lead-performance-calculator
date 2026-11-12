-- PENDING SOURCE CANDIDATE, NOT AN APPLIED MIGRATION.
-- Only the disposable fictional runner may load this file under H-X65.
-- No grants, public RPC wrappers, auth policy, live role or endpoint wiring.
-- Authority arguments must come from a separately reviewed request-scoped
-- server authority provider. A service-role credential is not that provider.
BEGIN;
CREATE SCHEMA scheduler_private;
REVOKE ALL ON SCHEMA scheduler_private FROM PUBLIC;

CREATE TABLE scheduler_private.heads (
  store_id text NOT NULL CHECK (store_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  month text NOT NULL CHECK (month ~ '^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$' AND month >= '2014-01' AND month <= '2100-12'),
  draft_rev bigint NOT NULL CHECK (draft_rev BETWEEN 0 AND 9007199254740991),
  published_rev bigint NOT NULL CHECK (published_rev BETWEEN 0 AND 9007199254740991),
  audit_revision bigint NOT NULL CHECK (audit_revision BETWEEN 0 AND 9007199254740991),
  last_audit_hash text CHECK (last_audit_hash ~ '^[0-9a-f]{16,128}$'),
  PRIMARY KEY (store_id, month)
);
CREATE TABLE scheduler_private.versions (
  store_id text NOT NULL,
  month text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('draft', 'published')),
  rev bigint NOT NULL CHECK (rev BETWEEN 1 AND 9007199254740991),
  version_text text NOT NULL CHECK (octet_length(version_text) <= 4000000),
  PRIMARY KEY (store_id, month, kind, rev),
  FOREIGN KEY (store_id, month) REFERENCES scheduler_private.heads DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE scheduler_private.audit (
  store_id text NOT NULL,
  month text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  entry jsonb NOT NULL CHECK (jsonb_typeof(entry) = 'object'),
  PRIMARY KEY (store_id, month, revision),
  FOREIGN KEY (store_id, month) REFERENCES scheduler_private.heads DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE scheduler_private.receipts (
  store_id text NOT NULL,
  month text NOT NULL,
  actor_id text NOT NULL CHECK (actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$'),
  key_digest text NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  request_key text NOT NULL CHECK (octet_length(request_key) <= 1048576),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  PRIMARY KEY (store_id, month, actor_id, key_digest),
  FOREIGN KEY (store_id, month) REFERENCES scheduler_private.heads DEFERRABLE INITIALLY DEFERRED
);
-- Defense in depth only. With no policies/grants, this file does not create a
-- usable application role. Local owner tests cannot prove production access.
ALTER TABLE scheduler_private.heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_private.receipts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION scheduler_private.object_keys(value jsonb, keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT CASE WHEN pg_catalog.jsonb_typeof(value) = 'object'
  THEN value ?& keys AND value - keys = '{}'::jsonb ELSE false END $$;

CREATE FUNCTION scheduler_private.require_authority(authority jsonb, action text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT scheduler_private.object_keys(authority, ARRAY['actorId','action','storeId','month','readKind'])
     OR pg_catalog.jsonb_typeof(authority->'action') IS DISTINCT FROM 'string'
     OR authority->>'action' IS DISTINCT FROM action OR action IS NULL OR action NOT IN ('read','save')
     OR pg_catalog.jsonb_typeof(authority->'actorId') IS DISTINCT FROM 'string'
     OR (authority->>'actorId') !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$'
     OR pg_catalog.jsonb_typeof(authority->'storeId') IS DISTINCT FROM 'string'
     OR (authority->>'storeId') !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     OR pg_catalog.jsonb_typeof(authority->'month') IS DISTINCT FROM 'string'
     OR (authority->>'month') !~ '^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$'
     OR authority->>'month' < '2014-01' OR authority->>'month' > '2100-12'
     OR (action = 'save' AND authority->'readKind' IS DISTINCT FROM 'null'::jsonb)
     OR (action = 'read' AND (pg_catalog.jsonb_typeof(authority->'readKind') IS DISTINCT FROM 'string'
       OR authority->>'readKind' NOT IN ('draft','published'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:forbidden';
  END IF;
END $$;

CREATE FUNCTION scheduler_private.require_key(authority jsonb, request_key text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE parsed jsonb;
BEGIN
  IF request_key IS NULL OR pg_catalog.octet_length(request_key) > 1048576 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:forbidden';
  END IF;
  parsed := request_key::jsonb;
  IF pg_catalog.jsonb_typeof(parsed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:forbidden';
  END IF;
  IF pg_catalog.jsonb_array_length(parsed) <> 4 OR parsed->0 IS DISTINCT FROM authority->'actorId'
    OR parsed->1 IS DISTINCT FROM authority->'storeId' OR parsed->2 IS DISTINCT FROM authority->'month'
    OR pg_catalog.jsonb_typeof(parsed->3) IS DISTINCT FROM 'string' OR pg_catalog.btrim(parsed->>3) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:forbidden';
  END IF;
END $$;

CREATE FUNCTION scheduler_private.immutable_record()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:immutable'; END $$;
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE OR TRUNCATE ON scheduler_private.versions
  FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON scheduler_private.audit
  FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.immutable_record();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE OR TRUNCATE ON scheduler_private.receipts
  FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.immutable_record();
CREATE TRIGGER retained_heads BEFORE DELETE OR TRUNCATE ON scheduler_private.heads
  FOR EACH STATEMENT EXECUTE FUNCTION scheduler_private.immutable_record();
CREATE FUNCTION scheduler_private.monotonic_head()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.month IS DISTINCT FROM OLD.month
    OR NEW.draft_rev < OLD.draft_rev OR NEW.published_rev < OLD.published_rev
    OR NEW.audit_revision <= OLD.audit_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER monotonic_head BEFORE UPDATE ON scheduler_private.heads
  FOR EACH ROW EXECUTE FUNCTION scheduler_private.monotonic_head();

CREATE FUNCTION scheduler_private.scheduler_snapshot(p_authority jsonb, p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM scheduler_private.require_authority(p_authority, p_authority->>'action');
  IF (p_authority->>'action' = 'read' AND p_key IS NOT NULL) OR
     (p_authority->>'action' = 'save' AND p_key IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:forbidden';
  END IF;
  IF p_key IS NOT NULL THEN PERFORM scheduler_private.require_key(p_authority, p_key); END IF;
  -- One SQL statement observes head, both version texts, audit boundary and
  -- receipt at one MVCC snapshot. No context/provider version is invented.
  SELECT pg_catalog.jsonb_build_object(
    'snapshot', pg_catalog.jsonb_build_object(
      'scope', pg_catalog.jsonb_build_object('storeId',p_authority->>'storeId','month',p_authority->>'month'),
      'head', CASE WHEN h.store_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('draftRev',h.draft_rev,'publishedRev',h.published_rev) END,
      'draftText', d.version_text, 'publishedText', p.version_text,
      'prevAuditHash', h.last_audit_hash, 'auditRevision', COALESCE(h.audit_revision,0)),
    'receipt', CASE WHEN r.request_key IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('key',r.request_key,'fingerprint',r.fingerprint,'result',r.result) END)
  INTO result
  FROM (SELECT 1) one
  LEFT JOIN scheduler_private.heads h ON h.store_id=p_authority->>'storeId' AND h.month=p_authority->>'month'
  LEFT JOIN scheduler_private.versions d ON d.store_id=h.store_id AND d.month=h.month AND d.kind='draft' AND d.rev=h.draft_rev
  LEFT JOIN scheduler_private.versions p ON p.store_id=h.store_id AND p.month=h.month AND p.kind='published' AND p.rev=h.published_rev
  LEFT JOIN scheduler_private.receipts r ON r.store_id=p_authority->>'storeId' AND r.month=p_authority->>'month'
    AND r.actor_id=p_authority->>'actorId' AND r.key_digest=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_key,'UTF8')),'hex');
  RETURN result;
END $$;

CREATE FUNCTION scheduler_private.scheduler_commit(p_authority jsonb, p_expected jsonb, p_plan jsonb, p_receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  h scheduler_private.heads%ROWTYPE;
  r scheduler_private.receipts%ROWTYPE;
  v_store text; month_id text; v_actor text; key_hash text;
  head_json jsonb; put jsonb; append_op jsonb; entry jsonb; envelope jsonb;
  draft_rev bigint; published_rev bigint; audit_rev bigint; next_rev bigint;
BEGIN
  PERFORM scheduler_private.require_authority(p_authority, 'save');
  IF NOT scheduler_private.object_keys(p_receipt, ARRAY['key','fingerprint','result'])
    OR pg_catalog.jsonb_typeof(p_receipt->'key') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(p_receipt->'fingerprint') IS DISTINCT FROM 'string'
    OR (p_receipt->>'fingerprint') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  PERFORM scheduler_private.require_key(p_authority, p_receipt->>'key');
  v_store := p_authority->>'storeId'; month_id := p_authority->>'month'; v_actor := p_authority->>'actorId';
  key_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_receipt->>'key','UTF8')),'hex');
  -- A store-wide transaction lock also serializes first writes to absent
  -- months. Hash collisions only serialize unrelated stores, never mix data.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sage-scheduler:' || v_store, 0));
  SELECT x.* INTO r FROM scheduler_private.receipts x WHERE x.store_id=v_store AND x.month=month_id
    AND x.actor_id=v_actor AND x.key_digest=key_hash;
  IF FOUND THEN
    IF r.request_key IS DISTINCT FROM p_receipt->>'key' OR r.fingerprint IS DISTINCT FROM p_receipt->>'fingerprint' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:idempotency-conflict';
    END IF;
    RETURN pg_catalog.jsonb_build_object('result',r.result,'replayed',true);
  END IF;
  SELECT x.* INTO h FROM scheduler_private.heads x WHERE x.store_id=v_store AND x.month=month_id FOR UPDATE;
  head_json := CASE WHEN FOUND THEN pg_catalog.jsonb_build_object('draftRev',h.draft_rev,'publishedRev',h.published_rev) ELSE 'null'::jsonb END;
  draft_rev := COALESCE(h.draft_rev,0); published_rev := COALESCE(h.published_rev,0); audit_rev := COALESCE(h.audit_revision,0);
  IF NOT scheduler_private.object_keys(p_expected, ARRAY['head','prevAuditHash','auditRevision'])
    OR p_expected->'head' IS DISTINCT FROM head_json
    OR p_expected->'prevAuditHash' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(h.last_audit_hash),'null'::jsonb)
    OR p_expected->'auditRevision' IS DISTINCT FROM pg_catalog.to_jsonb(audit_rev)
    OR draft_rev >= 9007199254740991 OR audit_rev >= 9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:conflict';
  END IF;
  IF NOT scheduler_private.object_keys(p_plan, ARRAY['kind','storeId','month','atomic','authorization','ops','auditEntry','resultingHead'])
    OR p_plan->>'kind' IS DISTINCT FROM 'draft-save' OR p_plan->'storeId' IS DISTINCT FROM p_authority->'storeId'
    OR p_plan->'month' IS DISTINCT FROM p_authority->'month' OR p_plan->'atomic' IS DISTINCT FROM 'true'::jsonb
    OR p_plan->>'authorization' IS DISTINCT FROM 'not-checked' OR pg_catalog.jsonb_typeof(p_plan->'ops') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  IF pg_catalog.jsonb_array_length(p_plan->'ops') <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  put := p_plan->'ops'->0; append_op := p_plan->'ops'->1; entry := p_plan->'auditEntry'; next_rev := draft_rev+1;
  IF pg_catalog.jsonb_typeof(put->'text') IS DISTINCT FROM 'string' OR
    put IS DISTINCT FROM pg_catalog.jsonb_build_object('op','put-version','kind','draft','storeId',v_store,'month',month_id,
      'expectedRev',draft_rev,'rev',next_rev,'text',put->>'text') OR
    append_op IS DISTINCT FROM pg_catalog.jsonb_build_object('op','append-audit','storeId',v_store,'month',month_id,'entry',entry) OR
    p_plan->'resultingHead' IS DISTINCT FROM pg_catalog.jsonb_build_object('draftRev',next_rev,'publishedRev',published_rev) OR
    p_receipt->'result' IS DISTINCT FROM pg_catalog.jsonb_build_object('head',p_plan->'resultingHead') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  IF pg_catalog.octet_length(put->>'text') > 4000000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  envelope := (put->>'text')::jsonb;
  -- The injected original C113 decoder/verifier checks canonical text and its
  -- checksum before RPC. SQL enforces relational bindings, not a copied FNV
  -- implementation. Neither FNV nor this database tail proves authenticity.
  IF envelope->>'format' IS DISTINCT FROM 'sage.scheduler.version' OR envelope->'version' IS DISTINCT FROM '1'::jsonb
    OR envelope->>'kind' IS DISTINCT FROM 'draft' OR envelope->'storeId' IS DISTINCT FROM p_authority->'storeId'
    OR envelope->'month' IS DISTINCT FROM p_authority->'month' OR envelope->'rev' IS DISTINCT FROM pg_catalog.to_jsonb(next_rev)
    OR entry->'entryVersion' IS DISTINCT FROM '1'::jsonb OR entry->>'action' IS DISTINCT FROM 'draft-save'
    OR entry->'storeId' IS DISTINCT FROM p_authority->'storeId' OR entry->'month' IS DISTINCT FROM p_authority->'month'
    OR entry->'actor' IS DISTINCT FROM pg_catalog.jsonb_build_object('id',v_actor)
    OR entry->'fromRev' IS DISTINCT FROM pg_catalog.to_jsonb(draft_rev) OR entry->'toRev' IS DISTINCT FROM pg_catalog.to_jsonb(next_rev)
    OR entry->'subject' IS DISTINCT FROM pg_catalog.jsonb_build_object('kind','draft','rev',next_rev,'digest',envelope->'hash'->'value')
    OR entry->'prevHash' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(h.last_audit_hash),'null'::jsonb)
    OR pg_catalog.jsonb_typeof(entry->'hash') IS DISTINCT FROM 'string' OR (entry->>'hash') !~ '^[0-9a-f]{16,128}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'scheduler:invalid';
  END IF;
  INSERT INTO scheduler_private.versions VALUES (v_store,month_id,'draft',next_rev,put->>'text');
  INSERT INTO scheduler_private.audit VALUES (v_store,month_id,audit_rev+1,entry);
  IF h.store_id IS NULL THEN
    INSERT INTO scheduler_private.heads VALUES (v_store,month_id,next_rev,published_rev,audit_rev+1,entry->>'hash');
  ELSE
    UPDATE scheduler_private.heads x SET draft_rev=next_rev,audit_revision=audit_rev+1,last_audit_hash=entry->>'hash'
      WHERE x.store_id=v_store AND x.month=month_id;
  END IF;
  INSERT INTO scheduler_private.receipts VALUES (v_store,month_id,v_actor,key_hash,p_receipt->>'key',p_receipt->>'fingerprint',p_receipt->'result');
  RETURN pg_catalog.jsonb_build_object('result',p_receipt->'result','replayed',false);
END $$;

-- Function EXECUTE defaults to PUBLIC. Revoke it in the same installation
-- transaction; no callable role or exposed-schema configuration is installed.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scheduler_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA scheduler_private FROM PUBLIC;
COMMIT;
