/* Read-only room fixture for the fixed 14 October spacing scenario. This serves
   synthetic mock rows, not the production endpoint or its authorization policy. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const APP='http://127.0.0.1:5178', MOCK='http://127.0.0.1:5433';
const WORDS=['request','read-status','read-shape','read-error','handler-error','respond-error'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
class Refused extends Error {}
export async function readRoomFixture(context, req) {
  let body;
  try {body=JSON.parse(req.postData());}catch{throw new Refused('request');}
  if(req.url()!==APP+'/api/floor-row'||req.method()!=='POST'||req.headers().authorization!=='Bearer mock-token'||!plain(body)
    ||Object.keys(body).some(k=>!['op','store','date','room','view','stamp'].includes(k))
    ||body.op!=='read'||body.store!=='sage-demo'||body.date!=='2026-10-14'||!['floor','line'].includes(body.room)||body.view!=='manager'
    ||(body.stamp!==undefined&&body.stamp!==null&&(typeof body.stamp!=='string'||body.stamp.length>200)))throw new Refused('request');
  const table=body.room==='floor'?'floor_public':'queue_public',id=body.store+':'+body.date;
  const url=new URL(MOCK+'/rest/v1/'+table);url.searchParams.set('select','id,data,updated_at');url.searchParams.set('id','eq.'+id);
  let response,bytes;
  try {response=await context.request.get(url.href,{maxRedirects:0,timeout:15000,failOnStatusCode:false});}
  catch{throw new Refused('read-error');}
  if(response.status()!==200)throw new Refused('read-status');
  try {bytes=await response.body();}catch{throw new Refused('read-error');}
  if(bytes.length>1024*1024)throw new Refused('read-shape');
  let rows;
  try{rows=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new Refused('read-shape');}
  if(!Array.isArray(rows)||rows.length>1||rows.some(r=>!plain(r)||r.id!==id||!plain(r.data)))throw new Refused('read-shape');
  if(!rows.length)return {row:null,stamp:'missing'};
  // The simple mock does not advance updated_at on every write; bind content too.
  const stamp='fixture:'+createHash('sha256').update(JSON.stringify(rows[0])).digest('hex');
  return body.stamp===stamp?{same:true,stamp}:{row:rows[0].data,stamp};
}
export async function installRoomReadFixture(context,{appOrigin=APP,log=console.error}={}){
  assert.equal(new URL(appOrigin).origin,APP,'room fixture requires the fixed loopback preview');
  const counts=Object.fromEntries(WORDS.map(w=>[w,0]));
  let inflight=0;
  const record=word=>{counts[word]=Math.min(1000,counts[word]+1);try{log('room-fixture: '+word);}catch{}};
  await context.route(APP+'/api/floor-row',async route=>{
    inflight++;let phase='handler-error';
    try {
      const json=await readRoomFixture(context,route.request());
      phase='respond-error';
      await route.fulfill({status:200,json});
    } catch(e) {
      if(!(e instanceof Refused)){record(phase);throw e;}
      record(e.message);
      try{await route.abort('failed');}catch(abortError){record('handler-error');throw abortError;}
    } finally {inflight--;}
  });
  return {assertNoRefusals(){assert.ok(inflight===0&&Object.values(counts).every(n=>n===0),'room fixture refused a request or has an unfinished request');}};
}
