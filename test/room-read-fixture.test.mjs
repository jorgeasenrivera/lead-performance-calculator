import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoomFixture,installRoomReadFixture} from '../scripts/room-read-fixture.mjs';
const body={op:'read',store:'sage-demo',date:'2026-10-14',room:'floor',view:'manager'};
const req=(b=body)=>({url:()=> 'http://127.0.0.1:5178/api/floor-row',method:()=> 'POST',headers:()=>({authorization:'Bearer mock-token'}),postData:()=>JSON.stringify(b)});
const backing=(rows,status=200)=>({request:{get:async(url,opts)=>{assert.equal(new URL(url).origin,'http://127.0.0.1:5433');assert.equal(new URL(url).searchParams.get('id'),'eq.sage-demo:2026-10-14');assert.equal(opts.maxRedirects,0);assert.equal(opts.timeout,15000);return {status:()=>status,body:async()=>Buffer.from(JSON.stringify(rows))};}}});
test('floor and line reads, unchanged stamps, changed data and true absence',async()=>{
 for(const room of ['floor','line']){
  const row={id:'sage-demo:2026-10-14',data:{line:[{id:'fictional',status:'waiting'}]},updated_at:'2026-10-14T09:00:00Z'};
  const ctx=backing([row]);const response=await readRoomFixture(ctx,req({...body,room}));
  assert.deepEqual(response.row,row.data);
  assert.deepEqual(await readRoomFixture(ctx,req({...body,room,stamp:response.stamp})),{same:true,stamp:response.stamp});
  row.data.line[0].status='customer';
  const changed=await readRoomFixture(ctx,req({...body,room,stamp:response.stamp}));assert.notEqual(changed.stamp,response.stamp);
  assert.deepEqual(await readRoomFixture(backing([]),req({...body,room})),{row:null,stamp:'missing'});
 }
});
test('non-200 and malformed backing responses refuse, never invent an empty room',async()=>{
 for(const status of [302,401,403,404,500])await assert.rejects(readRoomFixture(backing([],status),req()),/read-status/);
 for(const rows of [null,{},[{id:'wrong',data:{}}],[{id:'sage-demo:2026-10-14',data:null}],[{id:'sage-demo:2026-10-14',data:[]}],[{},{}]])await assert.rejects(readRoomFixture(backing(rows),req()),/read-shape/);
});
test('write operations, wrong scope/date/view and nonmock identity refuse before reads',async()=>{
 let reads=0;const ctx={request:{get:async()=>{reads++;throw Error('should not read');}}};
 for(const patch of [{op:'write'},{store:'another-store'},{date:'2026-10-15'},{view:'own'},{room:'online'},{extra:true}])await assert.rejects(readRoomFixture(ctx,req({...body,...patch})),/request/);
 const wrong=req();wrong.headers=()=>({authorization:'Bearer wrong'});await assert.rejects(readRoomFixture(ctx,wrong),/request/);assert.equal(reads,0);
});
test('invalid backing aborts and remains a terminal refusal',async()=>{
 let handler,aborted=0;const ctx={...backing([],404),route:async(_,h)=>{handler=h;}};
 const fx=await installRoomReadFixture(ctx,{log(){}});
 await handler({request:()=>req(),abort:async()=>{aborted++;},fulfill:async()=>assert.fail('must not fulfill')});
 assert.equal(aborted,1);assert.throws(()=>fx.assertNoRefusals());
});
test('pending backing read cannot pass terminal verdict; completed successful read can',async()=>{
 let handler,release;const pending=new Promise(resolve=>{release=resolve;});
 const ctx={request:{get:()=>pending},route:async(_,h)=>{handler=h;}};
 const fx=await installRoomReadFixture(ctx,{log(){}});
 const work=handler({request:()=>req(),fulfill:async()=>{},abort:async()=>assert.fail('unexpected abort')});
 assert.throws(()=>fx.assertNoRefusals());
 release({status:()=>200,body:async()=>Buffer.from('[]')});await work;fx.assertNoRefusals();
});
test('fulfillment and unexpected handler failures latch while preserving original errors',async()=>{
 for(const kind of ['fulfill','request']){
  let handler;const original=new Error('fictional '+kind+' failure');
  const ctx={...backing([]),route:async(_,h)=>{handler=h;}};
  const fx=await installRoomReadFixture(ctx,{log(){}});
  await assert.rejects(handler({request:()=>{if(kind==='request')throw original;return req();},fulfill:async()=>{throw original;},abort:async()=>assert.fail('unexpected abort')}),e=>e===original);
  assert.throws(()=>fx.assertNoRefusals());
 }
});
