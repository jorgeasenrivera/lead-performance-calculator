// Explicit local invocation only; approved fake data and verified PG17 binaries.
import {Pool} from 'pg';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createBrowserFixture,ids,scope,fixtureSession} from './browser-fixture.mjs';
import {createSchedulerPgTransport} from '../../api/_scheduler-pg-transport.mjs';
import {createRestrictedManualCapabilities} from './restricted-capabilities.mjs';
import {prepareManualServerAdapter} from './server-adapter.mjs';
import {addManualShift} from '../../src/scheduler-manual-model.mjs';
const run=promisify(execFile),bin='/workspace/.local/postgresql/root/usr/lib/postgresql/17/bin';
const root=await mkdtemp('/tmp/sage-manual-'),env={PATH:'/usr/bin:/bin',LANG:'C',HOME:root+'/home'};
await mkdir(root+'/home');await mkdir(root+'/socket',{mode:0o700});
let started=false,fixture,owner,runtime,transport;const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
try{
 await run(bin+'/initdb',['-D',root+'/data','-U','delivery_fixture','--auth-local=trust','--auth-host=reject','--no-instructions'],{env});
 await writeFile(root+'/data/postgresql.conf',`listen_addresses=''\nunix_socket_directories='${root}/socket'\nunix_socket_permissions=0700\n`);
 started=true;await run(bin+'/pg_ctl',['-D',root+'/data','-l',root+'/postgres.log','-w','-t','15','start'],{env});
 fixture=await createBrowserFixture({socket:root+'/socket',dataDirectory:root+'/data',expectedVersion:170011});await fixture.close();fixture=null;
 const options={host:root+'/socket',port:5432,database:'postgres',user:'delivery_fixture',password:'fake-unused',ssl:false,max:5};
 owner=new Pool(options);const q=(t,v)=>owner.query(t,v);
 await q(await readFile(new URL('./capture-executor.sql',import.meta.url),'utf8'));
 await q('ALTER ROLE scheduler_runtime LOGIN');
 runtime=new Pool({...options,user:'scheduler_runtime',application_name:'restricted-runtime-test'});
 const caps=createRestrictedManualCapabilities({pool:runtime});transport=createSchedulerPgTransport({pool:runtime,publicationV2:true});
 const tokens=new Map(Object.keys(ids).map(k=>[fixtureSession(k).access_token,ids[k]]));
 const handler=prepareManualServerAdapter({enabled:true,...caps,transport,now:()=> '2026-10-22T17:30:00Z',createRequestClient:async token=>({
  auth:{getUser:async supplied=>({data:{user:supplied===token&&tokens.has(token)?{id:tokens.get(token)}:null},error:null})},
  from:()=>({select:()=>({eq:(_k,id)=>({maybeSingle:async()=>({data:(await q('SELECT id,role,stores,active,pending FROM public.profiles WHERE id=$1',[id])).rows[0]||null,error:null})})})})
 })});
 const request=async(action,extra={},kind='manager')=>{const r={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization:'Bearer '+fixtureSession(kind).access_token},body:{action,...scope,...extra}},r);return r;};
 const asRuntime=(text,values)=>runtime.query(text,values);
 const forbidden=e=>e.code==='P0001'&&e.message==='scheduler:forbidden';
 const port=caps.capturePortFor({actorId:ids.manager,...scope});let reviewed;
 await check('non-owner runtime and capture definer have no elevated role or table ownership',async()=>{
  const rows=(await q("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN ('scheduler_runtime','scheduler_capture_executor') ORDER BY rolname")).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.rolsuper&&!r.rolbypassrls));assert.equal(rows[0].rolcanlogin,false);
  assert.equal((await q("SELECT count(*)::int n FROM pg_class WHERE relowner='scheduler_capture_executor'::regrole")).rows[0].n,0);
  assert.equal((await asRuntime('SELECT current_user,session_user')).rows[0].session_user,'scheduler_runtime');
 });
 await check('runtime direct tables, private capture, policy writes and executor SET ROLE denied',async()=>{
  for(const sql of ['SELECT * FROM scheduler_policy.publication_grants_v2','SELECT * FROM scheduler_private.publication_contexts_v2',"SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')","SELECT scheduler_private.put_manual_policy_v1('pilot-a',null,'{}','fake')",'SET ROLE scheduler_capture_executor'])await assert.rejects(asRuntime(sql),e=>e.code==='42501');
 });
 await check('current active/approved/role/store/grant/scope policy checks',async()=>{
  assert.equal(await caps.publishPermissionFor({actorId:ids.manager,storeId:'pilot-a'}),true);
  for(const kind of ['employee','pending'])assert.equal(await caps.publishPermissionFor({actorId:ids[kind],storeId:'pilot-a'}),false);
  await q("INSERT INTO scheduler_policy.publication_scope_v2 VALUES('other-store',true)");
  assert.equal(await caps.publishPermissionFor({actorId:ids.manager,storeId:'other-store'}),false);
  await assert.rejects(caps.capturePortFor({actorId:ids.manager,storeId:'other-store',month:scope.month}).snapshot({storeId:'other-store',month:scope.month}),e=>e.code==='forbidden');
  for(const [col,value,restore] of [['pending','true','false'],['active','false','true'],['role',"'overseer'","'manager'"],['stores',"ARRAY['other-store']","ARRAY['pilot-a']"]]){
   await q(`UPDATE public.profiles SET ${col}=${value} WHERE id=$1`,[ids.manager]);assert.equal(await caps.publishPermissionFor({actorId:ids.manager,storeId:'pilot-a'}),false);await assert.rejects(port.snapshot(scope),e=>e.code==='forbidden');await q(`UPDATE public.profiles SET ${col}=${restore} WHERE id=$1`,[ids.manager]);
  }
 });
 await check('actual disabled-adapter factory with restricted capture saves/reviews/publishes own immutable content',async()=>{
  const loaded=await request('load');assert.equal(loaded.code,200,JSON.stringify(loaded.body));
  const draft=addManualShift(loaded.body.result.schedule,{day:'2026-10-05',personId:'a',start:'09:00',end:'16:00',role:'sales',replaceAbsence:true});
  assert.equal((await request('save',{draft,baseRev:loaded.body.result.revision,requestId:'restricted-save'})).code,200);
  assert.equal((await request('own',{},'employee')).body.revision,0);
  reviewed=await request('review',{requestId:'restricted-review'});assert.equal(reviewed.code,200,JSON.stringify(reviewed.body));
  const pub=await request('publish',{contextId:reviewed.body.contextId,requestId:'restricted-publish'});assert.equal(pub.code,200,JSON.stringify(pub.body));
  const own=await request('own',{},'employee');assert.equal(own.code,200);assert.equal(own.body.revision,pub.body.result.head.publishedRev);assert.deepEqual(own.body.days.find(x=>x.date==='2026-10-05').intervals,[[540,960]]);
  assert.equal((await request('own',{},'pending')).code,403);
 });
 await check('context retrieval bound to actor and scope, revoked permission denies',async()=>{
  assert.ok((await port.context(reviewed.body.contextId)).contextText);
  await assert.rejects(caps.capturePortFor({actorId:ids.manager,storeId:'pilot-a',month:'2026-11'}).context(reviewed.body.contextId),e=>e.code==='forbidden');
  await q('UPDATE scheduler_policy.publication_grants_v2 SET enabled=false WHERE actor_id=$1',[ids.manager]);
  await assert.rejects(port.context(reviewed.body.contextId),e=>e.code==='forbidden');await assert.rejects(port.snapshot(scope),e=>e.code==='forbidden');
  await q('UPDATE scheduler_policy.publication_grants_v2 SET enabled=true WHERE actor_id=$1',[ids.manager]);
 });
 await check('malformed/null context refuses with no context or source-pointer mutation',async()=>{
  const before=(await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n;
  const snap=await port.snapshot(scope);for(const text of [null,'null','{}'])await assert.rejects(asRuntime('SELECT scheduler_gateway.register_capture_v2($1,$2,$3)',[ids.manager,JSON.stringify(snap),text]));
  assert.equal((await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n,before);
 });
 await check('concurrent grant revocation locks then causes subsequent capture denial',async()=>{
  const revoker=await owner.connect();try{
   await revoker.query('BEGIN');await revoker.query('UPDATE scheduler_policy.publication_grants_v2 SET enabled=false WHERE actor_id=$1',[ids.manager]);
   const p=port.snapshot(scope);const outcome=p.then(()=>null,e=>e);let blocked=false;
   for(let i=0;i<50;i++){blocked=(await q("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='restricted-runtime-test' AND cardinality(pg_blocking_pids(pid))>0) AS yes")).rows[0].yes;if(blocked)break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(blocked,true,'must observe actual lock wait');await revoker.query('COMMIT');assert.equal((await outcome)?.code,'forbidden');
  }finally{revoker.release(true);}
  await q('UPDATE scheduler_policy.publication_grants_v2 SET enabled=true WHERE actor_id=$1',[ids.manager]);
 });

 await check('cross-actor context denied even with an independent enabled manager grant',async()=>{
  await q("UPDATE public.profiles SET role='manager',stores=ARRAY['pilot-a'] WHERE id=$1",[ids.employee]);
  await q("INSERT INTO scheduler_policy.publication_grants_v2 VALUES($1,'pilot-a',true)",[ids.employee]);
  assert.equal(await caps.publishPermissionFor({actorId:ids.employee,storeId:'pilot-a'}),true);
  await assert.rejects(caps.capturePortFor({actorId:ids.employee,...scope}).context(reviewed.body.contextId),e=>e.code==='forbidden');
  await q('DELETE FROM scheduler_policy.publication_grants_v2 WHERE actor_id=$1',[ids.employee]);await q("UPDATE public.profiles SET role='overseer',stores=ARRAY[]::text[] WHERE id=$1",[ids.employee]);
 });
 await check('forged registration fields and stale source CAS refuse without mutation',async()=>{
  const r=await request('review',{requestId:'cas-review'});assert.equal(r.code,200,JSON.stringify(r.body));
  const text=(await port.context(r.body.contextId)).contextText,snap=await port.snapshot(scope);
  const before=(await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n;
  for(const mutate of [c=>{c.plan.auditEntry.actor.id=ids.employee;},c=>{c.scope.storeId='other-store';},c=>{c.expected.head.draftRev++;},c=>{c.inputDigest='0'.repeat(64);},c=>{c.sourceEpoch++;}]){
   const forged=JSON.parse(text);mutate(forged);
   await assert.rejects(asRuntime('SELECT scheduler_gateway.register_capture_v2($1,$2,$3)',[ids.manager,JSON.stringify(snap),JSON.stringify(forged)]),e=>e.code==='P0001'&&e.message==='scheduler:invalid');
  }
  assert.equal((await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n,before);

  await q("UPDATE public.app_data SET value=value||'{\"syntheticRevision\":1}'::jsonb WHERE key='lpc:store:pilot-a:v2'");
  await assert.rejects(port.register(snap,text),e=>e.code==='conflict');
  assert.equal((await q("SELECT count(*)::int n FROM scheduler_private.publication_source_heads_v2 WHERE store_id='pilot-a'")).rows[0].n,0);
 });
 await check('failure after context insertion rolls back context and source pointer atomically',async()=>{
  const before=(await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n;
  await q("CREATE FUNCTION public.synthetic_capture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure';END $$;CREATE TRIGGER synthetic_capture_failure BEFORE INSERT OR UPDATE ON scheduler_private.publication_source_heads_v2 FOR EACH ROW EXECUTE FUNCTION public.synthetic_capture_failure()");
  try{assert.equal((await request('review',{requestId:'rollback-review'})).code,503);assert.equal((await q('SELECT count(*)::int n FROM scheduler_private.publication_contexts_v2')).rows[0].n,before);assert.equal((await q("SELECT count(*)::int n FROM scheduler_private.publication_source_heads_v2 WHERE store_id='pilot-a'")).rows[0].n,0);}
  finally{await q('DROP TRIGGER synthetic_capture_failure ON scheduler_private.publication_source_heads_v2;DROP FUNCTION public.synthetic_capture_failure()');}
 });
 console.log(JSON.stringify({checks:results,postgres:170011,syntheticIdentity:true}));
}finally{
 const cleanup=[];
 for(const close of [()=>fixture?.close(),()=>transport?transport.close():runtime?.end(),()=>owner?.end()]){
  try{await close();}catch{cleanup.push('pool-close-failed');}
 }
 let stopped=!started;
 if(started){
  try{await run(bin+'/pg_ctl',['-D',root+'/data','-w','-m','fast','stop'],{env});}catch{cleanup.push('cluster-stop-command-failed');}
  try{stopped=await run(bin+'/pg_ctl',['-D',root+'/data','status'],{env}).then(()=>false,e=>e.code===3);}catch{stopped=false;}
 }
 if(stopped){await rm(root,{recursive:true});console.log('CLEANUP stopped and removed '+root);}else cleanup.push('cluster-stop-unverified-data-preserved');
 if(cleanup.length)throw Error(cleanup.join(','));
}
