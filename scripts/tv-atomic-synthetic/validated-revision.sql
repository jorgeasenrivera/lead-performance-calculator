-- Synthetic only: no real verifier or production authorization is defined here.
-- The fixture owner represents a separate trusted verifier; client roles have no access.
create table tv_fixture.verified_source (
 store_id text not null,
 source_rev bigint not null,
 source_asof timestamptz not null,
 period_start date not null,
 period_end date not null,
 metric text not null,
 source_snapshot jsonb not null,
 whole_count bigint not null check (whole_count >= 0),
 primary key (store_id,source_rev)
);
create function tv_fixture.prevent_attestation_change() returns trigger language plpgsql as $$
begin raise exception 'attestations are immutable'; end $$;
create trigger attestation_immutable before update or delete on tv_fixture.verified_source
for each row execute function tv_fixture.prevent_attestation_change();
revoke all on tv_fixture.verified_source from public,client,service_role;
grant select on tv_fixture.verified_source to tv_rpc_owner;
create function tv_fixture.publish_validated(sid text, expected_rev bigint, month text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,tv_fixture as $$
declare src public.private_store%rowtype; proof tv_fixture.verified_source%rowtype; k text;
begin
 if sid is null or expected_rev is null or month is null then return false; end if;
 select * into src from public.private_store where id=sid for share;
 if not found or src.rev <> expected_rev then return false; end if;
 select * into proof from tv_fixture.verified_source where store_id=sid and source_rev=src.rev;
 if not found or proof.source_snapshot <> src.value or proof.metric <> 'deals-delivered'
   or month !~ '^\d{4}-(0[1-9]|1[0-2])$'
   or proof.period_start::text <> month || '-01'
   or to_char(proof.period_end,'YYYY-MM') <> month
   or proof.period_end < proof.period_start
   or proof.period_end > (proof.source_asof at time zone 'America/New_York')::date
   or proof.source_asof > now() + interval '5 minutes'
 then return false; end if;
 if not tv_fixture.publish_projected(sid,month,'[]'::jsonb) then return false; end if;
 k := 'lpc:board:' || sid || ':v1';
 update public.app_data set value=jsonb_set(value,'{data}',(value->'data') || jsonb_build_object(
   'verifiedSourceRev',proof.source_rev,'verifiedSourceAsOf',proof.source_asof,'verifiedPeriodStart',proof.period_start,'verifiedPeriodEnd',proof.period_end,'verifiedMetric',proof.metric,'verifiedCount',proof.whole_count)) where key=k;
 return true;
end $$;
alter function tv_fixture.publish_validated(text,bigint,text) owner to tv_rpc_owner;
revoke all on function tv_fixture.publish_validated(text,bigint,text) from public,client,service_role;
