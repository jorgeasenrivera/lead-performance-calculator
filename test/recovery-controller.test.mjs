// Synthetic lifecycle checks of actual modules. No auth/network/storage fixture access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRecoveryController} from '../src/recovery-controller.mjs';
import {createRecoveryGuard,LINK_FAILED_NOTICE} from '../src/recovery-session.mjs';
import {createRecoveryContinuity,RECOVERY_CONTINUITY_KEY} from '../src/recovery-continuity.mjs';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const session=(id='synthetic-a',token='synthetic-recovery')=>({user:{id},access_token:token});
function harness({denied=false,raw=null}={}){
 let stored=raw,n=0,live=session(),reads=0;const writes=[],cleanup=[];
 const storage={getItem(){if(denied)throw Error('denied');return stored;},setItem(_k,v){if(denied)throw Error('denied');stored=v;},removeItem(){if(denied)throw Error('denied');stored=null;}};
 const guard=createRecoveryGuard(null),continuity=createRecoveryContinuity({storage,makeId:()=>`context-${++n}`});
 const succeeded=continuity.succeeded;continuity.succeeded=x=>{const v=succeeded(x);cleanup.push(v);return v;};
 const deps={getSession:async()=>({data:{session:live}}),writePassword:async()=>({error:null})};
 const controller=createRecoveryController({guard,continuity,getSession:()=>{reads++;return deps.getSession();},writePassword:(...args)=>{writes.push(args);return deps.writePassword(...args);},failedNotice:LINK_FAILED_NOTICE});
 return {controller,guard,continuity,deps,writes,cleanup,stored:()=>stored,reads:()=>reads,event(event,s=live){live=s;controller.onAuthEvent(event,s);},ready(s=session()){this.event('PASSWORD_RECOVERY',s);}};
}
for(const phase of ['session','write'])test(`same-user new recovery during ${phase} invalidates old save`,async()=>{
 const h=harness(),gate=defer(),entered=defer();h.ready();
 if(phase==='session')h.deps.getSession=()=>{entered.resolve();return gate.promise;};else h.deps.writePassword=()=>{entered.resolve();return gate.promise;};
 const p=h.controller.save('synthetic-password');await entered.promise;h.ready(session('synthetic-a','synthetic-new'));const marker=h.stored();
 gate.resolve(phase==='session'?{data:{session:session()}}:{error:null});assert.deepEqual(await p,{stale:true});assert.equal(h.controller.snapshot().status,'ready');assert.equal(h.guard.binding().accessToken,'synthetic-new');assert.equal(h.stored(),marker);assert.equal(h.writes.length,phase==='session'?0:1);assert.deepEqual(h.cleanup,[]);
});
for(const event of ['different','signedout','reentry'])for(const phase of ['session','write'])test(`${event} during ${phase} refuses old completion`,async()=>{
 const h=harness(),gate=defer(),entered=defer();h.ready();
 if(phase==='session')h.deps.getSession=()=>{entered.resolve();return gate.promise;};else h.deps.writePassword=()=>{entered.resolve();return gate.promise;};
 const p=h.controller.save('synthetic-password');await entered.promise;
 if(event==='different')h.event('SIGNED_IN',session('synthetic-b','synthetic-b-token'));else if(event==='signedout')h.event('SIGNED_OUT',null);else h.controller.reenter();
 gate.resolve(phase==='session'?{data:{session:session()}}:{error:null});assert.deepEqual(await p,{stale:true});assert.equal(h.guard.binding(),null);assert.equal(h.writes.length,phase==='session'?0:1);assert.deepEqual(h.cleanup,[]);
 if(event==='reentry')assert.equal(h.controller.snapshot().status,'interrupted');
});
test('same-user token refresh preserves original recovery binding and accepts current SDK session',async()=>{
 const h=harness();h.ready();h.event('TOKEN_REFRESHED',session('synthetic-a','synthetic-rotated'));assert.deepEqual(await h.controller.save('synthetic-password'),{error:null});assert.deepEqual(h.writes,[['synthetic-recovery','synthetic-password']]);assert.equal(h.guard.snapshot().status,'idle');
});
test('storage denial and false cleanup do not turn accepted password save into failure',async()=>{
 const h=harness({denied:true});h.ready();assert.deepEqual(await h.controller.save('synthetic-password'),{error:null});assert.deepEqual(h.cleanup,[false]);assert.equal(h.controller.snapshot().status,'idle');assert.equal(h.guard.binding(),null);
});
for(const raw of ['tampered',JSON.stringify({version:1,userId:'synthetic-a',id:'fake-context'})])test(`marker alone never authorizes write (${raw==='tampered'?'invalid':'wellformed'})`,async()=>{
 const h=harness({raw});h.controller.settled(session());assert.equal(h.guard.binding(),null);assert.equal((await h.controller.save('synthetic-password')).lost,true);assert.equal(h.reads(),0);assert.deepEqual(h.writes,[]);assert.equal(h.controller.dismiss(),true);assert.equal(h.controller.snapshot().status,'idle');assert.equal(h.reads(),0);
});
for(const outcome of ['error','unknown','throw'])test(`${outcome} outcome preserves marker and does not declare completion`,async()=>{
 const h=harness();h.ready();const marker=h.stored();h.deps.writePassword=async()=>{if(outcome==='throw')throw Error('synthetic network');return outcome==='error'?{error:'synthetic rejected'}:undefined;};assert.ok((await h.controller.save('synthetic-password')).error);assert.equal(h.stored(),marker);assert.equal(h.controller.snapshot().status,'ready');assert.deepEqual(h.cleanup,[]);
});
test('token rejection retains interruption marker while removing live authorization',async()=>{
 const h=harness();h.ready();const marker=h.stored();h.deps.writePassword=async()=>({error:'synthetic expired',lost:true});assert.equal((await h.controller.save('synthetic-password')).lost,true);assert.equal(h.stored(),marker);assert.equal(h.guard.binding(),null);assert.equal(h.controller.snapshot().status,'failed');
});
for(const phase of ['session','write'])test(`concurrent saves only newest attempt can complete (${phase})`,async()=>{
 const h=harness(),old=defer(),entered=defer();h.ready();let count=0;
 if(phase==='session')h.deps.getSession=()=>++count===1?(entered.resolve(),old.promise):Promise.resolve({data:{session:session()}});
 else h.deps.writePassword=()=>++count===1?(entered.resolve(),old.promise):Promise.resolve({error:null});
 const first=h.controller.save('old-synthetic-password');await entered.promise;assert.deepEqual(await h.controller.save('new-synthetic-password'),{error:null});old.resolve(phase==='session'?{data:{session:session()}}:{error:null});assert.deepEqual(await first,{stale:true});assert.equal(h.controller.snapshot().status,'idle');assert.equal(h.cleanup.length,1);assert.equal(h.writes.length,phase==='session'?1:2);
});
test('fresh recovery emits a new context generation even for same user',()=>{
 const h=harness(),seen=[];h.controller.subscribe(x=>seen.push(x));h.ready();const first=h.controller.snapshot().generation;h.ready(session('synthetic-a','synthetic-second'));assert.ok(h.controller.snapshot().generation>first);assert.equal(seen.at(-1).status,'ready');
});
const app=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
test('source wiring routes persisted page transitions through controller invalidation',()=>{
 assert.match(app,/const reenter = e => \{ if \(e\.persisted\) recoveryFlow\.reenter\(\); \}/);
 for(const event of ['pagehide','pageshow'])assert.ok(app.includes(`window.addEventListener("${event}", reenter)`));
 assert.match(app,/onAuthStateChange\(\(ev, session\) => recoveryFlow\.onAuthEvent\(ev, session\)\)/);
});
test('source keeps interrupted reset in recovery layer and threads generation into login',()=>{
 assert.match(app,/const recoveryLayer = rec\.status === "ready" \|\| rec\.status === "failed" \|\| rec\.status === "interrupted"/);
 assert.match(app,/interrupted=\{rec\.status === "interrupted"\} recoveryGeneration=\{rec\.generation\}/);
 assert.ok(app.includes('const { generation, sessionUserId } = recoveryFlow.snapshot();'), 'capture recovery generation and session identity');
 assert.ok(app.includes('return signIn(() => authSetPassword(password), () => recoveryFlow.snapshot().generation === generation && recoveryFlow.snapshot().sessionUserId === sessionUserId);'), 'custom arrival preserves both ownership checks');
});
test('source sign-in continuation checks context after waits and before handover',()=>{
 assert.match(app,/await settleViewport\(\);\s*if \(!isCurrent\(\)\) return;/);
 assert.match(app,/const handOver = \(\) => \{\s*if \(!isCurrent\(\)/);
 assert.match(app,/if \(!isCurrent\(\) \|\| res\?\.stale\) return;/);
});
