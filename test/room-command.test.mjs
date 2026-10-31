import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {storeDay} from '../api/_floor-access.mjs';
process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
let state; const day=storeDay(); const actor='00000000-0000-4000-8000-000000000001';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);const method=options.method||'GET';state.requests.push(u.pathname);
 if(u.pathname==='/auth/v1/user')return json({id:actor});
 if(u.pathname==='/rest/v1/profiles')return json(state.profile?[state.profile]:[]);
 if(u.pathname==='/rest/v1/floor_people')return json(state.link?[{person_id:'self'}]:[]);
 if(u.pathname==='/rest/v1/app_data'){
  if(state.configError)return json({code:'XX000',message:'synthetic'},500);
  if(u.searchParams.get('key')==='eq.lpc:config:v2')return json([{value:{stores:[{id:'alpha'}]}}]);
  return json([{value:{synthetic:{calls:16,video:2,rocked:true,uploadedAt:'2026-10-01T00:00:00Z'}}}]);
 }
 if(u.pathname==='/rest/v1/floor_public'){
  assert.equal(u.searchParams.get('id'),`eq.alpha:${day}`);assert.equal(u.searchParams.get('store'),'eq.alpha');assert.equal(u.searchParams.get('fdate'),`eq.${day}`);
  return json([{data:state.row,updated_at:state.stamp}]);
 }
 if(u.pathname==='/rest/v1/rpc/sage_room_receipt'){state.receiptArgs=JSON.parse(options.body);return state.receiptError?json({code:state.receiptError},403):json(state.receipt||null);}
 if(u.pathname==='/rest/v1/rpc/sage_room_commit'){
  assert.equal(method,'POST');const args=JSON.parse(options.body);state.commits.push(args);
  if(state.denyCommit)return json({code:'42501',message:'synthetic revocation'},403);
  if(state.race){state.race=false;state.row.history.push({id:'other',action:'concurrent'});state.stamp='2026-10-01T00:00:01Z';return json({code:'40001',message:'synthetic conflict'},409);}
  const {presence,...row}=args.p_next;return json({ok:true,row});
 }
 throw new Error(`Unexpected intercepted request ${method} ${u.pathname}`);
};
const {default:handler}=await import('../api/room-command.mjs');
const operationId='00000000-0000-4000-8000-000000000099';
const call=async(patch={})=>{const r={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await handler({method:'POST',headers:{authorization:'Bearer synthetic'},body:{store:'alpha',room:'floor',date:day,action:'join',operationId,...patch}},r);return r;};
beforeEach(()=>{state={profile:{active:true},link:true,requests:[],commits:[],stamp:'2026-10-01T00:00:00Z',row:{store:'alpha',date:day,roster:[{id:'self',name:'Synthetic',label:'Synthetic'},{id:'other',name:'Other'}],line:[],history:[],presence:{events:[{kind:'offday'}]}}};});
test('actual handler derives person and actor, omits private presence response',async()=>{
 const r=await call({personId:'other',actor:'forged',input:{personId:'other'}});assert.equal(r.code,200);assert.equal(r.body.row.line[0].id,'self');assert.equal(r.body.row.presence,undefined);assert.equal(state.commits[0].p_actor,actor);assert.equal(state.commits[0].p_person,'self');
});
for(const kind of ['inactive','missing','unlinked'])test(`${kind} refuses before mutation`,async()=>{
 if(kind==='inactive')state.profile.active=false;if(kind==='missing')state.profile=null;if(kind==='unlinked')state.link=false;
 assert.equal((await call()).code,403);assert.equal(state.commits.length,0);
});
test('missing operation ID and foreign canonical key reject before backend',async()=>{
 assert.equal((await call({operationId:null})).code,400);assert.equal((await call({store:'alpha:foreign'})).code,400);assert.equal(state.requests.length,0);
});
test('current config error refuses without commit',async()=>{state.configError=true;assert.equal((await call()).code,500);assert.equal(state.commits.length,0);});
test('transactional revocation refusal is surfaced',async()=>{state.denyCommit=true;assert.equal((await call()).code,403);});
test('retry reads current row and retains competing change',async()=>{state.race=true;const r=await call();assert.equal(r.code,200);assert.equal(state.commits.length,2);assert.equal(state.commits[0].p_operation_id,state.commits[1].p_operation_id);assert.ok(state.commits[1].p_next.history.some(x=>x.action==='concurrent'));assert.ok(!r.body.row.history.some(x=>x.id==='other'));});
test('checkout figures come from server, not supplied counts',async()=>{const r=await call({action:'checkout',input:{calls:999,units:999}});assert.equal(r.code,200);assert.equal(r.body.row.checkouts[0].calls,16);assert.equal(r.body.row.checkouts[0].units,undefined);});

test('durable replay is recovered before changed date/config/roster gates',async()=>{
 state.receipt={ok:true,row:{store:'alpha',date:'2020-01-01',line:[]}};state.configError=true;state.row.roster=[];
 const r=await call({date:'2020-01-01'});assert.equal(r.code,200);assert.equal(r.body.row.date,state.receipt.row.date);assert.deepEqual(r.body.row.line,[]);assert.equal(state.commits.length,0);assert.ok(!state.requests.includes('/rest/v1/app_data'));assert.equal(state.receiptArgs.p_actor,actor);
});
test('historical new command is refused after receipt miss, without mutation',async()=>{assert.equal((await call({date:'2020-01-01'})).code,400);assert.equal(state.commits.length,0);assert.ok(!state.requests.includes('/rest/v1/app_data'));});
test('receipt authorization refusal cannot fall through into mutation',async()=>{state.receiptError='42501';assert.equal((await call()).code,403);assert.equal(state.commits.length,0);assert.ok(!state.requests.includes('/rest/v1/app_data'));});
