import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://release.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
let state;
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
 const u=new URL(String(input)),q=u.searchParams,m=options.method||'GET';
 assert.equal(u.origin,'https://release.invalid');
 const body=options.body?JSON.parse(options.body):null;
 state.requests.push({u,m,body});
 if(u.pathname==='/auth/v1/user')return response({id:'actor'});
 const table=u.pathname.split('/').pop();
 if(table===state.error)return response({message:'synthetic failure'},500);
 if(table==='sage_room_commit'){
  assert.equal(body.p_actor,'actor');assert.equal(body.p_person,'self');assert.equal(body.p_store,'alpha');assert.equal(body.p_expected,state.stamp);
  state.writes.push({data:body.p_next,expected:body.p_expected,operationId:body.p_operation_id});
  if(state.denyCommit)return response({code:'42501'},403);
  if(state.race){state.race=false;state.stamp='2099-01-01T00:00:00.002Z';state.row.line[1].status='lunch';state.row.history.push({action:'competitor-change',id:'other'});return response({code:'40001'},409);}
  return response({ok:true,row:body.p_next});
 }
 if(table==='profiles')return response(state.profile?[state.profile]:[]);
 if(table==='floor_people')return response(state.link?[{store:'alpha',person_id:'self'}]:[]);
 if(table==='app_data'){
  if(q.get('key')==='eq.lpc:store:alpha:v2'&&state.figuresError)return response({message:'synthetic figures failure'},500);
  if(q.get('key')==='eq.lpc:store:alpha:v2'&&state.figuresMissing)return response([{}]);
  return response([{value:q.get('key')==='eq.lpc:config:v2'?state.config:(state.figures||{roster:[]})}]);
 }
 if(['floor_public','queue_public'].includes(table)){
  const dc=table==='floor_public'?'fdate':'qdate';
  if(m==='POST'){state.writes.push(body);if(state.duplicate){state.inserted=true;return response({code:'23505',message:'synthetic duplicate'},409);}return response([]);}
  assert.equal(q.get('store'),'eq.alpha');assert.ok(q.get(dc)?.startsWith('eq.'));
  const date=q.get(dc).slice(3),id=q.get('id').slice(3);
  assert.ok(id===`alpha:${date}`||id===`alpha:${date}:online`);
  if(m==='GET'){
   if(state.inserted){if(state.duplicate==='error')return response({message:'synthetic winner read failure'},500);if(state.duplicate==='matching')return response([{id}]);return response([]);}
   if(!state.row||state.malformed)return response([]);
   return response([{id,data:state.row,updated_at:state.stamp}]);
  }
  assert.equal(m,'PATCH');assert.equal(q.get('updated_at'),`eq.${state.stamp}`);
  assert.ok(Date.parse(body.updated_at)>Date.parse(state.stamp));
  state.writes.push(body);
  if(state.race){state.race=false;state.stamp='2099-01-01T00:00:00.002Z';state.row.line[1].status='lunch';state.row.history.push({action:'competitor-change',id:'other'});return response([]);}
  return response([{id}]);
 }
 assert.fail(`Unexpected request ${m} ${u.pathname}`);
};
const {default:open}=await import('../api/open-room.mjs');
const {default:read}=await import('../api/floor-row.mjs');
const {default:action}=await import('../api/queue-action.mjs');
beforeEach(()=>{state={requests:[],writes:[],profile:{active:true,pending:true,role:'associate',stores:[]},link:true,stamp:'2099-01-01T00:00:00.001Z',config:{stores:[{id:'alpha',rooms:{floor:true,line:true,online:true},hours:Object.fromEntries(['floor','line'].map(room=>[room,Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(day=>[day,'00:00']))]))}]}};});
async function call(fn,body){const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await fn({method:'POST',headers:{authorization:'Bearer synthetic-session'},body},res);return res;}
for(const error of ['profiles','floor_people','app_data','floor_public'])test(`open-room ${error} read fails closed`,async()=>{state.error=error;const r=await call(open,{store:'alpha',room:'floor'});assert.equal(r.code,500);assert.equal(state.writes.length,0);});
for(const kind of ['inactive','missing','foreign'])test(`open-room ${kind} denied`,async()=>{if(kind==='inactive')state.profile.active=false;if(kind==='missing')state.profile=null;if(kind==='foreign')state.link=false;assert.equal((await call(open,{store:'alpha'})).code,403);assert.equal(state.writes.length,0);});
test('open-room active pending linked staff can open the line',async()=>{const r=await call(open,{store:'alpha',room:'line'});assert.equal(r.code,200);assert.equal(r.body.made,true);assert.equal(state.writes[0].id,`alpha:${state.writes[0].qdate}`);});
test('open-room preserves disabled online policy',async()=>{assert.equal((await call(open,{store:'alpha',room:'online'})).code,400);assert.equal(state.writes.length,0);});
test('floor-row online uses its independent canonical suffix',async()=>{state.row={line:[]};assert.equal((await call(read,{op:'read',store:'alpha',room:'online',date:'2026-10-24'})).code,200);assert.ok(state.requests.at(-1).u.searchParams.get('id').endsWith(':online'));});
for(const error of ['profiles','floor_people','floor_public'])test(`floor-row ${error} lookup fails closed`,async()=>{state.error=error;assert.equal((await call(read,{op:'read',store:'alpha',room:'floor',date:'2026-10-24'})).code,500);});
test('floor-row mismatched stored scope cannot be returned',async()=>{state.row={secret:'foreign'};state.malformed=true;const r=await call(read,{op:'read',store:'alpha',room:'floor',date:'2026-10-24'});assert.equal(r.code,200);assert.equal(r.body.row,null);});
for(const body of ['{',null,{store:'alpha:other',date:'2026-10-24',action:'lunch'},{store:'alpha',date:'2026-02-30',action:'lunch'},{store:['alpha'],date:'2026-10-24',action:'lunch'}])test(`queue-action rejects malformed input ${JSON.stringify(body)}`,async()=>{assert.equal((await call(action,body)).code,400);assert.equal(state.requests.length,0);});
for(const act of ['lunch','back-line'])test(`queue-action ${act} scopes rows and advances stamp after CAS race`,async()=>{state.row={line:[{id:'self',label:'Synthetic',status:'away'},{id:'other',status:'waiting'}],history:[]};state.race=true;const r=await call(action,{store:'alpha',date:'2026-10-24',action:act,person_id:'other'});assert.equal(r.code,200);assert.equal(state.writes.length,2);assert.equal(state.writes[0].data.line[1].status,'waiting');assert.equal(state.writes[1].data.line[1].status,'lunch');assert.ok(state.writes[1].data.history.some(e=>e.action==='competitor-change'&&e.id==='other'));assert.equal(state.writes[1].expected,'2099-01-01T00:00:00.002Z');assert.equal(state.writes[0].operationId,state.writes[1].operationId);});

for(const duplicate of ['matching','mismatch','error'])test(`open-room duplicate insert verifies ${duplicate} winner`,async()=>{state.duplicate=duplicate;const r=await call(open,{store:'alpha',room:'floor'});assert.equal(r.code,duplicate==='matching'?200:409);if(duplicate==='matching')assert.equal(r.body.made,false);assert.equal(state.writes.length,1);assert.equal(state.requests.filter(x=>x.u.pathname==='/rest/v1/floor_public'&&x.m==='GET').length,2);});
test('floor-row mismatched scope never acknowledges supplied matching stamp',async()=>{state.row={secret:'foreign'};state.malformed=true;const r=await call(read,{op:'read',store:'alpha',room:'floor',date:'2026-10-24',stamp:state.stamp});assert.equal(r.code,200);assert.equal(r.body.row,null);assert.notEqual(r.body.same,true);});
for(const failure of ['figuresError','figuresMissing'])test(`phoneGate ${failure} on second app_data read refuses without PATCH`,async()=>{state[failure]=true;state.row={line:[{id:'self',label:'Synthetic',status:'waiting'}],history:[]};const r=await call(action,{store:'alpha',date:'2026-10-24',action:'take-desk'});assert.equal(r.code,500);const reads=state.requests.filter(x=>x.u.pathname==='/rest/v1/app_data');assert.equal(reads.length,2);assert.equal(reads[0].u.searchParams.get('key'),'eq.lpc:config:v2');assert.equal(reads[1].u.searchParams.get('key'),'eq.lpc:store:alpha:v2');assert.equal(state.requests.filter(x=>x.m==='PATCH').length,0);});

test('legacy native action surfaces transactional authorization refusal without raw PATCH',async()=>{state.denyCommit=true;state.row={line:[{id:'self',status:'waiting'}],history:[]};const r=await call(action,{store:'alpha',date:'2026-10-24',action:'lunch'});assert.equal(r.code,403);assert.equal(state.requests.filter(x=>x.m==='PATCH').length,0);});

for (const kind of ['below-standard', 'already waiting']) test(`native queue acknowledgment ${kind} is a completed no-op without a write`, async () => {
 state.config.stores[0].graceDays=0;
 state.row={line:[{id:'self',label:'Synthetic',status:'waiting'}],roster:[{id:'self',name:'Synthetic'}],history:[]};
 const {storeDay}=await import('../api/_floor-access.mjs');
 state.figures={months:{[storeDay().slice(0,7)]:{stats:{synthetic:{phoneLeads:20,phoneUnits:0}}}}};
 const before=structuredClone(state.row);
 const r=await call(action,{store:'alpha',date:'2026-10-24',action:kind==='below-standard'?'take-desk':'back-line'});
 assert.equal(r.code,200); assert.equal(r.body.ok,true); assert.equal(r.body.changed,false); assert.equal(r.body.why,kind);
 assert.equal(state.writes.length,0); assert.deepEqual(state.row,before);
});
