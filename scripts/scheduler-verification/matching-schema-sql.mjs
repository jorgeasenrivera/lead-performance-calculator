import {Pool} from 'pg';
import {after} from 'node:test';
import {createSchedulerPgTransport,createDraftPermissionFor} from '../../api/_scheduler-pg-transport.mjs';
import {createDraftOnlyScheduler} from '../../api/_scheduler-draft-only.mjs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createAuthorizedSchedulerHandler, createSchedulerIdentityReader, resolveSchedulerAuthority } from '../../api/_scheduler-authorization.mjs';
import { createSchedulerContract } from '../../api/_scheduler-contract.mjs';
import dormant from '../../api/scheduler.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const pins = {
'audit-entry.mjs':'4955fe594bb3736c0525f3c9975dfd43f53b4bc14394b6ced1a9dd0cc1b06300',
'cas.mjs':'35de09c8e30a22272b61c051d45464fae5be0c076f1b30fe7fba7484d40929e6',
'deserialize.mjs':'2d7a0c11148bbb90317805f750e792e5ae427a8eeafe4a26ba0ce985c1126ac8',
'envelope.mjs':'c7df30414b4a37190c5bbf1e160cee877eefffb4fc54cdba4a4ea10c09a141e9',
'identity.mjs':'2c5839019f28c8675d8f8e23e8d8eca5f0d72fcf41c40fa5e6a49a56b0accd1e',
'publish-plan.mjs':'fbe774b576f3661c8b5db56d5be46a71a4929e4816827bc9fdad49e98695a0ba',
'serialize.mjs':'5867e828fedf730c79b62d218af8ca8da3c3827f28e9b109cb142c3d04a55905',
'validate.mjs':'bbdc8c822079691649c7cf5a7bfb364b2ab82ea85e3d8ce34827be1e6170e7ad',
};
assert.equal(hash(fs.readFileSync(new URL('../../fixtures/c113-r1.tar.gz',import.meta.url))),'909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622');
const c113={};
for (const [name,pin] of Object.entries(pins)) {
 const url=new URL('../../fixtures/c113-r1/scripts/scheduler-performance/persistence/'+name,import.meta.url);
 assert.equal(hash(fs.readFileSync(url)),pin); Object.assign(c113,await import(url));
}
const root=process.env.SCHEDULER_POSTGRES_ROOT,bin=process.env.SCHEDULER_POSTGRES_BIN;assert.match(root||'',/^\/tmp\/sage-scheduler-pg\.[A-Za-z0-9]+$/);assert.equal(fs.readFileSync(root+'/runner-marker','utf8'),root);
const env={PATH:process.env.PATH,HOME:root+'/home',LANG:'C'},run=promisify(execFile),args=role=>['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',root+'/socket','-p','5432','-U',role,'-d','scheduler_fixture'];
const lit=x=>x===null?'NULL':`E'${String(x).replaceAll('\\','\\\\').replaceAll("'","''")}'`,json=x=>lit(JSON.stringify(x))+'::jsonb';
async function sql(s,role='scheduler_fixture',app='draft-proof'){return (await run(bin+'/psql',[...args(role),'-c',s],{env:{...env,PGAPPNAME:app},timeout:20000,maxBuffer:16000000})).stdout.trim();}
assert.equal(await sql('SHOW data_directory'),root+'/data');assert.equal(await sql('SHOW listen_addresses'),'');
const pgTransport=createSchedulerPgTransport({pool:new Pool({host:root+'/socket',port:5432,user:'scheduler_runtime',database:'scheduler_fixture',password:'',ssl:false,max:1,connectionTimeoutMillis:3000,query_timeout:6000})});after(()=>pgTransport.close());
const names={scheduler_snapshot:['p_authority','p_key'],scheduler_commit:['p_authority','p_expected','p_plan','p_receipt']};
const statement=(n,a)=>{assert.ok(names[n]);return `SELECT scheduler_gateway.${n}(${names[n].map(k=>typeof a[k]==='object'&&a[k]!==null?json(a[k]):lit(a[k]??null)).join(',')})`;};
let serial=0;const actor='00000000-0000-4000-8000-000000000001';
async function setup({enabled=true,storeId}={}){const scope={storeId:storeId||'draft-stage-'+(++serial),month:'2026-10'};
 await sql(`UPDATE public.profiles SET role='admin',stores='{}',active=true,pending=false WHERE id=${lit(actor)}::uuid; DELETE FROM scheduler_policy.pilot_scope; INSERT INTO scheduler_policy.pilot_scope(actor_id,approved_store_ids,enabled) VALUES(${lit(actor)}::uuid,ARRAY[${lit(scope.storeId)}],${enabled}); INSERT INTO scheduler_policy.draft_grants VALUES(${lit(actor)}::uuid,${lit(scope.storeId)},'draft-read',${enabled}),(${lit(actor)}::uuid,${lit(scope.storeId)},'draft-save',${enabled})`);
 const draft={...scope,store:{timezone:'America/New_York',people:[{id:'p',name:'Synthetic',start:9,end:17,off:[],maxHours:40}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[],holidays:{}}],teams:[],memberships:[]},overrides:{}};
 const identityDb={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:actor,role:'admin',stores:[],active:true,pending:false},error:null})})})})};
 const events=[];let intercept=false,dropReply=false;const transport={capabilities:{'scheduler-postgres-save-read/1':true},async rpc(n,a){events.push({n,a:structuredClone(a)});if(intercept&&n==='scheduler_commit')throw new Error('capture only');const reply=await pgTransport.rpc(n,a);if(dropReply&&n==='scheduler_commit'&&!reply.error){dropReply=false;return {data:null,error:{code:'LOST_REPLY',message:'synthetic lost reply'}};}return reply;}};
 const handler=createDraftOnlyScheduler({identityDb,draftPermissionFor:createDraftPermissionFor(pgTransport),c113,transport,now:()=> '2026-10-19T18:00:00.000Z'});
 const request={op:'save',...scope,requestId:'draft-save',input:{baseRev:0,draft}};
 const execute=async body=>{const res={setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};await handler({method:'POST',headers:{authorization:'Bearer synthetic'},body},res);return res;};
 return {scope,request,events,execute,loseNextReply(){dropReply=true;},async raw(){intercept=true;await execute(request);intercept=false;const raw=events.findLast(e=>e.n==='scheduler_commit')?.a;assert.ok(raw);return raw;}};
}
async function state(scope){return JSON.parse(await sql(`SELECT jsonb_build_object(${['heads','versions','audit','receipts'].map(t=>`${lit(t)},COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM scheduler_private.${t} x WHERE store_id=${lit(scope.storeId)}),'[]'::jsonb)`).join(',')})`));}
const real=(n,f)=>test('MATCHING SCHEMA SQL: '+n,{concurrency:false,timeout:90000},f);
const forbidden=e=>/ERROR:\s+P0001: scheduler:forbidden\n/.test(e.stderr),denied=e=>/ERROR:\s+42501:/.test(e.stderr);
real('fresh migration has no pilot/grants, runtime NO privilege escalation and admin empty stores requires explicit grants',async()=>{
 assert.equal(await sql('SELECT count(*) FROM scheduler_policy.pilot_scope'),'0');assert.equal(await sql('SELECT count(*) FROM scheduler_policy.draft_grants'),'0');await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,'pilot-a','draft-save')`,'scheduler_runtime'),forbidden);
 const x=await setup({enabled:false});assert.equal((await x.execute(x.request)).code,403);
 assert.equal(await sql("SELECT rolsuper OR rolbypassrls OR pg_has_role('scheduler_runtime','scheduler_executor','MEMBER') FROM pg_roles WHERE rolname='scheduler_runtime'"),'f');assert.equal(await sql("SELECT rolsuper OR rolbypassrls OR rolcanlogin FROM pg_roles WHERE rolname='scheduler_executor'"),'f');await assert.rejects(sql('SET ROLE scheduler_executor','scheduler_runtime'),denied);
});
real('proposed configuration restricts the selected store without profile membership and provisions only disabled scope/grants',async()=>{
 await sql(`DELETE FROM scheduler_policy.pilot_scope;UPDATE public.profiles SET role='admin',stores='{}',active=true,pending=false WHERE id=${lit(actor)}::uuid`);
 async function configure(stores){return run(bin+'/psql',[...args('scheduler_fixture'),'-v','pilot_actor_id='+actor,'-v','pilot_store_ids_json='+JSON.stringify(stores),'-f',new URL('../../supabase/pending/scheduler-pilot-disabled.sql',import.meta.url).pathname],{env,timeout:20000});}
 for(const stores of [['outside'],[],[null],['driver-s-mart-winter-park','outside']]){await assert.rejects(configure(stores));assert.equal(await sql('SELECT count(*) FROM scheduler_policy.pilot_scope'),'0');}
 await configure(['driver-s-mart-winter-park']);assert.equal(await sql(`SELECT stores::text FROM public.profiles WHERE id=${lit(actor)}::uuid`),'{}');assert.equal(await sql('SELECT enabled FROM scheduler_policy.pilot_scope'),'f');assert.equal(await sql('SELECT bool_or(enabled) FROM scheduler_policy.draft_grants'),'f');await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,'driver-s-mart-winter-park','draft-read')`,'scheduler_runtime'),forbidden);
});
real('only intended runtime executes verified HTTP save/read/replay; all JWT roles denied raw gateways',async()=>{
 const x=await setup({storeId:'driver-s-mart-winter-park'});assert.equal((await x.execute(x.request)).code,200);assert.equal((await x.execute({op:'read',...x.scope,input:{kind:'draft'}})).body.result.kind,'draft');assert.equal((await x.execute(x.request)).body.replayed,true);assert.equal(await sql(`SELECT stores::text FROM public.profiles WHERE id=${lit(actor)}::uuid`),'{}');const raw=x.events.find(e=>e.n==='scheduler_commit').a;
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await sql('SELECT session_user',role),role);
  for(const cmd of [statement('scheduler_commit',raw),statement('scheduler_snapshot',{p_authority:{actorId:actor,...x.scope,action:'read',readKind:'draft'},p_key:null}),`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,${lit(x.scope.storeId)},'draft-save')`,`SELECT * FROM scheduler_private.versions`,`SELECT * FROM scheduler_policy.draft_grants`])await assert.rejects(sql(`SET request.jwt.claim.sub=${lit(actor)};${cmd}`,role),denied);
 }
 await assert.rejects(sql(`SELECT scheduler_gateway.draft_inner_commit(${json(raw.p_authority)},${json(raw.p_expected)},${json(raw.p_plan)},${json(raw.p_receipt)})`,'scheduler_runtime'),denied);
 assert.equal(await sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='scheduler_gateway' AND (p.proname LIKE '%publish%' OR p.proname LIKE '%capture%')"),'0');
});
real('exact action, profile, approved store and explicit grant are all required',async()=>{
 const x=await setup(),raw=await x.raw(),before=await state(x.scope);
 for(const command of [`UPDATE public.profiles SET pending=true WHERE id=${lit(actor)}::uuid`,`UPDATE public.profiles SET active=false WHERE id=${lit(actor)}::uuid`,`UPDATE public.profiles SET role='overseer' WHERE id=${lit(actor)}::uuid`,`UPDATE scheduler_policy.pilot_scope SET enabled=false`,`UPDATE scheduler_policy.pilot_scope SET approved_store_ids=ARRAY['outside']`,`UPDATE scheduler_policy.draft_grants SET enabled=false WHERE permission='draft-save'`]){
  await sql(command);await assert.rejects(sql(statement('scheduler_commit',raw),'scheduler_runtime'),forbidden);assert.deepEqual(await state(x.scope),before);
  await sql(`UPDATE public.profiles SET active=true,pending=false,role='admin',stores='{}' WHERE id=${lit(actor)}::uuid; UPDATE scheduler_policy.pilot_scope SET enabled=true,approved_store_ids=ARRAY[${lit(x.scope.storeId)}];UPDATE scheduler_policy.draft_grants SET enabled=true`);
 }
 await sql(`UPDATE scheduler_policy.draft_grants SET enabled=false WHERE permission='draft-read'`);await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,${lit(x.scope.storeId)},'draft-read')`,'scheduler_runtime'),forbidden);assert.equal(await sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,${lit(x.scope.storeId)},'draft-save')`,'scheduler_runtime'),'t');
 await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,${lit(x.scope.storeId)},'publish')`,'scheduler_runtime'),forbidden);
});
real('self-insert cannot obtain pilot grants; restrictive policy blocks executor updates despite permissive PUBLIC policy',async()=>{
 const x=await setup(),other='00000000-0000-4000-8000-000000000002';
 await sql(`SET request.jwt.claim.sub=${lit(other)};INSERT INTO public.profiles(id,role,stores,active,pending) VALUES(${lit(other)}::uuid,'admin',ARRAY[${lit(x.scope.storeId)}],true,false)`,'authenticated');
 await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(other)}::uuid,${lit(x.scope.storeId)},'draft-save')`,'scheduler_runtime'),forbidden);
 await assert.rejects(sql(`INSERT INTO scheduler_policy.pilot_scope(actor_id,approved_store_ids,enabled) VALUES(${lit(other)}::uuid,ARRAY[${lit(x.scope.storeId)}],true)`,'authenticated'),denied);
 await sql('CREATE POLICY synthetic_public_update ON public.profiles FOR UPDATE TO PUBLIC USING(true) WITH CHECK(true)');
 try{assert.equal(await sql(`BEGIN;SET ROLE scheduler_executor;SELECT id FROM public.profiles WHERE id=${lit(actor)}::uuid FOR SHARE;ROLLBACK`),actor);await assert.rejects(sql(`SET ROLE scheduler_executor;UPDATE public.profiles SET id=id WHERE id=${lit(actor)}::uuid`),e=>denied(e)&&/row-level security/.test(e.stderr));assert.equal((await x.execute(x.request)).code,200);}finally{await sql('DROP POLICY synthetic_public_update ON public.profiles');}
});
async function until(check){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,15));}throw new Error('barrier timeout');}
async function hold(command,app){const child=spawn(bin+'/psql',args('scheduler_fixture'),{env:{...env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});let err='';child.stdout.resume();child.stderr.on('data',b=>err+=b);const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',c=>c===0?resolve():reject(Error(err)));});child.stdin.write(`BEGIN;${command};\n`);let released=false;const release=async()=>{if(!released){released=true;child.stdin.end('COMMIT;\n\\q\n');}await ended;};await until(async()=>await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${lit(app)} AND state='idle in transaction')`)==='t');return {release};}
const blocked=app=>until(async()=>await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${lit(app)} AND cardinality(pg_blocking_pids(pid))>0)`)==='t');
const observe=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
for(const kind of ['profile','scope','grant'])for(const first of ['revoke','save'])for(const replay of [false,true])real(`${kind} revocation ${first} first, ${replay?'historic replay':'new save'}`,async()=>{
 const x=await setup(),raw=await x.raw();if(replay)assert.equal((await x.execute(x.request)).code,200);const before=await state(x.scope),app='draft-write-'+(++serial),revApp='draft-revoke-'+(++serial),update=kind==='profile'?`UPDATE public.profiles SET active=false WHERE id=${lit(actor)}::uuid`:kind==='scope'?`UPDATE scheduler_policy.pilot_scope SET enabled=false WHERE actor_id=${lit(actor)}::uuid`:`UPDATE scheduler_policy.draft_grants SET enabled=false WHERE actor_id=${lit(actor)}::uuid AND store_id=${lit(x.scope.storeId)} AND permission='draft-save'`;let lock,write,revoke;
 try{if(first==='revoke'){lock=await hold(update,revApp);write=observe(sql(statement('scheduler_commit',raw),'scheduler_runtime',app));await blocked(app);await lock.release();const r=await write;assert.equal(r.ok,false);assert.match(r.error.stderr,/P0001: scheduler:forbidden/);assert.deepEqual(await state(x.scope),before);}else{lock=await hold(`SELECT pg_advisory_xact_lock(hashtextextended(${lit('sage-scheduler:'+x.scope.storeId)},0))`,'draft-controller-'+(++serial));write=observe(sql(statement('scheduler_commit',raw),'scheduler_runtime',app));await blocked(app);revoke=observe(sql(update,'scheduler_fixture',revApp));await blocked(revApp);await lock.release();const r=await write;assert.equal(r.ok,true);assert.equal(JSON.parse(r.value).replayed,replay);assert.equal((await revoke).ok,true);await assert.rejects(sql(statement('scheduler_commit',raw),'scheduler_runtime'),e=>/P0001: scheduler:forbidden/.test(e.stderr));assert.equal((await state(x.scope)).versions.length,1);}}finally{if(lock)await lock.release();await Promise.allSettled([write,revoke]);}
});
for(const [table,operation] of [['versions','INSERT'],['audit','INSERT'],['heads','INSERT'],['heads','UPDATE'],['receipts','INSERT']])real(`AFTER ${table} failure rolls back all scheduler writes, retry succeeds`,async()=>{
 const x=await setup();if(operation==='UPDATE'){assert.equal((await x.execute(x.request)).code,200);x.request.requestId='update';x.request.input.baseRev=1;}const raw=await x.raw(),before=await state(x.scope),name='matching_fault_'+(++serial);await sql(`CREATE FUNCTION scheduler_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.store_id=${lit(x.scope.storeId)} THEN RAISE EXCEPTION 'synthetic-matching-write-fault';END IF;RETURN NEW;END $$;CREATE TRIGGER ${name} AFTER ${operation} ON scheduler_private.${table} FOR EACH ROW EXECUTE FUNCTION scheduler_private.${name}()`);
 try{await assert.rejects(sql(statement('scheduler_commit',raw),'scheduler_runtime'),e=>/P0001: synthetic-matching-write-fault/.test(e.stderr));assert.deepEqual(await state(x.scope),before);}finally{await sql(`DROP TRIGGER ${name} ON scheduler_private.${table};DROP FUNCTION scheduler_private.${name}()`);}assert.equal((await x.execute(x.request)).code,200);
});
real('profile deletion revokes pilot via cascade and recreation cannot resurrect grants',async()=>{
 const x=await setup();assert.equal((await x.execute(x.request)).code,200);const before=await state(x.scope);for(const t of ['versions','audit','receipts'])assert.equal(before[t].length,1);await sql(`DELETE FROM public.profiles WHERE id=${lit(actor)}::uuid`);assert.equal(await sql('SELECT count(*) FROM scheduler_policy.pilot_scope'),'0');assert.equal(await sql('SELECT count(*) FROM scheduler_policy.draft_grants'),'0');
 await sql(`SET request.jwt.claim.sub=${lit(actor)};INSERT INTO public.profiles(id,role,stores,active,pending) VALUES(${lit(actor)}::uuid,'admin',ARRAY[${lit(x.scope.storeId)}],true,false)`,'authenticated');await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,${lit(x.scope.storeId)},'draft-save')`,'scheduler_runtime'),forbidden);assert.deepEqual(await state(x.scope),before);
});

real('explicit draft policy leaves general membership policy intact and denies other stores and missing grants',async()=>{
 const x=await setup(),profile={id:actor,role:'admin',stores:[],active:true,pending:false};
 await assert.rejects(resolveSchedulerAuthority({actor:{id:actor},request:x.request,profile,grantFor:async()=>true}),e=>e.code==='forbidden');
 for(const op of [{op:'publish',...x.scope},{op:'read',...x.scope,input:{kind:'published'}}])await assert.rejects(resolveSchedulerAuthority({actor:{id:actor},request:op,profile,grantFor:async()=>true,storeScope:'explicit-draft-pilot'}),e=>e.code==='forbidden');
 assert.equal((await x.execute({...x.request,storeId:'outside',input:{...x.request.input,draft:{...x.request.input.draft,storeId:'outside'}}})).code,403);
 await assert.rejects(sql(`SELECT scheduler_gateway.draft_permission(${lit(actor)}::uuid,'outside','draft-read')`,'scheduler_runtime'),forbidden);
 await sql('DELETE FROM scheduler_policy.draft_grants');assert.equal((await x.execute(x.request)).code,403);
 assert.equal(await sql(`SELECT stores::text FROM public.profiles WHERE id=${lit(actor)}::uuid`),'{}');
});

real('pg transport lost commit acknowledgement requires explicit exact replay without duplicate writes',async()=>{
 const x=await setup();x.loseNextReply();assert.equal((await x.execute(x.request)).code,503);const before=await state(x.scope);assert.equal(before.versions.length,1);assert.equal(before.receipts.length,1);assert.equal((await x.execute(x.request)).body.replayed,true);assert.deepEqual(await state(x.scope),before);
 const changed=structuredClone(x.request);changed.input.draft.store.people[0].name='Changed';assert.equal((await x.execute(changed)).code,409);
});
real('pg transport lock timeout rolls back and explicit retry succeeds',async()=>{
 const x=await setup(),raw=await x.raw(),before=await state(x.scope),lock=await hold(`SELECT pg_advisory_xact_lock(hashtextextended(${lit('sage-scheduler:'+x.scope.storeId)},0))`,'transport-lock');
 try{const reply=await pgTransport.rpc('scheduler_commit',raw);assert.equal(reply.error.code,'SCHEDULER_STORAGE_UNAVAILABLE');assert.deepEqual(await state(x.scope),before);}finally{await lock.release();}
 assert.equal((await x.execute(x.request)).code,200);
});
