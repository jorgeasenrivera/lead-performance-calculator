/**
 * What a salesperson's phone is allowed to know beyond the counts.
 * -------------------------------------------------------------------------
 * Goals, days off, RockEd and line moves all reach the phone through one
 * module that both publishers share. These pin the rules that module keeps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../api/_phone-rows.mjs";
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

test("a month-specific goal beats the standing one", () => {
  const sdata = { goals: { a1: { monthly: 12, byMonth: { "2026-09": 14 } } } };
  assert.equal(P.goalFor(sdata, "a1", "2026-09"), 14);
  assert.equal(P.goalFor(sdata, "a1", "2026-10"), 12);
  assert.equal(P.goalFor(sdata, "a9", "2026-09"), null);
});

test("days off travel for this month and the next, nothing older", () => {
  const sdata = { daysOff: { a1: ["2026-08-30", "2026-09-04", "2026-10-02", "2026-11-01"] } };
  assert.deepEqual(P.offDatesFor(sdata, "a1", "2026-09"), ["2026-09-04", "2026-10-02"]);
  assert.deepEqual(P.offDatesFor(sdata, "a1", "2026-12"), []);
  assert.deepEqual(P.offDatesFor({ daysOff: { a1: ["2026-12-25", "2027-01-01"] } }, "a1", "2026-12"), ["2026-12-25", "2027-01-01"]);
});

test("the extras are keyed like the stats and stay silent when empty", () => {
  const sdata = { goals: { a1: { monthly: 10 } }, daysOff: { a2: ["2026-09-07"] } };
  const roster = [{ id: "a1", name: "Ana Diaz" }, { id: "a2", name: "Bo Lee" }, { id: "a3", name: "Cy Ng" }];
  const x = P.phoneExtras(sdata, roster, "2026-09", norm);
  assert.deepEqual(x.goals, { "ana diaz": 10 });
  assert.deepEqual(x.off, { "bo lee": ["2026-09-07"] });
});

test("RockEd follows the checkout rule: tick, then legacy stars, else unknown", () => {
  const sdata = { qualified: { "2026-09-01": { "ana diaz": true, "bo lee": false } }, stars: { "2026-09-01": { "cy ng": 55, "di ok": 12 } } };
  assert.equal(P.rockedFor(sdata, "2026-09-01", "ana diaz"), true);
  assert.equal(P.rockedFor(sdata, "2026-09-01", "bo lee"), false);
  assert.equal(P.rockedFor(sdata, "2026-09-01", "cy ng"), true);
  assert.equal(P.rockedFor(sdata, "2026-09-01", "di ok"), false);
  assert.equal(P.rockedFor(sdata, "2026-09-01", "ed po"), null);
  const rows = P.withRocked(sdata, "2026-09-01", { "ana diaz": { calls: 20 }, "ed po": { calls: 5 } });
  assert.equal(rows["ana diaz"].rocked, true);
  assert.ok(!("rocked" in rows["ed po"]));
});

test("points on the phone are the desk's points", () => {
  const std = { minCalls: 16, minVideos: 2 };
  assert.deepEqual(P.pointsForDay({ calls: 20, video: 3, rocked: true }, std), { points: 0, missed: [], noData: false });
  assert.deepEqual(P.pointsForDay({ calls: 15, video: 3, rocked: true }, std).missed, ["calls"]);
  assert.deepEqual(P.pointsForDay({ calls: 16, video: 1 }, std).missed, ["videos", "rocked"]);
  assert.equal(P.pointsForDay({}, std).noData, true);
  // strict, not eighty percent: fifteen calls against sixteen is a miss
  assert.equal(P.pointsForDay({ calls: 15, video: 2, rocked: true }, std).points, 1);
});

test("a move up stamps only the people who moved up", () => {
  const prev = { line: [{ id: "a", status: "waiting" }, { id: "b", status: "waiting" }, { id: "c", status: "waiting" }] };
  const next = { line: [{ id: "b", status: "waiting" }, { id: "c", status: "waiting" }, { id: "d", status: "waiting" }] };
  const out = P.stampLineMoves(prev, next, "T");
  assert.equal(out.line[0].movedAt, "T");   // b moved up
  assert.equal(out.line[1].movedAt, "T");   // c moved up
  assert.equal(out.line[2].movedAt, "T");   // d joined: first move
});

test("standing down and coming back is not a move, and neither is somebody behind you leaving", () => {
  const prev = { line: [{ id: "a", status: "waiting" }, { id: "b", status: "lunch" }, { id: "c", status: "waiting" }] };
  const next = { line: [{ id: "a", status: "waiting" }, { id: "b", status: "waiting" }] };
  const out = P.stampLineMoves(prev, next, "T");
  assert.ok(!out.line[0].movedAt);          // a stayed first
  assert.equal(out.line[1].movedAt, "T");   // b re-entered the waiting order: counts as joining it
  const prev2 = { line: [{ id: "a", status: "waiting" }, { id: "c", status: "waiting" }] };
  const next2 = { line: [{ id: "a", status: "waiting" }] };
  assert.ok(!P.stampLineMoves(prev2, next2, "T").line[0].movedAt);
});
