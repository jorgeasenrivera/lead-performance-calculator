import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchManager } from "./build.mjs";
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
  assert.equal(
    await readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8"),
    source,
  );
});
