import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedulerConnectionConfig,createSchedulerPgTransport,createSchedulerPgTransportFromEnv} from '../api/_scheduler-pg-transport.mjs';
import {createDraftOnlySchedulerServer} from '../api/_scheduler-draft-server.mjs';
const uri='postgresql://scheduler_runtime.dydfevdnpppvxgdptiwv:synthetic%21@synthetic.pooler.supabase.com:6543/postgres';
test('env config enforces exact runtime identity and verified TLS without URI override',()=>{
 const c=schedulerConnectionConfig({SCHEDULER_DATABASE_URL:uri+'?sslmode=require'});assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.ssl.servername,'synthetic.pooler.supabase.com');assert.equal(c.password,'synthetic!');assert.equal(c.max,1);assert.equal(c.connectionTimeoutMillis,3000);assert.equal(c.connectionString,undefined);
 for(const s of ['',uri+'?sslmode=disable',uri+'?sslrootcert=secret',uri.replace('scheduler_runtime.','postgres.'),uri.replace('synthetic.pooler.supabase.com','evil.example'),uri.replace('/postgres','/other'),uri+'#secret'])assert.throws(()=>schedulerConnectionConfig({SCHEDULER_DATABASE_URL:s}),e=>e.code==='storage-not-configured'&&!e.message.includes('synthetic'));
});
function fake(fail){const seen=[],released=[];return {seen,released,on(){},async end(){},async connect(){return {async query(q){seen.push(q);if(fail)await fail(q);return {rows:[{data:true}]};},release(d){released.push(d);}};}};}
test('allowlisted parameterized unnamed calls and local transaction timeouts',async()=>{
 const p=fake(),t=createSchedulerPgTransport({pool:p}),attack="';DROP TABLE example;--";
 assert.equal((await t.rpc('draft_permission',{p_actor_id:'actor',p_store_id:attack,p_permission:'draft-read'})).data,true);
 assert.equal(p.seen.length,4);assert.deepEqual(p.seen[2].values,['actor',attack,'draft-read']);assert.ok(!p.seen[2].text.includes(attack));assert.equal(p.seen[2].name,undefined);assert.equal(p.seen[0].text,'BEGIN');assert.equal(p.seen[3].text,'COMMIT');assert.deepEqual(p.released,[false]);
 assert.ok((await t.rpc('constructor',{})).error);assert.equal(p.seen.length,4);await t.close();assert.ok((await t.rpc('draft_permission',{})).error);
});
test('query/commit failures redact secrets, destroy connection and never retry',async()=>{
 for(const stage of ['BEGIN','SET','SELECT','COMMIT']){const p=fake(q=>{if(q.text.startsWith(stage))throw Object.assign(Error(uri),{code:'08006',detail:uri});}),t=createSchedulerPgTransport({pool:p});const r=await t.rpc('draft_permission',{p_actor_id:'a',p_store_id:'s',p_permission:'draft-read'});assert.equal(JSON.stringify(r).includes('synthetic'),false);assert.deepEqual(p.released,[true]);assert.equal(p.seen.filter(q=>q.text.startsWith('SELECT')).length,['BEGIN','SET'].includes(stage)?0:1);await t.close();}
});
test('only exact known database errors are passed through',async()=>{for(const message of ['scheduler:forbidden','scheduler:conflict','scheduler:idempotency-conflict','scheduler:forbidden '+uri]){const t=createSchedulerPgTransport({pool:fake(()=>{throw Object.assign(Error(message),{code:'P0001'});})});const r=await t.rpc('draft_permission',{p_actor_id:'a',p_store_id:'s',p_permission:'draft-read'});assert.equal(r.error.code,message.includes('synthetic')?'SCHEDULER_STORAGE_UNAVAILABLE':'P0001');await t.close();}});
test('no pool construction without explicit factory enablement or valid config',()=>{let count=0;class Pool{constructor(){count++;}}assert.throws(()=>createDraftOnlySchedulerServer({env:{SCHEDULER_DATABASE_URL:uri},Pool}));assert.throws(()=>createSchedulerPgTransportFromEnv({env:{},Pool}));assert.equal(count,0);});

test('scalar hooks and ambient PG settings are rejected before connection',async()=>{let invoked=false;const p=fake(),t=createSchedulerPgTransport({pool:p}),bad={toPostgres(){invoked=true;}};await t.rpc('draft_permission',{p_actor_id:bad,p_store_id:'s',p_permission:'draft-read'});await t.rpc('scheduler_snapshot',{p_authority:{},p_key:bad});assert.equal(invoked,false);assert.equal(p.seen.length,0);assert.throws(()=>schedulerConnectionConfig({SCHEDULER_DATABASE_URL:uri,PGOPTIONS:'-c role=postgres'}));await t.close();});
test('admission cap rejects excess work without unbounded pool queue',async()=>{
 let unblock;const gate=new Promise(r=>{unblock=r;}),p=fake();const connect=p.connect.bind(p);let acquisitions=0;p.connect=async()=>{acquisitions++;await gate;return connect();};const t=createSchedulerPgTransport({pool:p});const jobs=Array.from({length:16},()=>t.rpc('draft_permission',{p_actor_id:'a',p_store_id:'s',p_permission:'draft-read'}));const excess=await t.rpc('draft_permission',{p_actor_id:'a',p_store_id:'s',p_permission:'draft-read'});assert.ok(excess.error);assert.equal(acquisitions,16);unblock();for(const r of await Promise.all(jobs))assert.equal(r.data,true);await t.close();
});
test('pool construction errors do not disclose connection configuration',()=>{class Pool{constructor(){throw Error(uri);}}assert.throws(()=>createSchedulerPgTransportFromEnv({env:{SCHEDULER_DATABASE_URL:uri},Pool}),e=>e.code==='storage-not-configured'&&!String(e).includes('synthetic'));});
