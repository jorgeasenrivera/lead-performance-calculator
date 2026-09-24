import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { transformArrival, replaceOnce, arrivalPage, installScenario, serveArrivalPrototype, lightspeedStudyEngine, installArrivalPreview, studyCSS } from "../scripts/arrival-prototype.mjs";

const source = await fs.readFile(new URL("../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8");
const transformed = transformArrival(source);

test("proposal fails closed when its source anchors drift", () => {
  assert.throws(() => replaceOnce("aa","a","b"), /source changed/);
  assert.throws(() => replaceOnce("x","a","b"), /source changed/);
  assert.match(source,/cruiseMin: 1400/);
  assert.match(transformed,/cruiseMin: 360/);
  assert.match(transformed,/!!storeData && !storeMismatch && !storeLoadFailed/);
});

test("proposal readiness needs both good data and a prepared screen", () => {
  const begin = transformed.indexOf("let arrivalReady = false;");
  const end = transformed.indexOf("/* ---- every time",begin);
  const listeners = {};
  const context = {window:{},document:{addEventListener:(k,fn) => { listeners[k] = fn; },dispatchEvent(){}},CustomEvent:class {}};
  vm.createContext(context); vm.runInContext(transformed.slice(begin,end),context);
  const ready = () => vm.runInContext("arrivalReady",context);
  vm.runInContext("tellArrivalReady(true)",context); assert.equal(ready(),false);
  context.window.__sageProposalScreenReady = true;
  listeners["sage-proposal-screen-ready"](); assert.equal(ready(),true);
  vm.runInContext("tellArrivalReady(false)",context); assert.equal(ready(),false);
});

function engine(lead = 0) {
  const start = transformed.indexOf("function arrivalEngineCore(");
  const end = transformed.indexOf("/* A pair of frames",start);
  const events = [], context = {Math}; vm.createContext(context);
  const make = vm.runInContext("(" + transformed.slice(start,end).trim() + ")",context);
  let draws = 0;
  const ctx = new Proxy({}, {get:(_,key) => key === "clearRect" ? () => draws++ : key === "createRadialGradient" ? () => ({addColorStop(){}}) : () => {}});
  const instance = make(ctx,{W:100,H:100,dpr:1,lead,T:{ratchet:10,reform:10,streaks:10,cruiseMin:10,cruiseCap:30,burst:10},FP:.5,mk:[],field:[],tunnel:[],font:"sans-serif"},(type,data) => events.push([type,data]));
  return {instance,events,draws:() => draws};
}

test("cruise timeout waits without drawing or revealing an unfinished screen", () => {
  const {instance,events,draws} = engine();
  for(let t=1;t<=101;t+=10) instance.tick(t);
  assert.ok(events.some(e => e[1] === "waiting"));
  assert.ok(!events.some(e => e[0] === "flash"));
  const before = draws(); instance.tick(150); assert.equal(draws(),before);
  instance.msg({type:"ready",ready:true}); instance.tick(160);
  assert.equal(events.filter(e => e[0] === "flash").length,1);
  instance.tick(170); assert.equal(events.filter(e => e[0] === "flash").length,1);
});

test("a ready destination takes the burst path once", () => {
  const {instance,events} = engine(); instance.msg({type:"ready",ready:true});
  for(let t=1;t<=101;t+=10) instance.tick(t);
  assert.ok(events.some(e => e[1] === "burst"));
  assert.ok(!events.some(e => e[1] === "waiting"));
  assert.equal(events.filter(e => e[0] === "flash").length,1);
});

test("logo exchange waits for the first painted frame, and the opening has no sideways kick", () => {
  const {instance,events} = engine(100);
  instance.tick(1); instance.tick(51);
  assert.equal(events.filter(e => e[0] === "paint").length,0);
  instance.tick(101); instance.tick(111); instance.tick(121);
  assert.equal(events.filter(e => e[0] === "paint").length,1);
  assert.match(transformed,/if \(type === "paint"\) \{ cv.style.opacity = "1"; root.classList.add\("sage-cv"\); \}/);
  assert.doesNotMatch(transformed,/d.hx \+ k \* 2.5/);
  assert.doesNotMatch(transformed,/Math.max\(d.hy, d.sy\) \+ 90/);
  assert.match(transformed,/cv.parentNode && !root.classList.contains\("proposal-waiting"\)/);
});

test("fault injection is scoped to local store reads and keeps abort semantics", async () => {
  let calls = 0; const events = [];
  const ctx = {URL,Response,DOMException,Event,CustomEvent:class {constructor(type,init){this.type=type;this.detail=init.detail;}},Date,Object,String,
    location:{hostname:"127.0.0.1",href:"http://127.0.0.1:49211/app"},parent:{},
    localStorage:{removeItem(){},setItem(){}},document:{dispatchEvent:e=>events.push(e.detail)},
    window:{fetch:async()=>{calls++;return new Response("[]");}},
    setTimeout:fn=>setTimeout(fn,1),clearTimeout};
  vm.createContext(ctx); vm.runInContext(`(${installScenario.toString()})("interrupted",false)`,ctx);
  assert.equal((await ctx.window.fetch("http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc:store:sage-demo")).status,503);
  assert.equal(calls,0);
  await ctx.window.fetch("http://127.0.0.1:5433/rest/v1/profiles"); assert.equal(calls,1);
  await ctx.window.fetch("http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc:store:sage-demo",{method:"POST"}); assert.equal(calls,2);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(ctx.window.fetch("http://127.0.0.1:5433/rest/v1/app_data?key=eq.lpc:store:sage-demo",{signal:abort.signal}),{name:"AbortError"});
  assert.ok(events.includes("interrupted"));
});

test("proposal page has a single live viewport, recovery controls and per-item decisions", () => {
  const html = arrivalPage();
  assert.equal((html.match(/<iframe /g)||[]).length,1);
  assert.equal((html.match(/<select>/g)||[]).length,3);
  assert.match(html,/frame.src='about:blank'/);
  assert.match(html,/e.source!==frame.contentWindow/);
  assert.match(html,/your device preference is always respected/);
});

test("saved draft stays separate and neither recovery view has the extra label", () => {
  assert.match(arrivalPage(),/Saved arrival draft/);
  assert.match(arrivalPage(),/study=0/);
  assert.match(arrivalPage(true),/Lightspeed study/);
  assert.match(arrivalPage(true),/study=1/);
  assert.doesNotMatch(installArrivalPreview.toString(),/SAGE \/ ARRIVAL PAUSED/);
  assert.match(transformed,/if \(world.study\) return/);
  assert.match(transformed,/window.__sageProposalStudy \? 1.5 : 2/);
  assert.match(studyCSS,/prefers-reduced-motion:reduce/);
});

test("study login folds downward without horizontal travel or outward enlargement",()=>{
  const expression=/card\.style\.transform = (window\.__sageProposalStudy[^;]+);/.exec(transformed)[1];
  let previousY=-1;
  for(let k=0;k<=1;k+=.05){
    const transform=vm.runInNewContext(expression,{window:{__sageProposalStudy:true},k});
    const match=/^translate3d\(0,([\d.]+)px,0\) scale\(([\d.]+),([\d.]+)\)$/.exec(transform);
    assert.ok(match,transform);
    const [,y,sx,sy]=match.map(Number);
    assert.ok(y>=previousY && y<=96);previousY=y;
    assert.ok(sx>=.96 && sx<=1 && sy>=.82 && sy<=1);
  }
  assert.equal(vm.runInNewContext(expression,{window:{__sageProposalStudy:false},k:1}),'scale(0.92)');
  assert.match(studyCSS,/\.proposal-study \.login-card \{ transform-origin:50% 100%; \}/);
});

function studyEngine() {
  const events=[],geometry=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):(...args)=>{
    if(['arc','moveTo','lineTo'].includes(key))geometry.push(args);
  }});
  const instance=lightspeedStudyEngine(ctx,{W:400,H:300,dpr:1,lead:0,
    mk:[{hx:130,hy:90,hr:2,sx:197,sy:153,sr:1,jit:.4,fill:'#294B3B'}],
    field:[{x:40,y:40,size:2,tint:'rgba(100,140,110,0.5)'},{x:-20,y:40,size:2,tint:'#123456'}]},(type,data)=>events.push([type,data]));
  return {instance,events,geometry};
}

test("study freezes after the wait cap and never reveals without readiness",()=>{
  const {instance,events,geometry}=studyEngine();
  for(let t=0;t<=5000;t+=16)instance.tick(t);
  assert.ok(events.some(e=>e[1]==='waiting'));
  assert.ok(!events.some(e=>e[0]==='flash'));
  const before=geometry.length;instance.tick(6000);assert.equal(geometry.length,before);
  instance.msg({type:'ready',ready:true});
  for(let t=6016;t<=6800;t+=16)instance.tick(t);
  assert.equal(events.filter(e=>e[0]==='flash').length,1);
  assert.equal(events.find(e=>e[0]==='metrics')[1].particles,2);
  assert.ok(geometry.flat().every(Number.isFinite));
});

test("study handles early readiness and cancellation without a second completion",()=>{
  const {instance,events}=studyEngine();instance.msg({type:'ready',ready:true});
  for(let t=0;t<3600;t+=8)instance.tick(t);
  assert.equal(events.filter(e=>e[0]==='paint').length,1);
  assert.equal(events.filter(e=>e[0]==='flash').length,1);
  assert.ok(!events.some(e=>e[1]==='waiting'));
  const stopped=studyEngine();stopped.instance.tick(0);stopped.instance.msg({type:'stop'});
  stopped.instance.msg({type:'ready',ready:true});stopped.instance.tick(10000);
  assert.ok(!stopped.events.some(e=>e[0]==='flash'));
});

test("store name holds a readable cruise beat and repeated messages do not restart it",()=>{
  const {instance,events}=studyEngine();
  instance.msg({type:'ready',ready:true});
  for(let t=0;t<=2800;t+=16){
    instance.msg({type:'dest',dest:{name:'  Driver’s Mart Winter Park  '}});instance.tick(t);
  }
  assert.deepEqual(events.filter(e=>e[0]==='destination'),[['destination','Driver’s Mart Winter Park']]);
  assert.ok(!events.some(e=>e[1]==='burst'));
  for(let t=2816;t<=3700;t+=16)instance.tick(t);
  assert.equal(events.filter(e=>e[0]==='flash').length,1);
  assert.match(installArrivalPreview.toString(),/destination.firstChild.textContent=e.detail/);
  assert.match(studyCSS,/proposal-waiting \.proposal-destination/);
  assert.match(studyCSS,/prefers-reduced-motion:reduce\)\{\.proposal-destination\{display:none/);
});

test("late store names are readable without allowing a failed load to land",()=>{
  const {instance,events}=studyEngine();
  for(let t=0;t<=2400;t+=16)instance.tick(t);
  assert.ok(!events.some(e=>e[0]==='destination'));
  instance.msg({type:'dest',dest:{name:'East Orlando Mitsubishi'}});
  for(let t=2416;t<=5000;t+=16)instance.tick(t);
  assert.deepEqual(events.filter(e=>e[0]==='destination'),[['destination','East Orlando Mitsubishi']]);
  assert.ok(events.some(e=>e[1]==='waiting'));
  assert.ok(!events.some(e=>e[0]==='flash'));
});

test("study keeps the first pass balanced and every exposure radial to one fixed centre",()=>{
  const arcs=[],segments=[];let tail;
  const ctx=new Proxy({}, {get:(_,key)=>{
    if(key==='createRadialGradient')return ()=>({addColorStop(){}});
    if(key==='arc')return (x,y)=>arcs.push([x,y]);
    if(key==='moveTo')return (x,y)=>{tail=[x,y];};
    if(key==='lineTo')return (x,y)=>segments.push({tail,head:[x,y]});
    return ()=>{};
  }});
  const field=[[70,80],[330,220],[70,220],[330,80]].map(([x,y])=>({x,y,size:2,tint:'#294b3b'}));
  const engine=lightspeedStudyEngine(ctx,{W:400,H:300,dpr:1,mk:[],field,lead:0},()=>{});
  engine.tick(0);
  for(let i=0;i<4;i++){
    assert.ok(Math.abs(arcs[i][0]-field[i].x)<1e-8);
    assert.ok(Math.abs(arcs[i][1]-field[i].y)<1e-8);
  }
  let checked=0;
  for(let t=16;t<=2400;t+=16){
    segments.length=0;engine.tick(t);
    if(!segments.length)continue;
    for(const {tail:[tx,ty],head:[hx,hy]} of segments){
      assert.ok(Math.abs((tx-200)*(hy-150)-(ty-150)*(hx-200))<1e-7);
      assert.ok(Math.hypot(hx-200,hy-150)>Math.hypot(tx-200,ty-150));
    }
    // After the first pass, independent respawns intentionally stop mirroring.
    // The extended border can draw streaks before these four original dots.
    const original=segments.filter(({head:[x,y]})=>Math.abs(Math.abs(x-200)*70-Math.abs(y-150)*130)<1e-7);
    if(t<1700 && original.length)for(const [a,b] of [[0,2],[4,6]]){
      assert.equal(original.length,8);
      assert.ok(Math.abs(original[a].head[0]+original[b].head[0]-400)<1e-8);
      assert.ok(Math.abs(original[a].head[1]+original[b].head[1]-300)<1e-8);
    }
    checked++;
  }
  assert.ok(checked>20);
  assert.match(transformed,/window.__sageProposalStudy \? document.body.getBoundingClientRect\(\).width : window.innerWidth/);
});

test("the pull reveals existing offscreen grid dots rather than an empty border",()=>{
  const arcs=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):key==='arc'?(x,y)=>arcs.push([x,y]):()=>{}});
  const field=[];
  for(let y=22;y<300;y+=44)for(let x=22;x<400;x+=44)field.push({x,y,size:2,tint:'#294b3b'});
  const engine=lightspeedStudyEngine(ctx,{W:400,H:300,dpr:1,mk:[],field},()=>{});
  engine.tick(0);
  assert.ok(arcs.some(([x,y])=>x===418 && y===22));
  arcs.length=0;engine.tick(880);
  assert.ok(arcs.some(([x,y])=>Math.abs(x-387.48)<1e-7 && Math.abs(y-39.92)<1e-7));
});

test("recycled streaks draw fresh random lifetimes without growing their pool",()=>{
  let seed=123,draws=0;const events=[];
  const random=()=>{draws++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const ctx=new Proxy({}, {get:(_,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}});
  const field=[];
  for(let y=22;y<600;y+=44)for(let x=22;x<800;x+=44)field.push({x,y,size:2,tint:'#294b3b'});
  const engine=lightspeedStudyEngine(ctx,{W:800,H:600,dpr:1,mk:[],field,random},(type,data)=>events.push([type,data]));
  const births=[];let previous=0;
  for(let t=0;t<=4100;t+=16){engine.tick(t);if(t>=2600){births.push((draws-previous)/4);}previous=draws;}
  assert.ok(draws>field.length*4);
  // A cohort must not disappear for a long beat and then all return together.
  const bins=[];for(let i=0;i<births.length;i+=12)bins.push(births.slice(i,i+12).reduce((a,b)=>a+b,0));
  assert.ok(bins.every(n=>n>0),JSON.stringify(bins));
  assert.ok(Math.max(...bins)/Math.min(...bins)<4,JSON.stringify(bins));
  engine.msg({type:'ready',ready:true});for(let t=4112;t<4900;t+=16)engine.tick(t);
  const metrics=events.find(e=>e[0]==='metrics')[1];
  assert.ok(metrics.particles>field.length && metrics.particles<field.length*2);
});

test("server refuses production bundles and blocks writes, traversal and service workers", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sage-arrival-test-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,"assets"));
  await fs.writeFile(path.join(root,"index.html"),'<html><head></head><body><script src="/assets/index-demo.js"></script></body></html>');
  const entry = path.join(root,"assets/index-demo.js");
  await fs.writeFile(entry,"live-backend");
  await assert.rejects(serveArrivalPrototype(root,0),/isolated proposal/);
  await fs.writeFile(entry,"http://127.0.0.1:5433 sage-proposal-screen-ready");
  const server = await serveArrivalPrototype(root,0);
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url,{method:"POST"})).status,405);
  assert.equal((await fetch(url+"/sw.js")).status,204);
  assert.equal((await fetch(url+"/%2e%2e%5cpackage.json")).status,403);
  const html = await (await fetch(url+"/app?scenario=interrupted&reduce=1")).text();
  assert.match(html,/\("interrupted",true\)/);
  assert.ok(html.indexOf("installScenario") < html.indexOf("index-demo.js"));
});
