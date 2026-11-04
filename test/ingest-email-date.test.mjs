import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ingest.mjs';
import {storeKey,actKey,floorStatsKey} from '../api/_store-keys.mjs';
const SECRET='fixture-secret', STORE={id:'demo',name:'Demo Motors'}, NativeDate=Date;
const current='2026-11-04T12:00:00Z';
class FixtureDate extends NativeDate { constructor(...args){super(...(args.length?args:[current]));} static now(){return NativeDate.parse(current);} }
const csv=['Daily Activity','Name,Call Contacted,Personalized Video,Calls Made','Alex Demo,2,1,7'].join('\n');
function email({dateHeaders=[],filename='activity.csv',subject='Daily Activity'}={}){
 const b='synthetic-boundary';return Buffer.from(['From: sender@example.invalid','To: lpc-demo@example.invalid',...dateHeaders.map(v=>'Date: '+v),'Subject: '+subject,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${b}"`,'',`--${b}`,'Content-Type: text/plain','','Synthetic',`--${b}`,`Content-Type: text/csv; name="${filename}"`,`Content-Disposition: attachment; filename="${filename}"`,'',csv,`--${b}--`,''].join('\r\n'));
}
function fake(seed,{conflictOnce=false}={}){
 const db=new Map(Object.entries(seed));let writes=0;
 const fetch=async(url,opts={})=>{const u=new URL(url),key=(u.searchParams.get('key')||'').replace(/^eq\./,''),method=opts.method||'GET';const json=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
  if(method==='GET')return json(db.has(key)?[{value:db.get(key)}]:[]);
  if(method==='POST'){writes++;for(const r of JSON.parse(opts.body))db.set(r.key,r.value);return json([]);}
  if(method==='PATCH'){const cur=db.get(key)||{},want=u.searchParams.get('value->>rev')||'',match=want==='is.null'?cur.rev==null:String(cur.rev)===want.replace(/^eq\./,'');if(conflictOnce&&key===storeKey('demo')){conflictOnce=false;db.set(key,{...cur,rev:cur.rev+1});return json([]);}if(!match)return json([]);writes++;const value=JSON.parse(opts.body).value;db.set(key,value);return json([{value}]);}
  throw Error('unexpected method');};
 return {db,fetch,get writes(){return writes;}};
}
async function run(raw,db){
 const oldFetch=globalThis.fetch,oldDate=globalThis.Date, keys=['INGEST_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 globalThis.fetch=db.fetch;globalThis.Date=FixtureDate;process.env.INGEST_SECRET=SECRET;process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
 const req={method:'POST',headers:{'x-ingest-secret':SECRET},async *[Symbol.asyncIterator](){yield raw;}},out={},res={status(c){out.code=c;return this;},json(b){out.body=b;return this;}};
 try{await handler(req,res);return out;}finally{globalThis.fetch=oldFetch;globalThis.Date=oldDate;for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
}
function seeded(){return fake({'lpc:config:v2':{stores:[STORE]},[storeKey('demo')]:{rev:1,roster:[],months:{'2026-11':{stats:{'alex demo':{actCalls:999}},names:{activity:['existing']},imports:{}}}}});}
const sent='Sun, 01 Nov 2026 01:30:00 -0400';
test('delayed activity uses Eastern sender day rather than processing day, including on retry',async()=>{
 const db=seeded(),raw=email({dateHeaders:[sent]});let out=await run(raw,db);assert.equal(out.code,200,JSON.stringify(out.body));
 let row=db.db.get(storeKey('demo'));assert.ok(row.activity['2026-11-01']);assert.equal(row.activity['2026-11-04'],undefined);
 assert.equal(row.months['2026-11'].stats['alex demo'].actCalls,999);assert.deepEqual(row.months['2026-11'].names.activity,['existing']);assert.equal(row.months['2026-11'].imports['2026-11-01'].activity,true);
 assert.equal(out.body.stores[0].results[0].daySource,'sender-date-header');assert.equal(row.activitySnaps['2026-11-01'][0].t,'2026-11-01T05:30:00.000Z');
 assert.ok(db.db.has(actKey('demo','2026-11-01')));assert.ok(db.db.has(floorStatsKey('demo','2026-11-01')));
 out=await run(raw,db);assert.equal(out.code,200);row=db.db.get(storeKey('demo'));assert.equal(row.activitySnaps['2026-11-01'].length,1);assert.equal(row.activitySnaps['2026-11-01'][0].t,'2026-11-01T05:30:00.000Z');
});
test('missing, duplicate and invalid sender Date refuse activity without writing',async()=>{
 for(const dateHeaders of [[],[sent,sent],[sent,'Sun, 01 Nov 2026 01:30:00 -0500'],['Sun, 01 Nov 2026 01:30:00'],['Mon, 01 Nov 2026 01:30:00 -0400']]){
  const db=seeded(),out=await run(email({dateHeaders}),db);assert.equal(out.code,422,JSON.stringify(out.body));assert.equal(db.writes,0);assert.equal(db.db.get(storeKey('demo')).activity,undefined);
 }
});
test('date-shaped conflicting filename and subject refuse the activity, not substitute a day',async()=>{
 for(const opts of [{filename:'activity-2026-11-02.csv'},{subject:'Daily Activity 11-02-2026'}]){
  const db=seeded(),out=await run(email({dateHeaders:[sent],...opts}),db);assert.equal(out.code,422,JSON.stringify(out.body));assert.equal(db.writes,0);assert.match(out.body.failures[0].why,/conflict/);
 }
});
test('cross-month delayed activity retains its Eastern sender day through a store CAS retry',async()=>{
 const base=seeded(),db=fake(Object.fromEntries(base.db),{conflictOnce:true});
 const out=await run(email({dateHeaders:['Sat, 31 Oct 2026 23:30:00 -0400']}),db);
 assert.equal(out.code,200,JSON.stringify(out.body));const row=db.db.get(storeKey('demo'));
 assert.ok(row.activity['2026-10-31']);assert.equal(row.activity['2026-11-04'],undefined);
 assert.equal(row.months['2026-10'].imports['2026-10-31'].activity,true);
 assert.equal(row.months['2026-11'].imports['2026-11-04']?.activity,undefined);assert.equal(row.months['2026-11'].stats['alex demo'].actCalls,999);
 assert.ok(db.db.has(actKey('demo','2026-10-31')));
});
