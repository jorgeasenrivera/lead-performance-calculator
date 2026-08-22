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
import { sameAs, foldAliases, manglings, unclaimed, unfold, folds } from "../api/_people-status.mjs";
import { mergeAgainstServer } from "../api/_store-merge.mjs";

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


/* =========================================================================
   And the seventh time, reported the same way: "trying to merge and it's still
   clicking and then reverting back", twenty-four names at Holler Honda.

   The figures were fixed. The LISTS were not. sameAs takes the misspelling off
   the roster and out of the holding pen by deleting it, and both of those are
   unions in the merge — the roster so a stale tab cannot drop somebody, the pen
   so two reports can each hold half of one unclaimed person. The server's copy
   handed the name straight back, and the screen offered it again.

   Every list this store keeps is checked here, because "we fixed the two that
   were reported" is what produced instances two through six.
   ========================================================================= */
const withName = (where) => {
  const d = store();
  d.excluded = d.excluded || []; d.departed = d.departed || []; d.pendingPeople = d.pendingPeople || {};
  d.importLog = [{ id: "i1", t: "2026-08-21T10:00:00.000Z" }];
  if (where === "roster") d.roster.push({ id: "a9", name: "Alejandro Diaz Visit", roleId: "sales" });
  if (where === "excluded") d.excluded.push("Alejandro Diaz Visit");
  if (where === "departed") d.departed.push({ name: "Alejandro Diaz Visit", at: "2026-07-01T00:00:00.000Z" });
  if (where === "pendingPeople") d.pendingPeople["alejandro diaz visit"] = { name: "Alejandro Diaz Visit", months: {}, days: {} };
  return d;
};
/* The ordinary case, not the rare one: reports arrive hourly, so the server
   almost always has an import this browser has never seen. */
const serverAhead = (d) => {
  const s = JSON.parse(JSON.stringify(d));
  s.importLog = [{ id: "i2", t: "2026-08-21T18:00:00.000Z" }];
  return s;
};

for (const where of ["roster", "excluded", "departed", "pendingPeople", "the figures alone"]) {
  test(`a name folded away does not come back off ${where}`, () => {
    const mine = withName(where);
    const rows = manglings(mine);
    assert.equal(rows.length, 1, `nothing was offered to merge from ${where}`);
    const folded = sameAs(mine, rows[0].from, rows[0].to, { by: "Jorge" });
    assert.deepEqual(manglings(folded), [], "still offered before the merge even ran");
    const out = mergeAgainstServer(JSON.parse(JSON.stringify(folded)), serverAhead(mine));
    assert.deepEqual(manglings(out).map((r) => r.from), [],
      `came back off ${where}: the merge screen offers it again seconds after it was merged`);
  });
}

test("and the person it was folded into keeps everything", () => {
  const mine = withName("roster");
  const rows = manglings(mine);
  const out = mergeAgainstServer(
    JSON.parse(JSON.stringify(sameAs(mine, rows[0].from, rows[0].to, { by: "Jorge" }))), serverAhead(mine));
  assert.equal(out.months[ym].stats["alejandro diaz"].internetUnits, 7, "3 folded into 4");
  assert.equal(out.months[ym].stats["alejandro diaz visit"], undefined);
  assert.ok(out.roster.some((a) => a.name === "Alejandro Diaz"), "the real person was taken off the roster");
  assert.equal(out.roster.filter((a) => /Visit/.test(a.name)).length, 0);
});

test("everybody else on the lists is left exactly where they were", () => {
  /* The fold reaches into four lists now. A pass that took anybody else off any
     of them would be a far worse fault than the one it fixes. */
  const mine = withName("roster");
  mine.roster.push({ id: "a2", name: "Fin Smith", roleId: "sales" });
  mine.excluded.push("Round Robin");
  mine.departed.push({ name: "Rick Dawkins", at: "2026-07-01T00:00:00.000Z" });
  mine.pendingPeople["vernon johnson"] = { name: "Vernon Johnson", months: {}, days: {} };
  const rows = manglings(mine);
  const out = foldAliases(sameAs(mine, rows[0].from, rows[0].to, { by: "Jorge" }));
  assert.ok(out.roster.some((a) => a.name === "Fin Smith"));
  assert.ok(out.excluded.includes("Round Robin"));
  assert.ok(out.departed.some((d) => d.name === "Rick Dawkins"));
  assert.ok(out.pendingPeople["vernon johnson"], "somebody still waiting to be claimed was dropped");
});

test("a store with no folds at all is not touched", () => {
  const d = store();
  d.roster.push({ id: "a9", name: "Alejandro Diaz Visit", roleId: "sales" });
  const before = JSON.stringify(d);
  foldAliases(d);
  assert.equal(JSON.stringify(d), before, "a document with no aliases must come back untouched");
});


/* =========================================================================
   Undoing one.

   Wanted for the case the fold cannot handle by design: somebody genuinely
   called what a misspelling was folded into. While a name is an alias it cannot
   be on any list at all, so without this there is no way back.

   And it is the eighth instance of the removal fault waiting to happen. The
   aliases are a union, so deleting a key is undone by the first save from any
   other tab -- which is exactly how the last seven went. It is a stamp.
   ========================================================================= */
const foldedStore = () => {
  const d = withName("roster");
  const rows = manglings(d);
  return sameAs(d, rows[0].from, rows[0].to, { by: "Jorge", at: "2026-08-20T10:00:00.000Z" });
};

test("a fold can be undone, and the spelling is free again", () => {
  const out = unfold(foldedStore(), "Alejandro Diaz Visit", { by: "Jorge" });
  assert.equal(out.aliases["alejandro diaz visit"], undefined);
  assert.ok(out.aliasesGone["alejandro diaz visit"], "nothing written down means nothing survives a merge");
  assert.equal(out.peopleLog[0].name, "Alejandro Diaz Visit");
});

test("undoing it survives a merge with a copy that still has the fold", () => {
  /* The whole reason it is a stamp. Without this the fold is back within
     seconds, which is instances one through seven of this fault verbatim. */
  const folded = foldedStore();
  const out = mergeAgainstServer(
    JSON.parse(JSON.stringify(unfold(folded, "Alejandro Diaz Visit", { by: "Jorge", at: "2026-08-21T10:00:00.000Z" }))),
    folded);
  assert.equal(out.aliases["alejandro diaz visit"], undefined,
    "the fold came back: " + JSON.stringify(out.aliases));
});

test("and folding it again afterwards also sticks", () => {
  // Both directions, however many times somebody changes their mind.
  const undone = unfold(foldedStore(), "Alejandro Diaz Visit", { by: "Jorge", at: "2026-08-21T10:00:00.000Z" });
  const again = sameAs(undone, "Alejandro Diaz Visit", "Alejandro Diaz",
    { by: "Jorge", at: "2026-08-22T10:00:00.000Z" });
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(again)), undone);
  assert.equal(out.aliases["alejandro diaz visit"], "alejandro diaz");
});

test("an older undo does not beat a newer fold", () => {
  const undone = unfold(foldedStore(), "Alejandro Diaz Visit", { by: "Jorge", at: "2026-08-19T10:00:00.000Z" });
  // The server folded it after this browser undid it.
  const server = sameAs(undone, "Alejandro Diaz Visit", "Alejandro Diaz",
    { by: "Ada", at: "2026-08-22T10:00:00.000Z" });
  assert.equal(mergeAgainstServer(JSON.parse(JSON.stringify(undone)), server).aliases["alejandro diaz visit"],
    "alejandro diaz");
});

test("a fold made before stamps existed is still undoable", () => {
  /* Every store has folds from before any of this. They have no stamp, and an
     absence of one is not a claim that the fold is newer than the undo. */
  const d = withName("roster");
  d.aliases = { "alejandro diaz visit": "alejandro diaz" };
  const out = mergeAgainstServer(
    JSON.parse(JSON.stringify(unfold(d, "Alejandro Diaz Visit", { by: "Jorge" }))), d);
  assert.equal(out.aliases["alejandro diaz visit"], undefined);
});

test("undoing something that was never folded changes nothing", () => {
  const d = withName("roster");
  const before = JSON.stringify(d);
  assert.equal(JSON.stringify(unfold(d, "Somebody Else", { by: "Jorge" })), before);
});

test("the figures do NOT come back apart, and nothing pretends they do", () => {
  /* Five and three became eight when the fold happened, and nothing anywhere
     records which of the eight came from where. Giving a number back would mean
     guessing at somebody's month. */
  const folded = foldedStore();
  assert.equal(folded.months[ym].stats["alejandro diaz"].internetUnits, 7);
  const out = unfold(folded, "Alejandro Diaz Visit", { by: "Jorge" });
  assert.equal(out.months[ym].stats["alejandro diaz"].internetUnits, 7, "invented a split");
  assert.equal(out.months[ym].stats["alejandro diaz visit"], undefined);
});

test("the list of folds says what was folded into whom, newest first", () => {
  let d = foldedStore();
  d = sameAs(d, "Alex Diaz Visit", "Alejandro Diaz", { by: "Jorge", at: "2026-08-21T10:00:00.000Z" });
  const list = folds(d);
  assert.deepEqual(list.map((f) => f.from), ["alex diaz visit", "alejandro diaz visit"]);
  assert.equal(list[0].to, "alejandro diaz");
  assert.equal(list[0].at, "2026-08-21T10:00:00.000Z");
});
