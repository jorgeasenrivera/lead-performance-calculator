// CLOSURE-LEVEL ONLY, NOT MOUNTED. The real signIn source and the real attempt plumbing (attemptRef, endAttempt, retireAttempt, killAttempt) run against a synthetic DOM class list, a synthetic animation and the real recovery modules.
// Overlap of two presses is not reachable through the mounted UI (the first press blurs the field), so current/new-owner protection is exercised here and labelled as such.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRecoveryController} from '../src/recovery-controller.mjs';
import {createRecoveryGuard,LINK_FAILED_NOTICE} from '../src/recovery-session.mjs';
import {createRecoveryContinuity} from '../src/recovery-continuity.mjs';
import {createHoldAttempt} from '../src/arrival-hold.mjs';
const source=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const anchor='  const signIn = async (authCall, isCurrent = () => true) => {';
const start=source.indexOf(anchor);assert.ok(start>=0);assert.equal(source.indexOf(anchor,start+1),-1);
const finish=source.indexOf('\n  const signUp =',start);const code=source.slice(start,finish);
const plumbStart=source.indexOf('  const attemptRef = useRef(null);'),plumbEnd=source.indexOf('  useEffect(() => () => { const a = attemptRef.current;');
const plumb=source.slice(plumbStart,plumbEnd).replace('useRef(null)','{current:null}');
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const sess=(id='synthetic-a',token='synthetic-token')=>({user:{id},access_token:token});
function harness(){
 const log=[];let flash=false,session=sess();const animations=[];const gates=[];
 const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const controller=createRecoveryController({guard:createRecoveryGuard(null),continuity:createRecoveryContinuity({storage,makeId:()=>'synthetic-1'}),getSession:async()=>({data:{session}}),writePassword:async()=>({error:null}),failedNotice:LINK_FAILED_NOTICE});
 controller.settled(session);
 const classList={add:x=>{if(x==='sage-flash-hold'){flash=true;log.push('flash-on');}},remove:x=>{if(x==='sage-flash-hold'){flash=false;log.push('flash-off');}}};
 const ctx={recoveryFlow:controller,setErr(){},setOk(){},email:'synthetic@example.invalid',password:'synthetic-password',setBusy:x=>log.push(['busy',x]),signInPressed:false,document:{activeElement:{blur(){}},documentElement:{classList}},settleViewport:async()=>{},onJump(){},tellJumpOrigin(){},markRef:{current:null},typed:34,hurryBuild(){},jumping:{current:null},RUSH:0,
  runJump:cb=>{animations.push(cb);return ()=>{};},createHoldAttempt,abortJump:()=>log.push('abort'),onRecoveryDismissed(){},onAuthed:async()=>{},onHandover:()=>log.push('handover'),console:{error(){}},
  authSignIn:()=>{const g=defer();gates.push(g);return g.promise;}};
 const f=new Function('ctx',`with(ctx){${plumb};${code};return {signIn,retireAttempt,attemptRef};}`)(ctx);
 return {...f,ctx,log,animations,gates,controller,isFlash:()=>flash,resolveA:(i)=>gates[i].resolve({error:null,userId:'synthetic-a'})};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('closure: a flash held while the answer is pending is taken down by the CURRENT attempt when it retires (generation or unmount path)',async()=>{
 const h=harness();const p=h.signIn();await tick();h.animations[0].onFlash();assert.equal(h.isFlash(),true);
 h.retireAttempt(h.attemptRef.current);assert.equal(h.isFlash(),false);assert.equal(h.attemptRef.current.done,true);
 h.resolveA(0);await p;assert.ok(!h.log.includes('handover'));assert.equal(h.isFlash(),false);
});
test('closure: a new press retires the old current attempt (flash off) before the new one is installed; the old late answer can never clear or hand over',async()=>{
 const h=harness();const p1=h.signIn();await tick();h.animations[0].onFlash();assert.equal(h.isFlash(),true);
 const first=h.attemptRef.current;const p2=h.signIn();await tick();
 assert.equal(h.isFlash(),false,'old flash retired by the new press');assert.equal(first.done,true);assert.notEqual(h.attemptRef.current,first);
 h.animations[1].onFlash();assert.equal(h.isFlash(),true,'the NEW attempt owns its own flash');
 const before=h.log.length;h.resolveA(0);await p1;
 assert.equal(h.isFlash(),true,'the old completion did not clear the new attempt flash');assert.ok(!h.log.slice(before).includes('flash-off'));assert.ok(!h.log.includes('handover'));
 h.resolveA(1);await p2;
});
test('closure: retiring an attempt that is no longer current never touches the class',async()=>{
 const h=harness();const p1=h.signIn();await tick();const first=h.attemptRef.current;const p2=h.signIn();await tick();
 h.animations[1].onFlash();assert.equal(h.isFlash(),true);
 h.retireAttempt(first);assert.equal(h.isFlash(),true,'stale retire is a no-op for the class');
 h.resolveA(0);h.resolveA(1);await p1;await p2;
});
test('closure: no residue and one current completion when the next legitimate press follows the retire',async()=>{
 const h=harness();const p1=h.signIn();await tick();h.animations[0].onFlash();h.retireAttempt(h.attemptRef.current);assert.equal(h.isFlash(),false);h.resolveA(0);await p1;
 const p2=h.signIn();await tick();h.animations[1].onFlash();h.resolveA(1);await p2;h.animations[1].onDone();
 assert.equal(h.log.filter(x=>x==='handover').length,1,'exactly one handover, from the current attempt');assert.equal(h.isFlash(),false);
});
