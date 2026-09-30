import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {proposalTransform, arrivalBoundaryTransform, slowManagerImport, replaceExactlyOnce, proposalPage, polishCSS, installProposal, installArrivalProbe, installComparison, withinTabTransform, createStudyCardMotion, createStudyCount, createStudyCardFocus, heroRenderTransform, createStudyEvaluationCache, boardEvaluationTransform} from "../scripts/manager-polish-proposal.mjs";

test("manager approval transform remains anchored to the actual component", async () => {
  const source = await fs.readFile(new URL("../src/Manager.jsx", import.meta.url),"utf8");
  const changed = proposalTransform(source);
  assert.ok(changed.includes('r.long + ", green threshold, percent"'));
  assert.ok(changed.includes('"Monthly grace period, days"'));
  assert.ok(changed.includes('"fr-acts sage-perf-actions" : "fr-acts ac-acts"'));
  assert.ok(changed.includes('>{shortLabel(f)}</span> : <i'));
});

test("proposal replacement refuses missing and ambiguous anchors", () => {
  assert.throws(() => replaceExactlyOnce("before before","before","after"));
  assert.throws(() => replaceExactlyOnce("other","before","after"));
  assert.equal(replaceExactlyOnce("before","before","after"),"after");
});

test("card edge repairs are scoped to Proposed and preserve touch containment", () => {
  assert.ok(polishCSS.includes("@media(hover:hover)"));
  assert.ok(polishCSS.includes(".sage-polish .acard .ac-gauges :is(.mclust,.bloop-host) { position:static; }"));
  assert.ok(polishCSS.includes("width:min(272px,calc(100% - 8px))"));
  assert.ok(!polishCSS.includes(".acard { overflow:visible"));
  assert.ok(polishCSS.includes("@media(min-width:641px) and (max-width:900px)"));
  assert.ok(polishCSS.includes(".sage-polish .da-ptcell { order:1; flex:0 0 auto; margin-left:auto; }"));
  assert.ok(polishCSS.includes(".sage-polish :is(.hs-head,.hs-row) { grid-template-columns:"));
  assert.ok(polishCSS.includes("minmax(52px,1fr)"));
  assert.ok(!polishCSS.includes("overflow-wrap:anywhere"));
});

test("only the proposed copy keeps login outside the destination's suspense boundary", async () => {
  const source = await fs.readFile(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
  const changed = arrivalBoundaryTransform(source);
  assert.ok(changed.includes('window.__SAGE_POLISH ? <><React.Suspense'));
  assert.ok(changed.includes('</RoomBoundary></React.Suspense>{signInLayer}</> : <React.Suspense'));
  assert.ok(changed.includes('</RoomBoundary>{signInLayer}</React.Suspense>'));
  assert.throws(() => arrivalBoundaryTransform("const wrap = changed"));
});

test("the cold-download experiment changes only one manager import, not the shared entry", () => {
  const source = 'import("./Manager-test.js");import("./index-test.js")';
  assert.equal(slowManagerImport(source), 'import("./Manager-test.js?study-lag=1");import("./index-test.js")');
  assert.throws(() => slowManagerImport('import("./index-test.js")'));
  assert.throws(() => slowManagerImport('import("./Manager-one.js");import("./Manager-two.js")'));
});

test("approval page scripts parse and retain existing decisions plus compact History", () => {
  const html = proposalPage();
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.equal((html.match(/data-decision="/g) || []).length,12);
  assert.ok(html.includes("Compact phone, 320 x 568"));
  assert.ok(html.includes("Landscape, 844 x 390"));
  assert.ok(html.includes("8. Compact phone History"));
  assert.ok(html.includes("9. Compact associate metrics"));
  assert.ok(html.includes("10. Phone hero fit"));
  assert.ok(html.includes("Fictional people and figures"));
  assert.ok(html.includes("Replay full sign-in"));
  assert.ok(html.includes("Replay page motion"));
});

test("compact History gives the name and no-data message their own full row", () => {
  assert.ok(polishCSS.includes("@media(max-width:380px)"));
  assert.ok(polishCSS.includes(".sage-polish .hs-who { grid-column:1 / -1; }"));
  assert.ok(polishCSS.includes(".sage-polish .hs-nf { grid-column:1 / -1; text-align:left; }"));
  assert.ok(polishCSS.includes(".sage-polish .hs-head > span:first-child { display:none; }"));
});

test("compact associate metrics keep all six in their original reading order", () => {
  const compact = polishCSS.split("@media(max-width:380px) {")[1].split("\n}")[0];
  assert.ok(compact.includes(".sage-polish .acard .ac-gauges .mstrip { grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px 10px; }"));
  assert.ok(!compact.includes("font-size"));
  assert.ok(!compact.includes(".s2g4 { display:none"));
});

test("phone hero keeps the goal below responsive dot digits without hiding data", () => {
  const phone = polishCSS.split("@media(max-width:600px) {")[1].split("\n}")[0];
  assert.ok(phone.includes(".sage-polish .bp-page .bp-l1 { flex-direction:column; align-items:flex-start; gap:8px; }"));
  assert.ok(phone.includes(".bp-num .dotnum { max-width:100%; }"));
  assert.ok(phone.includes(".bp-num .dotnum > svg { min-width:0; height:auto; }"));
  assert.ok(!phone.includes(".bp-r1"));
  assert.ok(!phone.includes("display:none"));
});

function motionHarness() {
  const timers=new Map(), frames=new Map(), observers=[], handlers={};let id=0;
  const classes=new Set();
  const root={classList:{contains:k=>classes.has(k)}};
  const doc={documentElement:root,hidden:false,addEventListener:(k,fn)=>handlers[k]=fn,removeEventListener:k=>delete handlers[k]};
  const media={matches:false,addEventListener:(k,fn)=>handlers.media=fn,removeEventListener:()=>delete handlers.media};
  const env={document:doc,matchMedia:()=>media,getComputedStyle:k=>k.painted || {transform:k.style.transform || "none",opacity:k.style.opacity || "1"},
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    MutationObserver:class {constructor(fn){this.fn=fn;this.active=false;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}}};
  const element=()=>({ownerDocument:doc,style:{transform:"",opacity:"",animation:"",transformOrigin:""},dataset:{},effects:[],
    animate(keys,options){let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});
      const a={keys,options,finished,cancelled:false,cancel(){this.cancelled=true;reject();},complete:resolve};this.effects.push(a);return a;},
    getBoundingClientRect:()=>({left:400,top:100,width:360,height:600}),querySelectorAll:()=>[]});
  const notify=()=>observers.filter(o=>o.active).forEach(o=>o.fn());
  const step=t=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(t));};
  return {env,doc,root,classes,media,timers,frames,handlers,observers,element,notify,step};
}

test("within-tab replacements fail closed and leave the Current routines in place", async () => {
  const source=await fs.readFile(new URL("../src/Manager.jsx",import.meta.url),"utf8");
  const changed=withinTabTransform(source);
  assert.ok(changed.includes('if (window.__SAGE_POLISH) { if (studyMotion.current)'));
  assert.ok(changed.includes('setTimeout(onClose, MOTION.settle)'));
  assert.ok(changed.includes('setV(Math.round(target * eased * f) / f)'));
  assert.ok(changed.includes('from:displayed.current'));
  assert.ok(changed.includes('motion.dispose(); studyMotion.current = null; releaseFocus();'));
  assert.throws(()=>withinTabTransform(source.replace('  const grew = useRef(null);','  const renamed = useRef(null);')));
});

test("card reverses from painted pose, closes once, and cancels owned effects", async () => {
  const h=motionHarness(), el=h.element(), child=h.element();el.querySelectorAll=()=>[child];let closes=0;
  const m=createStudyCardMotion(el,{rect:{left:10,top:20,width:600,height:120}},()=>closes++,h.env);
  el.painted={transform:"matrix(.7,0,0,.8,-90,-20)",opacity:"1"};child.painted={transform:"none",opacity:".4"};
  m.close();m.close();
  assert.equal(el.effects.length,2);assert.equal(child.effects.length,2);
  assert.equal(el.effects[0].cancelled,true);
  assert.equal(el.effects[1].keys[0].transform,el.painted.transform);
  assert.equal(child.effects[1].keys[0].opacity,".4");
  el.effects[0].complete();await Promise.resolve();assert.equal(closes,0);
  el.effects[1].complete();await Promise.resolve();assert.equal(closes,1);
  assert.equal(h.timers.size,0);assert.equal(el.dataset.studyCardMotion,"closed");
  m.dispose();assert.ok(h.observers.every(o=>!o.active));assert.deepEqual(h.handlers,{});
  assert.equal(el.style.opacity,"0");assert.equal(el.style.animation,"none");
});

test("card preferences and hidden pages settle without residual travel", () => {
  const h=motionHarness(), el=h.element();let closes=0;
  const m=createStudyCardMotion(el,null,()=>closes++,h.env);
  h.classes.add("sage-study-reduce");h.notify();
  assert.equal(el.dataset.studyCardMotion,"open");assert.equal(el.style.transform,"none");
  assert.ok(el.effects.every(a=>a.cancelled));m.close();assert.equal(closes,1);m.dispose();
  const h2=motionHarness(), el2=h2.element();let hiddenCloses=0;
  const m2=createStudyCardMotion(el2,null,()=>hiddenCloses++,h2.env);m2.close();h2.doc.hidden=true;h2.handlers.visibilitychange();
  assert.equal(hiddenCloses,1);assert.equal(h2.timers.size,0);m2.dispose();
});

test("card entry preserves a child's dimmed inline opacity through settle and cleanup", async () => {
  for (const reduce of [false,true]) {
    const h=motionHarness(), el=h.element(), child=h.element();
    child.style.opacity=".35"; el.querySelectorAll=()=>[child];
    if (reduce) h.classes.add("sage-study-reduce");
    const m=createStudyCardMotion(el,null,()=>{},h.env);
    if (!reduce) {
      assert.equal(child.effects[0].keys.at(-1).opacity,".35");
      el.effects[0].complete(); await Promise.resolve();
    }
    assert.equal(el.dataset.studyCardMotion,"open");
    assert.equal(child.style.opacity,".35");
    m.dispose(); assert.equal(child.style.opacity,".35");
  }
});

test("a finished close stays invisible while React removal is delayed", async () => {
  const h=motionHarness(), el=h.element(), child=h.element();el.querySelectorAll=()=>[child];
  let atClose;
  const m=createStudyCardMotion(el,null,()=>{atClose={opacity:el.style.opacity,transform:el.style.transform,childOpacity:child.style.opacity};},h.env);
  el.effects[0].complete();await Promise.resolve();
  m.close();el.effects[1].complete();await Promise.resolve();
  assert.equal(atClose.opacity,"0");
  assert.equal(atClose.transform,el.effects[1].keys.at(-1).transform);
  assert.equal(atClose.childOpacity,"0");
  assert.equal(el.style.opacity,"0");
  m.dispose(); // Layout-effect cleanup can precede DOM removal in the same commit.
  assert.equal(el.style.opacity,"0");assert.equal(el.style.animation,"none");
});

test("unmount cancels a pending close without invoking an old callback", async () => {
  const h=motionHarness(), el=h.element();let closes=0;
  const m=createStudyCardMotion(el,null,()=>closes++,h.env);m.close();m.dispose();
  el.effects[1].complete();await Promise.resolve();assert.equal(closes,0);assert.equal(h.timers.size,0);
  assert.equal(el.style.opacity,"");assert.equal(el.style.animation,"");
});

test("close watchdog and reduced-motion completion retain the invisible terminal pose", () => {
  for (const reduced of [false,true]) {
    const h=motionHarness(), el=h.element();let closes=0;
    const m=createStudyCardMotion(el,null,()=>closes++,h.env);m.close();
    if (reduced) {h.media.matches=true;h.handlers.media();}
    else [...h.timers.values()][0]();
    assert.equal(closes,1);assert.equal(el.style.opacity,"0");assert.equal(h.timers.size,0);
    m.dispose();assert.equal(el.style.opacity,"0");
  }
});

test("numbers retarget from displayed value, including descending to zero", () => {
  const h=motionHarness(), values=[];
  const dispose=createStudyCount(0,{from:80,ms:320,onValue:v=>values.push(v)},h.env);
  h.step(0);h.step(160);h.step(320);
  assert.deepEqual(values,[10,0]);assert.equal(h.frames.size,0);
  assert.ok(h.observers.every(o=>!o.active));dispose();
});

test("counts wait without polling, cancel, and finish on Reduce Motion changes", () => {
  const h=motionHarness(), values=[];h.classes.add("jump-under");
  const dispose=createStudyCount(79,{from:0,ms:640,onValue:v=>values.push(v)},h.env);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  h.classes.delete("jump-under");h.notify();h.step(0);h.step(100);
  h.media.matches=true;h.handlers.media();assert.equal(values.at(-1),79);
  assert.equal(h.frames.size,0);assert.deepEqual(h.handlers,{});dispose();
  const h2=motionHarness(), values2=[];
  const stop=createStudyCount(25,{from:10,onValue:v=>values2.push(v)},h2.env);
  stop();h2.step(1000);assert.deepEqual(values2,[]);
});

test("arrival probe is bounded and records the real cover and mount animations", () => {
  const probe = installArrivalProbe.toString();
  new vm.Script(probe);
  assert.ok(probe.includes("time-started < 12000"));
  assert.ok(probe.includes("rows.length < 300"));
  assert.ok(probe.includes('"animationcancel"'));
  assert.ok(probe.includes('".sage-flash"'));
  assert.ok(probe.includes('attributeFilter:["class"]'));
  assert.ok(!probe.includes("localStorage"));
});

test("motion is bounded, cancels and honours the system preference", () => {
  const runtime = installProposal.toString();
  assert.ok(runtime.includes('matchMedia("(prefers-reduced-motion: reduce)")'));
  assert.ok(runtime.includes(".slice(0, 6)"));
  assert.ok(runtime.includes("a.cancel()"));
  assert.ok(runtime.includes('"pagehide"'));
  assert.ok(polishCSS.includes("@media(prefers-reduced-motion:reduce)"));
  assert.ok(!polishCSS.includes("overflow-x:hidden"));
  assert.ok(polishCSS.includes('.sage-perf-actions .fr-b.warnpri { background:#B8332B'));
  assert.ok(polishCSS.includes('.sage-polish .s2-hero .s2-cap, .sage-polish .s2-hero .s2-scap'));
});

test("navigation follows actual app phases and cannot replay the outgoing page", () => {
  const runtime = installProposal.toString();
  assert.ok(runtime.includes('phases.observe(root, {attributes:true, attributeFilter:["class"]})'));
  assert.ok(runtime.includes('!root.classList.contains("sage-polish-switch")'));
  assert.ok(runtime.includes("phases.disconnect()"));
  assert.ok(!runtime.includes("nav.indexOf"));
  assert.ok(!runtime.includes("travel(direction)"));
  assert.ok(polishCSS.includes(":is(.page,.board-page,.tab-page) > *"));
  assert.ok(polishCSS.includes(".board-page:not(.page .board-page)"));
  assert.ok(polishCSS.includes("@media(prefers-reduced-motion:no-preference)"));
  assert.ok(polishCSS.includes(":not(.sage-study-reduce):is(.tool-enter,.tab-enter)"));
});

function comparisonHarness() {
  const handlers = {}, timers = new Map(); let timerId=0;
  const elements = {};
  const stack = {children:[], appendChild(frame) {frame.parentElement=this;this.children.push(frame);}};
  const frame = () => ({title:"Sage", id:"", style:{}, contentWindow:{postMessage() {}},
    set src(value) {this.url=new URL(value,"http://localhost:49214").href;}, get src() {return this.url;},
    remove() {stack.children=stack.children.filter(el=>el!==this);}});
  const original=frame(); original.id="app"; original.src="/app?mode=proposed"; stack.appendChild(original);
  elements.app=original;
  for (const key of ["status","trace","reduce","current","proposed","replay","signin","totals"]) elements[key]={id:key,checked:false,setAttribute(k,v){this[k]=v;}};
  const document={querySelector:s=>elements[s.slice(1)], querySelectorAll:()=>[elements.current,elements.proposed],getElementById:k=>elements[k],createElement:frame};
  const window={addEventListener:(name,cb)=>handlers[name]=cb};
  vm.runInNewContext('('+installComparison.toString()+')()', {document,window,location:{origin:"http://localhost:49214",search:""},URL,URLSearchParams,
    setTimeout:cb=>{timers.set(++timerId,cb);return timerId;},clearTimeout:id=>timers.delete(id)});
  const ready = (target, origin="http://localhost:49214") => handlers.message({origin,source:target.contentWindow,data:{type:"sage-polish-ready"}});
  return {elements,stack,original,ready,timers};
}

test("comparison holds the painted frame until the pending app is ready", () => {
  const h=comparisonHarness();
  h.elements.current.onclick();
  const next=h.stack.children[1];
  assert.equal(h.stack.children[0],h.original);
  assert.equal(next.style.visibility,"hidden");
  assert.equal(next.inert,true);
  h.ready(h.original); assert.equal(h.stack.children.length,2);
  h.ready(next,"http://different.invalid"); assert.equal(h.stack.children.length,2);
  h.ready(next);
  assert.deepEqual(h.stack.children,[next]);
  assert.equal(next.style.visibility,"");
  assert.equal(next.inert,false);
  assert.equal(next.id,"app");
  assert.equal(h.elements.current["aria-pressed"],"true");
});

test("rapid comparison reversal and timeout keep the last usable view", () => {
  const h=comparisonHarness();
  h.elements.current.onclick(); const stale=h.stack.children[1];
  h.elements.proposed.onclick(); h.ready(stale);
  assert.deepEqual(h.stack.children,[h.original]);
  h.elements.current.onclick();
  [...h.timers.values()][0]();
  assert.deepEqual(h.stack.children,[h.original]);
  assert.ok(h.elements.status.textContent.includes("previous view is still here"));
});

function decisionHarness(stored, {readError=false,writeError=false}={}) {
  const selects=Array.from({length:12},(_,i)=>({dataset:{decision:String(i)},value:""}));
  const nodes={"#device":{},"#copy":{},"#export":{textContent:""}}, writes=[];
  const document={body:{dataset:{}},querySelectorAll:()=>selects,querySelector:s=>nodes[s]};
  const localStorage={getItem(){if(readError) throw new Error("SecurityError");return stored;},setItem(k,v){if(writeError) throw new Error("QuotaExceededError");writes.push([k,v]);}};
  const script=proposalPage().match(/<script>([\s\S]*?)<\/script>/)[1];
  // Run the real emitted decision installer without the unrelated frame mock.
  vm.runInNewContext(script.slice(0,script.indexOf("(function installComparison")),{document,localStorage});
  return {selects,nodes,writes,document};
}

test("damaged or unavailable decision storage cannot disable preview controls", () => {
  for(const stored of ["{","null","[]","42",'"text"',undefined]) {
    const h=decisionHarness(stored);
    assert.ok(h.selects.every(s=>s.value==="pending" && typeof s.onchange==="function"));
    h.nodes["#device"].onchange({target:{value:"tablet"}});
    assert.equal(h.document.body.dataset.device,"tablet");
    h.nodes["#copy"].onclick();assert.equal(h.nodes["#export"].textContent,"No decisions yet");
  }
  const h=decisionHarness("{}",{readError:true});
  assert.equal(typeof h.nodes["#device"].onchange,"function");
});

test("decision recovery keeps only known indexes and allowed values", () => {
  const h=decisionHarness('{"0":"Approve","9":"Adjust","10":"Approve","11":"Keep current","1":"unknown","2":null,"-1":"Approve","100":"Approve","__proto__":"Approve"}');
  assert.equal(h.selects[0].value,"Approve");assert.equal(h.selects[9].value,"Adjust");
  assert.equal(h.selects[1].value,"pending");assert.equal(h.selects[2].value,"pending");
  assert.equal(h.selects[10].value,"Approve");assert.equal(h.selects[11].value,"Keep current");
  h.nodes["#copy"].onclick();assert.equal(h.nodes["#export"].textContent,"1: Approve\n10: Adjust\n11: Approve\n12: Keep current");
  h.selects[11].value="Adjust";h.selects[11].onchange();
  assert.equal(JSON.parse(h.writes.at(-1)[1])["11"],"Adjust");
});

test("a denied decision save keeps changes exportable and controls usable", () => {
  const h=decisionHarness('{"0":"Approve"}',{writeError:true});
  h.selects[9].value="Adjust";h.selects[9].onchange();
  assert.match(h.nodes["#export"].textContent,/could not be saved/);
  h.nodes["#copy"].onclick();assert.equal(h.nodes["#export"].textContent,"1: Approve\n10: Adjust");
  h.selects[0].value="Keep current";h.selects[0].onchange();h.nodes["#copy"].onclick();
  assert.equal(h.nodes["#export"].textContent,"1: Keep current\n10: Adjust");
});

test("fresh phone origin objects cannot restart a mounted Proposed card or cancel its close", async () => {
  const source=await fs.readFile(new URL("../src/Manager.jsx",import.meta.url),"utf8");
  const changed=withinTabTransform(source);
  const prefix=changed.slice(changed.indexOf("function AssocCard("),changed.indexOf('  const ini = a.name',changed.indexOf("function AssocCard(")));
  const mount=proposed=>{
    const h=motionHarness(), el=h.element(), refs=[];
    let cursor=0, prior, cleanup, queued, latestEffect, runs=0, layouts=0, closes=0;
    const context={window:{...h.env,__SAGE_POLISH:proposed},normThresholds:v=>v,useState:()=>[false,()=>{}],useRef:value=>refs[cursor++] ||= {current:value},useEffect:()=>{},
      createStudyCardFocus:()=>()=>{},createStudyCardMotion:(...args)=>{runs++;return createStudyCardMotion(...args,h.env);},
      useLayoutEffect:(fn,deps)=>{latestEffect=fn;if(!prior || deps.some((d,i)=>!Object.is(d,prior[i]))) queued=()=>{cleanup?.();cleanup=fn();prior=deps;layouts++;};}};
    const Card=vm.runInNewContext('('+prefix+'return {boxRef,shut};\n})',context);
    const render=(x=12)=>{cursor=0;queued=null;const card=Card({a:{name:"Demo"},origin:{x,y:20},onClose:()=>closes++});card.boxRef.current=el;queued?.();return card;};
    return {h,el,render,get runs(){return runs;},get layouts(){return layouts;},get closes(){return closes;},dispose:()=>cleanup?.(),strictReplay:()=>{cleanup?.();cleanup=latestEffect();}};
  };
  const m=mount(true),first=m.render();assert.equal(m.runs,1);
  m.render();assert.equal(m.runs,1);
  m.el.effects[0].complete();await Promise.resolve();m.render();assert.equal(m.runs,1);
  first.shut();m.render();assert.equal(m.runs,1);assert.equal(m.el.dataset.studyCardMotion,"closing");
  m.el.effects[1].complete();await Promise.resolve();assert.equal(m.closes,1);m.dispose();
  // Each actual mount still gets one entry, and StrictMode can safely replay
  // setup/cleanup without a stale completion cancelling its new controller.
  const reopened=mount(true);reopened.render(200);reopened.strictReplay();
  assert.equal(reopened.runs,2);assert.equal(reopened.el.effects[0].cancelled,true);
  reopened.el.effects[0].complete();await Promise.resolve();assert.equal(reopened.el.dataset.studyCardMotion,"opening");
  reopened.el.effects[1].complete();await Promise.resolve();assert.equal(reopened.el.dataset.studyCardMotion,"open");reopened.dispose();
  const current=mount(false);current.render();current.render();
  assert.equal(current.runs,0);assert.equal(current.layouts,2);current.dispose();
});

test("page replay coalesces repeated requests until the last delayed section finishes", () => {
  const effects=[],classes=new Set();
  const make=()=>({getBoundingClientRect:()=>({top:0,bottom:100}),contains:()=>false,animate(keys,options){const a={keys,options,playState:"running",cancel(){this.playState="idle";}};effects.push(a);return a;}});
  const sections=[make(),make(),make()],page={children:sections,querySelector:()=>sections[0],animate(){}};
  const context={proposed:true,manualReduce:false,media:{matches:false},document:{hidden:false,querySelector:()=>page},root:{matches:()=>false,classList:{add:k=>classes.add(k)}},innerHeight:900,report(){},effects};
  const source=installProposal.toString(),start=source.indexOf('  const stop ='),end=source.indexOf('  const ensureStyle');
  vm.runInNewContext('let animations=[];'+source.slice(start,end)+'\nthis.travel=travel;this.stop=stop;',context);
  context.travel();context.travel();assert.equal(effects.length,3);
  effects[0].playState="finished";effects[1].playState="finished";context.travel();assert.equal(effects.length,3);
  effects[2].playState="finished";context.travel();assert.equal(effects.length,6);
  context.stop();assert.ok(effects.every(a=>a.playState==="idle"));
  context.travel();assert.equal(effects.length,9);
  context.stop();context.manualReduce=true;context.travel();assert.equal(effects.length,9);
});

function focusHarness({inert=false}={}) {
  const listeners={},body={},app={inert,contains:()=>false};
  const doc={body,activeElement:null,getElementById:()=>app,addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener:k=>delete listeners[k]};
  const control=(name,extra={})=>({name,tabIndex:0,disabled:false,isConnected:true,closest:()=>null,getClientRects:()=>[{}],focus(options){this.lastFocus=options;doc.activeElement=this;},...extra});
  const opener=control('opener'),close=control('close'),metric=control('metric'),coach=control('coach');
  doc.activeElement=opener;
  const items=[close,metric,coach],attributes=new Map();
  const el=control('dialog',{ownerDocument:doc,querySelectorAll:()=>items,contains:k=>k===el || items.includes(k),getAttribute:k=>attributes.get(k) ?? null,setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)});
  const key=(shiftKey=false)=>{const e={key:'Tab',shiftKey,preventDefault(){this.prevented=true;}};listeners.keydown(e);return e;};
  return {doc,app,opener,close,metric,coach,items,el,listeners,key,control};
}

test("associate modal owns initial focus, wraps both directions and restores its invoker", () => {
  const h=focusHarness(),dispose=createStudyCardFocus(h.el);
  assert.equal(h.doc.activeElement,h.close);assert.equal(h.app.inert,true);
  assert.deepEqual(h.close.lastFocus,{preventScroll:true});
  assert.equal(h.key(true).prevented,true);assert.equal(h.doc.activeElement,h.coach);
  assert.equal(h.key().prevented,true);assert.equal(h.doc.activeElement,h.close);
  h.doc.activeElement=h.metric;assert.equal(h.key().prevented,undefined);
  h.doc.activeElement=h.opener;h.listeners.focusin({target:h.opener});assert.equal(h.doc.activeElement,h.close);
  dispose();dispose();assert.equal(h.doc.activeElement,h.opener);assert.equal(h.app.inert,false);assert.deepEqual(h.listeners,{});
  assert.equal(h.el.getAttribute('tabindex'),null);
});

test("focus trap skips disabled, hidden and inert controls and handles an empty card", () => {
  const h=focusHarness();h.coach.disabled=true;h.metric.getClientRects=()=>[];
  h.items.push(h.control('inert control',{closest:()=>({})}));
  const dispose=createStudyCardFocus(h.el);
  assert.equal(h.key(true).prevented,true);assert.equal(h.doc.activeElement,h.close);
  h.close.disabled=true;assert.equal(h.key().prevented,true);assert.equal(h.doc.activeElement,h.el);
  dispose();assert.equal(h.doc.activeElement,h.opener);
});

test("modal cleanup preserves pre-existing inert state and never focuses a removed invoker", () => {
  const h=focusHarness({inert:true}),dispose=createStudyCardFocus(h.el);
  h.opener.isConnected=false;dispose();assert.equal(h.app.inert,true);assert.notEqual(h.doc.activeElement,h.opener);
  const h2=focusHarness(),dispose2=createStudyCardFocus(h2.el),newDestination=h2.control('new destination');
  h2.doc.activeElement=newDestination;dispose2();assert.equal(h2.doc.activeElement,newDestination);
});

test("proposal keeps original decisions and adds an explicit keyboard-control decision", async () => {
  assert.ok(proposalPage().includes('11. Associate card keyboard controls'));
  const changed=withinTabTransform(await fs.readFile(new URL('../src/Manager.jsx',import.meta.url),'utf8'));
  assert.ok(changed.includes('aria-modal={window.__SAGE_POLISH ? true : undefined}'));
  assert.ok(changed.includes('const releaseFocus = createStudyCardFocus(el)'));
});

test("optional final totals return the actual value on first render without number animation work", async () => {
  const changed=withinTabTransform(await fs.readFile(new URL('../src/Manager.jsx',import.meta.url),'utf8'));
  const start=changed.indexOf('function useCountUp('),end=changed.indexOf('\n/* Numbers roll up',start);
  let pending,counts=0;
  const context={window:{__SAGE_POLISH:true,__SAGE_FINAL_TOTALS:true},useState:()=>[0,()=>{throw new Error('final totals must not schedule fake intermediate values');}],useRef:v=>({current:v}),useEffect:fn=>pending=fn,
    createStudyCount:()=>{counts++;return ()=>{};}};
  const hook=vm.runInNewContext('('+changed.slice(start,end)+')',context);
  for(const value of [24.5,0,9,266]) {assert.equal(hook(value),value);pending();}
  assert.equal(counts,0);
  context.window.__SAGE_FINAL_TOTALS=false;hook(24.5);pending();assert.equal(counts,1);
  assert.ok(polishCSS.includes('.sage-polish.sage-study-reduce .sage-final-number { animation:none; }'));
});

test("final-total comparison is opt-in, keeps the old view until ready and can reverse", () => {
  const h=comparisonHarness();assert.equal(h.elements.totals.checked,false);
  h.elements.totals.checked=true;h.elements.totals.onchange();
  const pending=h.stack.children[1];assert.ok(pending.src.includes('totals=final'));
  assert.equal(h.stack.children[0],h.original);
  h.ready(pending);assert.deepEqual(h.stack.children,[pending]);
  h.elements.totals.checked=false;h.elements.totals.onchange();
  const reversal=h.stack.children[1];assert.ok(!reversal.src.includes('totals=final'));
  [...h.timers.values()][0]();assert.deepEqual(h.stack.children,[pending]);assert.equal(h.elements.totals.checked,true);
  h.elements.signin.onclick();assert.ok(pending.src.includes('totals=final'));
  assert.ok(proposalPage().includes('12. Accurate numbers at a glance'));
});

test("unchanged Proposed hero inputs keep the month-trail roster memo valid", async () => {
  const source=await fs.readFile(new URL('../src/Manager.jsx',import.meta.url),'utf8'),changed=heroRenderTransform(source);
  const start=changed.indexOf('function StoreHero('),line=changed.slice(start).split('\n').find(l=>l.includes('const boardRoster ='));
  let cached,prior,computations=0;
  const a={id:'sales',roleId:'sales'},b={id:'desk',roleId:'desk'};
  const context={window:{__SAGE_POLISH:true},data:{roster:[a,b]},config:{roles:[{id:'sales'},{id:'desk',onBoard:false}]},
    useMemo:(fn,deps)=>{if(!prior || deps.some((v,i)=>!Object.is(v,prior[i]))) {cached=fn();prior=deps;computations++;}return cached;}};
  const render=()=>{context.roster=context.data.roster.filter(a=>a.roleId);context.boardRoleIds=new Set(context.config.roles.filter(r=>r.onBoard!==false).map(r=>r.id));return vm.runInNewContext('(function(){'+line+'return boardRoster;})()',context);};
  const first=render();for(let i=0;i<10;i++) assert.equal(render(),first);
  assert.equal(computations,1);assert.deepEqual([...first],[a]);
  context.config.roles=[{id:'sales'},{id:'desk'}];assert.deepEqual([...render()],[a,b]);assert.equal(computations,2);
  context.data.roster=[b];assert.deepEqual([...render()],[b]);assert.equal(computations,3);
  context.window.__SAGE_POLISH=false;const current=render();assert.notEqual(render(),current);
  assert.throws(()=>heroRenderTransform('missing hero'));
});

test("board deduplication preserves real evaluation results with one computation per input pair", async () => {
  const source=await fs.readFile(new URL('../src/Manager.jsx',import.meta.url),'utf8');
  const start=source.indexOf('function evaluateAssociate('),end=source.indexOf('\n// which required',start);
  const evaluate=vm.runInNewContext('('+source.slice(start,end)+')',{METRICS:{calls:{kind:'count'},close:{kind:'pct'}}});
  const tiers=[{cap:30,requirements:[{metric:'calls',min:12},{metric:'close',min:20}]},{cap:10,requirements:[{metric:'calls',min:5}]}];
  const otherTiers=[{cap:20,requirements:[{metric:'close',min:30}]}];
  const people=[undefined,{opps:4},{opps:8,calls:10,close:.35},{opps:25,calls:3,close:.05},{opps:40,calls:30,close:.5}];
  let calls=0;const cached=createStudyEvaluationCache((...args)=>{calls++;return evaluate(...args);});
  for(let phase=0;phase<6;phase++) for(const person of people) {
    for(const standards of [tiers,otherTiers,undefined]) assert.deepEqual(cached(person,standards),evaluate(person,standards));
  }
  assert.equal(calls,people.length*3); // 15 actual evaluations, 90 requests.
  const sorted=[...people.slice(2)].sort((a,b)=>(cached(b,tiers).opps ?? 0)-(cached(a,tiers).opps ?? 0));
  assert.deepEqual(sorted.map(a=>a.opps),[40,25,8]);assert.equal(calls,15);
  // A new render intentionally discards the cache, even for a reused object.
  people[2].calls=0;
  const next=createStudyEvaluationCache(evaluate);
  assert.deepEqual(next(people[2],tiers),evaluate(people[2],tiers));
  assert.equal(next(people[2],tiers).status,'fail');
});

test("only the isolated Board uses per-render evaluation reuse and changed anchors fail closed", async () => {
  const source=await fs.readFile(new URL('../src/Manager.jsx',import.meta.url),'utf8'),changed=boardEvaluationTransform(source);
  assert.ok(changed.includes('window.__SAGE_POLISH ? createStudyEvaluationCache(evaluateAssociate) : evaluateAssociate'));
  assert.equal((changed.match(/evaluateBoard\(/g) || []).length,5);
  assert.ok(changed.includes('function evaluateAssociate(stats, tiers)'));
  assert.throws(()=>boardEvaluationTransform(source.replace('const ev = evaluateAssociate(st, tiers);','const ev = changedEvaluation(st, tiers);')));
});
