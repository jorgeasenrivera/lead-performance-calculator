import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { transformArrival, replaceOnce, arrivalPage, installScenario, serveArrivalPrototype } from "../scripts/arrival-prototype.mjs";

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

function engine() {
  const start = transformed.indexOf("function arrivalEngineCore(");
  const end = transformed.indexOf("/* A pair of frames",start);
  const events = [], context = {Math}; vm.createContext(context);
  const make = vm.runInContext("(" + transformed.slice(start,end).trim() + ")",context);
  let draws = 0;
  const ctx = new Proxy({}, {get:(_,key) => key === "clearRect" ? () => draws++ : () => {}});
  const instance = make(ctx,{W:100,H:100,dpr:1,T:{ratchet:10,reform:10,streaks:10,cruiseMin:10,cruiseCap:30,burst:10},FP:.5,mk:[],field:[],tunnel:[],font:"sans-serif"},(type,data) => events.push([type,data]));
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
