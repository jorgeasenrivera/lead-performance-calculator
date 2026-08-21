/**
 * A merged name must not come back.
 * -------------------------------------------------------------------------
 * "Tried merging and then after a few seconds it popped back up."
 *
 * The fifth time this store has lost a removal to the same trap, and the first
 * time it was the FIGURES rather than a list. sameAs took the mangled spelling
 * off the roster, the ignore list and the departed list, all correctly stamped
 * — and folded its numbers into the real person by deleting a key. Then the
 * merge ran:
 *
 *   if (newestImport(serverCopy) > newestImport(next)) next.months = serverCopy.months
 *
 * which is right on its own terms, and hands back every mangled spelling with
 * it. Reports arrive hourly, so the server almost always has the newer import
 * and that branch is the normal case.
 *
 * The fold is now a decision that gets re-applied, not a deletion that hopes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameAs, foldAliases, manglings, unclaimed } from "../api/_people-status.mjs";

const ym = new Date().toISOString().slice(0, 7);
const store = () => ({
  roster: [{ id: "a1", name: "Alejandro Diaz", roleId: "sales" }],
  months: { [ym]: { stats: {
    "alejandro diaz": { displayName: "Alejandro Diaz", internetUnits: 4, calls: 10 },
    "alejandro diaz visit": { displayName: "Alejandro Diaz Visit", internetUnits: 3, calls: 5 },
  }, names: {}, imports: {} } },
  activity: { "2026-08-20": { "alejandro diaz visit": { calls: 5 } } },
  aliases: {}, excluded: [], departed: [],
});

// ---- the reader's leftovers are offered, and merging folds them ----
test("a column heading welded to a name is offered, and merging folds the figures", () => {
  const before = manglings(store());
  assert.equal(before.length, 1, JSON.stringify(before));
  assert.equal(before[0].from, "Alejandro Diaz Visit");

  const after = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", { by: "Jorge" });
  const st = after.months[ym].stats;
  assert.equal(st["alejandro diaz visit"], undefined, "the mangled key should be gone");
  assert.equal(st["alejandro diaz"].internetUnits, 7, "both halves of the month, added");
  assert.equal(st["alejandro diaz"].calls, 15, JSON.stringify(st["alejandro diaz"]));
  assert.equal(manglings(after).length, 0, JSON.stringify(manglings(after)));
});

// ---- the bug the user hit: the server hands the month straight back ----
test("and it stays merged when the server hands its own month back", () => {
  const merged = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", { by: "Jorge" });
  // What the merge does when the server has an import this browser has not seen.
  merged.months = JSON.parse(JSON.stringify(store().months));
  merged.activity = JSON.parse(JSON.stringify(store().activity));
  // Before the fix this was the end of it and the name was back on the screen.
  foldAliases(merged);
  const st = merged.months[ym].stats;
  assert.equal(st["alejandro diaz visit"], undefined, "it came back: " + JSON.stringify(Object.keys(st)));
  assert.equal(st["alejandro diaz"].internetUnits, 7, JSON.stringify(st["alejandro diaz"]));
  assert.equal(merged.activity["2026-08-20"]["alejandro diaz visit"], undefined);
  assert.equal(manglings(merged).length, 0, JSON.stringify(manglings(merged)));
});

// ---- running it twice must not count the same cars twice ----
test("folding the same figures again does not double them", () => {
  const merged = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", {});
  foldAliases(merged); foldAliases(merged); foldAliases(merged);
  assert.equal(merged.months[ym].stats["alejandro diaz"].internetUnits, 7,
    JSON.stringify(merged.months[ym].stats));
});

// ---- a fresh import writing the old spelling again is folded on arrival ----
test("a later report using the mangled spelling folds in too", () => {
  const merged = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", {});
  merged.months[ym].stats["alejandro diaz visit"] = { displayName: "Alejandro Diaz Visit", internetUnits: 2 };
  foldAliases(merged);
  assert.equal(merged.months[ym].stats["alejandro diaz"].internetUnits, 9,
    JSON.stringify(merged.months[ym].stats));
});

// ---- a folded name is not somebody waiting to be claimed ----
test("a folded spelling is not offered as an unclaimed person", () => {
  const merged = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", {});
  merged.months[ym].stats["alejandro diaz visit"] = { displayName: "Alejandro Diaz Visit", internetUnits: 2 };
  assert.ok(!unclaimed(merged).some((u) => u.key === "alejandro diaz visit"),
    JSON.stringify(unclaimed(merged)));
});

// ---- a chain of aliases lands on the person at the end of it ----
test("an alias pointing at an alias lands on the real person", () => {
  let d = sameAs(store(), "Alejandro Diaz Visit", "Alejandro Diaz", {});
  d.months[ym].stats["alejandro diaz visit visit"] = { internetUnits: 1 };
  d.aliases["alejandro diaz visit visit"] = "alejandro diaz visit";
  foldAliases(d);
  assert.equal(d.months[ym].stats["alejandro diaz"].internetUnits, 8,
    JSON.stringify(d.months[ym].stats));
});
