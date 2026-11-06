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

/* =========================================================================
   Second review (R1 to R3). These were written before the helper was changed
   and failed against c367f3c; the failing run is kept with the review packet.
   ========================================================================= */

const ALL_DAYS = { sun: "09:00", mon: "09:00", tue: "09:00", wed: "09:00", thu: "09:00", fri: "09:00", sat: "09:00" };
const POLICY_SETS = [
  {}, { offsetPolicy: "wall" }, { offsetPolicy: "elapsed" },
  { offsetPolicy: "elapsed", gapPolicy: "later" }, { offsetPolicy: "wall", gapPolicy: "earlier" },
  { gapPolicy: "later", foldPolicy: "second" }, { offsetPolicy: "wall", foldPolicy: "first" },
];
const ZONES = ["UTC", NY, "Pacific/Kiritimati"];

/* ---- R1: a day has to be on the calendar ---- */

test("R1: a day that is not on the calendar is invalid-day under every policy and zone, before any zone work", () => {
  const impossible = ["2026-02-30", "2026-02-29", "2100-02-29", "1900-02-29", "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31",
    "2026-00-10", "2026-13-01", "2026-01-00", "2026-01-32", "2026-12-99", "2026-99-99", "0000-00-00", "0026-02-30"];
  for (const day of impossible) for (const tz of ZONES) for (const p of POLICY_SETS) {
    const r = openingInstant({ day, openingHm: "09:00", tz, ...p });
    assert.equal(r.ok, false, `${day} ${tz} ${JSON.stringify(p)}`);
    assert.equal(r.reason, "invalid-day", `${day} ${tz} ${JSON.stringify(p)}`);
  }
  /* The day is looked at first: a bad zone or a bad time does not hide it. */
  assert.equal(openingInstant({ day: "2026-02-30", openingHm: "09:00", tz: "Mars/Base" }).reason, "invalid-day");
  assert.equal(openingInstant({ day: "2026-02-30", openingHm: "nine", tz: NY }).reason, "invalid-day");
  assert.equal(openingInstant({ day: "2026-02-30", openingHm: "09:00", tz: "UTC", offsetMinutes: -5 }).reason, "invalid-day");
  for (const day of ["2026-2-3", "2026/02/03", "", " 2026-02-03", "2026-02-03 ", "2026-02-03T00:00", null, undefined, 20260203, {}, [], true])
    assert.equal(openingInstant({ day, openingHm: "09:00", tz: "UTC" }).reason, "invalid-day", String(day));
});

test("R1: leap days are valid when the year is a leap year, and the day before and after are right", () => {
  for (const [day, want] of [["2024-02-29", "2024-02-29T08:00:00.000Z"], ["2028-02-29", "2028-02-29T08:00:00.000Z"],
    ["2000-02-29", "2000-02-29T08:00:00.000Z"], ["2400-02-29", "2400-02-29T08:00:00.000Z"], ["2026-04-30", "2026-04-30T08:00:00.000Z"],
    ["2026-12-31", "2026-12-31T08:00:00.000Z"]]) {
    for (const p of POLICY_SETS) assert.equal(openingInstant({ day, openingHm: "09:00", tz: "UTC", ...p }).opensAt, want, `${day} ${JSON.stringify(p)}`);
  }
  assert.equal(openingInstant({ day: "2024-02-29", openingHm: "09:00", tz: NY }).opensAt, "2024-02-29T13:00:00.000Z"); // 08:00 EST
  assert.equal(openingInstant({ day: "2024-03-01", openingHm: "00:30", tz: "UTC" }).opensAt, "2024-02-29T23:30:00.000Z");
  assert.equal(openingInstant({ day: "2100-03-01", openingHm: "00:30", tz: "UTC" }).opensAt, "2100-02-28T23:30:00.000Z"); // 2100 is not a leap year
});

test("R1: years before 1000 are an explicit unsupported result, never remapped to the 1900s", () => {
  for (const day of ["0000-01-01", "0001-01-01", "0026-02-28", "0099-12-31", "0100-01-01", "0400-02-29", "0999-12-31"])
    for (const tz of ZONES) for (const p of POLICY_SETS) {
      const r = openingInstant({ day, openingHm: "09:00", tz, ...p });
      assert.deepEqual([r.ok, r.reason], [false, "day-out-of-range"], `${day} ${tz} ${JSON.stringify(p)}`);
    }
  /* 0100-02-29 is not a real day (a century year, not divisible by 400), so it is invalid-day, not out of range. */
  assert.equal(openingInstant({ day: "0100-02-29", openingHm: "09:00", tz: "UTC" }).reason, "invalid-day");
  assert.equal(openingInstant({ day: "10000-01-01", openingHm: "09:00", tz: "UTC" }).reason, "invalid-day");
});

/* ---- R2: moments and days have to be representable and in range ---- */

const UTC_ALL = (o = {}) => base({ tz: "UTC", openingHours: ALL_DAYS, ...o });
const MIN_OK = Date.UTC(1000, 0, 1);              // 1000-01-01T00:00:00.000Z
const MAX_OK = 253402300799999;                   // 9999-12-31T23:59:59.999Z

test("R2: moments that cannot be a date, or are outside 1000 to 9999, are invalid-now with no plan", () => {
  const bad = [Number.MAX_VALUE, -Number.MAX_VALUE, 8640000000000000, -8640000000000000, 8640000000000001, Infinity, NaN,
    new Date("0001-10-19T12:00:00Z"), new Date(8640000000000000), new Date(-8640000000000000), new Date(NaN),
    MIN_OK - 1, MAX_OK + 1, new Date(MIN_OK - 1), new Date(MAX_OK + 1), "2026-10-19T12:00:00Z", 10n];
  for (const now of bad) {
    const r = decideRoomNow(UTC_ALL({ now }));
    assert.deepEqual([r.status, r.reason, r.plan], ["unresolved", "invalid-now", null], String(now));
  }
});

test("R2: the first and last accepted moments, as a Date and as a number, decide the same way", () => {
  const first = decideRoomNow(UTC_ALL({ now: MIN_OK }));
  assert.equal(first.status, "pending"); assert.equal(first.day, "1000-01-01"); assert.equal(first.opensAt, "1000-01-01T08:00:00.000Z");
  assert.deepEqual(first, decideRoomNow(UTC_ALL({ now: new Date(MIN_OK) })));
  const last = decideRoomNow(UTC_ALL({ now: MAX_OK }));
  assert.equal(last.status, "open"); assert.equal(last.day, "9999-12-31"); assert.equal(last.rowKey, "s1:9999-12-31");
  assert.equal(last.early, null); assert.equal(last.earlyReason, "day-out-of-range"); // there is no next day to look at
  assert.deepEqual(last, decideRoomNow(UTC_ALL({ now: new Date(MAX_OK) })));
  const noon = decideRoomNow(UTC_ALL({ now: new Date("9999-12-31T12:00:00Z") }));
  assert.equal(noon.status, "open"); assert.equal(noon.opensAt, "9999-12-31T08:00:00.000Z"); assert.equal(noon.early, null);
  assert.equal(decideRoomNow(UTC_ALL({ now: at("2026-10-19T14:00:00Z") })).earlyReason, null);
});

test("R2: the store's own day has to be in range too, not only the instant", () => {
  /* In New York the instant 1000-01-01T00:00Z is still 31 December 999 (and the zone then ran on local mean time). */
  assert.equal(decideRoomNow(base({ openingHours: ALL_DAYS, now: MIN_OK })).reason, "invalid-now");
  const ny = decideRoomNow(base({ openingHours: ALL_DAYS, now: Date.UTC(1000, 0, 2) }));
  assert.equal(ny.day, "1000-01-01"); assert.notEqual(ny.reason, "invalid-now"); assert.equal(ny.status, "open");
  /* In Kiritimati (UTC+14) the last UTC moment is already 1 January 10000. */
  assert.equal(decideRoomNow(base({ tz: "Pacific/Kiritimati", openingHours: ALL_DAYS, now: new Date("9999-12-31T12:00:00Z") })).reason, "invalid-now");
  /* 9999-12-30T12:00Z is 02:00 on the 31st there: accepted, and not yet 08:00, so pending. */
  const kir = decideRoomNow(base({ tz: "Pacific/Kiritimati", openingHours: ALL_DAYS, now: new Date("9999-12-30T12:00:00Z") }));
  assert.deepEqual([kir.status, kir.day, kir.opensAt], ["pending", "9999-12-31", "9999-12-30T18:00:00.000Z"]);
});

test("R2: an opening that would fall on a day outside the range is named, under every policy", () => {
  for (const p of POLICY_SETS) for (const hm of ["00:00", "00:30", "00:59"]) {
    const r = openingInstant({ day: "1000-01-01", openingHm: hm, tz: "UTC", ...p });
    assert.deepEqual([r.ok, r.reason], [false, "day-out-of-range"], `${hm} ${JSON.stringify(p)}`);
  }
  assert.equal(openingInstant({ day: "1000-01-01", openingHm: "00:00", tz: "UTC", offsetMinutes: 0 }).opensAt, "1000-01-01T00:00:00.000Z");
  assert.equal(openingInstant({ day: "1000-01-01", openingHm: "01:00", tz: "UTC" }).opensAt, "1000-01-01T00:00:00.000Z");
  assert.equal(openingInstant({ day: "9999-12-31", openingHm: "23:30", tz: "UTC" }).opensAt, "9999-12-31T22:30:00.000Z");
  assert.equal(openingInstant({ day: "9999-12-31", openingHm: "09:00", tz: NY }).opensAt, "9999-12-31T13:00:00.000Z");
  assert.equal(openingInstant({ day: "9999-12-31", openingHm: "23:30", tz: "Pacific/Kiritimati" }).opensAt, "9999-12-31T08:30:00.000Z");
  /* Through the decision: the day itself is reported unresolved, with no plan. */
  const d = decideRoomNow(UTC_ALL({ openingHours: { ...ALL_DAYS, ...Object.fromEntries(Object.keys(ALL_DAYS).map((k) => [k, "00:30"])) }, now: MIN_OK }));
  assert.deepEqual([d.status, d.reason, d.plan], ["unresolved", "day-out-of-range", null]);
});

test("R2: an old year in a zone that then kept local mean time is one instant, not a false gap", () => {
  const a = openingInstant({ day: "1800-06-15", openingHm: "09:00", tz: NY });
  assert.equal(a.ok, true);
  assert.equal(a.opensAt, "1800-06-15T12:56:02.000Z"); // 08:00 at UTC-4:56:02
  assert.equal(openingInstant({ day: "1000-06-15", openingHm: "09:00", tz: NY }).ok, true);
});

test("R2: no public entry point throws, whatever it is given", () => {
  const weird = [undefined, null, NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 8.64e15, 8.64e15 + 1, -8.64e15, 0, -0, 1.5, -1,
    "", "x", "2026-02-30", "0001-01-01", "9999-12-31", "10000-01-01", true, false, [], {}, [1], () => 1, new Date(NaN), new Date(8.64e15),
    new Date(-8.64e15), new Date("0001-10-19T12:00:00Z"), new Date("9999-12-31T12:00:00Z"), 10n, Symbol("s"),
    { toString() { throw new Error("no"); } }, { valueOf() { throw new Error("no"); } }];
  const okInstant = { day: "2026-10-19", openingHm: "09:00", tz: "UTC" };
  const okRoom = { config: cfgOf({ floor: true, line: true, online: true }), storeId: "s1", room: "floor", tz: "UTC", openingHours: ALL_DAYS, now: 1760875200000 };
  let calls = 0;
  for (const v of weird) {
    const out = [
      roomEnabled(v, v, v), enabledRooms(v, v), rowKeyFor(v, v, v), openingInstant(v), decideRoomNow(v),
      ...Object.keys(okInstant).concat(["offsetMinutes", "offsetPolicy", "gapPolicy", "foldPolicy"]).map((k) => openingInstant({ ...okInstant, [k]: v })),
      ...Object.keys(okRoom).concat(["closedDates", "offsetMinutes", "offsetPolicy", "gapPolicy", "foldPolicy"]).map((k) => decideRoomNow({ ...okRoom, [k]: v })),
    ];
    calls += out.length;
    assert.equal(typeof out[0].on, "boolean"); assert.ok(Array.isArray(out[1]));
    assert.ok(out[2] === null || typeof out[2] === "string");
    for (const r of out.slice(3)) assert.ok(r && typeof r === "object" && (typeof r.ok === "boolean" || typeof r.status === "string"));
    for (const r of out.slice(3)) if (r.status) assert.ok(r.plan === null || (r.plan && r.plan.kind === "ensure-row"));
  }
  assert.equal(calls, weird.length * 23); // 5 direct calls, 7 openingInstant fields, 11 decideRoomNow fields, for every value
  assert.equal(rowKeyFor("floor", "s1", "2026-02-30"), null);
  assert.equal(rowKeyFor("floor", "s1", "0026-02-28"), null);
  assert.equal(rowKeyFor("floor", "bad id", "2026-10-19"), null);
  assert.equal(rowKeyFor("kitchen", "s1", "2026-10-19"), null);
});

/* ---- R3: candidates are the instants the named outcomes would be ---- */

const iso = (ms) => new Date(ms).toISOString();

test("R3: explicit elapsed, spring forward 02:30: the candidates are the room-opening instants, an hour earlier than the store's", () => {
  const o = { day: "2026-03-08", openingHm: "02:30", tz: NY, offsetPolicy: "elapsed" };
  const none = openingInstant(o);
  assert.deepEqual([none.ok, none.reason], [false, "gap-policy-required"]);
  assert.deepEqual(none.candidates, { earlier: "2026-03-08T05:30:00.000Z", later: "2026-03-08T06:30:00.000Z" });
  assert.equal(openingInstant({ ...o, gapPolicy: "earlier" }).opensAt, none.candidates.earlier);
  assert.equal(openingInstant({ ...o, gapPolicy: "later" }).opensAt, none.candidates.later);
  assert.equal(none.candidatesFor, "room-opening");
});

test("R3: explicit elapsed, fall back 01:30: the same", () => {
  const o = { day: "2026-11-01", openingHm: "01:30", tz: NY, offsetPolicy: "elapsed" };
  const none = openingInstant(o);
  assert.deepEqual([none.ok, none.reason], [false, "fold-policy-required"]);
  assert.deepEqual(none.candidates, { first: "2026-11-01T04:30:00.000Z", second: "2026-11-01T05:30:00.000Z" });
  assert.equal(openingInstant({ ...o, foldPolicy: "first" }).opensAt, none.candidates.first);
  assert.equal(openingInstant({ ...o, foldPolicy: "second" }).opensAt, none.candidates.second);
});

test("R3: for every offset, zone and gap or fold time, each elapsed candidate equals the outcome of choosing it", () => {
  const cases = [
    [NY, "2026-03-08", ["02:00", "02:15", "02:30", "02:59"], "gap"], [NY, "2026-11-01", ["01:00", "01:30", "01:59"], "fold"],
    ["Europe/London", "2026-03-29", ["01:00", "01:30", "01:59"], "gap"], ["Europe/London", "2026-10-25", ["01:00", "01:30", "01:59"], "fold"],
    ["Australia/Lord_Howe", "2026-10-04", ["02:00", "02:10", "02:29"], "gap"],   // a 30 minute gap
    ["Australia/Lord_Howe", "2026-04-05", ["01:30", "01:45", "01:59"], "fold"],  // a 30 minute fold
  ];
  let checked = 0;
  for (const [tz, day, times, kind] of cases) for (const hm of times) for (const offsetMinutes of [0, 15, 30, 60, 90, 180]) {
    const o = { day, openingHm: hm, tz, offsetMinutes, offsetPolicy: "elapsed" };
    const none = openingInstant(o);
    const label = `${tz} ${day} ${hm} -${offsetMinutes}`;
    assert.equal(none.ok, false, label);
    const [a, b] = kind === "gap" ? ["earlier", "later"] : ["first", "second"];
    assert.equal(none.reason, kind === "gap" ? "gap-policy-required" : "fold-policy-required", label);
    assert.deepEqual(Object.keys(none.candidates), [a, b], label);
    const pol = kind === "gap" ? "gapPolicy" : "foldPolicy";
    assert.equal(openingInstant({ ...o, [pol]: a }).opensAt, none.candidates[a], label);
    assert.equal(openingInstant({ ...o, [pol]: b }).opensAt, none.candidates[b], label);
    checked += 2;
  }
  assert.equal(checked, 19 * 6 * 2); // 19 clock times in six cases, six offsets, two choices each
});

test("R3: a zero offset means the candidates are the store's own opening instants", () => {
  const spring = openingInstant({ day: "2026-03-08", openingHm: "02:30", tz: NY, offsetMinutes: 0, offsetPolicy: "elapsed" });
  assert.deepEqual(spring.candidates, { earlier: "2026-03-08T06:30:00.000Z", later: "2026-03-08T07:30:00.000Z" });
  const fall = openingInstant({ day: "2026-11-01", openingHm: "01:30", tz: NY, offsetMinutes: 0, offsetPolicy: "elapsed" });
  assert.deepEqual(fall.candidates, { first: "2026-11-01T05:30:00.000Z", second: "2026-11-01T06:30:00.000Z" });
});

test("R3: non-60 offsets, spring forward and fall back", () => {
  const s = (offsetMinutes) => openingInstant({ day: "2026-03-08", openingHm: "02:30", tz: NY, offsetMinutes, offsetPolicy: "elapsed" }).candidates;
  assert.deepEqual(s(30), { earlier: "2026-03-08T06:00:00.000Z", later: "2026-03-08T07:00:00.000Z" });
  assert.deepEqual(s(90), { earlier: "2026-03-08T05:00:00.000Z", later: "2026-03-08T06:00:00.000Z" });
  const f = (offsetMinutes) => openingInstant({ day: "2026-11-01", openingHm: "01:30", tz: NY, offsetMinutes, offsetPolicy: "elapsed" }).candidates;
  assert.deepEqual(f(30), { first: "2026-11-01T05:00:00.000Z", second: "2026-11-01T06:00:00.000Z" });
  assert.deepEqual(f(90), { first: "2026-11-01T04:00:00.000Z", second: "2026-11-01T05:00:00.000Z" });
});

test("R3: explicit wall candidates were already room-opening instants, and still equal their outcomes", () => {
  const w = { day: "2026-03-08", openingHm: "03:30", tz: NY, offsetPolicy: "wall" };
  const none = openingInstant(w);
  assert.deepEqual(none.candidates, { earlier: "2026-03-08T06:30:00.000Z", later: "2026-03-08T07:30:00.000Z" });
  assert.equal(openingInstant({ ...w, gapPolicy: "earlier" }).opensAt, none.candidates.earlier);
  assert.equal(openingInstant({ ...w, gapPolicy: "later" }).opensAt, none.candidates.later);
  const f = { day: "2026-11-01", openingHm: "02:30", tz: NY, offsetPolicy: "wall" };
  const fold = openingInstant(f);
  assert.equal(openingInstant({ ...f, foldPolicy: "first" }).opensAt, fold.candidates.first);
  assert.equal(openingInstant({ ...f, foldPolicy: "second" }).opensAt, fold.candidates.second);
  assert.equal(fold.candidatesFor, "room-opening");
});

test("R3: with no offset policy, both branches are kept with their own requirements", () => {
  /* The opening itself is in the gap: elapsed needs a gap policy; wall resolves (01:30 EST). */
  const a = openingInstant({ day: "2026-03-08", openingHm: "02:30", tz: NY });
  assert.deepEqual([a.ok, a.reason], [false, "gap-policy-required"]);
  assert.deepEqual(a.branches.elapsed, { ok: false, reason: "gap-policy-required", candidates: { earlier: "2026-03-08T05:30:00.000Z", later: "2026-03-08T06:30:00.000Z" } });
  assert.deepEqual(a.branches.wall, { ok: true, opensAt: "2026-03-08T06:30:00.000Z" });
  assert.deepEqual(a.candidates, a.branches.elapsed.candidates);
  assert.equal(a.candidatesFor, "room-opening");
  /* The hour before lands in the gap: elapsed resolves; wall needs a gap policy. */
  const b = openingInstant({ day: "2026-03-08", openingHm: "03:00", tz: NY });
  assert.deepEqual(b.branches.elapsed, { ok: true, opensAt: "2026-03-08T06:00:00.000Z" });
  assert.deepEqual(b.branches.wall, { ok: false, reason: "gap-policy-required", candidates: { earlier: "2026-03-08T06:00:00.000Z", later: "2026-03-08T07:00:00.000Z" } });
  assert.deepEqual(b.candidates, b.branches.wall.candidates);
  /* Both resolve and disagree: said so, with both. */
  const c = openingInstant({ day: "2026-03-08", openingHm: "03:00", tz: NY, gapPolicy: "later" });
  assert.equal(c.reason, "offset-policy-required");
  assert.equal(c.candidatesFor, "room-opening");
  assert.deepEqual(c.candidates, { wall: "2026-03-08T07:00:00.000Z", elapsed: "2026-03-08T06:00:00.000Z" });
  assert.deepEqual(c.branches, { wall: { ok: true, opensAt: "2026-03-08T07:00:00.000Z" }, elapsed: { ok: true, opensAt: "2026-03-08T06:00:00.000Z" } });
  /* Both need a policy: both are shown, in their own terms. */
  const d = openingInstant({ day: "2026-11-01", openingHm: "02:00", tz: NY, offsetMinutes: 30 });
  assert.equal(d.ok, false);
  assert.deepEqual(Object.keys(d.branches).sort(), ["elapsed", "wall"]);
  /* Both branches need a policy for the same time of day, and they name the same room-opening instants,
     so whichever is reported first, the candidates are the same ones. */
  const both = openingInstant({ day: "2026-03-08", openingHm: "02:45", tz: NY, offsetMinutes: 30 });
  assert.deepEqual([both.ok, both.reason], [false, "gap-policy-required"]);
  assert.deepEqual(both.branches.elapsed.candidates, { earlier: "2026-03-08T06:15:00.000Z", later: "2026-03-08T07:15:00.000Z" });
  assert.deepEqual(both.branches.wall.candidates, both.branches.elapsed.candidates);
  assert.deepEqual(both.candidates, both.branches.elapsed.candidates);
  assert.equal(openingInstant({ day: "2026-03-08", openingHm: "02:45", tz: NY, offsetMinutes: 30, offsetPolicy: "wall", gapPolicy: "earlier" }).opensAt, both.candidates.earlier);
  assert.equal(openingInstant({ day: "2026-03-08", openingHm: "02:45", tz: NY, offsetMinutes: 30, offsetPolicy: "elapsed", gapPolicy: "later" }).opensAt, both.candidates.later);
  /* An explicit policy has one branch and no branches block. */
  assert.equal("branches" in openingInstant({ day: "2026-03-08", openingHm: "02:30", tz: NY, offsetPolicy: "elapsed" }), false);
});

test("R3: the decision carries the same candidates and branches", () => {
  const d = decideRoomNow(base({ openingHours: { ...WEEK, sun: "02:30" }, now: at("2026-03-08T12:00:00Z") }));
  assert.equal(d.status, "unresolved"); assert.equal(d.reason, "gap-policy-required");
  assert.deepEqual(d.candidates, { earlier: "2026-03-08T05:30:00.000Z", later: "2026-03-08T06:30:00.000Z" });
  assert.equal(d.branches.wall.ok, true); assert.equal(d.plan, null);
});

/* =========================================================================
   Third review (R4). Written before the helper was changed; it failed against
   revision 2 and the failing run is kept with the review packet.

   With no offset policy the result shows both branches. Each branch has to be
   exactly what choosing that policy would have returned, range check included.
   ========================================================================= */

/* The outcome of each branch, as the omitted-policy result shows it, against the
   outcome of asking for that policy explicitly with everything else the same. */
function checkBranchesAgree(a, label) {
  const r = openingInstant(a);
  if (!r.branches) return { branches: 0 };
  assert.deepEqual(Object.keys(r.branches).sort(), ["elapsed", "wall"], label);
  for (const name of ["wall", "elapsed"]) {
    const b = r.branches[name], x = openingInstant({ ...a, offsetPolicy: name });
    assert.equal(b.ok, x.ok, `${label} ${name}: ok`);
    if (x.ok) assert.equal(b.opensAt, x.opensAt, `${label} ${name}: opensAt`);
    else { assert.equal(b.reason, x.reason, `${label} ${name}: reason`); assert.deepEqual(b.candidates, x.candidates, `${label} ${name}: candidates`); }
  }
  /* And the top level says what the branches say: the first that cannot be used is the reason. */
  const first = !r.branches.elapsed.ok ? r.branches.elapsed : !r.branches.wall.ok ? r.branches.wall : null;
  if (first) { assert.equal(r.ok, false, label); assert.equal(r.reason, first.reason, `${label}: top-level reason`); assert.deepEqual(r.candidates, first.candidates, `${label}: top-level candidates`); }
  return { branches: 2 };
}

test("R4: the lower boundary, the reviewer's own example, branch by branch", () => {
  const a = { day: "1000-01-01", openingHm: "00:30", tz: "UTC" };
  const r = openingInstant(a);
  assert.deepEqual([r.ok, r.reason], [false, "day-out-of-range"]);
  assert.deepEqual(r.branches.wall, { ok: false, reason: "day-out-of-range" });
  assert.deepEqual(r.branches.elapsed, { ok: false, reason: "day-out-of-range" }, "an instant on 31 December 999 is not a successful branch");
  assert.deepEqual(openingInstant({ ...a, offsetPolicy: "elapsed" }), { ok: false, reason: "day-out-of-range" });
  assert.deepEqual(openingInstant({ ...a, offsetPolicy: "wall" }), { ok: false, reason: "day-out-of-range" });
});

test("R4: every branch of every omitted-policy result equals the explicit policy's result, at both ends of the range and at modern clock changes", () => {
  let results = 0, branches = 0, boundary = 0;
  const zones = ["UTC", NY, "Asia/Kolkata", "Europe/London", "Pacific/Kiritimati"];
  for (const tz of zones) for (const [day, hms] of [["1000-01-01", ["00:00", "00:30", "00:59", "01:00", "01:30", "09:00"]], ["1000-01-02", ["00:00", "00:30", "01:00"]],
    ["9999-12-31", ["00:00", "00:30", "09:00", "23:30"]], ["9999-12-30", ["23:30"]]])
    for (const openingHm of hms) for (const offsetMinutes of [0, 15, 30, 60, 90, 1440]) {
      const out = checkBranchesAgree({ day, openingHm, tz, offsetMinutes }, `${tz} ${day} ${openingHm} -${offsetMinutes}`);
      results++; branches += out.branches; if (day === "1000-01-01" && out.branches) boundary++;
    }
  /* Modern gap and fold behaviour is untouched: ambiguous branches keep their candidates, with and without a gap or fold policy. */
  let modern = 0;
  for (const [tz, day, hms] of [[NY, "2026-03-08", ["02:30", "02:45", "03:00", "03:30"]], [NY, "2026-11-01", ["01:30", "02:00", "02:30"]],
    ["Europe/London", "2026-03-29", ["01:30", "02:00"]], ["Europe/London", "2026-10-25", ["01:30", "02:00"]], ["Australia/Lord_Howe", "2026-10-04", ["02:10", "02:40"]]])
    for (const openingHm of hms) for (const offsetMinutes of [0, 30, 60, 90]) for (const p of [{}, { gapPolicy: "later" }, { gapPolicy: "earlier" }, { foldPolicy: "first" }, { foldPolicy: "second" }]) {
      const out = checkBranchesAgree({ day, openingHm, tz, offsetMinutes, ...p }, `${tz} ${day} ${openingHm} -${offsetMinutes} ${JSON.stringify(p)}`);
      results++; branches += out.branches; modern += out.branches;
    }
  assert.ok(boundary > 0, "some boundary results carried branches");
  assert.ok(modern > 0, "some modern gap or fold results carried branches");
  assert.ok(branches % 2 === 0 && results > branches / 2, "and some results carried none, because both branches agreed");
});

test("R4: when both branches are usable and agree there is no branches block and no change in the answer", () => {
  const r = openingInstant({ day: "1000-01-02", openingHm: "09:00", tz: "UTC" });
  assert.deepEqual([r.ok, r.opensAt, r.policyIndependent, "branches" in r], [true, "1000-01-02T08:00:00.000Z", true, false]);
  assert.equal(openingInstant({ day: "2026-10-19", openingHm: "09:00", tz: NY }).opensAt, "2026-10-19T12:00:00.000Z");
});

/* =========================================================================
   Fourth review: two fixed-offset boundary assertions from the independent
   reviewer. The UTC range applies to the instant that comes out, not only to
   the store's own opening day. Etc/GMT-5 is UTC+5 all year and Etc/GMT+5 is
   UTC-5, so there is no clock change here to blame.

   1000-01-01 01:00 less an hour is 00:00 local, which is 19:00Z on
   31 December 999: the local day is in range and the instant is not.
   9999-12-31 23:30 less an hour is 22:30 local, which is 03:30Z on
   1 January 10000: the same at the other end.
   ========================================================================= */

test("wall result must respect UTC lower bound even when local opening day stays in range", () => {
  assert.deepEqual(openingInstant({ day: "1000-01-01", openingHm: "01:00", tz: "Etc/GMT-5", offsetPolicy: "wall" }), { ok: false, reason: "day-out-of-range" });
});

test("wall result must respect UTC upper bound even when local opening day stays in range", () => {
  assert.deepEqual(openingInstant({ day: "9999-12-31", openingHm: "23:30", tz: "Etc/GMT+5", offsetPolicy: "wall" }), { ok: false, reason: "day-out-of-range" });
});
