/* C104: the reviewer's salesperson. Apple's reviewer signs in as Sam Demo to see
   what a salesperson sees, and the seed is rewritten every night, so what the
   link and the screenshots rely on has to come out of the seed the same way
   every time. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemo, DEMO_SALES } from "../scripts/demo-seed.mjs";

const at = new Date("2026-09-29T17:00:00Z");

test("Sam keeps his id from one night to the next, so his account's link still points at him", () => {
  const a = buildDemo(at), b = buildDemo(new Date("2026-09-30T08:00:00Z"));
  for (const d of [a, b]) {
    const sam = d.roster.find((p) => p.name === "Sam Demo");
    assert.equal(sam && sam.id, "demo-sam");
    assert.equal(sam.id, DEMO_SALES.id);
    assert.equal(d.roster.filter((p) => p.id === "demo-sam").length, 1);
  }
});

test("he has the month behind him: every open day, the month's units, and a place on the board", () => {
  const d = buildDemo(at);
  for (const day of d.days) assert.ok(d.storeData.activity[day]["sam demo"], `no day for Sam on ${day}`);
  const s = d.storeData.months["2026-09"].stats["sam demo"];
  assert.ok(s && s.newUnits + s.usedUnits > 0, "his month has cars in it");
  const board = d.rows.find((r) => r.row.key === "lpc:board:sage-demo:v1").row.value;
  assert.ok(board.people.some((p) => p.id === "demo-sam"), "the phone's which-of-these-is-me list has him");
  const days = d.rows.filter((r) => (r.row.key || "").startsWith("lpc:board:sage-demo:act:"));
  assert.ok(days.every((r) => r.row.value["sam demo"]), "the closing line has a point for him every day");
});

test("today's floor has a line with nobody waiting, so Sam getting on is first up; he is on no room himself", () => {
  const d = buildDemo(at);
  const floor = d.rows.find((r) => r.table === "floor_public").row.data.line;
  assert.ok(floor.length >= 3);
  assert.ok(floor.every((p) => p.status === "customer" && p.table), "everybody on the floor is with a customer");
  const phone = d.rows.find((r) => r.table === "queue_public").row.data.line;
  assert.ok(![...floor, ...phone].some((p) => p.id === "demo-sam"), "Sam gets on himself");
});

test("every row still names the demo store, which is what lets the nightly reset write it", () => {
  for (const { row } of buildDemo(at).rows) {
    assert.ok(String(row.key || row.id).includes("sage-demo"), String(row.key || row.id));
  }
});
