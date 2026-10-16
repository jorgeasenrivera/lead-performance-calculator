import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchManager, patchPhoneLayout } from "./build.mjs";
test("preview refuses to patch a changed Manager ownership boundary", async () => {
  const source = await readFile(
    new URL("../../src/Manager.jsx", import.meta.url),
    "utf8",
  );
  assert.throws(() => patchManager(source + "\n"), /Re-review entry points/);
  const patched = patchManager(source);
  assert.equal((patched.match(/scheduler-open/g) || []).length, 1);
  assert.ok(!patched.includes('onClick={() => setPop({ k: "onoff" })}'));
  assert.ok(!patched.includes('<BloopWin cls="dn s2-salewin">'));
  assert.ok(patched.includes("sp-mini-grid"));
  assert.ok(!patched.includes('<button className={"s2-imp s2-lampbtn"'));
  for (const route of ['function ManagerContextAction(', 'function ImportPanel(', 'onClick={() => { onClose(); onImport(); }}>Import</button>']) {
    assert.ok(source.includes(route) && patched.includes(route), "manual Import route preserved");
  }
  assert.equal(
    await readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8"),
    source,
  );
});

test("preview input-aware layout transform refuses changed core source", async()=>{
 const source=await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8");
 assert.throws(()=>patchPhoneLayout(source+"\n"),/Core layout boundary changed/);
 assert.ok(patchPhoneLayout(source).includes('(max-width: 700px) and (hover: none) and (pointer: coarse)'));
 assert.equal(await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8"),source);
});
