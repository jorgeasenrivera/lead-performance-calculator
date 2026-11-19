/**
 * The Dashboard's one link to People: how many names need review.
 * -------------------------------------------------------------------------
 * The Dashboard used to carry two prompts, "Select people to ignore" and a
 * "Needs a position" card. They became one line on 18 November at Jorge's
 * word: "3 names need review · Open People", counting each person once. The
 * count is the only thing the Dashboard does now. These hold it to that, on
 * fictional people.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReview, statusOf } from "../api/_people-status.mjs";

const store = () => ({
  roster: [
    { id: "p1", name: "Avery Fable", roleId: "sales" },
    { id: "p2", name: "Briar Testwood", roleId: null },       // on the floor, no position
    { id: "p3", name: "Cedar Mockley" },                      // no position field at all
  ],
  departed: [], excluded: [], ignoredAt: {}, unignored: {}, returned: {}, aliases: {},
  months: { "2026-11": { stats: {
    "avery fable": { displayName: "Avery Fable", internetUnits: 3 },
    "briar testwood": { displayName: "Briar Testwood", phoneUnits: 1 },
    "dune stranger": { displayName: "Dune Stranger", showroomUnits: 2 },   // in the books, on no list
  } } },
  activity: {},
  pendingPeople: {
    "ember heldover": { name: "Ember Heldover", firstSeen: "2026-11-18T12:00:00.000Z", months: {}, days: {} },
  },
});

test("each list that asks for a decision adds its names", () => {
  // Briar and Cedar need a position, Dune is unclaimed, Ember is held.
  assert.equal(needsReview(store()), 4);
});

test("somebody on two lists is one name, not two", () => {
  const d = store();
  // A held name that also left figures in the books shows on both lists.
  d.months["2026-11"].stats["ember heldover"] = { displayName: "Ember Heldover", internetUnits: 1 };
  assert.equal(needsReview(d), 4);
});

test("a store with nothing to decide says nothing", () => {
  const d = store();
  d.roster = d.roster.map((a) => ({ ...a, roleId: "sales" }));
  delete d.months["2026-11"].stats["dune stranger"];
  d.pendingPeople = {};
  assert.equal(needsReview(d), 0);
  assert.equal(needsReview(null), 0);
});

test("counting changes nobody's standing", () => {
  const d = store();
  const before = JSON.stringify(d);
  needsReview(d);
  assert.equal(JSON.stringify(d), before, "the count must not write to the store");
  assert.equal(statusOf(d, "Briar Testwood"), "active");
});

test("a spelling already folded into somebody is not asked about again", () => {
  const d = store();
  d.aliases = { "dune stranger": "avery fable" };
  assert.equal(needsReview(d), 3);
});

/* Jorge, 19 November, for shipping #542: keep the overseer's read-only "Needs
   a position" list and search results, without adding edit controls, and
   managers keep the single Open People link. */
test("the overseer keeps a read-only Needs a position list; managers get the link", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  const board = src.slice(src.indexOf("function Board({"), src.indexOf("\n}\n", src.indexOf("function Board({")));
  assert.match(board, /const showUnassigned = !onOpenPeople;/);
  assert.match(board, /\+ unassigned\.length;/);                 // search results count them
  const at = board.indexOf("Needs a position <span");
  const card = board.slice(at, board.indexOf("</section>", at));
  assert.ok(card.length > 0);
  assert.doesNotMatch(card, /<select|onMove|<button/);            // nothing to change on it
  assert.match(board, /!readOnly && onOpenPeople && !query && reviewCount > 0/);
});
