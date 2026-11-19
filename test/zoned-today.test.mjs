/**
 * Today on the Dashboard moves on at midnight in the store's zone.
 * -------------------------------------------------------------------------
 * Jorge, 19 November: Today rolls over at midnight Eastern, and opens the
 * right day on the first tap after a tab sleeps. The hook re-reads the day
 * when the tab wakes and the control reads it again at the press; this holds
 * the wait between checks to the right moment, and never more than an hour,
 * so a clock change cannot carry the day past midnight.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { msToNextZonedDay } from "../src/zoned-today.mjs";

const NY = "America/New_York";

test("a minute before midnight Eastern waits about a minute", () => {
  const ms = msToNextZonedDay(NY, new Date("2026-11-20T04:59:00Z"));
  assert.ok(ms >= 60000 && ms <= 61000, String(ms));
});

test("midday waits no more than an hour, so the check comes round again", () => {
  assert.equal(msToNextZonedDay(NY, new Date("2026-11-19T17:00:00Z")), 3600000);
});

test("the night the clocks go back still lands on the real midnight", () => {
  // 11:30 PM on 31 October 2026 is EDT; the fall back is the next night.
  const ms = msToNextZonedDay(NY, new Date("2026-11-01T03:30:00Z"));
  assert.ok(ms >= 30 * 60000 && ms <= 30 * 60000 + 1000, String(ms));
});

test("a zone it cannot read falls back to checking hourly", () => {
  assert.equal(msToNextZonedDay("Not/AZone", new Date()), 3600000);
});

test("the schedule control reads the day again at the press", () => {
  const src = readFileSync(new URL("../src/scheduler-calendar.jsx", import.meta.url), "utf8");
  assert.match(src, /const today=useZonedToday\(timezone\)/);
  assert.match(src, /onClick=\{event=>open\(zonedToday\(timezone,new Date\(\)\)\|\|today,event\.currentTarget\)\}/);
});
