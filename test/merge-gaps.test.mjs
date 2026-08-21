/**
 * Two managers, one store, at the same moment.
 * -------------------------------------------------------------------------
 * Seven fields had no merge rule at all. Not a rule that was wrong — no rule:
 * the client's whole copy was written over the server's, so whichever manager
 * saved second silently threw away the first one's work. No error, nothing in
 * the log, and the only way to find out was to notice a setting had gone back.
 *
 * Jorge asked for this specifically, and the reason is worth keeping: many
 * managers across many stores and many reps, all on one system. Two people
 * changing two different things at once is the ordinary case here, not a race
 * worth losing.
 *
 * Each check below is that ordinary case. One manager changes one person while
 * another changes a different person, and both changes have to survive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeAgainstServer } from "../api/_store-merge.mjs";

const T = (d) => new Date(Date.UTC(2026, 7, d)).toISOString();
const merge = (mine, server) => mergeAgainstServer(JSON.parse(JSON.stringify(mine)), server);

/* ---- restrictions: off leads, and back on ---- */
test("two managers restricting two different people both stick", () => {
  const server = { restrictions: { a1: { why: "training" } }, restrictionsAt: { a1: T(2) } };
  const mine   = { restrictions: { a2: { why: "attendance" } }, restrictionsAt: { a2: T(3) } };
  const out = merge(mine, server);
  assert.deepEqual(Object.keys(out.restrictions).sort(), ["a1", "a2"],
    "one of them was thrown away: " + JSON.stringify(out.restrictions));
});

test("lifting a restriction is not undone by a tab that still has it", () => {
  // The shape that has bitten five times: a removal meeting a copy that never heard of it.
  const server = { restrictions: { a1: { why: "training" } }, restrictionsAt: { a1: T(2) } };
  const mine   = { restrictions: {}, restrictionsAt: { a1: T(4) } };   // lifted, and stamped
  assert.equal(merge(mine, server).restrictions.a1, undefined, "the restriction came back");
});

test("but an older lift does not beat a newer restriction", () => {
  const server = { restrictions: { a1: { why: "re-restricted" } }, restrictionsAt: { a1: T(9) } };
  const mine   = { restrictions: {}, restrictionsAt: { a1: T(4) } };
  assert.deepEqual(merge(mine, server).restrictions.a1, { why: "re-restricted" });
});

test("a restriction written before stamps existed is not deleted by one", () => {
  /* Every store has data from before this. An absence on the other side is
     ignorance, not a decision, and must not read as a removal. */
  const server = { restrictions: { a1: { why: "old" } } };            // no stamps at all
  const mine   = { restrictions: {}, restrictionsAt: {} };
  assert.deepEqual(merge(mine, server).restrictions, { a1: { why: "old" } });
});

/* ---- goals: an individual's monthly number, set under coaching ---- */
test("two managers setting two people's goals both stick", () => {
  const server = { goals: { a1: { monthly: 12 } }, goalsAt: { a1: T(2) } };
  const mine   = { goals: { a2: { monthly: 15 } }, goalsAt: { a2: T(2) } };
  assert.deepEqual(Object.keys(merge(mine, server).goals).sort(), ["a1", "a2"]);
});

test("the later of two edits to the same goal wins", () => {
  const server = { goals: { a1: { monthly: 12 } }, goalsAt: { a1: T(2) } };
  const mine   = { goals: { a1: { monthly: 20 } }, goalsAt: { a1: T(5) } };
  assert.equal(merge(mine, server).goals.a1.monthly, 20);
  assert.equal(merge({ goals: { a1: { monthly: 20 } }, goalsAt: { a1: T(1) } }, server).goals.a1.monthly, 12);
});

/* ---- baselines: what every coaching target is built from ---- */
test("a baseline seeded in one tab is not wiped by another that never saw it", () => {
  const server = { baselines: { a1: { daysWorked: 30 } }, baselinesAt: { a1: T(6) } };
  const mine   = { baselines: {}, baselinesAt: {} };
  assert.deepEqual(merge(mine, server).baselines, { a1: { daysWorked: 30 } });
});

/* ---- the RockEd mark, per day per person ---- */
test("two managers marking two people on the same morning both stick", () => {
  const day = "2026-08-20";
  const server = { qualified: { [day]: { "fin smith": true } }, qualifiedAt: { [day]: { "fin smith": T(20) } } };
  const mine   = { qualified: { [day]: { "ada reyes": false } }, qualifiedAt: { [day]: { "ada reyes": T(20) } } };
  const out = merge(mine, server);
  assert.deepEqual(out.qualified[day], { "ada reyes": false, "fin smith": true },
    "one manager's morning was lost: " + JSON.stringify(out.qualified[day]));
});

test("changing your mind about the same person wins by time, not by tab", () => {
  const day = "2026-08-20";
  const server = { qualified: { [day]: { fin: true } }, qualifiedAt: { [day]: { fin: T(20) } } };
  const mine   = { qualified: { [day]: { fin: false } }, qualifiedAt: { [day]: { fin: T(21) } } };
  assert.equal(merge(mine, server).qualified[day].fin, false);
});

/* ---- stars: the old form of that mark, read-only now ---- */
test("legacy star counts are filled in, never overwritten", () => {
  const day = "2026-01-05";
  const server = { stars: { [day]: { fin: 44, ada: 12 } } };
  const mine   = { stars: { [day]: { fin: 40 } } };
  const out = merge(mine, server);
  assert.equal(out.stars[day].fin, 40, "this copy's value should stand");
  assert.equal(out.stars[day].ada, 12, "and the one it had never seen should arrive");
});

/* ---- out of the store's benchmark averages ---- */
test("excluding two different people from the averages keeps both", () => {
  const out = merge({ statsExcluded: ["Ada Reyes"] }, { statsExcluded: ["Fin Smith"] });
  assert.deepEqual(out.statsExcluded.sort(), ["Ada Reyes", "Fin Smith"]);
});

test("putting somebody back into the averages sticks", () => {
  /* The sixth instance of the removal bug, caught before it happened: the list
     is a union now, so taking a name off it needs a stamp behind it. */
  const server = { statsExcluded: ["Fin Smith", "Ada Reyes"] };
  const mine   = { statsExcluded: ["Ada Reyes"], statsExcludedGone: { "fin smith": T(7) } };
  assert.deepEqual(merge(mine, server).statsExcluded, ["Ada Reyes"], "Fin came back");
});

test("and excluding them again afterwards also sticks", () => {
  // Both directions, however many times somebody changes their mind.
  const server = { statsExcluded: [], statsExcludedGone: { "fin smith": T(7) } };
  const mine   = { statsExcluded: ["Fin Smith"], statsExcludedAt: { "fin smith": T(9) } };
  assert.deepEqual(merge(mine, server).statsExcluded, ["Fin Smith"]);
});

/* ---- and the one that is deliberately left alone ---- */
test("repeatFlags is untouched, because nothing reads or writes it", () => {
  const out = merge({ repeatFlags: { keep: 1 } }, { repeatFlags: { other: 2 } });
  assert.deepEqual(out.repeatFlags, { keep: 1 },
    "it is dead; merging it would be inventing a rule for something with no behaviour");
});
