/**
 * The offline room timing contract (C114). Synthetic stores, caller-supplied
 * time, no clock, no network, no database. Every expected instant is written
 * out by hand from the zone's published offsets, not recomputed with the
 * code under test.
 *
 * What is not tested here, because this helper does not do it: denying a
 * request for a disabled room, remembering a person's last tab, making a row,
 * checking who is asking. Those are acceptance tests for the integration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROOMS3, roomEnabled, enabledRooms, rowKeyFor, openingInstant, decideRoomNow } from "../api/_room-timing.mjs";

const NY = "America/New_York";
const WEEK = { sun: "closed", mon: "09:00", tue: "09:00", wed: "09:00", thu: "09:00", fri: "09:00", sat: "10:00" };
const cfgOf = (rooms) => ({ stores: [{ id: "s1", name: "Synthetic One", rooms }, { id: "s2", name: "Synthetic Two" }] });
const base = (o = {}) => ({ config: cfgOf({ floor: true, line: true, online: true }), storeId: "s1", room: "floor", tz: NY, openingHours: WEEK, ...o });
const at = (iso) => new Date(iso);

/* ---- the three rooms, all eight ways ---- */

test("all eight floor, line and online combinations: the list, the order, and what each room decides", () => {
  const expected = [];
  for (const f of [false, true]) for (const l of [false, true]) for (const o of [false, true]) {
    const config = cfgOf({ floor: f, line: l, online: o });
    const want = [f && "floor", l && "line", o && "online"].filter(Boolean);
    expected.push(want.join("+") || "none");
    assert.deepEqual(enabledRooms(config, "s1"), want, `list for ${f}/${l}/${o}`);
    for (const room of ROOMS3) {
      const d = decideRoomNow(base({ config, room, now: at("2026-10-19T14:00:00Z") })); // Monday 10:00 in New York
      if (want.includes(room)) { assert.equal(d.status, "open", `${room} on ${f}/${l}/${o}`); assert.equal(d.reason, null); }
      else { assert.equal(d.status, "off", `${room} off ${f}/${l}/${o}`); assert.equal(d.reason, "room-disabled"); assert.equal(d.plan, null); }
    }
  }
  assert.equal(new Set(expected).size, 8);
});

test("a room that was never set is off, whatever the live defaults are", () => {
  assert.deepEqual(enabledRooms(cfgOf({ floor: true }), "s1"), ["floor"]);
  assert.equal(roomEnabled(cfgOf({ floor: true }), "s1", "online").reason, "room-unconfigured");
  assert.equal(roomEnabled(cfgOf({ floor: "true", line: 1 }), "s1", "floor").reason, "room-unconfigured");
  assert.equal(roomEnabled(cfgOf({ floor: "true", line: 1 }), "s1", "line").on, false);
  assert.equal(roomEnabled(cfgOf(undefined), "s1", "floor").reason, "rooms-unconfigured");
  assert.equal(roomEnabled(cfgOf(null), "s1", "floor").reason, "rooms-unconfigured");
  assert.deepEqual(enabledRooms(cfgOf({}), "s1"), []);
  assert.equal(roomEnabled(cfgOf({ floor: true }), "s1", "kitchen").reason, "room-unknown");
});

test("a store with no entry, or no config at all, has nothing on; names in this test are not configuration", () => {
  /* The two ids below are bare strings in synthetic input. They configure
     nothing, and no store is named in the helper. */
  for (const id of ["audi-daytona", "eccco", "s2", "nobody"]) {
    assert.deepEqual(enabledRooms(cfgOf({ floor: true, line: true, online: true }), id), [], id);
    const d = decideRoomNow(base({ storeId: id, now: at("2026-10-19T14:00:00Z") }));
    assert.equal(d.status, "off"); assert.equal(d.plan, null);
  }
  assert.equal(roomEnabled(cfgOf({ floor: true }), "s2", "floor").reason, "rooms-unconfigured");
  assert.equal(roomEnabled(cfgOf({ floor: true }), "nobody", "floor").reason, "store-unconfigured");
  for (const config of [null, undefined, {}, { stores: null }, { stores: "x" }, { stores: [null, 4] }]) {
    assert.deepEqual(enabledRooms(config, "s1"), []);
    assert.equal(decideRoomNow(base({ config, now: at("2026-10-19T14:00:00Z") })).status, "off");
  }
});

/* ---- opening minus 60, in more than one zone ---- */

test("an hour before a 09:00 opening, in each zone, as a fixed instant", () => {
  const go = (tz) => openingInstant({ day: "2026-10-19", openingHm: "09:00", tz });
  assert.equal(go("America/New_York").opensAt, "2026-10-19T12:00:00.000Z");   // 08:00 EDT, UTC-4
  assert.equal(go("America/Chicago").opensAt, "2026-10-19T13:00:00.000Z");    // 08:00 CDT, UTC-5
  assert.equal(go("America/Los_Angeles").opensAt, "2026-10-19T15:00:00.000Z"); // 08:00 PDT, UTC-7
  assert.equal(go("Asia/Kolkata").opensAt, "2026-10-19T02:30:00.000Z");       // 08:00 IST, UTC+5:30
  assert.equal(go("UTC").opensAt, "2026-10-19T08:00:00.000Z");
  assert.equal(go("America/New_York").policyIndependent, true);
});

test("the same wall clock opens at different instants in different zones, and the zone is the store's", () => {
  const ny = decideRoomNow(base({ now: at("2026-10-19T11:59:59.999Z") }));
  assert.equal(ny.status, "pending"); assert.equal(ny.opensAt, "2026-10-19T12:00:00.000Z");
  const la = decideRoomNow(base({ tz: "America/Los_Angeles", now: at("2026-10-19T12:00:00Z") }));
  assert.equal(la.status, "pending"); assert.equal(la.opensAt, "2026-10-19T15:00:00.000Z");
});

test("the offset is a parameter: zero minutes, ninety minutes, and nothing outside a day", () => {
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, offsetMinutes: 0 }).opensAt, "2026-10-19T13:00:00.000Z");
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, offsetMinutes: 90 }).opensAt, "2026-10-19T11:30:00.000Z");
  for (const bad of [-1, 1441, 1.5, "60", null, NaN]) assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, offsetMinutes: bad }).reason, "invalid-offset-minutes", String(bad));
});

/* ---- the exact minute ---- */

test("one millisecond before, at, and after the opening instant", () => {
  const f = (iso) => decideRoomNow(base({ now: at(iso) }));
  assert.equal(f("2026-10-19T11:59:59.999Z").status, "pending");
  assert.equal(f("2026-10-19T11:59:59.999Z").plan, null);
  assert.equal(f("2026-10-19T12:00:00.000Z").status, "open");
  assert.equal(f("2026-10-19T12:00:00.001Z").status, "open");
  assert.deepEqual(f("2026-10-19T12:00:00Z").plan, { kind: "ensure-row", rowKey: "s1:2026-10-19", day: "2026-10-19", opensAt: "2026-10-19T12:00:00.000Z" });
});

test("now may be a Date or epoch milliseconds, and means the same thing", () => {
  const ms = Date.UTC(2026, 9, 19, 12, 0, 0);
  assert.deepEqual(decideRoomNow(base({ now: ms })), decideRoomNow(base({ now: new Date(ms) })));
});

/* ---- date boundaries ---- */

test("the store's day is the zone's day, not the UTC day", () => {
  /* 02:00Z on the 20th is 22:00 on Monday the 19th in New York. */
  const d = decideRoomNow(base({ now: at("2026-10-20T02:00:00Z") }));
  assert.equal(d.day, "2026-10-19"); assert.equal(d.status, "open"); assert.equal(d.rowKey, "s1:2026-10-19");
  /* 03:59Z on the 19th is still Sunday the 18th at 23:59 in New York. */
  const s = decideRoomNow(base({ now: at("2026-10-19T03:59:59Z") }));
  assert.equal(s.day, "2026-10-18"); assert.equal(s.status, "closed");
  assert.equal(decideRoomNow(base({ now: at("2026-10-19T04:00:00Z") })).day, "2026-10-19");
});

test("an opening just after midnight is due the evening before: the hour crosses the date", () => {
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "00:30", tz: NY }).opensAt, "2026-10-19T03:30:00.000Z"); // 23:30 EDT on the 18th
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "00:00", tz: NY }).opensAt, "2026-10-19T03:00:00.000Z"); // 23:00 EDT on the 18th
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "01:00", tz: NY }).opensAt, "2026-10-19T04:00:00.000Z"); // 00:00 on the 19th itself
  const cfg = { openingHours: { ...WEEK, mon: "00:30" } };
  const before = decideRoomNow(base({ ...cfg, now: at("2026-10-19T03:29:59.999Z") }));
  assert.equal(before.day, "2026-10-18"); assert.equal(before.early, null);
  const after = decideRoomNow(base({ ...cfg, now: at("2026-10-19T03:30:00Z") }));
  /* Sunday is closed, so the day itself says closed and the early block carries the row to make. */
  assert.equal(after.status, "closed");
  assert.equal(after.early.status, "open"); assert.equal(after.early.day, "2026-10-19");
  assert.equal(after.early.rowKey, "s1:2026-10-19");
  assert.equal(after.early.plan.opensAt, "2026-10-19T03:30:00.000Z");
});

test("month and year boundaries roll the day correctly", () => {
  assert.equal(openingInstant({ day: "2026-11-01", openingHm: "00:30", tz: "UTC" }).opensAt, "2026-10-31T23:30:00.000Z");
  assert.equal(openingInstant({ day: "2027-01-01", openingHm: "00:15", tz: "UTC" }).opensAt, "2026-12-31T23:15:00.000Z");
  assert.equal(openingInstant({ day: "2028-03-01", openingHm: "00:15", tz: "UTC" }).opensAt, "2028-02-29T23:15:00.000Z"); // a leap year
});

/* ---- Sunday, closed, manual, missing ---- */

test("Sunday closed never opens; Sunday with a time opens like any day", () => {
  const sun = decideRoomNow(base({ now: at("2026-10-18T20:00:00Z") })); // Sunday afternoon
  assert.equal(sun.status, "closed"); assert.equal(sun.reason, "closed-day"); assert.equal(sun.plan, null);
  const open = decideRoomNow(base({ openingHours: { ...WEEK, sun: "11:00" }, now: at("2026-10-18T15:00:00Z") })); // 11:00 EDT
  assert.equal(open.status, "open"); assert.equal(open.opensAt, "2026-10-18T14:00:00.000Z"); // 10:00 EDT
});

test("a closed date wins over a time, and only for that date", () => {
  const cfg = { closedDates: ["2026-10-19", "not a date", 5, null] };
  const d = decideRoomNow(base({ ...cfg, now: at("2026-10-19T14:00:00Z") }));
  assert.equal(d.status, "closed"); assert.equal(d.reason, "closed-date");
  assert.equal(decideRoomNow(base({ ...cfg, now: at("2026-10-20T14:00:00Z") })).status, "open");
});

test("a blank day is the desk's; a missing schedule is the desk's; a malformed time is the desk's, with its own reason", () => {
  const f = (openingHours) => decideRoomNow(base({ openingHours, now: at("2026-10-19T14:00:00Z") }));
  for (const blank of ["", null, undefined]) { const d = f({ ...WEEK, mon: blank }); assert.equal(d.status, "manual"); assert.equal(d.reason, "hours-blank"); assert.equal(d.plan, null); }
  for (const miss of [undefined, null, "x"]) { const d = f(miss); assert.equal(d.status, "manual"); assert.equal(d.reason, "schedule-missing"); }
  for (const bad of ["9:00", "24:00", "09:60", "9am", 900, "Closed", " 09:00"]) { const d = f({ ...WEEK, mon: bad }); assert.equal(d.status, "manual", String(bad)); assert.equal(d.reason, "hours-invalid", String(bad)); }
  assert.equal(f({}).reason, "hours-blank");
});

/* ---- clock changes ---- */

test("an ordinary day either side of a clock change is policy independent", () => {
  /* New York, Sunday 8 March 2026: clocks go 02:00 to 03:00 at 07:00Z. 08:00 is EDT, UTC-4. */
  const a = openingInstant({ day: "2026-03-08", openingHm: "08:00", tz: NY });
  assert.equal(a.opensAt, "2026-03-08T11:00:00.000Z"); assert.equal(a.policyIndependent, true);
  /* Sunday 1 November 2026: clocks go back at 06:00Z. 08:00 is EST, UTC-5. */
  const b = openingInstant({ day: "2026-11-01", openingHm: "08:00", tz: NY });
  assert.equal(b.opensAt, "2026-11-01T12:00:00.000Z"); assert.equal(b.policyIndependent, true);
  /* Monday after each: plain offsets. */
  assert.equal(openingInstant({ day: "2026-03-09", openingHm: "09:00", tz: NY }).opensAt, "2026-03-09T12:00:00.000Z");
  assert.equal(openingInstant({ day: "2026-11-02", openingHm: "09:00", tz: NY }).opensAt, "2026-11-02T13:00:00.000Z");
});

test("spring forward: 03:00 opening, less an hour, lands in the gap, so the policy matters and is not chosen", () => {
  const o = { day: "2026-03-08", openingHm: "03:00", tz: NY };
  /* Wall: 02:00 does not exist. Elapsed: 03:00 EDT is 07:00Z, less an hour is 06:00Z. */
  const none = openingInstant(o);
  assert.equal(none.ok, false); assert.equal(none.reason, "gap-policy-required");
  assert.deepEqual(none.candidates, { earlier: "2026-03-08T06:00:00.000Z", later: "2026-03-08T07:00:00.000Z" });
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed" }).opensAt, "2026-03-08T06:00:00.000Z");
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed", gapPolicy: "later" }).opensAt, "2026-03-08T06:00:00.000Z");
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall" }).reason, "gap-policy-required");
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", gapPolicy: "earlier" }).opensAt, "2026-03-08T06:00:00.000Z");
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", gapPolicy: "later" }).opensAt, "2026-03-08T07:00:00.000Z");
  /* Given both policies of the gap and neither of the offset, the two answers disagree and it says so. */
  const split = openingInstant({ ...o, gapPolicy: "later" });
  assert.equal(split.reason, "offset-policy-required");
  assert.deepEqual(split.candidates, { wall: "2026-03-08T07:00:00.000Z", elapsed: "2026-03-08T06:00:00.000Z" });
  assert.equal(openingInstant({ ...o, gapPolicy: "earlier" }).opensAt, "2026-03-08T06:00:00.000Z"); // both agree on 06:00Z
});

test("spring forward: an opening that is itself in the gap needs a gap policy", () => {
  const o = { day: "2026-03-08", openingHm: "02:30", tz: NY, offsetPolicy: "elapsed" };
  assert.equal(openingInstant(o).reason, "gap-policy-required");
  /* 02:30 read after the gap is 03:30 EDT, 07:30Z; read before it, 01:30 EST, 06:30Z. Less an hour: */
  assert.equal(openingInstant({ ...o, gapPolicy: "later" }).opensAt, "2026-03-08T06:30:00.000Z");
  assert.equal(openingInstant({ ...o, gapPolicy: "earlier" }).opensAt, "2026-03-08T05:30:00.000Z");
});

test("spring forward: 03:30 opening, three ways", () => {
  const o = { day: "2026-03-08", openingHm: "03:30", tz: NY };
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed" }).opensAt, "2026-03-08T06:30:00.000Z"); // 07:30Z less an hour
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", gapPolicy: "later" }).opensAt, "2026-03-08T07:30:00.000Z"); // 02:30 shifted forward is the opening itself: no lead at all
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", gapPolicy: "earlier" }).opensAt, "2026-03-08T06:30:00.000Z");
});

test("fall back: 02:30 opening, less an hour, lands in the repeated hour", () => {
  const o = { day: "2026-11-01", openingHm: "02:30", tz: NY };
  /* 02:30 EST is 07:30Z. Elapsed: 06:30Z (the second 01:30). Wall: 01:30 happens at 05:30Z (EDT) and 06:30Z (EST). */
  const none = openingInstant(o);
  assert.equal(none.reason, "fold-policy-required");
  assert.deepEqual(none.candidates, { first: "2026-11-01T05:30:00.000Z", second: "2026-11-01T06:30:00.000Z" });
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed" }).opensAt, "2026-11-01T06:30:00.000Z");
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", foldPolicy: "first" }).opensAt, "2026-11-01T05:30:00.000Z");
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", foldPolicy: "second" }).opensAt, "2026-11-01T06:30:00.000Z");
  /* No offset policy: the fold choice that makes the two agree resolves it, the other does not. */
  const agree = openingInstant({ ...o, foldPolicy: "second" });
  assert.equal(agree.opensAt, "2026-11-01T06:30:00.000Z"); assert.equal(agree.policyIndependent, true);
  const split = openingInstant({ ...o, foldPolicy: "first" });
  assert.equal(split.reason, "offset-policy-required");
  assert.deepEqual(split.candidates, { wall: "2026-11-01T05:30:00.000Z", elapsed: "2026-11-01T06:30:00.000Z" });
});

test("fall back: an opening that is itself in the repeated hour needs a fold policy", () => {
  const o = { day: "2026-11-01", openingHm: "01:30", tz: NY };
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed" }).reason, "fold-policy-required");
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed", foldPolicy: "first" }).opensAt, "2026-11-01T04:30:00.000Z");  // 05:30Z less an hour
  assert.equal(openingInstant({ ...o, offsetPolicy: "elapsed", foldPolicy: "second" }).opensAt, "2026-11-01T05:30:00.000Z"); // 06:30Z less an hour
  assert.equal(openingInstant({ ...o, offsetPolicy: "wall", foldPolicy: "second" }).opensAt, "2026-11-01T04:30:00.000Z"); // 00:30 EDT, unique
});

test("a zone outside the United States, both changes", () => {
  /* London: clocks go 01:00 to 02:00 on 29 March 2026 (01:00Z) and back on 25 October (01:00Z). */
  const spring = { day: "2026-03-29", openingHm: "02:00", tz: "Europe/London" };
  assert.equal(openingInstant({ ...spring, offsetPolicy: "elapsed" }).opensAt, "2026-03-29T00:00:00.000Z"); // 02:00 BST is 01:00Z
  assert.equal(openingInstant({ ...spring, offsetPolicy: "wall" }).reason, "gap-policy-required");          // 01:00 does not exist
  assert.equal(openingInstant({ ...spring, offsetPolicy: "wall", gapPolicy: "later" }).opensAt, "2026-03-29T01:00:00.000Z");
  const fall = { day: "2026-10-25", openingHm: "08:00", tz: "Europe/London" };
  assert.equal(openingInstant(fall).opensAt, "2026-10-25T07:00:00.000Z");
  assert.equal(openingInstant({ day: "2026-10-26", openingHm: "09:00", tz: "Europe/London" }).opensAt, "2026-10-26T08:00:00.000Z");
});

test("an unresolved opening is a decision of its own: no plan, the candidates, and nothing guessed", () => {
  const d = decideRoomNow(base({ openingHours: { ...WEEK, sun: "03:00" }, now: at("2026-03-08T12:00:00Z") })); // Sunday 8 March, 08:00 EDT
  assert.equal(d.status, "unresolved"); assert.equal(d.reason, "gap-policy-required"); assert.equal(d.plan, null);
  assert.equal(d.openingHm, "03:00"); assert.ok(d.candidates.earlier && d.candidates.later);
  const settled = decideRoomNow(base({ openingHours: { ...WEEK, sun: "03:00" }, offsetPolicy: "elapsed", now: at("2026-03-08T12:00:00Z") }));
  assert.equal(settled.status, "open"); assert.equal(settled.opensAt, "2026-03-08T06:00:00.000Z");
});

/* ---- the same answer for two clients ---- */

test("two clients at different moments after the opening get the same row and the same opening instant", () => {
  const moments = ["2026-10-19T12:00:00Z", "2026-10-19T12:00:30Z", "2026-10-19T13:17:00Z", "2026-10-19T23:59:00Z"];
  const plans = moments.map((m) => decideRoomNow(base({ now: at(m) })).plan);
  for (const p of plans) assert.deepEqual(p, plans[0]);
  assert.equal(plans[0].rowKey, "s1:2026-10-19");
  /* Same inputs twice are deeply equal, and a different order of asking changes nothing. */
  assert.deepEqual(decideRoomNow(base({ now: at(moments[1]) })), decideRoomNow(base({ now: at(moments[1]) })));
  const b = moments.slice().reverse().map((m) => decideRoomNow(base({ now: at(m) })).plan);
  assert.deepEqual(b.reverse(), plans);
});

test("the row key follows the room: floor and line share the day's key, online has its own", () => {
  assert.equal(rowKeyFor("floor", "s1", "2026-10-19"), "s1:2026-10-19");
  assert.equal(rowKeyFor("line", "s1", "2026-10-19"), "s1:2026-10-19");
  assert.equal(rowKeyFor("online", "s1", "2026-10-19"), "s1:2026-10-19:online");
  const d = decideRoomNow(base({ room: "online", now: at("2026-10-19T14:00:00Z") }));
  assert.equal(d.plan.rowKey, "s1:2026-10-19:online");
});

test("a model of insert-if-absent: both clients carry out the same plan and one row results", () => {
  /* This is the contract the integration must meet, in memory. It is not a test
     of any endpoint or table. */
  const rows = new Map();
  const ensure = (plan) => { if (!plan) return "nothing"; if (rows.has(plan.rowKey)) return "exists"; rows.set(plan.rowKey, { opensAt: plan.opensAt }); return "made"; };
  const a = decideRoomNow(base({ now: at("2026-10-19T12:00:05Z") }));
  const b = decideRoomNow(base({ now: at("2026-10-19T12:00:41Z") }));
  assert.deepEqual([ensure(b.plan), ensure(a.plan), ensure(a.plan)], ["made", "exists", "exists"]);
  assert.equal(rows.size, 1);
  assert.equal(ensure(decideRoomNow(base({ now: at("2026-10-19T11:00:00Z") })).plan), "nothing"); // before the hour
});

/* ---- bad input is a named result, not a throw ---- */

test("bad input comes back unresolved with a reason, and never throws", () => {
  const ok = base({ now: at("2026-10-19T14:00:00Z") });
  const r = (o) => decideRoomNow({ ...ok, ...o });
  assert.equal(r({ tz: "Mars/Olympus" }).reason, "invalid-timezone");
  assert.equal(r({ tz: "" }).reason, "invalid-timezone");
  assert.equal(r({ tz: undefined }).reason, "invalid-timezone");
  for (const now of [undefined, null, NaN, Infinity, "2026-10-19T14:00:00Z", new Date("nope")]) assert.equal(r({ now }).reason, "invalid-now", String(now));
  for (const storeId of [undefined, "", "a b", "-x", 5, "x".repeat(65)]) assert.equal(r({ storeId }).reason, "invalid-store", String(storeId));
  assert.equal(r({ room: "kitchen" }).reason, "invalid-room");
  assert.equal(decideRoomNow().reason, "invalid-store");
  assert.equal(decideRoomNow(null).status, "unresolved");
  /* A bad policy name is refused on a day that has a time to work out, and never looked at on a day that has none. */
  assert.equal(r({ offsetPolicy: "sometimes" }).status, "unresolved");
  assert.equal(r({ offsetPolicy: "sometimes" }).reason, "invalid-offset-policy");
  assert.equal(r({ offsetPolicy: "sometimes", now: at("2026-10-18T20:00:00Z") }).status, "closed"); // Sunday
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, offsetPolicy: "sometimes" }).reason, "invalid-offset-policy");
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, gapPolicy: "never" }).reason, "invalid-gap-policy");
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY, foldPolicy: "third" }).reason, "invalid-fold-policy");
  assert.equal(openingInstant({ day: "2026-13-40", openingHm: "09:00", tz: NY }).ok, false);
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "9:00", tz: NY }).reason, "invalid-opening-time");
  assert.equal(openingInstant().ok, false);
});

test("the inputs are never changed", () => {
  const deep = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === "object") deep(v); return o; };
  const input = deep(base({ closedDates: ["2026-12-25"], now: 1760875200000 }));
  decideRoomNow(input);
  openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY });
  assert.equal(input.openingHours.mon, "09:00");
});

/* ---- what the file is allowed to touch ---- */

test("the helper reads no clock, store, network or file, and imports nothing", () => {
  const src = readFileSync(new URL("../api/_room-timing.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.equal(/^\s*import\s/m.test(src), false, "no imports");
  for (const bad of [/Date\.now/, /new Date\(\s*\)/, /Math\.random/, /\bfetch\b/, /process\./, /require\(/, /\bawait\b/, /setTimeout|setInterval/, /localStorage|sessionStorage/, /supabase/i, /createClient/, /readFileSync|writeFile/])
    assert.equal(bad.test(src), false, String(bad));
  for (const name of ["Audi", "Daytona", "ECCCO"]) assert.equal(new RegExp(name, "i").test(src), false, `${name} is not named in the helper`);
});
