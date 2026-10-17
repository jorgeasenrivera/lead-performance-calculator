import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
function section(begin,end,offset=0){const a=source.indexOf(begin,offset),b=source.indexOf(end,a+begin.length);assert.ok(a>=0&&b>a,'Actual source boundary changed');return source.slice(a,b);}
const notify=section('function tellArrivalReady(ready, dest) {','\nfunction ArrivalPrepared');
const short=section('  if (jumpShort) {','\n  const W = window.innerWidth',source.indexOf('function runJump('));
function arrival(){const c=vm.createContext({});vm.runInContext(`
 let arrivalReady=false,arrivalDest=null,activeEngineSend=null,arrivalSurfaceReady=true,arrivalFailed=false,jumpShort=true,jumpOwnsEntrance=true;
 const timers=[],events=[],setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout=()=>{};
 const tellPhase=p=>events.push(p),onFlash=()=>events.push('flash'),onDone=()=>events.push('done');
 const arrivalView={landing:()=>events.push('landing'),recovery:()=>{},ready:()=>events.push('ready'),wait:()=>{},dispose:()=>{}};
 ${notify}
 function launch(){${short}}
 `,c);return code=>vm.runInContext(code,c);}

test('actual short arrival can finish during destination notification without a second cleared call',()=>{
 const run=arrival();run('launch();timers[0].fn();');assert.equal(run('timers[0].ms'),180);
 assert.doesNotThrow(()=>run('tellArrivalReady(true,{name:"Fixture"});'));
 assert.equal(run('activeEngineSend'),null);assert.deepEqual(Array.from(run('events')),['cruise','landing','flash','done']);
 run('tellArrivalReady(true);timers[0].fn();');assert.equal(run('events.filter(e=>e==="done").length'),1);
});
test('actual short arrival still waits for its timer when readiness arrives first',()=>{
 const run=arrival();run('launch();tellArrivalReady(true);');assert.equal(run('events.includes("done")'),false);
 run('timers[0].fn();');assert.equal(run('events.filter(e=>e==="done").length'),1);
});
test('a replacement arrival receiver does not inherit the old dispatch sequence',()=>{
 const run=arrival();run('const calls=[];const replacement=m=>calls.push("new:"+m.type);activeEngineSend=m=>{calls.push("old:"+m.type);activeEngineSend=replacement;};tellArrivalReady(true);');
 assert.deepEqual(Array.from(run('calls')),['old:dest']);
 run('tellArrivalReady(true);');assert.deepEqual(Array.from(run('calls')),['old:dest','new:dest','new:ready']);
});
test('an unchanged arrival receiver receives destination and current readiness',()=>{
 const run=arrival();run('const calls=[];activeEngineSend=m=>{calls.push(m.type);if(m.type==="dest")arrivalReady=false;else calls.push(m.ready);};tellArrivalReady(true);');
 assert.deepEqual(Array.from(run('calls')),['dest','ready',false]);
});

const settle=section('r.settle = setTimeout(() => {','\n    };',source.indexOf('const rail = useRef({ ramp:'));
function scroller({driving=false,left=0,tab='floor',active=true,width=390}={}){
 const c=vm.createContext({});vm.runInContext(`const r={driving:${driving}},el={clientWidth:${width},scrollLeft:${left}},activeRef={current:${active}},tabRef={current:${JSON.stringify(tab)}},tabs=[],slides=[];let callback,delay;const setTimeout=(fn,ms)=>{callback=fn;delay=ms;return 90;},onSlide=x=>slides.push(x),setTab=x=>tabs.push(x);${settle}`,c);
 return code=>vm.runInContext(code,c);
}
test('queued Home settle cannot undo a newer Floor ramp before its first frame',()=>{
 const run=scroller({driving:true,left:0,tab:'floor'});assert.equal(run('delay'),80);run('callback();');
 assert.deepEqual(Array.from(run('tabs')),[]);assert.deepEqual(Array.from(run('slides')),[]);assert.equal(run('r.driving'),true);
});
test('queued Floor settle cannot undo a newer Home ramp',()=>{
 const run=scroller({driving:true,left:390,tab:'corner'});run('callback();');assert.deepEqual(Array.from(run('tabs')),[]);assert.equal(run('r.driving'),true);
});
test('idle manual settling selects either page, but not a middle or inactive page',()=>{
 for(const [options,expected] of [[{left:0,tab:'floor'},['corner']],[{left:390,tab:'corner'},['floor']],[{left:195},[]],[{active:false},[]],[{width:0},[]]]){
  const run=scroller(options);run('callback();');assert.deepEqual(Array.from(run('tabs')),expected);
 }
});
test('completed programmatic ramp can settle at its destination without reversing it',()=>{
 const run=scroller({driving:true,left:0,tab:'floor'});run('r.driving=false;el.scrollLeft=390;callback();');
 assert.deepEqual(Array.from(run('tabs')),[]);assert.deepEqual(Array.from(run('slides')),[1,null]);
});
