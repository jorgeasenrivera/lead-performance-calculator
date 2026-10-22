import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualClient,ownScheduleResult} from '../../src/scheduler-manual-client.mjs';
function fixture(fetchImpl){
 let notify;const token='fake.'+Buffer.from(JSON.stringify({sub:'synthetic-a',session_id:'00000000-0000-4000-8000-000000000001'})).toString('base64url')+'.fake';
 const session={access_token:token,user:{id:'synthetic-a'}};
 let disposed=0;
 const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{notify=fn;return {data:{subscription:{unsubscribe(){disposed++;}}}};}}};
 return {api:createManualClient(client,{fetchImpl}),notify:(...x)=>notify(...x),disposed:()=>disposed};
}
test('same-origin manual POST sends exact command once and disposes auth',async()=>{
 const calls=[],f=fixture(async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({done:true})};});
 const command={action:'own',storeId:'pilot-a',month:'2026-10'};
 assert.deepEqual(await f.api.send(command),{done:true});assert.equal(calls.length,1);
 const {url,init}=calls[0];assert.equal(url,'/api/scheduler-manual');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.mode,'same-origin');assert.equal(init.cache,'no-store');assert.deepEqual(JSON.parse(init.body),command);
 f.api.dispose();assert.equal(f.disposed(),1);
});
test('no automatic retries for denial, conflict, network loss or non-JSON response',async()=>{
 for(const outcome of [403,409,503,'network','nonJSON']){
  let count=0;const f=fixture(async()=>{count++;if(outcome==='network')throw Error('synthetic');return {ok:outcome==='nonJSON',status:outcome,json:async()=>{throw Error('raw synthetic response');}};});
  await assert.rejects(f.api.send({action:'own'}));assert.equal(count,1);f.api.dispose();
 }
});
test('auth change rejects in-flight old-user response',async()=>{
 let release,started;const ready=new Promise(r=>started=r);
 const f=fixture(async()=>{started();return new Promise(r=>release=r);});
 const result=f.api.send({action:'own'});await ready;f.notify('SIGNED_OUT',null);
 release({ok:true,json:async()=>({private:'old-user'})});await assert.rejects(result,/access changed/);f.api.dispose();
});
test('own DTO only accepts scoped bounded day fields; fractional legacy intervals preserved',()=>{
 const r={version:'scheduler-own/2',revision:1,days:[{date:'2026-10-05',status:'working',timezone:'America/New_York',intervals:[[540.5,1020]]}]};
 assert.equal(ownScheduleResult(r,'2026-10').schedule[0].intervals[0][0],540.5);
 for(const mutate of [x=>x.personId='other',x=>x.days[0].date='2026-11-01',x=>x.days[0].intervals=[[2,1]],x=>x.days.push(x.days[0]),x=>x.days[0].status='off',x=>x.revision=0]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>ownScheduleResult(bad,'2026-10'));}
});
