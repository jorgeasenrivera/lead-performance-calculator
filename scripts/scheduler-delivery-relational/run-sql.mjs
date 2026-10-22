import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localStore } from '../scheduler-delivery-local/local-store.mjs';
import { preparePublication,validatePublicationPlan } from './context.mjs';
import { createPublicationV2 } from '../../api/_scheduler-publication-v2.mjs';
import { originalC113 as c113 } from '../../api/_scheduler-c113.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review.mjs';
import { INPUT_BINDING_VERSION,CONTEXT_CAPABILITY } from '../../api/_scheduler-contract.mjs';
const run=promisify(execFile),bin='/workspace/.local/postgresql/root/usr/lib/postgresql/17/bin';
const root=await mkdtemp('/tmp/sage-delivery-'),env={PATH:'/usr/bin:/bin',LANG:'C',HOME:root+'/home'};
await mkdir(root+'/home');await mkdir(root+'/socket',{mode:0o700});
const identicalMode=process.argv.includes('--identical');
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
 await sql(await readFile(new URL('./publication-v2.sql',import.meta.url),'utf8'));
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
 const request={op:'publish',...scope,requestId:'publish',input:{draftRev:1,review:{definition:reviewed.definition,digest:reviewed.digest}}};
 const prepared=await preparePublication({request,actor,now:at,snapshot,sourceEpoch:1});
 await check('JS context captures inherited full-day and absence semantics',async()=>{assert.equal(validatePublicationPlan(prepared.context.plan,prepared.context),true);const days=prepared.context.projection.find(x=>x.personId==='a').days;assert.deepEqual(days.find(x=>x.date==='2026-10-06').intervals,[[9.01*60,16.99*60]]);assert.equal(days.find(x=>x.date==='2026-10-07').status,'vacation');assert.equal(days.find(x=>x.date==='2026-10-08').status,'closed');assert.throws(()=>validatePublicationPlan({...prepared.context.plan,publishedRev:99},prepared.context));});
 await sql(`INSERT INTO scheduler_private.publication_contexts_v2 VALUES(${lit(prepared.contextId)},${lit(prepared.contextText)},${json(prepared.context)});INSERT INTO scheduler_private.publication_source_heads_v2 VALUES('pilot-a','2026-10',1,${lit(prepared.contextId)});`);
 const publicationRequest={...scope,contextId:prepared.contextId,requestId:'publish'};
 const receipt={key:JSON.stringify([manager,'pilot-a','2026-10','publish']),fingerprint:hash(c113.canonicalize(publicationRequest).text),result:{head:prepared.context.plan.resultingHead}};
 const publisher=createPublicationV2({enabled:true,identity:{verifyToken:async token=>token==='synthetic-manager'?{id:manager}:null},capturedContextFor:async id=>id===prepared.contextId?{contextText:prepared.contextText}:null,transport:{capabilities:{'scheduler-publication/2':true},rpc:async(name,args)=>{assert.equal(name,'publish_v2');try{return {data:JSON.parse(await rpc(`SELECT scheduler_gateway.publish_v2(${json(args.p_authority)},${lit(args.p_context_id)},${json(args.p_plan)},${json(args.p_receipt)})`)),error:null};}catch(error){if(error.message.includes('scheduler:conflict'))return {data:null,error:{message:'scheduler:conflict'}};throw error;}}}});
 const pub=(plan=prepared.context.plan,r=receipt)=>rpc(`SELECT scheduler_gateway.publish_v2(${json(auth('publish'))},${lit(prepared.contextId)},${json(plan)},${json(r)})`);
 await check('publish requires explicit grant and exact captured plan',async()=>{await assert.rejects(pub(),/scheduler:forbidden/);await sql('UPDATE scheduler_policy.publication_grants_v2 SET enabled=true');await assert.rejects(pub({...prepared.context.plan,publishedRev:99}),/scheduler:invalid/);});
 await check('source epoch mismatch fails before commit',async()=>{await sql('UPDATE scheduler_private.publication_source_heads_v2 SET epoch=2');await assert.rejects(pub(),/scheduler:invalid/);await sql('UPDATE scheduler_private.publication_source_heads_v2 SET epoch=1');});
 await check('new adjacent draft fails expected-head check without writes',async()=>{
  await assert.rejects(sql(`BEGIN;INSERT INTO scheduler_private.heads VALUES('pilot-a','2026-09',1,0,0,null);SET ROLE scheduler_runtime;SELECT scheduler_gateway.publish_v2(${json(auth('publish'))},${lit(prepared.contextId)},${json(prepared.context.plan)},${json(receipt)});COMMIT`),/scheduler:conflict/);
  assert.equal(await sql("SELECT count(*) FROM scheduler_private.heads WHERE month='2026-09'"),'0');
 });
 await check('rollback after publication leaves all relational writes unchanged',async()=>{
  const state=()=>sql("SELECT jsonb_build_object('versions',(SELECT count(*) FROM scheduler_private.versions),'audits',(SELECT count(*) FROM scheduler_private.audit),'receipts',(SELECT count(*) FROM scheduler_private.receipts),'head',(SELECT to_jsonb(h) FROM scheduler_private.heads h),'bindings',(SELECT count(*) FROM scheduler_private.publication_bindings_v2))");
  const before=await state();await assert.rejects(rpc(`BEGIN; SELECT scheduler_gateway.publish_v2(${json(auth('publish'))},${lit(prepared.contextId)},${json(prepared.context.plan)},${json(receipt)}); SELECT 1/0; COMMIT`),/division by zero/);assert.equal(await state(),before);
 });
 await check('failure at audit insert rolls back already inserted versions',async()=>{
  const before=await sql("SELECT jsonb_build_object('v',(SELECT jsonb_agg(v) FROM scheduler_private.versions v),'a',(SELECT jsonb_agg(a) FROM scheduler_private.audit a),'h',(SELECT jsonb_agg(h) FROM scheduler_private.heads h),'r',(SELECT jsonb_agg(r) FROM scheduler_private.receipts r),'b',(SELECT jsonb_agg(b) FROM scheduler_private.publication_bindings_v2 b))");
  await sql(`CREATE FUNCTION public.synthetic_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT count(*) FROM scheduler_private.versions)<>3 THEN RAISE EXCEPTION 'fixture-not-midwrite'; END IF; RAISE EXCEPTION 'synthetic-midwrite'; END $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON scheduler_private.audit FOR EACH ROW EXECUTE FUNCTION public.synthetic_fail_audit();`);
  try{await assert.rejects(pub(),/synthetic-midwrite/);}finally{await sql('DROP TRIGGER synthetic_fail ON scheduler_private.audit;DROP FUNCTION public.synthetic_fail_audit()');}
  assert.equal(await sql("SELECT jsonb_build_object('v',(SELECT jsonb_agg(v) FROM scheduler_private.versions v),'a',(SELECT jsonb_agg(a) FROM scheduler_private.audit a),'h',(SELECT jsonb_agg(h) FROM scheduler_private.heads h),'r',(SELECT jsonb_agg(r) FROM scheduler_private.receipts r),'b',(SELECT jsonb_agg(b) FROM scheduler_private.publication_bindings_v2 b))"),before);
 });
 await check(identicalMode?'identical first publications contend, commit once and replay once':'distinct publications contend, commit once and conflict once',async()=>{
  const gate=sql("SET application_name='synthetic-gate';BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('sage-scheduler:pilot-a',0));SELECT pg_sleep(3);COMMIT");
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-gate' AND wait_event='PgSleep'",1);
  const otherRequest={...publicationRequest,requestId:'distinct'};
  const calls=Promise.allSettled([publisher.publish('synthetic-manager',publicationRequest),publisher.publish('synthetic-manager',identicalMode?publicationRequest:otherRequest)]);
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-rpc' AND wait_event_type='Lock'",2);
  await gate;const outcomes=await calls;
  if(identicalMode){assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,2);assert.deepEqual(outcomes.map(x=>x.value.replayed).sort(),[false,true]);}
  else {assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/^conflict$/);
   if(outcomes[1].status==='fulfilled')Object.assign(receipt,{key:JSON.stringify([manager,'pilot-a','2026-10','distinct']),fingerprint:hash(c113.canonicalize(otherRequest).text)});
  }
 });
 await check('concurrent identical receipt replay is idempotent',async()=>{const pair=await Promise.all([pub(),pub()]);assert.deepEqual(pair.map(x=>JSON.parse(x).replayed),[true,true]);assert.equal(await sql("SELECT count(*) FROM scheduler_private.versions"),'3');assert.equal(await sql("SELECT count(*) FROM scheduler_private.audit"),'2');});
 await check('conflicting request-id reuse denies without new writes',async()=>{await assert.rejects(pub(prepared.context.plan,{...receipt,fingerprint:hash('different-body')}),/scheduler:idempotency-conflict/);assert.equal(await sql('SELECT count(*) FROM scheduler_private.receipts'),'2');});
 await check('versioned JS composition uses server actor and rejects client identity selectors',async()=>{
  assert.throws(()=>createPublicationV2(),{code:'storage-not-configured'});
  const composition=createPublicationV2({enabled:true,identity:{verifyToken:async token=>token==='synthetic-approved'?{id:employee}:null},capturedContextFor:async()=>null,
   transport:{capabilities:{'scheduler-publication/2':true},rpc:async(name,args)=>{assert.equal(name,'own_published_v2');return {data:JSON.parse(await own(args.p_actor_id,args.p_store_id)),error:null};}}});
  const result=await composition.own('synthetic-approved',scope);assert.equal(result.revision,1);assert.deepEqual(result.days.find(x=>x.date==='2026-10-06').intervals,[[9.01*60,16.99*60]]);
  await assert.rejects(composition.own('synthetic-approved',{...scope,personId:'b'}),{code:'invalid-request'});
  await assert.rejects(composition.own('wrong',scope),{code:'unauthenticated'});
 });
 await check('own SQL reader returns frozen own days only',async()=>{const result=JSON.parse(await own());assert.equal(result.revision,1);assert.deepEqual(Object.keys(result).sort(),['days','revision','version']);assert.equal(result.days.length,31);assert.deepEqual(result.days.find(x=>x.date==='2026-10-06').intervals,[[9.01*60,16.99*60]]);assert.equal(result.days.find(x=>x.date==='2026-10-07').status,'vacation');assert.ok(!JSON.stringify(result).includes('Synthetic b'));});
 await check('changed current source does not change already published content',async()=>{
  const before=await own();await sql('UPDATE scheduler_private.publication_source_heads_v2 SET epoch=2');assert.equal(await own(),before);
 });
 await check('enabled other store still denies unlinked employee and manager',async()=>{
  await sql("INSERT INTO scheduler_policy.publication_scope_v2 VALUES('other',true)");
  await assert.rejects(own(employee,'other'),/scheduler:forbidden/);
  await assert.rejects(rpc(`SELECT scheduler_gateway.publish_v2(${json({...auth('publish'),storeId:'other'})},${lit(prepared.contextId)},${json(prepared.context.plan)},${json(receipt)})`),/scheduler:forbidden/);
 });
 for(const [kind,change,restore,attempt] of [
  ['profile',`UPDATE public.profiles SET active=false WHERE id='${employee}'`,`UPDATE public.profiles SET active=true WHERE id='${employee}'`,()=>own()],
  ['link',`DELETE FROM public.floor_people WHERE user_id='${employee}'`,`INSERT INTO public.floor_people VALUES('fictional-link','${employee}','pilot-a','a')`,()=>own()],
  ['grant',`UPDATE scheduler_policy.publication_grants_v2 SET enabled=false`,`UPDATE scheduler_policy.publication_grants_v2 SET enabled=true`,()=>pub()]
 ])await check('concurrent '+kind+' revocation blocks reader or receipt replay',async()=>{
  const revoker=sql(`SET application_name='synthetic-revoker'; BEGIN; ${change};SELECT pg_sleep(3);COMMIT`);
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-revoker' AND wait_event='PgSleep'",1);
  const denied=assert.rejects(attempt(),/scheduler:forbidden/);
  await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-rpc' AND wait_event_type='Lock'",1);
  await Promise.all([revoker,denied]);await sql(restore);assert.equal(JSON.parse(await own()).revision,1);
 });
 await check('pending inactive cross-store unlinked and revoked manager replay deny',async()=>{await sql(`UPDATE public.profiles SET pending=true WHERE id='${employee}'`);await assert.rejects(own(),/scheduler:forbidden/);await sql(`UPDATE public.profiles SET pending=false,active=false WHERE id='${employee}'`);await assert.rejects(own(),/scheduler:forbidden/);await sql(`UPDATE public.profiles SET active=true WHERE id='${employee}'`);await assert.rejects(own(employee,'other'),/scheduler:forbidden/);await sql('DELETE FROM public.floor_people');await assert.rejects(own(),/scheduler:forbidden/);await sql('UPDATE scheduler_policy.publication_grants_v2 SET enabled=false');await assert.rejects(pub(),/scheduler:forbidden/);});
 await check('runtime cannot read raw contexts or mutate identity; context immutable',async()=>{await assert.rejects(rpc('SELECT * FROM scheduler_private.publication_contexts_v2'),/permission denied/);await assert.rejects(rpc('UPDATE public.profiles SET pending=false'),/permission denied/);await assert.rejects(sql("UPDATE scheduler_private.publication_contexts_v2 SET context_text=context_text"),/immutable/);});
}catch(error){results.failure={message:error.message};console.error(error.message);process.exitCode=1;}
finally{
 if(started){try{await run(bin+'/pg_ctl',['-D',root+'/data','-w','-t','15','-m','fast','stop'],{env});const status=await run(bin+'/pg_ctl',['-D',root+'/data','status'],{env}).then(()=>0,e=>e.code);assert.equal(status,3);await rm(root,{recursive:true});results.cleanup={stopped:true,statusExit:3,removed:true,root};}catch{results.cleanup={stopped:false,removed:false,root};process.exitCode=1;}}
 else {await rm(root,{recursive:true});results.cleanup={neverStarted:true,removed:true,root};}
 await writeFile(new URL(identicalMode?'./sql-identical-results.json':'./sql-results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.checks.length,cleanup:results.cleanup}));
}
