/**
 * A room that opens itself, on the store's own schedule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursOf, openAtFor, localClock, openedBy, clockLabel, DAY_KEYS } from "../api/_rooms.mjs";
import { rosterSnapshot, dayRowFor } from "../api/open-room.mjs";

const cfg = { roles: [{ id: "sales", name: "Sales Associate" }, { id: "bdc", name: "BDC", coaching: false }, { id: "mgr", name: "Manager", tracked: false }],
  stores: [{ id: "s1", name: "One", hours: { floor: { mon: "09:00", sat: "10:00", sun: "" , fri: "9:00" }, line: { tue: "08:30" } } }, { id: "s2", name: "Two" }] };

test("a store with no times set has the desk open every room, as today", () => {
  const h = hoursOf(cfg, "s2");
  for (const d of DAY_KEYS) { assert.equal(h.floor[d], null); assert.equal(h.line[d], null); }
  assert.equal(openAtFor(cfg, "s2", "floor", "2026-09-21"), null);
});

test("a time per weekday, read by the calendar day, and only a real HH:MM counts", () => {
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-21"), "09:00");   // a Monday
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-19"), "10:00");   // a Saturday
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-20"), null);      // Sunday, blank
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-18"), null);      // Friday, "9:00" is not a time
  assert.equal(openAtFor(cfg, "s1", "line", "2026-09-22"), "08:30");    // a Tuesday
  assert.equal(openAtFor(cfg, "s1", "line", "2026-09-21"), null);
  assert.equal(openAtFor(cfg, "s1", "online", "2026-09-21"), null);
});

test("the clock is the store's, and opened means the clock has reached the time", () => {
  const c = localClock(new Date("2026-09-21T13:05:00Z"), "America/New_York");   // 9:05 in September
  assert.deepEqual(c, { day: "2026-09-21", hm: "09:05" });
  const late = localClock(new Date("2026-09-22T03:30:00Z"), "America/New_York"); // still the 21st there
  assert.deepEqual(late, { day: "2026-09-21", hm: "23:30" });
  assert.equal(openedBy("09:00", "08:59"), false);
  assert.equal(openedBy("09:00", "09:00"), true);
  assert.equal(openedBy(null, "09:00"), false);
  assert.equal(clockLabel("09:00"), "9:00 AM");
  assert.equal(clockLabel("13:30"), "1:30 PM");
  assert.equal(clockLabel("00:15"), "12:15 AM");
});

test("the row it makes is the wall's row: the sales roster, labelled, the test person, an empty line", () => {
  const sdata = { roster: [{ id: "b", name: "Bea Ortiz", roleId: "sales", langs: ["es"] }, { id: "a", name: "Al Ng", roleId: "sales" },
    { id: "c", name: "Cy Bdc", roleId: "bdc" }, { id: "m", name: "Mo Boss", roleId: "mgr" }, { id: "x", name: "No Role" }] };
  const snap = rosterSnapshot(cfg, sdata);
  assert.deepEqual(snap.map((p) => p.id), ["a", "b", "__lpc_test__"]);
  assert.equal(snap[1].label, "Bea O.");
  assert.deepEqual(snap[0].langs, []); assert.deepEqual(snap[1].langs, ["es"]);
  assert.equal(snap[0].role, "Sales Associate");
  const floor = dayRowFor("floor", "s1", "2026-09-21", "09:00", cfg, sdata);
  assert.equal(floor.storeName, "One"); assert.equal(floor.date, "2026-09-21"); assert.deepEqual(floor.line, []);
  assert.ok(floor.token && floor.token.length >= 6);
  assert.deepEqual(floor.unmatched, []); assert.equal(floor.lastEventAt, null); assert.equal(floor.openedBy, "schedule");
  const line = dayRowFor("line", "s1", "2026-09-21", "08:30", cfg, sdata);
  assert.equal("unmatched" in line, false); assert.equal(line.openAt, "08:30");
});
