\set ON_ERROR_STOP on
create role tv_rpc_owner nologin;
create role client nologin;
create role service_role nologin;
create table private_store (id text primary key, rev bigint not null, value jsonb not null);
create table private_config (id text primary key, value jsonb not null);
grant select, update on private_config to tv_rpc_owner;
create table app_data (key text primary key, value jsonb not null);
grant usage on schema public to tv_rpc_owner,client,service_role;
grant select on private_store to tv_rpc_owner;
grant select, insert, update, delete on app_data to client,service_role,tv_rpc_owner;
create function guard_board() returns trigger language plpgsql as $$
begin
 if current_user <> 'tv_rpc_owner' and
   ((tg_op <> 'INSERT' and old.key like 'lpc:board:%:v1') or
    (tg_op <> 'DELETE' and new.key like 'lpc:board:%:v1')) then
  raise exception 'direct board writes disabled';
 end if;
 if tg_op = 'DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_board before insert or update or delete on app_data for each row execute function guard_board();
create function publish_data(sid text) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare src public.private_store%rowtype; k text;
begin
 if sid !~ '^[a-z0-9-]+$' then raise exception 'bad store id'; end if;
 k := 'lpc:board:' || sid || ':v1';
 select * into src from public.private_store where id=sid for share;
 if not found then return false; end if;
 insert into public.app_data(key,value) values(k, jsonb_build_object('sourceRev',src.rev,'data',jsonb_build_object('count',src.value->'count'),'settingsRev',0,'settings','{}'::jsonb))
 on conflict (key) do update set value = jsonb_set(jsonb_set(public.app_data.value,'{sourceRev}',to_jsonb(src.rev)),'{data}',jsonb_build_object('count',src.value->'count'));
 return true;
end $$;
create function save_settings(sid text, expected bigint, baseline jsonb, desired jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare k text; n integer;
begin
 if sid !~ '^[a-z0-9-]+$' or jsonb_typeof(baseline) <> 'object' or jsonb_typeof(desired) <> 'object' then raise exception 'bad input'; end if;
 k := 'lpc:board:' || sid || ':v1';
 update public.app_data set value=jsonb_set(jsonb_set(value,'{settingsRev}',to_jsonb(expected+1)),'{settings}',desired)
 where key=k and (value->>'settingsRev')::bigint=expected and value->'settings'=baseline;
 get diagnostics n = row_count;
 return n=1;
end $$;
alter function publish_data(text) owner to tv_rpc_owner;
alter function save_settings(text,bigint,jsonb,jsonb) owner to tv_rpc_owner;
revoke all on function publish_data(text),save_settings(text,bigint,jsonb,jsonb) from public;
grant execute on function publish_data(text),save_settings(text,bigint,jsonb,jsonb) to client,service_role;
insert into private_store values ('demo',1,'{"count":4,"private":"never publish"}');

insert into private_config values ('demo','{"name":"Demo","roles":[{"id":"sales"}]}');
