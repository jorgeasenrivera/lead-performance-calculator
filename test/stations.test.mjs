/**
 * Taking and leaving a phone station.
 * -------------------------------------------------------------------------
 * Phase one of the staffed stations, and the rules that matter are the ones
 * about a person being in two places or a seat holding two people. Both are
 * the kind of mistake that looks fine on the board for an hour and then makes
 * every number downstream wrong, because the later phases count seated hours
 * and a doubled interval doubles them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_PLAN, stationPlanOf, seatsOf, stationOf, openSit,
  claimStation, releaseStation, releasePerson, stationBoard,
} from "../api/_stations.mjs";

const DEV = { id: "p-dev", label: "Dev Okonjo" };
const PRI = { id: "p-pri", label: "Priya Ramanan" };
const T1 = "2026-09-10T14:00:00.000Z";
const T2 = "2026-09-10T15:30:00.000Z";
const T3 = "2026-09-10T16:00:00.000Z";

test("a claim seats somebody and opens a sit", () => {
  const { row, changed } = claimStation({}, "3", DEV, T1);
  assert.equal(changed, true);
  assert.equal(row.stations["3"].id, "p-dev");
  assert.equal(stationOf(row, "p-dev"), "3");
  assert.deepEqual(openSit(row, "p-dev"), { st: "3", id: "p-dev", label: "Dev Okonjo", in: T1, out: null, why: null });
});

test("a seat somebody else is in is refused", () => {
  /* The desk moves people; a claim does not take them. Silently bumping
     somebody is how two people end up believing the same call is theirs. */
  const a = claimStation({}, "3", DEV, T1).row;
  const b = claimStation(a, "3", PRI, T2);
  assert.equal(b.changed, false);
  assert.equal(b.why, "taken");
  assert.equal(b.row.stations["3"].id, "p-dev", "the row is handed back untouched");
});

test("claiming your own seat again changes nothing", () => {
  const a = claimStation({}, "3", DEV, T1).row;
  const b = claimStation(a, "3", DEV, T2);
  assert.equal(b.changed, false);
  assert.equal(b.row.sits.length, 1, "no second sit for the seat they are already in");
});

test("claiming a second seat is a move, not a second sit", () => {
  /* Two open sits for one person double every hour they are counted for, and
     the doubling is invisible until somebody adds up the day. */
  const a = claimStation({}, "3", DEV, T1).row;
  const b = claimStation(a, "5", DEV, T2).row;
  assert.equal(stationOf(b, "p-dev"), "5");
  assert.equal(b.stations["3"], undefined, "the old seat is free again");
  const open = b.sits.filter((s) => !s.out);
  assert.equal(open.length, 1, "exactly one open sit");
  assert.equal(open[0].st, "5");
  const closed = b.sits.find((s) => s.st === "3");
  assert.equal(closed.out, T2);
  assert.equal(closed.why, "moved");
});

test("leaving frees the seat and closes the sit with a reason", () => {
  const a = claimStation({}, "3", DEV, T1).row;
  const b = releaseStation(a, "3", T2, "lunch");
  assert.equal(b.changed, true);
  assert.equal(b.row.stations["3"], undefined);
  assert.equal(openSit(b.row, "p-dev"), null);
  assert.equal(b.row.sits[0].out, T2);
  assert.equal(b.row.sits[0].why, "lunch");
});

test("the reason is kept, because the later phases read it", () => {
  /* Tapped out, at lunch, and the phone left the lot are three different
     facts about a seat, and the last one frees a seat nobody told us about. */
  for (const why of ["out", "lunch", "left"]) {
    const a = claimStation({}, "1", DEV, T1).row;
    const b = releaseStation(a, "1", T2, why).row;
    assert.equal(b.sits[0].why, why);
  }
});

test("releasing an empty seat is not a change", () => {
  const r = releaseStation({ stations: {} }, "4", T2);
  assert.equal(r.changed, false);
  assert.equal(r.why, "empty");
});

test("a person can be released without knowing where they sat", () => {
  /* Which is how the geofence will free a seat: it knows whose phone left the
     lot, not which chair they were in. */
  const a = claimStation({}, "6", DEV, T1).row;
  const b = releasePerson(a, "p-dev", T2, "left");
  assert.equal(b.changed, true);
  assert.equal(b.station, "6");
  assert.equal(b.row.stations["6"], undefined);
  assert.equal(b.row.sits[0].why, "left");
  assert.equal(releasePerson(b.row, "p-dev", T3).changed, false);
});

test("two people can hold different seats at once", () => {
  const a = claimStation({}, "1", DEV, T1).row;
  const b = claimStation(a, "2", PRI, T1).row;
  assert.equal(stationOf(b, "p-dev"), "1");
  assert.equal(stationOf(b, "p-pri"), "2");
  assert.equal(b.sits.filter((s) => !s.out).length, 2);
});

test("a day reads back as whole intervals", () => {
  /* What phase six will actually consume: one row per sit, in, out, and where.
     Checked here because it is the shape, not the screen, that has to survive. */
  let row = claimStation({}, "3", DEV, T1).row;
  row = releaseStation(row, "3", T2, "lunch").row;
  row = claimStation(row, "3", DEV, T2).row;
  row = releaseStation(row, "3", T3, "out").row;
  assert.deepEqual(row.sits.map((s) => [s.st, s.in, s.out, s.why]), [
    ["3", T1, T2, "lunch"],
    ["3", T2, T3, "out"],
  ]);
});

test("the board carries the free seats too", () => {
  /* An empty station is the thing a manager is looking for, so a list of only
     the occupied ones answers the wrong question. */
  const row = claimStation({}, "2", DEV, T1).row;
  const board = stationBoard(DEFAULT_STATION_PLAN, row);
  assert.equal(board.length, 6);
  const two = board.find((s) => s.n === "2");
  assert.equal(two.taken, true);
  assert.equal(two.label, "Dev Okonjo");
  assert.equal(board.filter((s) => !s.taken).length, 5);
});

test("a store without a drawn plan gets the default, and its own when it has one", () => {
  assert.equal(stationPlanOf({ stores: [{ id: "a" }] }, "a"), DEFAULT_STATION_PLAN);
  assert.equal(stationPlanOf(null, "a"), DEFAULT_STATION_PLAN);
  /* An empty seat list is not a drawn plan — it is a plan somebody started and
     did not finish, and honouring it would leave the store with no stations. */
  assert.equal(stationPlanOf({ stores: [{ id: "a", stationPlan: { seats: [] } }] }, "a"), DEFAULT_STATION_PLAN);
  const mine = { seats: [{ n: "A", x: 10, y: 10 }] };
  assert.equal(stationPlanOf({ stores: [{ id: "a", stationPlan: mine }] }, "a"), mine);
});

test("seats drawn under the floor's key still read", () => {
  /* The map and the editor are shared with the floor, which calls them tables.
     A plan that came through that path must not draw an empty room. */
  const plan = { tables: [{ n: "1", x: 5, y: 5 }, { n: "2", x: 20, y: 5 }] };
  assert.equal(seatsOf(plan).length, 2);
  assert.equal(stationPlanOf({ stores: [{ id: "a", stationPlan: plan }] }, "a"), plan);
  assert.equal(stationBoard(plan, {}).length, 2);
});

/* ---- phase two: presence ---- */
import { HOLD_MS, presenceOf, touchStation, stationPresence, sitsFor, sitMinutes, seenAt } from "../api/_stations.mjs";

const AT = (mins) => new Date(Date.parse(T1) + mins * 60000).toISOString();
const NOW = (mins) => Date.parse(T1) + mins * 60000;

test("a seat just taken is seated", () => {
  const row = claimStation({}, "1", DEV, T1).row;
  const seat = stationBoard(DEFAULT_STATION_PLAN, row).find((s) => s.n === "1");
  assert.equal(presenceOf(seat, { now: NOW(1) }), "seated");
});

test("fifteen quiet minutes greys it, and it is still theirs", () => {
  const row = claimStation({}, "1", DEV, T1).row;
  const seat = stationBoard(DEFAULT_STATION_PLAN, row).find((s) => s.n === "1");
  assert.equal(presenceOf(seat, { now: NOW(14) }), "seated");
  assert.equal(presenceOf(seat, { now: NOW(15) }), "held");
  assert.equal(seat.taken, true, "held is cosmetic — the seat has not been released");
  assert.equal(HOLD_MS, 15 * 60 * 1000);
});

test("hearing from them starts the clock again", () => {
  let row = claimStation({}, "1", DEV, T1).row;
  row = touchStation(row, "p-dev", AT(14)).row;
  const seat = stationBoard(DEFAULT_STATION_PLAN, row).find((s) => s.n === "1");
  assert.equal(presenceOf(seat, { now: NOW(20) }), "seated", "six minutes since we heard from them");
  assert.equal(presenceOf(seat, { now: NOW(29) }), "held");
});

test("a phone off the lot frees the seat regardless of how recently they tapped", () => {
  /* The one thing the fence is actually good for. Somebody who tapped a
     button on their way out of the door is not still at the desk. */
  const row = claimStation({}, "1", DEV, T1).row;
  const seat = stationBoard(DEFAULT_STATION_PLAN, row).find((s) => s.n === "1");
  assert.equal(presenceOf(seat, { now: NOW(1), onLot: false }), "free");
  assert.equal(presenceOf(seat, { now: NOW(1), onLot: true }), "seated");
});

test("an unknown reading is treated as on the lot", () => {
  /* No fence drawn, permission refused, or a reading too vague to act on.
     Freeing a seat on the strength of a reading the fence itself would not
     stand behind is worse than leaving it alone. */
  const row = claimStation({}, "1", DEV, T1).row;
  const seat = stationBoard(DEFAULT_STATION_PLAN, row).find((s) => s.n === "1");
  assert.equal(presenceOf(seat, { now: NOW(1), onLot: undefined }), "seated");
  assert.equal(presenceOf(seat, { now: NOW(1), onLot: null }), "seated");
});

test("touching a seat you are not in changes nothing", () => {
  const row = claimStation({}, "1", DEV, T1).row;
  assert.equal(touchStation(row, "p-pri", AT(2)).changed, false);
});

test("the board carries each seat's state, per person", () => {
  let row = claimStation({}, "1", DEV, T1).row;
  row = claimStation(row, "2", PRI, T1).row;
  row = touchStation(row, "p-pri", AT(20)).row;
  const board = stationPresence(DEFAULT_STATION_PLAN, row, { now: NOW(21), onLot: { "p-dev": true } });
  assert.equal(board.find((s) => s.n === "1").state, "held", "quiet for twenty-one minutes");
  assert.equal(board.find((s) => s.n === "2").state, "seated", "heard from a minute ago");
  assert.equal(board.find((s) => s.n === "3").state, "free");
});

test("a seat whose person has left the lot reads free on the board", () => {
  const row = claimStation({}, "1", DEV, T1).row;
  const board = stationPresence(DEFAULT_STATION_PLAN, row, { now: NOW(2), onLot: { "p-dev": false } });
  assert.equal(board.find((s) => s.n === "1").state, "free");
});

test("your day at the station reads back as intervals with lengths", () => {
  let row = claimStation({}, "3", DEV, T1).row;
  row = releaseStation(row, "3", AT(90), "lunch").row;
  row = claimStation(row, "5", DEV, AT(120)).row;
  const mine = sitsFor(row, "p-dev");
  assert.equal(mine.length, 2);
  assert.equal(sitMinutes(mine[0]), 90);
  assert.equal(mine[0].why, "lunch");
  assert.equal(sitMinutes(mine[1], NOW(150)), 30, "the open one runs to now");
  assert.deepEqual(sitsFor(row, "p-pri"), [], "somebody else's day is not in it");
});

test("seen falls back to when they sat, so an untouched seat still has a clock", () => {
  const row = claimStation({}, "1", DEV, T1).row;
  assert.equal(seenAt(row.stations["1"]), T1);
});
