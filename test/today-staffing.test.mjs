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
import { confirmedStaffing, confirmedStaffingToday, staffingFor } from "../src/today-staffing.mjs";

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

/* Jorge, 19 November, for shipping #542: with the calendar off, show explicit
   days off and do not call anyone on unless the planner confirms it. */
test("the lists behind the control are explicit days off and confirmed on only", () => {
  const partial = staffingFor(store, data({ p1: [DAY] }), DAY);
  assert.deepEqual([...partial.off], ["p1"]);
  assert.deepEqual([...partial.on], []);          // p2 is only not listed off
  assert.equal(partial.counts, null);
  const none = staffingFor(store, data(), DAY);
  assert.deepEqual([...none.off], []);
  assert.deepEqual([...none.on], []);
});

test("today rolls over at midnight Eastern, not at midnight UTC or on the device", () => {
  const d = data({ p1: ["2026-11-19"], p2: ["2026-11-20"] });
  // 11:59 PM in Orlando on the 19th, then one minute later.
  assert.deepEqual(confirmedStaffingToday(store, { ...d, daysOff: { p1: ["2026-11-19"], p2: ["2026-11-19"] } }, new Date("2026-11-20T04:59:00Z")), { on: 0, off: 2 });
  assert.equal(confirmedStaffingToday(store, d, new Date("2026-11-20T05:00:00Z")), null);
  assert.deepEqual([...staffingFor(store, d, "2026-11-20").off], ["p2"]);
});

/* Jorge, 19 November: with the calendar off the button said "2 off" while the
   list it opened showed only Sales, because the list read the floor roster and
   the count read the planner's. Both now read the planner's roster. */
test("Sales and Service both off: the count and the names agree", () => {
  const d = {
    __storeId: "fictional-7", rev: 5,
    roster: [
      { id: "s1", name: "Avery Fable", roleId: "sales" },
      { id: "v1", name: "Dale Mockwell", roleId: "service" },
    ],
    departed: [], daysOff: { s1: [DAY], v1: [DAY] },
  };
  const staffing = staffingFor(store, d, DAY);
  assert.deepEqual(staffing.counts, { on: 0, off: 2 });
  assert.deepEqual(staffing.offPeople.map((p) => p.name), ["Avery Fable", "Dale Mockwell"]);
  assert.deepEqual(staffing.onPeople, []);
  assert.equal(staffing.offPeople.length, staffing.counts.off);
});

test("an unknown person is listed neither on nor off, and the count goes", () => {
  const d = data({ p1: [DAY] });
  const staffing = staffingFor(store, d, DAY);
  assert.equal(staffing.counts, null);
  assert.deepEqual(staffing.offPeople.map((p) => p.id), ["p1"]);
  assert.deepEqual(staffing.onPeople, []);
});

test("the Dashboard lists come from the planner's roster, not the floor roster", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  assert.equal((src.match(/const offToday = staffing\?\.offPeople \|\| \[\];/g) || []).length, 2);
  assert.equal((src.match(/const onToday = staffing\?\.onPeople \|\| \[\];/g) || []).length, 2);
  assert.doesNotMatch(src, /offToday = floorRoster/);
});

test("the schedule panel stays open when focus drops to nowhere, and a press outside closes it", async () => {
  // WebKit drops focus to the page on a press of a button inside the panel and
  // when the window lets go of focus. Closing on that took the month away
  // between finding a day and pressing it (#542, WebKit run, 19 November).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  const start = src.indexOf("function SignalSchedule(");
  const body = src.slice(start, src.indexOf("\nfunction ", start + 1));
  assert.match(body, /onBlur=\{e => \{ if\(e\.relatedTarget && !e\.currentTarget\.contains\(e\.relatedTarget\)\)/);
  assert.doesNotMatch(body, /if\(!e\.currentTarget\.contains\(e\.relatedTarget\)\)/);
  assert.match(body, /document\.addEventListener\("pointerdown", away, true\)/);
  assert.match(body, /if \(!rootRef\.current\?\.contains\(e\.target\)\) \{ setPinned\(false\); setHover\(false\); \}/);
  assert.match(body, /<div ref=\{rootRef\} className="sg-schedule"/);
});
