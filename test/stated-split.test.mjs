/* The stock split the report states, with its shares (Codex, H-X22). The phone
   board read newPct and usedPct from a split that never carried them, and drew
   NaN for both paces on any store whose report states New and Used. The helper
   is lifted out of Manager.jsx and run, so this is the code that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = mgr.indexOf("const statedSplitOf = (M) => {");
const src = mgr.slice(start, mgr.indexOf("\n};\n", start) + 3);
const statedSplitOf = new Function(src + "\nreturn statedSplitOf;")();

test("a stated split carries its shares, over everything the report counted", () => {
  const s = statedSplitOf({ stated: { vehicles: { new: 40, used: 48, other: 12 } } });
  assert.deepEqual({ nw: s.nw, us: s.us, other: s.other, known: s.known }, { nw: 40, us: 48, other: 12, known: 100 });
  assert.equal(s.newPct, 0.4);
  assert.equal(s.usedPct, 0.48);
  assert.ok(Number.isFinite(Math.round(90 * s.newPct)), "the phone's pace is a number");
});

test("no split, or nothing counted, gives no shares rather than NaN", () => {
  assert.equal(statedSplitOf({}), null);
  assert.equal(statedSplitOf({ stated: { vehicles: { other: 3 } } }), null);
  const z = statedSplitOf({ stated: { vehicles: { new: 0, used: 0 } } });
  assert.equal(z.newPct, null);
  assert.equal(z.usedPct, null);
});

test("the phone and the desk take the same split, and the goal field has a name", () => {
  assert.equal((mgr.match(/if \(told\) return \{ seen: true, \.\.\.told \};/g) || []).length, 2, "both boards spread the one helper");
  assert.match(mgr, /aria-label="Units goal for the month" value=\{goalDraft\}/);
});
