/**
 * The Dashboard's "Today's schedule · 8 on, 3 off" counts.
 * -------------------------------------------------------------------------
 * Jorge, 19 November: use the planner's confirmed staffing for the counts, and
 * if staffing is unknown, show "Today's schedule" without numbers. Not being
 * listed off is not being on, so these hold the counts to what the planner
 * itself confirms, on fictional people.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedStaffing, confirmedStaffingToday } from "../src/today-staffing.mjs";

const DAY = "2026-11-19";
const store = { id: "fictional-7", name: "Cedar Motors", timezone: "America/New_York" };
const data = (daysOff = {}) => ({
  __storeId: "fictional-7", rev: 4,
  roster: [
    { id: "p1", name: "Avery Fable", roleId: "sales" },
    { id: "p2", name: "Briar Testwood", roleId: "sales" },
    { id: "p3", name: "Cedar Mockley", roleId: null },     // no position: not on the planner
  ],
  departed: [], daysOff,
});

test("somebody only not listed off leaves the day unknown", () => {
  assert.equal(confirmedStaffing(store, data({ p1: [DAY] }), DAY), null);
  assert.equal(confirmedStaffing(store, data(), DAY), null);
});

test("a day the planner can place everyone on is counted", () => {
  assert.deepEqual(confirmedStaffing(store, data({ p1: [DAY], p2: [DAY] }), DAY), { on: 0, off: 2 });
});

test("people outside their dates are neither on nor off", () => {
  const d = data({ p1: [DAY] });
  d.roster[1].hiredAt = "2026-12-01";
  assert.deepEqual(confirmedStaffing(store, d, DAY), { on: 0, off: 1 });
});

test("records that are not this store's give no numbers", () => {
  const d = data({ p1: [DAY], p2: [DAY] });
  d.__storeId = "fictional-8";
  assert.equal(confirmedStaffing(store, d, DAY), null);
  assert.equal(confirmedStaffing(null, d, DAY), null);
  assert.equal(confirmedStaffing(store, null, DAY), null);
});

test("today is the store's own day, and reading changes nothing", () => {
  const d = data({ p1: [DAY], p2: [DAY] });
  const before = JSON.stringify(d);
  // 03:30 UTC on the 20th is still the 19th in Orlando.
  assert.deepEqual(confirmedStaffingToday(store, d, new Date("2026-11-20T03:30:00Z")), { on: 0, off: 2 });
  assert.equal(JSON.stringify(d), before);
});
