// Synthetic fixture derived from run-pg-sql.mjs at carrier63ddf9f. No runtime import.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createSchedulerPgTransport} from '../../api/_scheduler-pg-transport.mjs';
import {createSchedulerCapturePort} from '../../api/_scheduler-capture-port.mjs';
import {createManualSchedulerServer} from '../../api/_scheduler-manual-server.mjs';
import {originalC113 as c113} from '../../api/_scheduler-c113.mjs';
export const ids={manager:'00000000-0000-4000-8000-000000000001',employee:'00000000-0000-4000-8000-000000000002',pending:'00000000-0000-4000-8000-000000000003'};
export const scope={storeId:'pilot-a',month:'2026-10'};
const at='2026-10-22T17:30:00Z';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function fixtureSession(kind){
 const id=ids[kind];assert.ok(id);
 const claims=Buffer.from(JSON.stringify({sub:id,session_id:id})).toString('base64url');
 return {access_token:'synthetic.'+claims+'.fixture',user:{id}};
}
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

export async function createBrowserFixture({socket,dataDirectory,expectedVersion}){
 // Only our job's private socket is accepted. No URL/env-derived database options.
 assert.match(socket,/^\/tmp\/sage-manual-[A-Za-z0-9_-]+\/socket$/);
 assert.match(dataDirectory,/^\/tmp\/sage-manual-[A-Za-z0-9_-]+\/data$/);
 assert.ok(Number.isSafeInteger(expectedVersion)&&[16,17].includes(Math.floor(expectedVersion/10000)));
 const options={host:socket,port:5432,database:'postgres',user:'delivery_fixture',password:'fake-unused',ssl:false,max:4,connectionTimeoutMillis:3000};
 const owner=new Pool(options);let transport;
 const close=async()=>{try{if(transport)await transport.close();}finally{await owner.end();}};
 const q=(text,values)=>owner.query(text,values);
 try{
 const meta=(await q("SELECT current_setting('listen_addresses') AS listen,current_setting('data_directory') AS dir,current_setting('server_version_num')::int AS version")).rows[0];
 assert.equal(meta.listen,'');assert.equal(meta.dir,dataDirectory);assert.equal(meta.version,expectedVersion);
 assert.equal((await q("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='scheduler_private'")).rows[0].n,0);
 for(const file of ['../../test/matching-profile-fixture.sql','../../supabase/reference/scheduler-draft-structure.sql','../scheduler-delivery-relational/publication-v2.sql','../scheduler-source-capture/capture.sql','./policy.sql']){
  if(file.includes('scheduler-draft-structure'))await q('CREATE TABLE public.floor_people(id text PRIMARY KEY,user_id uuid REFERENCES public.profiles(id),store text,person_id text,UNIQUE(store,user_id),UNIQUE(store,person_id));ALTER TABLE public.floor_people ENABLE ROW LEVEL SECURITY');
  await q(await readFile(new URL(file,import.meta.url),'utf8'));
 }
 await q("INSERT INTO auth.users VALUES($1)",[ids.pending]);
 await q("INSERT INTO public.profiles(id,role,active,pending) VALUES($1,'overseer',true,false),($2,'overseer',true,true)",[ids.employee,ids.pending]);
 await q("INSERT INTO public.floor_people VALUES('employee-link',$1,'pilot-a','a'),('pending-link',$2,'pilot-a','b')",[ids.employee,ids.pending]);
 await q("INSERT INTO scheduler_policy.publication_scope_v2 VALUES('pilot-a',true);INSERT INTO scheduler_policy.publication_grants_v2 VALUES('"+ids.manager+"','pilot-a',true);INSERT INTO scheduler_policy.pilot_scope(actor_id,approved_store_ids,enabled) VALUES('"+ids.manager+"',ARRAY['pilot-a'],true);INSERT INTO scheduler_policy.draft_grants VALUES('"+ids.manager+"','pilot-a','draft-save',true),('"+ids.manager+"','pilot-a','draft-read',true)");
 // Target starts explicitly off. Existing reviewed hours, roles and boundary rules remain.
 const seed=structuredClone(draft);seed.overrides['2026-10-05'].on=['b'];seed.overrides['2026-10-05'].off=['a'];seed.overrides['2026-10-05'].shifts=seed.overrides['2026-10-05'].shifts.filter(x=>x.personId==='b');
 for(const month of ['2026-09','2026-10','2026-11']){
  const d={...structuredClone(seed),month,overrides:month==='2026-10'?seed.overrides:{}};
  const saved=c113.planDraftSave({storeId:scope.storeId,month,draft:d,baseRev:0,head:null,actor:{id:ids.manager},at,prevAuditHash:null});assert.equal(saved.ok,true);
  await q('SELECT scheduler_gateway.scheduler_commit($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)',[
   JSON.stringify({actorId:ids.manager,action:'save',storeId:scope.storeId,month,readKind:null}),JSON.stringify({head:null,prevAuditHash:null,auditRevision:0}),JSON.stringify(saved.plan),JSON.stringify({key:JSON.stringify([ids.manager,scope.storeId,month,'seed']),fingerprint:hash(month),result:{head:saved.plan.resultingHead}})]);
 }
 await q('INSERT INTO public.app_data(key,value) VALUES($1,$2::jsonb)',['lpc:store:pilot-a:v2',JSON.stringify({roster:[{id:'a',name:'Synthetic a',roleId:'sales'},{id:'b',name:'Synthetic b',roleId:'sales'}],daysOff:{a:['2026-10-07']},activity:{}})]);
 const capturePort=createSchedulerCapturePort({query:q});
 await capturePort.putPolicy({storeId:scope.storeId,expected:null,replacement:{version:'scheduler-manual-policy/1',months:{'2026-09':null,'2026-10':{people:{a:{eligible:true,roles:['sales','support']},b:{eligible:true,roles:['sales','support']}},requiredRoles:{sales:1}},'2026-11':null}},requestId:'fixture-policy'});
 const pool=new Pool({...options,options:'-c role=scheduler_runtime'});
 transport=createSchedulerPgTransport({pool,publicationV2:true});
 assert.equal((await pool.query('SELECT current_user AS role')).rows[0].role,'scheduler_runtime');
 const tokens=new Map(Object.keys(ids).map(k=>[fixtureSession(k).access_token,ids[k]]));
 const identityDb={auth:{getUser:async token=>({data:{user:tokens.has(token)?{id:tokens.get(token)}:null},error:null})},from:()=>({select:()=>({eq:(_key,id)=>({maybeSingle:async()=>({data:(await q('SELECT * FROM public.profiles WHERE id=$1',[id])).rows[0]||null,error:null})})})})};
 const handler=createManualSchedulerServer({enabled:true,identityDb,transport,capturePort,draftPermissionFor:async a=>(await q('SELECT 1 FROM scheduler_policy.draft_grants WHERE actor_id=$1 AND store_id=$2 AND permission=$3 AND enabled',[a.actorId,a.storeId,a.permission])).rowCount===1,publishPermissionFor:async a=>(await q('SELECT 1 FROM scheduler_policy.publication_grants_v2 WHERE actor_id=$1 AND store_id=$2 AND enabled',[a.actorId,a.storeId])).rowCount===1,now:()=>at});
 return {handler,close,setPending:async value=>q('UPDATE public.profiles SET pending=$1 WHERE id=$2',[value,ids.employee])};
 }catch(error){await close();throw error;}
}
