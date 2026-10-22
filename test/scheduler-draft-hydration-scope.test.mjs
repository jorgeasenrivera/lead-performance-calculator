// Candidate scope regression with synthetic codec; no C113 compatibility claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from '../scripts/scheduler-performance/month-model.mjs';
import {createSchedulerDraftBinding} from '../src/scheduler-draft-binding.mjs';
import {createSchedulerDraftTransport} from '../src/scheduler-draft-transport.mjs';
const make=(timezone='America/New_York')=>createPlanner([{id:'fixture',name:'Fixture',timezone,history:[],people:[{id:'a',name:'A',off:[],start:9,end:17,maxHours:40}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,closedDays:[],holidays:{}}],teams:[],memberships:[]}],{assignmentForDay:()=>null});
const projection=p=>p.exportMonth(0,'2026-11').projection;
function fixture(verify,remote){
 const p=make();let pending=false,calls=0;
 const auth={getSnapshot:()=>({principalEpoch:1,disposed:false}),getAccessToken:async()=> 'synthetic',subscribe:()=>()=>{}};
 const transport=createSchedulerDraftTransport({auth,codec:{validateScope:()=>true,encode:v=>v,decode:v=>v},requestId:()=> 'synthetic-id',fetchImpl:async()=>{calls++;return {status:200,json:async()=>({result:{kind:'draft',revision:1,schedule:remote||projection(p)}})}}});
 const handle={exportMonth:(m,i)=>({ok:true,...p.exportMonth(i,m)}),hydrateMonth:(v,i,scope)=>p.hydrateMonth(i,v,verify,scope),acknowledgeMonth:(m,t,i)=>p.acknowledgeMonth(i,m,t),draftStatus:i=>({ok:true,...p.draftStatus(i),pending}),hasDraft:()=>p.unsaved||pending};
 const binding=createSchedulerDraftBinding({auth,transport,getEditor:()=>handle,storeId:'fixture',lifetime:'test'});
 return {p,binding,setPending:v=>pending=v,calls:()=>calls};
}

const scope=Object.freeze({storeId:'fixture',month:'2026-11'});
const both=p=>['2026-11','2026-12'].map(m=>p.exportMonth(0,m).projection);
for(const [name,change,verify] of [
 ['raw wrong month',v=>({...v,month:'2026-12'}),v=>v],
 ['raw wrong store',v=>({...v,storeId:'other'}),v=>v],
 ['redirected month',v=>v,v=>({...v,month:'2026-12'})],
 ['redirected store',v=>v,v=>({...v,storeId:'other'})],
 ['throws',v=>v,()=>{throw Error('refused')}],
 ['Promise',v=>v,async v=>v],
]) {
 test(`scope refusal leaves both months, dirty state and tokens unchanged: ${name}`,()=>{
  const p=make();p.setAssignment(0,'2026-12-10',{on:['a'],off:[]});
  const before=both(p),status=p.draftStatus(0),token=p.exportMonth(0,'2026-12').token;
  assert.equal(p.hydrateMonth(0,change(structuredClone(before[0])),verify,scope).ok,false);
  assert.deepEqual(both(p),before);assert.deepEqual(p.draftStatus(0),status);
  assert.equal(p.acknowledgeMonth(0,'2026-12',token).ok,true);
 });
 test(`binding refuses without accepting or altering either month: ${name}`,async()=>{
  const f=fixture(verify,change(projection(make()))),before=both(f.p);
  await f.binding.load('2026-11');assert.equal(f.binding.getSnapshot().months[0].loadAccepted,false);
  assert.deepEqual(both(f.p),before);f.binding.dispose();
 });
}
test('raw scope mismatch does not invoke verifier; trusted scope is captured before caller code',()=>{
 const p=make(),v=projection(p);let calls=0;
 assert.equal(p.hydrateMonth(0,{...v,month:'2026-12'},()=>{calls++;return true},scope).ok,false);assert.equal(calls,0);
 const expected={...scope};assert.equal(p.hydrateMonth(0,v,x=>{expected.month='2026-12';return {...x,month:'2026-12'}},expected).ok,false);
});
test('valid matching hydration works; dirty target refusal and opaque tokens remain intact',async()=>{
 const f=fixture(v=>v);await f.binding.load('2026-11');assert.equal(f.binding.getSnapshot().months[0].loadAccepted,true);f.binding.dispose();
 for(const verify of [v=>v,()=>true]) {
  const p=make(),incoming=projection(p);assert.equal(p.hydrateMonth(0,incoming,verify,scope).ok,true);
  p.setAssignment(0,'2026-11-10',{on:['a'],off:[]});const e=p.exportMonth(0,'2026-11');
  assert.equal(p.hydrateMonth(0,incoming,verify,scope).reason,'unsaved-changes');
  assert.deepEqual(projection(p),e.projection);
  assert.equal(p.acknowledgeMonth(0,'2026-11',structuredClone(e.token)).ok,false);
  assert.equal(p.acknowledgeMonth(0,'2026-11',e.token).ok,true);
 }
});
test('missing timezone is still refused without adding a default',()=>{
 const p=make(),before=both(p),v=structuredClone(before[0]);delete v.store.timezone;
 assert.equal(p.hydrateMonth(0,v,x=>x,scope).ok,false);assert.deepEqual(both(p),before);
});
