-- Synthetic experiment only. This schema is created only in a disposable database.
-- This is a partial projection, not the complete board contract.
create schema tv_fixture;
revoke all on schema tv_fixture from public;
grant usage on schema tv_fixture to tv_rpc_owner;
create function tv_fixture.valid_day(value text) returns boolean
language plpgsql immutable strict set search_path=pg_catalog as $$
begin
 if value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
 return to_char(value::date,'YYYY-MM-DD') = value;
exception when others then return false;
end $$;
create function tv_fixture.up_streak(data jsonb, person jsonb, standards jsonb) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare d text; rec jsonb; q jsonb; pid text := person->>'id'; nm text := lower(regexp_replace(trim(person->>'name'),'\s+',' ','g')); worked boolean; offday boolean; points integer; len integer := 0; calls numeric; videos numeric;
begin
 for d in select k from jsonb_object_keys(coalesce(data->'activity','{}'::jsonb)) k order by k desc loop
   rec := data->'activity'->d->nm; q := data->'qualified'->d->nm;
   calls := case when jsonb_typeof(rec->'calls')='number' then (rec->>'calls')::numeric else null end;
   videos := case when jsonb_typeof(rec->'video')='number' then (rec->>'video')::numeric else null end;
   worked := coalesce(calls>0,false) or coalesce(videos>0,false) or exists (
     select 1 from unnest(array['queue','queueOnline','floor']) kind,
       jsonb_array_elements(coalesce(data->kind->d->'line','[]'::jsonb)) x where x->>'id'=pid);
   offday := coalesce((data->'forcedOff'->pid) ? d,false) or (coalesce((data->'daysOff'->pid) ? d,false) and not worked);
   if offday then continue; end if;
   if calls is null and videos is null and (q is null or q='null'::jsonb) then continue; end if;
   points := (case when calls >= coalesce((standards->>'minCalls')::numeric,16) then 0 else 1 end)
           + (case when videos >= coalesce((standards->>'minVideos')::numeric,2) then 0 else 1 end)
           + (case when q='true'::jsonb then 0 else 1 end);
   if points <> 0 then exit; end if;
   len := len + 1;
 end loop;
 return len;
end $$;
create function tv_fixture.tv_projection(data jsonb, month text, roles jsonb, store jsonb) returns jsonb
language sql immutable strict set search_path=pg_catalog as $$
with persons as (
 select x, lower(regexp_replace(trim(x->>'name'),'\s+',' ','g')) as name_key
 from jsonb_array_elements(coalesce(data->'roster','[]'::jsonb)) x
 where jsonb_typeof(x->'id')='string' and (x->>'id') ~ '^[a-zA-Z0-9_-]{1,128}$'
 and jsonb_typeof(x->'name')='string' and length(x->>'name') between 1 and 160
 and (x->>'name') !~ '[<>[:cntrl:]]'
 and (x->'roleId' is null or x->'roleId' = 'null'::jsonb or (jsonb_typeof(x->'roleId')='string' and x->>'roleId' ~ '^[a-zA-Z0-9_-]{1,128}$'))
 and not exists (select 1 from jsonb_array_elements(coalesce(data->'departed','[]'::jsonb)) d
   where lower(regexp_replace(trim(d->>'name'),'\s+',' ','g')) = lower(regexp_replace(trim(x->>'name'),'\s+',' ','g')))
), on_board as (
 select * from persons p where exists (select 1 from jsonb_array_elements(roles) r where jsonb_typeof(r->'id')='string' and r->>'id'=p.x->>'roleId')
), allowed_stats as (
 select p.name_key, coalesce((select jsonb_object_agg(k, case when k in ('prevPct','prevUnits') and jsonb_typeof(v) = 'object' then (select coalesce(jsonb_object_agg(nk,nv),'{}'::jsonb) from jsonb_each(v) n(nk,nv) where nk = any(array['internet','phone','showroom','campaign']) and jsonb_typeof(nv) in ('number','null')) else v end) from jsonb_each(coalesce(data->'months'->month->'stats'->p.name_key,'{}'::jsonb)) s(k,v)
 where ((k in ('prevPct','prevUnits') and jsonb_typeof(v) = 'object') or (k not in ('prevPct','prevUnits') and jsonb_typeof(v) in ('number','null'))) and k = any(array['internetUnits','internetPct','phoneUnits','phonePct','showroomUnits','showroomPct','campaignUnits','prevPct','prevUnits','internetLeads','phoneLeads','showroomLeads','newUnits','usedUnits'])), '{}'::jsonb) as stats
 from on_board p
)
select jsonb_build_object(
 'storeName',case when jsonb_typeof(store->'name')='string' and length(store->>'name') between 1 and 160 and (store->>'name') !~ '[<>[:cntrl:]]' then store->>'name' else 'Store' end,
 'brand',jsonb_build_object('primary',case when store->'brand'->>'primary' ~ '^#[0-9A-Fa-f]{6}$' then store->'brand'->>'primary' else '#2A5E9B' end,'deep',case when store->'brand'->>'deep' ~ '^#[0-9A-Fa-f]{6}$' then store->'brand'->>'deep' else '#1D4674' end,'accent',case when store->'brand'->>'accent' ~ '^#[0-9A-Fa-f]{6}$' then store->'brand'->>'accent' else '#C1D730' end),
 'thresholds', (select jsonb_object_agg(ch,jsonb_build_object('green',case when jsonb_typeof(store->'thresholds'->ch->'green')='number' then store->'thresholds'->ch->'green' when ch in ('internet','phone','showroom') and (store->'thresholds' ? 'green' or store->'thresholds' ? 'yellow') then coalesce(case when jsonb_typeof(store->'thresholds'->'green')='number' then store->'thresholds'->'green' end,'20'::jsonb) else defs->ch->'green' end,'yellow',case when jsonb_typeof(store->'thresholds'->ch->'yellow')='number' then store->'thresholds'->ch->'yellow' when ch in ('internet','phone','showroom') and (store->'thresholds' ? 'green' or store->'thresholds' ? 'yellow') then coalesce(case when jsonb_typeof(store->'thresholds'->'yellow')='number' then store->'thresholds'->'yellow' end,'10'::jsonb) else defs->ch->'yellow' end)) from jsonb_object_keys('{"internet":{},"phone":{},"showroom":{},"apptVideoDayPct":{},"engagedVideoPct":{}}'::jsonb) ch cross join (select '{"internet":{"green":20,"yellow":10},"phone":{"green":25,"yellow":12},"showroom":{"green":30,"yellow":15},"apptVideoDayPct":{"green":60,"yellow":45},"engagedVideoPct":{"green":50,"yellow":35}}'::jsonb defs) d),
 'ticker',coalesce((select jsonb_agg('&#128293; ' || replace(replace(replace(p.x->>'name','&','&amp;'),'<','&lt;'),'>','&gt;') || ' is on a ' || streak || '-day streak') from on_board p cross join lateral (select tv_fixture.up_streak(data,p.x,coalesce(store->'activityStandards','{}'::jsonb)) streak) v where streak>=3),'[]'::jsonb),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r->'id')) from jsonb_array_elements(roles) r where jsonb_typeof(r->'id')='string' and (r->>'id') ~ '^[a-zA-Z0-9_-]{1,128}$'),'[]'::jsonb), 'ym',month,
 'people', coalesce((select jsonb_agg(jsonb_build_object('id',x->'id','name',x->'name','roleId',x->'roleId')) from persons),'[]'::jsonb),
 'roster', coalesce((select jsonb_agg(jsonb_build_object('id',x->'id','name',x->'name','roleId',x->'roleId')) from on_board),'[]'::jsonb),
 'goals', coalesce((select jsonb_object_agg(p.name_key,coalesce(nullif(data->'goals'->(p.x->>'id')->'byMonth'->month,'null'::jsonb),nullif(data->'goals'->(p.x->>'id')->'monthly','null'::jsonb))) from on_board p where case when jsonb_typeof(coalesce(nullif(data->'goals'->(p.x->>'id')->'byMonth'->month,'null'::jsonb),nullif(data->'goals'->(p.x->>'id')->'monthly','null'::jsonb)))='number' then (coalesce(nullif(data->'goals'->(p.x->>'id')->'byMonth'->month,'null'::jsonb),nullif(data->'goals'->(p.x->>'id')->'monthly','null'::jsonb)) #>> '{}')::numeric >= 0 else false end),'{}'::jsonb),
 'off', coalesce((select jsonb_object_agg(p.name_key,dates.days) from on_board p cross join lateral (select jsonb_agg(day order by day) as days from jsonb_array_elements_text(case when jsonb_typeof(data->'daysOff'->(p.x->>'id'))='array' then data->'daysOff'->(p.x->>'id') else '[]'::jsonb end) day where tv_fixture.valid_day(day) and left(day,7) in (month,to_char(to_date(month||'-01','YYYY-MM-DD')+interval '1 month','YYYY-MM'))) dates where dates.days is not null),'{}'::jsonb),
 'months', jsonb_build_object(month,jsonb_build_object('stats',coalesce((select jsonb_object_agg(name_key,stats) from allowed_stats),'{}'::jsonb)))
);
$$;
do $$
declare p jsonb;
begin
 p := tv_fixture.tv_projection('{"roster":[{"id":"a","name":"Alex Jones","roleId":"sales","secret":"private"},{"id":"b","name":"Other Person","roleId":"bdc"},{"id":"c","name":"Gone Person","roleId":"sales"}],"departed":[{"name":"Gone Person"}],"goals":{"a":{"monthly":10}},"daysOff":{"a":["2026-08-01","2026-07-03","2026-09-01"]},"months":{"2026-07":{"stats":{"alex jones":{"internetUnits":0.5,"phoneUnits":2,"prevPct":{"internet":0.2,"secret":"private"},"prevUnits":{"phone":1.5,"secret":"private"},"secret":"private"}},"stated":{"deliveries":4}}}}','2026-07','[{"id":"sales"}]','{"name":"Demo"}');
 if p->'months'->'2026-07'->'stats'->'alex jones'->>'internetUnits' <> '0.5' then raise exception 'split lost'; end if;
 if p->'goals'->>'alex jones' <> '10' or p->'off'->'alex jones' <> '["2026-07-03","2026-08-01"]'::jsonb then raise exception 'phone extras failed'; end if;
 if p->'months'->'2026-07'->'stats'->'alex jones'->'prevPct' <> '{"internet":0.2}'::jsonb then raise exception 'nested whitelist failed'; end if;
 if jsonb_array_length(p->'people') <> 2 or jsonb_array_length(p->'roster') <> 1 then raise exception 'roster filter failed'; end if;
 if p::text like '%private%' or p::text like '%stated%' or p::text like '%storeTotal%' then raise exception 'unapproved field escaped'; end if;
end $$;
select 'PASS synthetic SQL projection: filtering, split credit, private fields and unverified count' as result;
do $$
declare p jsonb; input jsonb;
begin
 input := '{"roster":[{"id":"a","name":"Alex Jones","roleId":"sales"}],"activity":{"2026-07-05":{"alex jones":{"calls":16,"video":2}},"2026-07-06":{"alex jones":{"calls":16,"video":2}},"2026-07-07":{"alex jones":{"calls":16,"video":2}},"2026-07-08":{"alex jones":{"calls":16,"video":2}}},"forcedOff":{"a":["2026-07-08"]},"qualified":{"2026-07-05":{"alex jones":true},"2026-07-06":{"alex jones":true},"2026-07-07":{"alex jones":true},"2026-07-08":{"alex jones":true}}}'::jsonb;
 p := tv_fixture.tv_projection(input,'2026-07','[{"id":"sales"}]','{"name":"Demo","brand":{"primary":"#112233","secret":"private"},"thresholds":{"green":40,"yellow":20,"secret":"private"}}');
 if p->'brand' <> '{"primary":"#112233","deep":"#1D4674","accent":"#C1D730"}'::jsonb then raise exception 'brand mismatch'; end if;
 if p->'thresholds'->'internet' <> '{"green":40,"yellow":20}'::jsonb or p->'thresholds'->'apptVideoDayPct' <> '{"green":60,"yellow":45}'::jsonb then raise exception 'threshold mismatch'; end if;
 if p->'ticker' <> '["&#128293; Alex Jones is on a 3-day streak"]'::jsonb then raise exception 'ticker mismatch: %',p->'ticker'; end if;
 if p::text like '%private%' then raise exception 'config leak'; end if;
 p := tv_fixture.tv_projection(input,'2026-07','[{"id":"sales"}]','{"thresholds":{"phone":{"green":33}}}');
 if p->'thresholds'->'phone' <> '{"green":33,"yellow":12}'::jsonb then raise exception 'partial threshold mismatch'; end if;
 p := tv_fixture.tv_projection(input,'2026-07','[{"id":"sales"}]','{"thresholds":{"green":33}}');
 if p->'thresholds'->'phone' <> '{"green":33,"yellow":10}'::jsonb then raise exception 'flat threshold mismatch'; end if;
end $$;
select 'PASS synthetic branding, thresholds, ticker and private-config filtering' as result;
do $$
declare p jsonb;
begin
 p := tv_fixture.tv_projection('{"roster":[{"id":"a","name":"Alex Jones","roleId":"sales"},{"id":{"private":"hidden"},"name":"Bad","roleId":"sales"}],"goals":{"a":{"monthly":{"private":"hidden"}}},"daysOff":{"a":{"private":"hidden"}},"months":{"2026-07":{"stats":{"alex jones":{"internetPct":{"private":"hidden"},"prevPct":{"internet":{"private":"hidden"},"phone":0.2}}}}}}','2026-07','[{"id":"sales","private":"hidden"},{"id":{"private":"hidden"}}]','{"name":{"private":"hidden"},"brand":{"primary":{"private":"hidden"}}}');
 if p::text like '%hidden%' or p->'goals' <> '{}'::jsonb or p->'off' <> '{}'::jsonb then raise exception 'malformed value leaked: %',p; end if;
 if p->'months'->'2026-07'->'stats'->'alex jones'->'prevPct' <> '{"phone":0.2}'::jsonb then raise exception 'nested numeric filter failed'; end if;
 p := tv_fixture.tv_projection('{"roster":[{"id":"a","name":"Alex Jones","roleId":"sales"}],"daysOff":{"a":["2026-07-01","2026-07-99","2026-02-30"]}}','2026-07','[{"id":"sales"}]','{}');
 if p->'off'->'alex jones' <> '["2026-07-01"]'::jsonb then raise exception 'malformed date escaped'; end if;
end $$;
select 'PASS malformed synthetic values do not escape the SQL projection' as result;



-- Private synthetic test function: the caller cannot supply board data.
create function tv_fixture.publish_projected(sid text, month text, roles jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,tv_fixture as $$
declare src public.private_store%rowtype; cfg public.private_config%rowtype; projected jsonb; configured_roles jsonb;
begin
 select * into src from public.private_store where id=sid for share;
 if not found then return false; end if;
 select * into cfg from public.private_config where id=sid for share;
 if not found then return false; end if;
 configured_roles := coalesce((select jsonb_agg(jsonb_build_object('id',r->'id')) from jsonb_array_elements(coalesce(cfg.value->'roles','[]'::jsonb)) r where r->'onBoard' is distinct from 'false'::jsonb and jsonb_typeof(r->'id')='string' and (r->>'id') ~ '^[a-zA-Z0-9_-]{1,128}$'),'[]'::jsonb);
 projected := tv_fixture.tv_projection(src.value,month,configured_roles,cfg.value);
 insert into public.app_data(key,value) values ('lpc:board:'||sid||':v1',jsonb_build_object('sourceRev',src.rev,'data',projected,'settingsRev',0,'settings','{}'::jsonb))
 on conflict(key) do update set value=jsonb_set(jsonb_set(public.app_data.value,'{sourceRev}',to_jsonb(src.rev)),'{data}',projected);
 return true;
end $$;
alter function tv_fixture.publish_projected(text,text,jsonb) owner to tv_rpc_owner;
revoke all on function tv_fixture.publish_projected(text,text,jsonb) from public;
