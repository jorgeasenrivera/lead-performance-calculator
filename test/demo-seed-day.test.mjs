/* The demo seeds the store's day, not UTC's (C94).
   From 8 PM to midnight Eastern, UTC is already on tomorrow. The seed took
   "today" from UTC, the app takes it from the store, and for those four hours
   the mock's Phone Line row was tomorrow's: the app said the line was not
   open and every feel run failed in both engines, whatever it was testing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemo, storeDay, openDays } from "../scripts/demo-seed.mjs";

const evening = new Date("2026-09-24T00:50:00Z");   // 20:50 Eastern on the 23rd: #422's run

test("at 8:50 PM Eastern the store's day is still the 23rd", () => {
  assert.equal(storeDay(evening), "2026-09-23");
  assert.equal(openDays(3, evening).at(-1), "2026-09-23");
});

test("the seeded rows carry the store's day, which is the one the app looks for", () => {
  const demo = buildDemo(evening);
  assert.equal(demo.today, "2026-09-23");
  const rooms = demo.rows.filter((r) => r.table === "queue_public" || r.table === "floor_public").map((r) => r.row);
  assert.ok(rooms.length > 0, "the seed writes the day's rooms");
  for (const r of rooms) {
    const d = r.qdate || r.fdate;
    assert.ok(d <= "2026-09-23", `a room is seeded for ${d}, a day the store has not reached`);
  }
  assert.ok(rooms.some((r) => r.qdate === "2026-09-23" && r.id === "sage-demo:2026-09-23"), "today's Phone Line is there, under today's id");
});

test("a clock change does not skip or repeat a day", () => {
  const days = openDays(12, new Date("2026-11-03T02:00:00Z"));   // across the November change
  assert.equal(new Set(days).size, days.length);
  for (let i = 1; i < days.length; i++) {
    const gap = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000;
    assert.ok(gap === 1 || gap === 2, `${days[i - 1]} to ${days[i]} is ${gap} days; only a Sunday may be skipped`);
  }
});
