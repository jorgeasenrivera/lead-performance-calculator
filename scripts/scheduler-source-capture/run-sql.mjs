import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localStore } from '../scheduler-delivery-local/local-store.mjs';
import {createSourceCapture,assembleSource} from './adapter.mjs';
import { createPublicationV2 } from '../../api/_scheduler-publication-v2.mjs';
import { originalC113 as c113 } from '../../api/_scheduler-c113.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review.mjs';
import { INPUT_BINDING_VERSION,CONTEXT_CAPABILITY } from '../../api/_scheduler-contract.mjs';
const run=promisify(execFile),bin='/workspace/.local/postgresql/root/usr/lib/postgresql/17/bin';
const root=await mkdtemp('/tmp/sage-delivery-'),env={PATH:'/usr/bin:/bin',LANG:'C',HOME:root+'/home'};
await mkdir(root+'/home');await mkdir(root+'/socket',{mode:0o700});
const identicalMode=false;
const results={mode:identicalMode?'identical':'distinct',checks:[],cleanup:null};let started=false;
const hash=x=>createHash('sha256').update(x).digest('hex');
const lit=x=>`convert_from(decode('${Buffer.from(String(x)).toString('hex')}','hex'),'UTF8')`;
const json=x=>lit(JSON.stringify(x))+'::jsonb';
const manager='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002';
const scope={storeId:'pilot-a',month:'2026-10'},actor={id:manager},at='2026-10-22T17:30:00Z';
const auth=action=>({actorId:manager,action,...scope,readKind:null});
const person=id=>({id,name:'Synthetic '+id,start:9,end:17,off:[],maxHours:40});
const closed={open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{}};
const draft={...scope,store:{timezone:'America/New_York',people:[person('a'),person('b')],
 rules:[{...closed,effective:'2014-01-01'},{...closed,effective:'2026-10-05',closedDays:[]},{...closed,effective:'2026-10-06',closedDays:[],open:9.01,close:16.99},{...closed,effective:'2026-10-07',closedDays:[]},{...closed,effective:'2026-10-08'}],teams:[],
 memberships:['a','b'].map(personId=>({storeId:scope.storeId,personId,teamIds:[],from:'2014-01-01',to:'2100-12-31',unknown:false}))},
 overrides:{'2026-10-05':{on:['a','b'],off:[],shifts:['a','b'].map(personId=>({storeId:scope.storeId,personId,date:'2026-10-05',endDate:'2026-10-05',startMinute:540,endMinute:1020,timezone:'America/New_York'}))},
 '2026-10-06':{on:['a','b'],off:[]},
 '2026-10-07':{on:['b'],off:['a'],absences:{a:{kind:'vacation'}}}}};
const check=async(name,fn)=>{await fn();results.checks.push({name,passed:true});console.log('PASS '+name);};
try{
 await run(bin+'/initdb',['-D',root+'/data','-U','delivery_fixture','--auth-local=trust','--auth-host=reject','--no-instructions'],{env});
 await writeFile(root+'/data/postgresql.conf',`listen_addresses=''\nunix_socket_directories='${root}/socket'\nunix_socket_permissions=0700\nfsync=on\nsynchronous_commit=on\n`);
 started=true;await run(bin+'/pg_ctl',['-D',root+'/data','-l',root+'/postgres.log','-w','-t','15','start'],{env});
 const {sql}=localStore({bin,root});assert.equal(await sql('SHOW listen_addresses'),'');assert.equal(await sql('SHOW data_directory'),root+'/data');
 await sql(await readFile(new URL('../../test/matching-profile-fixture.sql',import.meta.url),'utf8'));
 await sql(`CREATE TABLE public.floor_people(id text PRIMARY KEY,user_id uuid REFERENCES public.profiles(id),store text,person_id text,UNIQUE(store,user_id),UNIQUE(store,person_id));ALTER TABLE public.floor_people ENABLE ROW LEVEL SECURITY;`);
 await sql(await readFile(new URL('../../supabase/reference/scheduler-draft-structure.sql',import.meta.url),'utf8'));
 await sql(await readFile(new URL('../scheduler-delivery-relational/publication-v2.sql',import.meta.url),'utf8'));
 const rpc=q=>sql("SET application_name='synthetic-rpc'; SET ROLE scheduler_runtime; "+q);
 const waitFor=async(query,count)=>{const deadline=Date.now()+2500;while(Date.now()<deadline){if(await sql(query)===String(count))return;}assert.fail('required lock barrier not observed');};
 const own=(id=employee,store='pilot-a')=>rpc(`SELECT scheduler_gateway.own_published_v2(${lit(id)}::uuid,${lit(store)},'2026-10')`);
 await check('v2 installs empty disabled scope and no public execution',async()=>{assert.equal(await sql('SELECT count(*) FROM scheduler_policy.publication_scope_v2'),'0');for(const role of ['anon','authenticated','service_role'])assert.equal(await sql(`SELECT has_function_privilege('${role}','scheduler_gateway.own_published_v2(uuid,text,text)','EXECUTE')`),'f');});
 await sql(`INSERT INTO public.profiles(id,role,stores,active,pending) VALUES('${employee}','overseer','{}',true,false);
 INSERT INTO public.floor_people VALUES('fictional-link','${employee}','pilot-a','a');
 INSERT INTO scheduler_policy.publication_scope_v2 VALUES('pilot-a',false);
 INSERT INTO scheduler_policy.publication_grants_v2 VALUES('${manager}','pilot-a',false);`);
 await assert.rejects(own(),/scheduler:forbidden/);
 await sql(`UPDATE scheduler_policy.publication_scope_v2 SET enabled=true;INSERT INTO scheduler_policy.pilot_scope(actor_id,approved_store_ids,enabled) VALUES('${manager}',ARRAY['pilot-a'],true);INSERT INTO scheduler_policy.draft_grants VALUES('${manager}','pilot-a','draft-save',true),('${manager}','pilot-a','draft-read',true);`);
 const saved=c113.planDraftSave({...scope,draft,baseRev:0,head:null,actor,at,prevAuditHash:null});assert.equal(saved.ok,true,JSON.stringify(saved));
 const draftReceipt={key:JSON.stringify([manager,'pilot-a','2026-10','save']),fingerprint:hash('save'),result:{head:saved.plan.resultingHead}};
 await check('existing v1 draft RPC still saves and employee sees no draft',async()=>{await rpc(`SELECT scheduler_gateway.scheduler_commit(${json(auth('save'))},${json({head:null,prevAuditHash:null,auditRevision:0})},${json(saved.plan)},${json(draftReceipt)})`);assert.equal(JSON.parse(await own()).revision,0);});
 const span=review.reviewSpan(scope.month),enrich={...structuredClone(draft.store),id:'pilot-a',history:[]};
 const input={definition:'month-review/1',scope,baseStore:enrich,teamState:{teams:[],memberships:draft.store.memberships},months:{'2026-10':{store:enrich,overrides:draft.overrides}},base:Object.fromEntries(span.days.map(day=>[day,day==='2026-10-06'?{on:['a','b'],off:[]}:null]))};
 const reviewed=review.reviewMonth(input,{sha256:hash});assert.equal(reviewed.openIssues,0,JSON.stringify(reviewed.rows.filter(r=>r.issues.length)));
 const snapshot={scope,head:{draftRev:1,publishedRev:0},draftText:saved.plan.ops[0].text,publishedText:null,prevAuditHash:saved.plan.auditEntry.hash,auditRevision:1,adjacentNow:{prev:0,next:0},neighborDraftTexts:{prev:null,next:null},reviewInput:input,
 reviewBinding:{version:INPUT_BINDING_VERSION,scope,inputVersion:{id:'fixture-capture',revision:1},inputDigest:reviewed.inputDigest,draftRev:1,publishedRev:0,adjacent:{prev:0,next:0},sources:Object.fromEntries(['baseStore','teamState','baseAssignments','history','planningPolicy'].map(x=>[x,{id:'fixture-'+x,revision:1}]))},
 contextTransaction:{id:'fixture-capture-1',capabilities:{[CONTEXT_CAPABILITY]:true},register:async x=>({registered:true,transactionId:'fixture-capture-1',bindingDigest:x.bindingDigest})}};
 await sql(await readFile(new URL('./capture.sql',import.meta.url),'utf8'));
 const raw=()=>sql("SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')").then(JSON.parse);
 const register=(expected,txt)=>sql(`SELECT scheduler_private.register_capture_v1(${json(expected)},${lit(txt)})`);
 const capture=createSourceCapture({enabled:true,port:{snapshot:raw,register}});
 const cap=()=>capture.capture({scope,actor,now:at,requestId:'capture'});
 const data={roster:[{id:'a',name:'Synthetic a',roleId:'sales'},{id:'b',name:'Synthetic b',roleId:'sales'}],departed:[],daysOff:{a:['2026-10-07']},activity:{'2026-10-07':{'synthetic a':{calls:1}}}};
 const put=(key,value)=>sql(`INSERT INTO public.app_data VALUES(${lit(key)},${json(value)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
 await put('lpc:store:pilot-a:v2',data);
 await check('missing supplemental origins fail closed',async()=>{await assert.rejects(cap(),{code:'SOURCE_INPUTS_MISSING'});assert.throws(()=>createSourceCapture(),{code:'CAPTURE_DISABLED'});});
 const supplement={version:'scheduler-source-inputs/1',baseStore:{...enrich,planningPolicy:null},teamState:input.teamState,months:{'2026-10':{history:[],planningPolicy:null}}};
 await sql(`INSERT INTO scheduler_private.capture_inputs_v1 VALUES('pilot-a',${json(supplement)})`);
 await check('strict source completeness and roster checks',async()=>{
  const value=await raw();for(const mutate of [x=>delete x.supplement.baseStore.history,x=>delete x.supplement.months['2026-10'].planningPolicy]){const v=structuredClone(value);mutate(v);assert.throws(()=>assembleSource(v),{code:'SOURCE_INPUTS_MISSING'});}
  const unknown=structuredClone(value);unknown.supplement.baseStore.people[0].start=null;assert.throws(()=>assembleSource(unknown),{code:'SOURCE_INPUTS_INCOMPLETE'});
  const v=structuredClone(value);v.rows['lpc:store:pilot-a:v2'].roster.pop();assert.throws(()=>assembleSource(v),{code:'SOURCE_ROSTER_MISMATCH'});
 });
 await check('split activity replaces embedded evidence without inventing shifts',async()=>{
  assert.equal(assembleSource(await raw()).snapshot.reviewInput.base['2026-10-07'],null);
  await put('lpc:store:pilot-a:act:2026-10-07',{'synthetic a':{calls:0,video:0}});
  assert.deepEqual(assembleSource(await raw()).snapshot.reviewInput.base['2026-10-07'],{on:[],off:['a']});
 });
 let prepared=await cap();
 await check('registered capture binds persisted C113 and typed absence',async()=>{assert.equal(await sql("SELECT context_id FROM scheduler_private.publication_source_heads_v2"),prepared.contextId);assert.equal(prepared.context.projection[0].days.find(d=>d.date==='2026-10-07').status,'vacation');});
 const pointer=()=>sql('SELECT count(*) FROM scheduler_private.publication_source_heads_v2');
 await check('insert update delete restore config and supplement invalidate transactionally',async()=>{
  for(const statement of [
   "INSERT INTO public.app_data VALUES('lpc:store:pilot-a:act:2026-10-08','{}')",
   "UPDATE public.app_data SET value=value WHERE key='lpc:store:pilot-a:v2'",
   "DELETE FROM public.app_data WHERE key='lpc:store:pilot-a:act:2026-10-08'",
   "INSERT INTO public.app_data VALUES('lpc:store:pilot-a:restore:v1','{}')",
   "INSERT INTO public.app_data VALUES('lpc:config:v1','{}')",
   "UPDATE scheduler_private.capture_inputs_v1 SET payload=payload WHERE store_id='pilot-a'"
  ]){prepared=await cap();const before=(await raw()).epoch;await sql(statement);assert.equal(await pointer(),'0');assert.ok((await raw()).epoch>before);}
 });
 await check('rolled back source writes leave generation pointer and rows unchanged',async()=>{
  prepared=await cap();const before=await raw();await assert.rejects(sql("BEGIN;UPDATE public.app_data SET value='{}' WHERE key='lpc:store:pilot-a:v2';SELECT 1/0;COMMIT"),/division by zero/);assert.deepEqual(await raw(),before);assert.equal(await pointer(),'1');
 });
 await check('stale source snapshot registration rejected including missing-row insert',async()=>{
  const before=await raw();prepared=await cap();await put('lpc:store:pilot-a:act:2026-10-09',{});await assert.rejects(register(before,prepared.contextText),/capture:conflict/);assert.equal(await pointer(),'0');
 });
 await check('source changes during JS review or immediately before final registration fail closed',async()=>{
  let calls=0;const moving=createSourceCapture({enabled:true,port:{snapshot:async()=>{if(++calls===2)await put('lpc:store:pilot-a:act:2026-10-12',{});return raw();},register}});
  await assert.rejects(moving.capture({scope,actor,now:at,requestId:'moving'}),{code:'SOURCE_CONFLICT'});
  const late=createSourceCapture({enabled:true,port:{snapshot:raw,register:async(expected,txt)=>{await put('lpc:store:pilot-a:act:2026-10-13',{});return register(expected,txt);}}});
  await assert.rejects(late.capture({scope,actor,now:at,requestId:'late'}),/capture:conflict/);assert.equal(await pointer(),'0');
 });
 await check('concurrent identical registrations preserve one immutable context',async()=>{
  prepared=await cap();const before=await raw();assert.deepEqual(await Promise.all([register(before,prepared.contextText),register(before,prepared.contextText)]),[prepared.contextId,prepared.contextId]);
 });
 await check('snapshot waits for in-flight source writer then sees committed whole snapshot',async()=>{
  const writer=sql("SET application_name='capture-writer';BEGIN;UPDATE public.app_data SET value=jsonb_set(value,'{rev}','42') WHERE key='lpc:store:pilot-a:v2';SELECT pg_sleep(3);COMMIT");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='capture-writer' AND wait_event='PgSleep'",1);
  const read=sql("SET application_name='capture-reader';SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='capture-reader' AND wait_event_type='Lock'",1);
  await writer;assert.equal(JSON.parse((await read)).rows['lpc:store:pilot-a:v2'].rev,42);
 });
 await check('capture snapshot holding lock forces subsequent writer to invalidate it',async()=>{
  const holder=sql("SET application_name='capture-holder';BEGIN;SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10');SELECT pg_sleep(3);COMMIT");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='capture-holder' AND wait_event='PgSleep'",1);
  const writer=sql("SET application_name='capture-write-wait';UPDATE public.app_data SET value=jsonb_set(value,'{rev}','43') WHERE key='lpc:store:pilot-a:v2'");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='capture-write-wait' AND wait_event_type='Lock'",1);
  const held=JSON.parse((await holder).trim());await writer;prepared=await cap();await assert.rejects(register(held,prepared.contextText),/capture:conflict/);
 });
 await check('neighbor draft insertion rejects old capture registration',async()=>{
  const before=await raw();prepared=await cap();await assert.rejects(sql(`BEGIN;INSERT INTO scheduler_private.heads VALUES('pilot-a','2026-09',1,0,0,null);SELECT scheduler_private.register_capture_v1(${json(before)},${lit(prepared.contextText)});COMMIT`),/capture:conflict/);assert.deepEqual(await raw(),before);
 });
 await check('runtime cannot read snapshots register captures or write supplemental inputs',async()=>{
  await assert.rejects(rpc("SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')"),/permission denied/);
  await assert.rejects(rpc(`SELECT scheduler_private.register_capture_v1(${json(await raw())},${lit(prepared.contextText)})`),/permission denied/);
  await assert.rejects(rpc("UPDATE scheduler_private.capture_inputs_v1 SET payload=payload"),/permission denied/);
 });
 await check('captured context publishes using existing gateway; later source edit preserves published content',async()=>{
  prepared=await cap();await sql('UPDATE scheduler_policy.publication_grants_v2 SET enabled=true');
  const receipt={key:JSON.stringify([manager,scope.storeId,scope.month,'captured-publish']),fingerprint:hash('captured-publish'),result:{head:prepared.context.plan.resultingHead}};
  const pub=()=>rpc(`SELECT scheduler_gateway.publish_v2(${json(auth('publish'))},${lit(prepared.contextId)},${json(prepared.context.plan)},${json(receipt)})`);
  const before=await raw();await put('lpc:store:pilot-a:act:2026-10-10',{});await assert.rejects(pub(),/scheduler:conflict/);
  prepared=await cap();
  const publishing=rpc(`BEGIN;SELECT scheduler_gateway.publish_v2(${json(auth('publish'))},${lit(prepared.contextId)},${json(prepared.context.plan)},${json(receipt)});SELECT pg_sleep(3);COMMIT`);
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-rpc' AND wait_event='PgSleep'",1);
  const editing=sql("SET application_name='postpublish-writer';UPDATE public.app_data SET value=jsonb_set(value,'{rev}','44') WHERE key='lpc:store:pilot-a:v2'");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='postpublish-writer' AND wait_event_type='Lock'",1);
  assert.equal(JSON.parse((await publishing).trim()).replayed,false);await editing;assert.equal(await pointer(),'0');
  const published=await own();assert.equal(JSON.parse(published).revision,1);await put('lpc:store:pilot-a:act:2026-10-11',{});assert.equal(await pointer(),'0');assert.equal(await own(),published);
  await sql(`UPDATE public.profiles SET pending=true WHERE id='${employee}'`);await assert.rejects(own(),/scheduler:forbidden/);
 });
 await check('synchronized truncate and capture use table-before-advisory lock order',async()=>{
  const gate=sql("SET application_name='truncate-gate';BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('sage-scheduler:pilot-a',0));SELECT pg_sleep(3);COMMIT");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='truncate-gate' AND wait_event='PgSleep'",1);
  const reading=sql("SET application_name='truncate-reader';SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='truncate-reader' AND wait_event_type='Lock'",1);
  const truncating=sql("SET application_name='truncate-writer';TRUNCATE public.app_data");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='truncate-writer' AND wait_event='relation'",1);
  await gate;const result=JSON.parse(await reading);await truncating;
  assert.ok(result.rows['lpc:store:pilot-a:v2']);assert.deepEqual((await raw()).rows,{});assert.equal(await pointer(),'0');
 });
 await check('truncate invalidates enrolled scopes without deleting frozen published context',async()=>{await sql('TRUNCATE public.app_data');assert.equal(await pointer(),'0');await assert.rejects(cap(),{code:'SOURCE_INPUTS_MISSING'});assert.ok(Number(await sql('SELECT count(*) FROM scheduler_private.publication_contexts_v2'))>0);});
}catch(error){results.failure={message:error.message};console.error(error.message);process.exitCode=1;}
finally{
 if(started){try{await run(bin+'/pg_ctl',['-D',root+'/data','-w','-t','15','-m','fast','stop'],{env});const status=await run(bin+'/pg_ctl',['-D',root+'/data','status'],{env}).then(()=>0,e=>e.code);assert.equal(status,3);await rm(root,{recursive:true});results.cleanup={stopped:true,statusExit:3,removed:true,root};}catch{results.cleanup={stopped:false,removed:false,root};process.exitCode=1;}}
 else {await rm(root,{recursive:true});results.cleanup={neverStarted:true,removed:true,root};}
 await writeFile(new URL('./sql-results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.checks.length,cleanup:results.cleanup}));
}
