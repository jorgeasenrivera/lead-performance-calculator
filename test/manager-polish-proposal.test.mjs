import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {proposalTransform, replaceExactlyOnce, proposalPage, polishCSS, installProposal} from "../scripts/manager-polish-proposal.mjs";

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

test("approval page scripts parse and present all five decisions", () => {
  const html = proposalPage();
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.equal((html.match(/data-decision="/g) || []).length,5);
  assert.ok(html.includes("Fictional people and figures"));
});

test("motion is bounded, cancels and honours the system preference", () => {
  const runtime = installProposal.toString();
  assert.ok(runtime.includes('matchMedia("(prefers-reduced-motion: reduce)")'));
  assert.ok(runtime.includes(".slice(0, 6)"));
  assert.ok(runtime.includes("a.cancel()"));
  assert.ok(runtime.includes('"pagehide"'));
  assert.ok(polishCSS.includes("@media(prefers-reduced-motion:reduce)"));
  assert.ok(!polishCSS.includes("overflow-x:hidden"));
});
