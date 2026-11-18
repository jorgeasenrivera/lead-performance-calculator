/**
 * A room that opens itself, on the store's own schedule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursOf, openAtFor, localClock, openedBy, clockLabel, DAY_KEYS, storeOpenOf, minutesBefore } from "../api/_rooms.mjs";
import { rosterSnapshot, dayRowFor } from "../api/open-room.mjs";

const cfg = { roles: [{ id: "sales", name: "Sales Associate" }, { id: "bdc", name: "BDC", coaching: false }, { id: "mgr", name: "Manager", tracked: false }],
  stores: [{ id: "s1", name: "One", hours: { floor: { mon: "09:00", sat: "10:00", sun: "" , fri: "9:00" }, line: { tue: "08:30" } } }, { id: "s2", name: "Two" }] };

test("a store with no times set: the desk opens Phone Line, Live Floor opens an hour before the store", () => {
  const h = hoursOf(cfg, "s2");
  for (const d of DAY_KEYS) { assert.equal(h.floor[d], null); assert.equal(h.line[d], null); }
  /* s2 has no store hours either, so it is taken as a 9 AM store (Q3). */
  assert.equal(openAtFor(cfg, "s2", "floor", "2026-09-21"), "08:00");
  assert.equal(openAtFor(cfg, "s2", "line", "2026-09-21"), null);
});

test("Live Floor follows the store's own opening time, and a weekday time still wins", () => {
  const c = { stores: [
    { id: "late", hours: { open: "10:30", close: "19:00" } },
    { id: "mixed", hours: { open: "09:00", close: "20:00", floor: { sun: "11:00" }, line: { mon: "09:00" } } },
    { id: "junk", hours: { open: "9am" } },
    { id: "dawn", hours: { open: "00:30" } },
  ] };
  assert.equal(storeOpenOf(c, "late"), "10:30");
  assert.equal(openAtFor(c, "late", "floor", "2026-11-18"), "09:30");
  assert.equal(openAtFor(c, "mixed", "floor", "2026-11-22"), "11:00");   // a Sunday, set by hand
  assert.equal(openAtFor(c, "mixed", "floor", "2026-11-23"), "08:00");   // a Monday, the default
  assert.equal(openAtFor(c, "mixed", "line", "2026-11-23"), "09:00");    // the line's own time
  assert.equal(openAtFor(c, "mixed", "line", "2026-11-24"), null);       // and never the floor's early hour
  assert.equal(storeOpenOf(c, "junk"), "09:00");                         // not a time: taken as 9
  assert.equal(openAtFor(c, "junk", "floor", "2026-11-18"), "08:00");
  assert.equal(openAtFor(c, "nobody", "floor", "2026-11-18"), "08:00");  // unknown store, same
  assert.equal(minutesBefore("00:30", 60), "00:00");                    // held at midnight, not yesterday
  assert.equal(openAtFor(c, "dawn", "floor", "2026-11-18"), "00:00");
});

test("saving a room time keeps the store's own hours", () => {
  const c = { stores: [{ id: "h", hours: { open: "09:00", close: "20:00" } }] };
  /* What the rooms setup does with a new Live Floor time for Monday. */
  const cur = hoursOf(c, "h");
  const saved = { ...cur, floor: { ...cur.floor, mon: "07:45" } };
  assert.equal(saved.open, "09:00");
  assert.equal(saved.close, "20:00");
  c.stores[0].hours = saved;
  assert.equal(storeOpenOf(c, "h"), "09:00");
  assert.equal(openAtFor(c, "h", "floor", "2026-11-23"), "07:45");      // the Monday just set
  assert.equal(openAtFor(c, "h", "floor", "2026-11-24"), "08:00");      // the rest still an hour early
  assert.equal("open" in hoursOf({ stores: [{ id: "n" }] }, "n"), false);
});

test("daylight saving: 8 AM is 8 AM on the Eastern clock either side of the change", () => {
  const at = openAtFor({ stores: [] }, "x", "floor", "2026-11-01");
  /* 2026-11-01 is the fall-back Sunday. 12:00 UTC is 7 AM EST, 13:00 UTC is 8. */
  assert.equal(openedBy(at, localClock(new Date("2026-11-01T12:59:00Z")).hm), false);
  assert.equal(openedBy(at, localClock(new Date("2026-11-01T13:00:00Z")).hm), true);
  /* 2027-03-14 springs forward: 8 AM EDT is 12:00 UTC. */
  assert.equal(openedBy(at, localClock(new Date("2027-03-14T11:59:00Z")).hm), false);
  assert.equal(openedBy(at, localClock(new Date("2027-03-14T12:00:00Z")).hm), true);
});

test("a time per weekday, read by the calendar day, and only a real HH:MM counts", () => {
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-21"), "09:00");   // a Monday
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-19"), "10:00");   // a Saturday
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-20"), "08:00");   // Sunday, blank: the floor's default
  assert.equal(openAtFor(cfg, "s1", "floor", "2026-09-18"), "08:00");   // Friday, "9:00" is not a time, so the same
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
