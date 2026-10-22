// Derived local driver verification of run-sql.mjs; synthetic Unix socket only.
import {Pool} from 'pg';
import {createSchedulerPgTransport} from '../../api/_scheduler-pg-transport.mjs';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localStore } from '../scheduler-delivery-local/local-store.mjs';
import {createSourceCapture} from '../scheduler-source-capture/adapter.mjs';
import {assembleManualSource} from './contract.mjs';
import {createSchedulerCapturePort} from '../../api/_scheduler-capture-port.mjs';
import {createManualSchedulerServer} from '../../api/_scheduler-manual-server.mjs';
import {createSchedulerDraftTransport} from '../../src/scheduler-draft-transport.mjs';
import {schedulerDraftCodec} from '../../src/scheduler-draft-codec.mjs';
import {manualDraftFetch} from '../../src/scheduler-manual-setup.mjs';
import {createPlanner} from '../scheduler-performance/month-model.mjs';
import {editorStore} from '../../src/scheduler-editor-adapter.mjs';
import {addManualShift,removeManualShift} from '../../src/scheduler-manual-model.mjs';
import { createPublicationV2 } from '../../api/_scheduler-publication-v2.mjs';
import { originalC113 as c113 } from '../../api/_scheduler-c113.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
import { INPUT_BINDING_VERSION,CONTEXT_CAPABILITY } from '../../api/_scheduler-contract.mjs';
const run=promisify(execFile),bin='/workspace/.local/postgresql/root/usr/lib/postgresql/17/bin';
const root=await mkdtemp('/tmp/sage-delivery-'),env={PATH:'/usr/bin:/bin',LANG:'C',HOME:root+'/home'};
await mkdir(root+'/home');await mkdir(root+'/socket',{mode:0o700});
const identicalMode=false;
const results={mode:identicalMode?'identical':'distinct',checks:[],cleanup:null};let started=false;let driverTransport;
const hash=x=>createHash('sha256').update(x).digest('hex');
const lit=x=>`convert_from(decode('${Buffer.from(String(x)).toString('hex')}','hex'),'UTF8')`;
const json=x=>lit(JSON.stringify(x))+'::jsonb';
const manager='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002';
const scope={storeId:'pilot-a',month:'2026-10'},actor={id:manager},at='2026-10-22T17:30:00Z';
const auth=action=>({actorId:manager,action,...scope,readKind:null});
const person=id=>({id,name:'Synthetic '+id,start:9,end:17,off:[],maxHours:40,maxHoursSource:'manager-confirmed'});
const closed={open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{}};
const draft={...scope,store:{timezone:'America/New_York',people:[person('a'),person('b')],
 rules:[{...closed,effective:'2014-01-01'},{...closed,effective:'2026-10-05',closedDays:[]},{...closed,effective:'2026-10-06',closedDays:[],open:9.25,close:16.75},{...closed,effective:'2026-10-07',closedDays:[]},{...closed,effective:'2026-10-08'}],teams:[],
 memberships:['a','b'].map(personId=>({storeId:scope.storeId,personId,teamIds:[],from:'2014-01-01',to:'2100-12-31',unknown:false}))},
 overrides:{'2026-10-05':{on:['a','b'],off:[],shifts:['a','b'].map(personId=>({storeId:scope.storeId,personId,date:'2026-10-05',endDate:'2026-10-05',startMinute:540,endMinute:1020,timezone:'America/New_York'}))},
 '2026-10-06':{on:['a','b'],off:[]},
 '2026-10-07':{on:['b'],off:['a'],absences:{a:{kind:'vacation'}}}}};
for(const [day,r] of Object.entries(draft.overrides))if(!r.shifts)r.shifts=r.on.map(personId=>({storeId:scope.storeId,personId,date:day,endDate:day,startMinute:day==='2026-10-06'?555:540,endMinute:day==='2026-10-06'?1005:1020,timezone:'America/New_York'}));
for(const r of Object.values(draft.overrides))for(const s of r.shifts)s.role='sales';
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
 const planner=createPlanner([editorStore({id:scope.storeId},{roster:[{id:'a',name:'Synthetic a',roleId:'sales'},{id:'b',name:'Synthetic b',roleId:'sales'}]},'America/New_York')],{assignmentForDay:()=>null});
 const initial=planner.exportMonth(0,scope.month).projection;assert.equal(initial.store.people[0].maxHours,null);assert.deepEqual(initial.store.rules,[]);
 // Explicit synthetic settings, just as setup exports them; no fallback values.
 assert.equal(planner.hydrateMonth(0,draft,x=>x,scope).ok,true);
 const initialized=planner.exportMonth(0,scope.month).projection;
 const saved=c113.planDraftSave({...scope,draft:initialized,baseRev:0,head:null,actor,at,prevAuditHash:null});assert.equal(saved.ok,true,JSON.stringify(saved));
 const draftReceipt={key:JSON.stringify([manager,'pilot-a','2026-10','save']),fingerprint:hash('save'),result:{head:saved.plan.resultingHead}};
 await check('existing v1 draft RPC still saves and employee sees no draft',async()=>{await rpc(`SELECT scheduler_gateway.scheduler_commit(${json(auth('save'))},${json({head:null,prevAuditHash:null,auditRevision:0})},${json(saved.plan)},${json(draftReceipt)})`);assert.equal(JSON.parse(await own()).revision,0);});
 const span=review.reviewSpan(scope.month),enrich={...structuredClone(draft.store),id:'pilot-a',history:[]};
 const input={definition:'month-review/1',scope,baseStore:enrich,teamState:{teams:[],memberships:draft.store.memberships},months:{'2026-10':{store:enrich,overrides:draft.overrides}},base:Object.fromEntries(span.days.map(day=>[day,day==='2026-10-06'?{on:['a','b'],off:[]}:null]))};
 const reviewed=review.reviewMonth(input,{sha256:hash});assert.equal(reviewed.openIssues,0,JSON.stringify(reviewed.rows.filter(r=>r.issues.length)));
 const snapshot={scope,head:{draftRev:1,publishedRev:0},draftText:saved.plan.ops[0].text,publishedText:null,prevAuditHash:saved.plan.auditEntry.hash,auditRevision:1,adjacentNow:{prev:0,next:0},neighborDraftTexts:{prev:null,next:null},reviewInput:input,
 reviewBinding:{version:INPUT_BINDING_VERSION,scope,inputVersion:{id:'fixture-capture',revision:1},inputDigest:reviewed.inputDigest,draftRev:1,publishedRev:0,adjacent:{prev:0,next:0},sources:Object.fromEntries(['baseStore','teamState','baseAssignments','history','planningPolicy'].map(x=>[x,{id:'fixture-'+x,revision:1}]))},
 contextTransaction:{id:'fixture-capture-1',capabilities:{[CONTEXT_CAPABILITY]:true},register:async x=>({registered:true,transactionId:'fixture-capture-1',bindingDigest:x.bindingDigest})}};
 await sql(await readFile(new URL('../scheduler-source-capture/capture.sql',import.meta.url),'utf8'));
 await sql(await readFile(new URL('./policy.sql',import.meta.url),'utf8'));
 const port=createSchedulerCapturePort({query:async(text,values)=>{
  const query=text.replace(/\$(\d+)/g,(_,n)=>values[Number(n)-1]===null?'NULL':lit(values[Number(n)-1]));
  try{const value=await sql(query);return {rows:[{value:text.includes('capture_snapshot_v1')?JSON.parse(value):value}]};}catch(e){const message=/manual-policy:(conflict|idempotency-conflict)|capture:conflict/.exec(e.message)?.[0];if(message)throw {code:'P0001',message};throw e;}
 }});
 const raw=()=>sql("SELECT scheduler_private.capture_snapshot_v1('pilot-a','2026-10')").then(JSON.parse);
 const register=(expected,txt)=>sql(`SELECT scheduler_private.register_capture_v1(${json(expected)},${lit(txt)})`);
 const capture=createSourceCapture({enabled:true,port:{snapshot:raw,register},assemble:assembleManualSource});
 const cap=()=>capture.capture({scope,actor,now:at,requestId:'capture'});
 const data={roster:[{id:'a',name:'Synthetic a',roleId:'sales'},{id:'b',name:'Synthetic b',roleId:'sales'},{id:'future',name:'Synthetic future',roleId:'sales',hiredAt:'2026-12-01'},{id:'past',name:'Synthetic past',roleId:'sales'}],departed:[{id:'past',at:'2026-08-31'}],daysOff:{a:['2026-10-07']},activity:{'2026-10-07':{'synthetic a':{calls:1}}}};
 const put=(key,value)=>sql(`INSERT INTO public.app_data VALUES(${lit(key)},${json(value)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
 await put('lpc:store:pilot-a:v2',data);

 for(const month of ['2026-09','2026-11']){
  const d={...structuredClone(draft),month,overrides:{}};
  const saved=c113.planDraftSave({storeId:scope.storeId,month,draft:d,baseRev:0,head:null,actor,at,prevAuditHash:null});assert.equal(saved.ok,true);
  const a={actorId:manager,action:'save',storeId:scope.storeId,month,readKind:null};
  const receipt={key:JSON.stringify([manager,scope.storeId,month,'neighbor']),fingerprint:hash(month),result:{head:saved.plan.resultingHead}};
  await rpc(`SELECT scheduler_gateway.scheduler_commit(${json(a)},${json({head:null,prevAuditHash:null,auditRevision:0})},${json(saved.plan)},${json(receipt)})`);
 }
 const configuredPolicy={people:{a:{eligible:true,roles:['sales','support']},b:{eligible:true,roles:['sales','support']}},requiredRoles:{sales:1}};
 const supplement={version:'scheduler-manual-policy/1',months:{'2026-09':null,'2026-10':configuredPolicy,'2026-11':null}};
 await port.putPolicy({storeId:scope.storeId,expected:null,replacement:supplement,requestId:'initialize-policy'});
 await check('owner policy CAS replay strict validation and privilege denial',async()=>{
  assert.equal(await port.putPolicy({storeId:scope.storeId,expected:null,replacement:supplement,requestId:'initialize-policy'}),'1');
  await assert.rejects(port.putPolicy({storeId:scope.storeId,expected:null,replacement:supplement,requestId:'stale'}),{code:'conflict'});
  await assert.rejects(port.putPolicy({storeId:scope.storeId,expected:null,replacement:{...supplement,months:{}},requestId:'initialize-policy'}),{code:'conflict'});
  for(const invalid of [{...supplement,unexpected:true},{version:null,months:{}},{version:3,months:{}}])assert.equal(await sql(`SELECT scheduler_private.manual_policy_valid_v1(${json(invalid)})`),'f');
  assert.equal(await sql(`SELECT has_function_privilege('scheduler_runtime','scheduler_private.put_manual_policy_v1(text,jsonb,jsonb,text)','EXECUTE')`),'f');
  assert.equal(await sql('SELECT count(*) FROM scheduler_private.manual_policy_history_v1'),'1');
 });
 await check('policy update atomic audit rollback and competing CAS preserve configured months',async()=>{
  const before=await raw();
  await sql(`CREATE FUNCTION public.fail_policy_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='rollback' THEN RAISE EXCEPTION 'synthetic policy audit failure';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_policy_fixture BEFORE INSERT ON scheduler_private.manual_policy_history_v1 FOR EACH ROW EXECUTE FUNCTION public.fail_policy_fixture()`);
  const next={...supplement,months:{...supplement.months,'2027-01':null}};
  await assert.rejects(port.putPolicy({storeId:scope.storeId,expected:supplement,replacement:next,requestId:'rollback'}));
  assert.deepEqual(await raw(),before);
  await sql('DROP TRIGGER fail_policy_fixture ON scheduler_private.manual_policy_history_v1;DROP FUNCTION public.fail_policy_fixture()');
  const barrier=sql("SET application_name='manual-policy-barrier';BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('sage-scheduler:pilot-a',0));SELECT pg_sleep(1.5);COMMIT");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='manual-policy-barrier' AND wait_event='PgSleep'",1);
  const attempts=Promise.allSettled(['race-one','race-two'].map(requestId=>port.putPolicy({storeId:scope.storeId,expected:supplement,replacement:next,requestId})));
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%put_manual_policy_v1%'",2);
  await barrier;const outcomes=await attempts;
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.code==='conflict').length,1);
  assert.deepEqual((await raw()).supplement.months['2026-10'],configuredPolicy);
  assert.ok((await raw()).epoch>before.epoch);
  await port.putPolicy({storeId:scope.storeId,expected:next,replacement:supplement,requestId:'restore-policy'});
 });
 await sql('UPDATE scheduler_policy.publication_grants_v2 SET enabled=true');
 const identityDb={auth:{getUser:async token=>({data:{user:token==='fake-manager'?{id:manager}:token==='fake-employee'?{id:employee}:null},error:null})},from:()=>({select:()=>({eq:(_k,id)=>({maybeSingle:async()=>({data:JSON.parse(await sql(`SELECT to_jsonb(p) FROM public.profiles p WHERE id=${lit(id)}::uuid`)),error:null})})})})};
 const pool=new Pool({host:root+'/socket',port:5432,database:'postgres',user:'delivery_fixture',password:'deliberately-fake-unused',ssl:false,max:4,connectionTimeoutMillis:3000,application_name:'synthetic-rpc',options:'-c role=scheduler_runtime'});
 driverTransport=createSchedulerPgTransport({pool,publicationV2:true});
 const identity=await pool.query('SELECT current_user AS role,session_user AS login');
 assert.equal(identity.rows[0].role,'scheduler_runtime');assert.equal(identity.rows[0].login,'delivery_fixture');
 const transport=driverTransport;
 let revokeAfterCapture=false;
 const handler=createManualSchedulerServer({enabled:true,identityDb,transport,capturePort:{snapshot:port.snapshot,register:async(...args)=>{const id=await port.register(...args);if(revokeAfterCapture)await sql(`UPDATE public.profiles SET pending=true WHERE id='${manager}'`);return id;},context:port.context},draftPermissionFor:async a=>(await sql(`SELECT count(*) FROM scheduler_policy.draft_grants WHERE actor_id=${lit(a.actorId)}::uuid AND store_id=${lit(a.storeId)} AND permission=${lit(a.permission)} AND enabled`))==='1',publishPermissionFor:async a=>(await sql(`SELECT count(*) FROM scheduler_policy.publication_grants_v2 WHERE actor_id=${lit(a.actorId)}::uuid AND store_id=${lit(a.storeId)} AND enabled`))==='1',now:()=>at});
 const request=async(action,extra={},token='fake-manager')=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization:'Bearer '+token},body:{action,...scope,...extra}},res);return res;};
 await check('first month uses existing setup export codec transport and real draft gateway',async()=>{
  const setupScope={...scope,month:'2026-12'};
  const setupPlanner=createPlanner([editorStore({id:scope.storeId},data,'America/New_York')],{assignmentForDay:()=>null});
  const projection=setupPlanner.exportMonth(0,setupScope.month).projection;
  assert.ok(projection.store.people.every(p=>p.start===null&&p.end===null&&p.maxHours===null));assert.deepEqual(projection.store.rules,[]);
  const transport=createSchedulerDraftTransport({auth:{getSnapshot:()=>({principalEpoch:1,disposed:false}),getAccessToken:async()=> 'fake-manager'},codec:schedulerDraftCodec,requestId:()=> 'initial-setup-save',fetchImpl:manualDraftFetch(async(url,init)=>{
   assert.equal(url,'/api/scheduler-manual');const body=JSON.parse(init.body),res=await request(body.action,Object.fromEntries(Object.entries(body).filter(([k])=>k!=='action')));return {status:res.statusCode,json:async()=>res.body};
  })});
  const empty=await transport.send(transport.prepareRead(setupScope),{expectedEpoch:1});assert.equal(empty.revision,0);assert.equal(empty.draft,null);
  const command=transport.prepareSave(setupScope,0,projection),saved=await transport.send(command,{expectedEpoch:1});assert.equal(saved.head.draftRev,1);assert.equal((await transport.send(command,{expectedEpoch:1})).replayed,true);
  const loaded=await transport.send(transport.prepareRead(setupScope),{expectedEpoch:1});assert.deepEqual(loaded.draft,projection);
 });
 await check('manual contract refuses missing policy boundary dates and inferred on times',async()=>{
  const value=await raw();assert.ok(assembleManualSource(value));
  for(const [mutate,code] of [[v=>delete v.supplement.months['2026-10'],'MANUAL_POLICY_UNAVAILABLE'],[v=>v.versions=v.versions.filter(x=>x.month!=='2026-09'),'MANUAL_BOUNDARY_DRAFT_REQUIRED']]){const v=structuredClone(value);mutate(v);assert.throws(()=>assembleManualSource(v),{code});}
  const alterDraft=mutate=>{const v=structuredClone(value),version=v.versions.find(x=>x.month===scope.month&&x.kind==='draft');const e=JSON.parse(version.version_text);mutate(e.payload);const encoded=c113.serializeVersion({kind:'draft',...scope,rev:e.rev,draft:e.payload,meta:e.meta});assert.equal(encoded.ok,true);version.version_text=encoded.text;return v;};
  assert.throws(()=>assembleManualSource(alterDraft(d=>delete d.overrides['2026-10-05'].shifts)),{code:'MANUAL_EXPLICIT_TIMES_REQUIRED'});
  assert.throws(()=>assembleManualSource(alterDraft(d=>{for(const r of Object.values(d.overrides))for(const s of r.shifts)delete s.role;})),{code:'SOURCE_REVIEW_ISSUES'});
  const v=structuredClone(value);v.supplement.months['2026-10']={people:{a:{eligible:false,roles:[]},b:{eligible:true,roles:[]}},requiredRoles:{}};assert.throws(()=>assembleManualSource(v));
 });
 await check('manual source accepts correct month roster despite future and departed source staff',async()=>{const a=assembleManualSource(await raw());assert.deepEqual(a.snapshot.reviewInput.baseStore.people.map(p=>p.id),['a','b']);});
 let manualReviewed;
 await check('real composed HTTP actions load edit save review publish and own read',async()=>{
  const loaded=await request('load');assert.equal(loaded.statusCode,200,JSON.stringify(loaded.body));
  let edited=removeManualShift(loaded.body.result.schedule,'2026-10-05',0);
  edited=addManualShift(edited,{day:'2026-10-05',personId:'a',start:'09:00',end:'17:00',role:'sales'});
  const body={draft:edited,baseRev:loaded.body.result.revision,requestId:'manual-save'};
  const saved=await request('save',body);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
  assert.equal((await request('save',body)).body.replayed,true);assert.equal((await request('load')).body.result.schedule.store.people[0].maxHoursSource,'manager-confirmed');
  assert.equal((await request('own',{},'fake-employee')).body.revision,0);
  const result=await request('review',{requestId:'manual-review'});assert.equal(result.statusCode,200,JSON.stringify(result.body));manualReviewed=result.body;const captured=await port.context(manualReviewed.contextId);assert.ok(JSON.parse(captured.contextText).inputText.includes('manager-confirmed'));
  const pub={contextId:manualReviewed.contextId,requestId:'manual-publish'};
  const published=await request('publish',pub);assert.equal(published.statusCode,200,JSON.stringify(published.body));assert.equal((await request('publish',pub)).body.replayed,true);
  const own=await request('own',{},'fake-employee');assert.equal(own.statusCode,200);assert.equal(own.body.revision,published.body.result.head.publishedRev);assert.deepEqual(own.body.days.find(d=>d.date==='2026-10-05').intervals,[[540,1020]]);assert.ok(!JSON.stringify(own.body).includes('personId'));
 });
 await check('manual handler denies employee review and pending own read; source drift rejects publish',async()=>{
  assert.equal((await request('review',{requestId:'deny'},'fake-employee')).statusCode,403);
  await sql(`UPDATE public.profiles SET pending=true WHERE id='${employee}'`);assert.equal((await request('own',{},'fake-employee')).statusCode,403);
  await sql(`UPDATE public.profiles SET pending=false WHERE id='${employee}'`);assert.equal((await request('own',{},'fake-employee')).statusCode,200);
  const next=await request('review',{requestId:'next'});assert.equal(next.statusCode,200);
  await put('lpc:store:pilot-a:act:2026-10-10',{});
  assert.equal((await request('publish',{contextId:next.body.contextId,requestId:'stale'})).statusCode,409);
 });
 const draftRead=()=>rpc(`SELECT scheduler_gateway.scheduler_snapshot(${json({...auth('read'),readKind:'draft'})},NULL)`);
 for(const [name,change,restore,attempt] of [
  ['pending employee own read',`UPDATE public.profiles SET pending=true WHERE id='${employee}'`,`UPDATE public.profiles SET pending=false WHERE id='${employee}'`,async()=>assert.equal((await request('own',{},'fake-employee')).statusCode,403)],
  ['manager role publication replay',`UPDATE public.profiles SET role='overseer' WHERE id='${manager}'`,`UPDATE public.profiles SET role='manager' WHERE id='${manager}'`,async()=>assert.equal((await request('publish',{contextId:manualReviewed.contextId,requestId:'manual-publish'})).statusCode,403)],
  ['manager store publication replay',`UPDATE public.profiles SET stores='{}' WHERE id='${manager}'`,`UPDATE public.profiles SET stores=ARRAY['pilot-a'] WHERE id='${manager}'`,async()=>assert.equal((await request('publish',{contextId:manualReviewed.contextId,requestId:'manual-publish'})).statusCode,403)],
  ['pending manager draft snapshot',`UPDATE public.profiles SET pending=true WHERE id='${manager}'`,`UPDATE public.profiles SET pending=false WHERE id='${manager}'`,()=>assert.rejects(draftRead(),/scheduler:forbidden/)],
  ['manager role draft snapshot',`UPDATE public.profiles SET role='overseer' WHERE id='${manager}'`,`UPDATE public.profiles SET role='manager' WHERE id='${manager}'`,()=>assert.rejects(draftRead(),/scheduler:forbidden/)],
  ['pilot store retargeting draft snapshot',`UPDATE scheduler_policy.pilot_scope SET approved_store_ids=ARRAY['other'] WHERE actor_id='${manager}'`,`UPDATE scheduler_policy.pilot_scope SET approved_store_ids=ARRAY['pilot-a'] WHERE actor_id='${manager}'`,()=>assert.rejects(draftRead(),/scheduler:forbidden/)],
 ])await check('blocked authorization race: '+name,async()=>{
  await draftRead();assert.equal((await request('own',{},'fake-employee')).statusCode,200);
  if(name.includes('publication replay'))assert.equal((await request('publish',{contextId:manualReviewed.contextId,requestId:'manual-publish'})).statusCode,200);
  const revoker=sql(`SET application_name='manual-auth-revoker';BEGIN;${change};SELECT pg_sleep(1.5);COMMIT`);
  revoker.catch(()=>{}); // Observe rejection immediately; Promise.all below still propagates it.
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='manual-auth-revoker' AND wait_event='PgSleep'",1);
  const denied=attempt();denied.catch(()=>{}); // Preserve cleanup if a barrier fails first.
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-rpc' AND wait_event_type='Lock'",1);
  await Promise.all([revoker,denied]);await sql(restore);
  if(name.includes('publication replay'))assert.equal((await request('publish',{contextId:manualReviewed.contextId,requestId:'manual-publish'})).statusCode,200);
  await draftRead();assert.equal((await request('own',{},'fake-employee')).statusCode,200);
 });
 await check('manager revocation during capture withholds complete review projection',async()=>{revokeAfterCapture=true;const r=await request('review',{requestId:'revoked-review'});assert.equal(r.statusCode,403);assert.deepEqual(r.body,{error:'forbidden'});await sql(`UPDATE public.profiles SET pending=false WHERE id='${manager}'`);});
}catch(error){results.failure={message:error.message};console.error(error.message);process.exitCode=1;}
finally{
 if(driverTransport){try{await driverTransport.close();results.driverClosed=true;}catch{results.driverClosed=false;process.exitCode=1;}}
 if(started){try{await run(bin+'/pg_ctl',['-D',root+'/data','-w','-t','15','-m','fast','stop'],{env});const status=await run(bin+'/pg_ctl',['-D',root+'/data','status'],{env}).then(()=>0,e=>e.code);assert.equal(status,3);await rm(root,{recursive:true});results.cleanup={stopped:true,statusExit:3,removed:true,root};}catch{results.cleanup={stopped:false,removed:false,root};process.exitCode=1;}}
 else {await rm(root,{recursive:true});results.cleanup={neverStarted:true,removed:true,root};}
 await writeFile(new URL('./pg-sql-results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.checks.length,cleanup:results.cleanup}));
}
