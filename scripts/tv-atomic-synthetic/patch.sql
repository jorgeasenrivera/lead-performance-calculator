\set ON_ERROR_STOP on
create function patch_setting(sid text, field text, oldval jsonb, newval jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 if sid !~ '^[a-z0-9-]+$' or field not in ('size','style') or newval is null then raise exception 'bad input'; end if;
 update public.app_data set value=jsonb_set(jsonb_set(value,'{settingsRev}',to_jsonb((value->>'settingsRev')::bigint+1)),'{settings}',jsonb_set(value->'settings',array[field],newval,true))
 where key='lpc:board:' || sid || ':v1' and (value->'settings'->field) is not distinct from oldval;
 get diagnostics n = row_count;
 return n=1;
end $$;
alter function patch_setting(text,text,jsonb,jsonb) owner to tv_rpc_owner;
revoke all on function patch_setting(text,text,jsonb,jsonb) from public;
grant execute on function patch_setting(text,text,jsonb,jsonb) to client,service_role;
