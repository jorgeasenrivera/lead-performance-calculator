import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {proposalTransform, arrivalBoundaryTransform, slowManagerImport, replaceExactlyOnce, proposalPage, polishCSS, installProposal, installArrivalProbe, installComparison, withinTabTransform, createStudyCardMotion, createStudyCount} from "../scripts/manager-polish-proposal.mjs";

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
  assert.equal((html.match(/data-decision="/g) || []).length,8);
  assert.ok(html.includes("Compact phone, 320 x 568"));
  assert.ok(html.includes("Landscape, 844 x 390"));
  assert.ok(html.includes("8. Compact phone History"));
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
  assert.ok(changed.includes('motion.dispose(); studyMotion.current = null;'));
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
  for (const key of ["status","trace","reduce","current","proposed","replay","signin"]) elements[key]={id:key,checked:false,setAttribute(k,v){this[k]=v;}};
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
