/**
 * The store's month, and what it is being asked for.
 * -------------------------------------------------------------------------
 * A manager decides whether to push the floor on the 22nd off these numbers, so
 * they had better be the right numbers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { storeDaysInMonth, storeDaysDone, storeGoalFor } from "../api/_store-month.mjs";

const none = () => false;
const on = (...days) => (d) => days.includes(d);

test("a store's month is every day of it, not a six-day week", () => {
  // The difference matters: over 31 days a Sunday-skipping count is 27, and a
  // pace divided by 27 instead of 31 reads about 15% high all month.
  assert.equal(storeDaysInMonth("2026-08", none), 31);
  assert.equal(storeDaysInMonth("2026-09", none), 30);
  assert.equal(storeDaysInMonth("2026-02", none), 28);
  assert.equal(storeDaysInMonth("2028-02", none), 29, "a leap February");
});

test("a holiday comes out of the month", () => {
  assert.equal(storeDaysInMonth("2026-12", on("2026-12-25")), 30);
  assert.equal(storeDaysInMonth("2026-12", on("2026-12-25", "2026-12-24")), 29);
});

test("a holiday in another month is somebody else's problem", () => {
  assert.equal(storeDaysInMonth("2026-08", on("2026-12-25")), 31);
});

test("the same holiday listed twice only comes out once", () => {
  assert.equal(storeDaysInMonth("2026-12", on("2026-12-25", "2026-12-25")), 30);
});

test("days done stop at yesterday, because today's cars are not in yet", () => {
  /* Deliveries arrive on the next morning's report. Counting today divides real
     sales by a day whose sales have not landed, so every projection sags each
     morning and recovers each afternoon for no reason anybody could name. */
  assert.equal(storeDaysDone("2026-08", none, "2026-08-21"), 20);
  assert.equal(storeDaysDone("2026-08", none, "2026-08-01"), 0, "nothing is finished on the first");
  assert.equal(storeDaysDone("2026-08", none, "2026-08-02"), 1);
});

test("a holiday already gone comes out of the days done", () => {
  assert.equal(storeDaysDone("2026-12", on("2026-12-25"), "2026-12-28"), 26);
});

test("a holiday still to come does not", () => {
  assert.equal(storeDaysDone("2026-12", on("2026-12-25"), "2026-12-10"), 9);
  assert.equal(storeDaysInMonth("2026-12", on("2026-12-25")), 30,
    "but it is still out of the whole month, which is what the projection divides into");
});

test("a month that has already ended is complete", () => {
  assert.equal(storeDaysDone("2026-07", none, "2026-08-21"), 31);
  assert.equal(storeDaysDone("2026-07", on("2026-07-04"), "2026-08-21"), 30);
});

test("the goal, and the share of it that counts as hitting", () => {
  const store = { goal: { units: 100, pct: 85, byMonth: {} } };
  const g = storeGoalFor(store, "2026-08");
  assert.equal(g.units, 100);
  assert.equal(g.pct, 85);
  assert.equal(g.bar, 85, "the number a manager is actually judged on");
});

test("this month's own goal beats the standing one", () => {
  const store = { goal: { units: 100, pct: 85, byMonth: { "2026-08": 120 } } };
  assert.equal(storeGoalFor(store, "2026-08").bar, 102);
  assert.equal(storeGoalFor(store, "2026-09").bar, 85, "and a month nobody set falls back");
});

test("no percentage set means the goal is the goal", () => {
  assert.equal(storeGoalFor({ goal: { units: 90 } }, "2026-08").bar, 90);
});

test("a store with no goal says so rather than inventing one", () => {
  assert.equal(storeGoalFor({}, "2026-08"), null);
  assert.equal(storeGoalFor({ goal: {} }, "2026-08"), null);
  assert.equal(storeGoalFor({ goal: { units: 0, pct: 85 } }, "2026-08"), null);
  assert.equal(storeGoalFor(null, "2026-08"), null);
});

test("a month explicitly set to zero is not the standing goal in disguise", () => {
  const store = { goal: { units: 100, pct: 85, byMonth: { "2026-08": 0 } } };
  assert.equal(storeGoalFor(store, "2026-08"), null,
    "zero is a store that has not been given a number this month, not a 100-car month");
});

test("the pace a manager acts on", () => {
  /* The whole point, worked end to end: 20 days finished of a 31-day December
     with Christmas out, 60 delivered, judged at 85 of a 100-car goal. */
  const isHol = on("2026-12-25");
  const daysAll = storeDaysInMonth("2026-12", isHol);
  const daysDone = storeDaysDone("2026-12", isHol, "2026-12-21");
  const g = storeGoalFor({ goal: { units: 100, pct: 85 } }, "2026-12");
  assert.equal(daysAll, 30);
  assert.equal(daysDone, 20);

  const perDay = 60 / daysDone;
  const projected = perDay * daysAll;
  assert.equal(perDay, 3);
  assert.equal(projected, 90);
  assert.ok(projected >= g.bar, "90 clears the 85 it is judged at");

  const parToday = g.bar * (daysDone / daysAll);
  assert.ok(Math.abs(parToday - 56.667) < 0.01, "a level month would be at 56.7 by now");
  assert.ok(60 - parToday > 0, "so 60 is ahead, and the popup should say so");

  const short = Math.max(0, g.bar - 60);
  const needPerDay = short / (daysAll - daysDone);
  assert.equal(short, 25);
  assert.equal(needPerDay, 2.5, "2.5 a day over the last ten days, less than it has been running");
});

test("and the same month going badly", () => {
  const g = storeGoalFor({ goal: { units: 100, pct: 85 } }, "2026-12");
  const daysAll = 30, daysDone = 20, units = 40;
  const projected = (units / daysDone) * daysAll;
  assert.equal(projected, 60);
  assert.ok(projected < g.bar);
  const needPerDay = (g.bar - units) / (daysAll - daysDone);
  assert.equal(needPerDay, 4.5,
    "4.5 a day against the 2 it has been running — the number that says push or do not bother");
});
