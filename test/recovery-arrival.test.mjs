// Actual signIn closure with synthetic DOM/animation and actual recovery ownership modules.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRecoveryController} from '../src/recovery-controller.mjs';
import {createRecoveryGuard,LINK_FAILED_NOTICE} from '../src/recovery-session.mjs';
import {createRecoveryContinuity} from '../src/recovery-continuity.mjs';
const source=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const anchor='  const signIn = async (authCall, isCurrent = () => true) => {';
const start=source.indexOf(anchor);assert.ok(start>=0);assert.equal(source.indexOf(anchor,start+1),-1);
const finish=source.indexOf('\n  const signUp =',start);assert.ok(finish>start);const code=source.slice(start,finish);
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const sess=(id='synthetic-a',token='synthetic-token')=>({user:{id},access_token:token});
function harness({mode='idle',denied=false}={}){
 const calls=[];let raw=mode==='interrupted'?JSON.stringify({version:1,userId:'synthetic-a',id:'old-marker'}):null,session=sess(),n=0,animation;
 const storage={getItem(){if(denied)throw Error('denied');return raw;},setItem(k,v){if(denied)throw Error('denied');raw=v;},removeItem(){if(denied)throw Error('denied');raw=null;}};
 const guard=createRecoveryGuard(mode==='failed'?'expired':null),continuity=createRecoveryContinuity({storage,makeId:()=>`synthetic-${++n}`});
 const controller=createRecoveryController({guard,continuity,getSession:async()=>({data:{session}}),writePassword:async()=>{calls.push('password-write');return {error:null};},failedNotice:LINK_FAILED_NOTICE});
 controller.settled(session);
 const ctx={recoveryFlow:controller,setErr:x=>calls.push(['error',x]),setOk(){},email:'synthetic@example.invalid',password:'synthetic-password',setBusy:x=>calls.push(['busy',x]),signInPressed:false,document:{activeElement:{blur(){}},documentElement:{classList:{add:x=>calls.push(['class-add',x]),remove:x=>calls.push(['class-remove',x])}}},settleViewport:async()=>{},onJump:()=>calls.push('jump'),tellJumpOrigin(){},markRef:{current:null},typed:34,hurryBuild(){},jumping:{current:null},RUSH:0,runJump:callbacks=>{animation=callbacks;return ()=>{};},authSignIn:async()=>{calls.push('auth');session=sess('synthetic-b','signed-in-token');controller.onAuthEvent('SIGNED_IN',session);return {error:null};},abortJump:()=>calls.push('abort'),onRecoveryDismissed:()=>{calls.push('dismiss');controller.dismiss();},onAuthed:async()=>calls.push('profile'),onHandover:()=>calls.push('handover'),console:{error(){}}};
 return {ctx,calls,guard,continuity,controller,signIn:new Function('ctx',`with(ctx){${code};return signIn;}`)(ctx),done:()=>animation?.onDone(),fresh(){session=sess('synthetic-a','fresh-recovery');controller.onAuthEvent('PASSWORD_RECOVERY',session);},marker:()=>raw};
}
for(const mode of ['idle','failed','interrupted'])test(`ordinary ${mode} sign-in dismisses notice without cancelling its own arrival`,async()=>{
 const h=harness({mode});const generation=h.controller.snapshot().generation;await h.signIn();h.done();assert.ok(h.calls.includes('auth'));assert.ok(h.calls.includes('dismiss'));assert.ok(h.calls.includes('profile'));assert.equal(h.calls.filter(x=>x==='handover').length,1);assert.equal(h.controller.snapshot().generation,generation);assert.equal(h.controller.snapshot().status,'idle');
});
test('fresh recovery during ordinary auth preserves new binding and prevents profile/handover',async()=>{
 const h=harness(),gate=defer(),entered=defer();h.ctx.authSignIn=()=>{h.calls.push('auth');entered.resolve();return gate.promise;};const p=h.signIn();await entered.promise;h.fresh();const marker=h.marker();gate.resolve({error:null});await p;h.done();assert.ok(!h.calls.includes('dismiss'));assert.ok(!h.calls.includes('profile'));assert.ok(!h.calls.includes('handover'));assert.equal(h.guard.binding().accessToken,'fresh-recovery');assert.equal(h.marker(),marker);assert.equal(h.controller.snapshot().status,'ready');
});
test('fresh recovery during viewport wait prevents ordinary auth dispatch',async()=>{
 const h=harness(),gate=defer();h.ctx.settleViewport=()=>gate.promise;const p=h.signIn();h.fresh();gate.resolve();await p;assert.ok(!h.calls.includes('auth'));assert.ok(!h.calls.includes('jump'));assert.ok(!h.calls.includes('profile'));assert.ok(!h.calls.includes('handover'));assert.equal(h.controller.snapshot().status,'ready');
});
test('fresh recovery during profile await prevents old handover',async()=>{
 const h=harness(),gate=defer(),entered=defer();h.ctx.onAuthed=()=>{h.calls.push('profile');entered.resolve();return gate.promise;};const p=h.signIn();await entered.promise;h.fresh();h.done();gate.resolve();await p;assert.ok(!h.calls.includes('handover'));assert.equal(h.controller.snapshot().status,'ready');assert.equal(h.guard.binding().accessToken,'fresh-recovery');
});
test('accepted own password write arrives even when storage cleanup fails',async()=>{
 const h=harness({denied:true});h.fresh();const generation=h.controller.snapshot().generation;await h.signIn(()=>h.controller.save('synthetic-new-password'));h.done();assert.ok(h.calls.includes('password-write'));assert.ok(h.calls.includes('profile'));assert.equal(h.calls.filter(x=>x==='handover').length,1);assert.ok(!h.calls.includes('auth'));assert.ok(!h.calls.includes('dismiss'));assert.equal(h.controller.snapshot().status,'idle');assert.equal(h.controller.snapshot().generation,generation);
});
test('accepted password followed by account switch during profile load cancels handover',async()=>{
 const h=harness(),gate=defer(),entered=defer();h.fresh();
 h.ctx.onAuthed=()=>{h.calls.push('profile');entered.resolve();return gate.promise;};
 const p=h.signIn(()=>h.controller.save('synthetic-new-password'));await entered.promise;
 assert.ok(h.calls.includes('password-write'));assert.equal(h.controller.snapshot().status,'idle');
 const generation=h.controller.snapshot().generation;
 h.controller.onAuthEvent('SIGNED_IN',sess('synthetic-b','other-account-token'));
 assert.ok(h.controller.snapshot().generation>generation);
 h.done();gate.resolve();await p;assert.ok(!h.calls.includes('handover'));
 assert.equal(h.controller.snapshot().sessionUserId,'synthetic-b');
});
test('completed custom handover releases ownership so next normal account sign-in succeeds',async()=>{
 const h=harness();h.fresh();await h.signIn(()=>h.controller.save('synthetic-new-password'));h.done();
 assert.equal(h.calls.filter(x=>x==='handover').length,1);
 const generation=h.controller.snapshot().generation;h.calls.length=0;
 await h.signIn();h.done();assert.ok(h.calls.includes('auth'));assert.ok(h.calls.includes('profile'));assert.ok(h.calls.includes('dismiss'));assert.equal(h.calls.filter(x=>x==='handover').length,1);assert.equal(h.controller.snapshot().generation,generation);assert.equal(h.controller.snapshot().sessionUserId,'synthetic-b');
});
test('source connects generation changes to jump cleanup and custom handover to ownership release',()=>{
 const effect=source.slice(source.indexOf('// completions must not clear'),source.indexOf('  const signIn = async'));
 assert.ok(effect.includes('abortJump(); signInPressed = false; setBusy(false);'));
 assert.ok(effect.includes('}, [recoveryGeneration]);'));
 assert.ok(code.includes('if (custom) recoveryFlow.arrivalFinished(generation, arrivalUser);'));
});
