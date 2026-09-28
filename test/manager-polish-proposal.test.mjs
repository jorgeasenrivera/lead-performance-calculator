import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {proposalTransform, arrivalBoundaryTransform, slowManagerImport, replaceExactlyOnce, proposalPage, polishCSS, installProposal, installArrivalProbe, installComparison} from "../scripts/manager-polish-proposal.mjs";

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

test("approval page scripts parse and present all five decisions", () => {
  const html = proposalPage();
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.equal((html.match(/data-decision="/g) || []).length,5);
  assert.ok(html.includes("Fictional people and figures"));
  assert.ok(html.includes("Replay full sign-in"));
  assert.ok(html.includes("Replay page motion"));
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
