import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {proposalTransform, arrivalBoundaryTransform, slowManagerImport, replaceExactlyOnce, proposalPage, polishCSS, installProposal, installArrivalProbe} from "../scripts/manager-polish-proposal.mjs";

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
