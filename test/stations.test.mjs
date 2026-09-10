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

/* ---- phase three: the rotation ---- */
import { OFFER_MS, waitingFor, offerOf, offerLeftMs, rollOffers, takeOffer,
  skipOffer, stationLine } from "../api/_stations.mjs";

const TEST_ID = "__lpc_test__";
/* A row with a plan of two seats, so a full room is reachable in a test. */
const TWO = { seats: [{ n: "1", x: 10, y: 10 }, { n: "2", x: 40, y: 10 }] };
const ANA = { id: "p-ana", label: "Ana Beltre" };
const roll = (row, plan, mins, opts) => rollOffers(row, plan, NOW(mins), opts);

/* Somebody in the line, waiting, unless told otherwise. */
const inLine = (...people) => ({
  line: people.map((p) => (p.id ? { id: p.id, label: p.label, status: "waiting" } : p)),
});

test("a free seat is offered to whoever is next in the line", () => {
  const row = inLine(DEV, PRI);
  const { row: r, changed } = roll(row, TWO, 0);
  assert.equal(changed, true);
  assert.equal(offerOf(r, "1").id, "p-dev", "the first in the line");
  assert.equal(offerOf(r, "2").id, "p-pri", "and the second gets the other seat");
});

test("nobody is promised two chairs at once", () => {
  /* Two seats promised to one body is how a room ends up with an empty chair
     everybody believes is spoken for. */
  const r = roll(inLine(DEV), TWO, 0).row;
  assert.equal(offerOf(r, "1").id, "p-dev");
  assert.equal(offerOf(r, "2"), null, "and the other seat is not promised to them as well");
});

test("an occupied seat is not offered", () => {
  let row = inLine(DEV, PRI);
  row = claimStation(row, "1", DEV, T1).row;
  const r = roll(row, TWO, 0).row;
  assert.equal(offerOf(r, "1"), null);
  assert.equal(offerOf(r, "2").id, "p-pri", "and the person in a chair is not offered another");
});

test("a board left open writes nothing", () => {
  /* The property everything else depends on: every phone looking at the board
     rolls the offers, so an unchanged room has to come back changed:false or
     the row is rewritten on every tick by every device. */
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  for (const m of [0, 1, 2]) assert.equal(roll(r, TWO, m).changed, false, `${m} minutes later`);
});

test("an offer that is not taken rolls on to the next person", () => {
  const row = inLine(DEV, PRI);
  const a = roll(row, { seats: [{ n: "1", x: 0, y: 0 }] }, 0).row;
  assert.equal(offerOf(a, "1").id, "p-dev");
  assert.equal(roll(a, { seats: [{ n: "1", x: 0, y: 0 }] }, 2).changed, false, "three minutes is not up");
  const b = roll(a, { seats: [{ n: "1", x: 0, y: 0 }] }, 4).row;
  assert.equal(offerOf(b, "1").id, "p-pri");
  assert.deepEqual(offerOf(b, "1").passed, ["p-dev"], "and it remembers who has had their turn");
  assert.equal(OFFER_MS, 3 * 60 * 1000);
});

test("a round that runs out of takers leaves the seat open, and stops asking", () => {
  const ONE = { seats: [{ n: "1", x: 0, y: 0 }] };
  let r = roll(inLine(DEV), ONE, 0).row;
  r = roll(r, ONE, 4).row;
  assert.equal(offerOf(r, "1").id, null, "offered to nobody");
  assert.deepEqual(offerOf(r, "1").passed, ["p-dev"]);
  assert.equal(roll(r, ONE, 8).changed, false, "and it does not start over on the next tick");
});

test("somebody joining the line is offered the seat nobody wanted", () => {
  const ONE = { seats: [{ n: "1", x: 0, y: 0 }] };
  let r = roll(inLine(DEV), ONE, 0).row;
  r = roll(r, ONE, 4).row;                       // Dev's turn lapsed, seat open
  r.line.push({ id: ANA.id, label: ANA.label, status: "waiting" });
  assert.equal(roll(r, ONE, 5).row.offers["1"].id, "p-ana");
});

test("an offer to somebody who steps away ends, and does not cost them a turn", () => {
  /* A promise to a person who is at lunch holds the chair empty. They are not
     counted as having passed: when they come back they are eligible again. */
  const ONE = { seats: [{ n: "1", x: 0, y: 0 }] };
  const row = inLine(DEV, PRI);
  let r = roll(row, ONE, 0).row;
  assert.equal(offerOf(r, "1").id, "p-dev");
  r.line[0].status = "lunch";
  r = roll(r, ONE, 1).row;
  assert.equal(offerOf(r, "1").id, "p-pri", "it moves on without waiting out the clock");
  assert.deepEqual(offerOf(r, "1").passed, [], "Dev did not pass on it");
});

test("waiting means waiting", () => {
  const row = { line: [
    { id: "p-dev", label: "Dev", status: "waiting" },
    { id: "p-pri", label: "Priya", status: "lunch" },
    { id: "p-ana", label: "Ana", status: "customer" },
    { id: TEST_ID, label: "Test", status: "waiting" },
  ] };
  assert.deepEqual(waitingFor(row, { skip: [TEST_ID] }).map((p) => p.id), ["p-dev"]);
});

test("the person a seat was offered to can take it", () => {
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  const t = takeOffer(r, "1", DEV, T1);
  assert.equal(t.changed, true);
  assert.equal(stationOf(t.row, "p-dev"), "1");
  assert.equal(offerOf(t.row, "1"), null, "the offer is spent");
  assert.equal(openSit(t.row, "p-dev").via, "line", "and the sit says where the chair came from");
});

test("somebody else's offer is refused", () => {
  /* The desk can still seat anybody through claimStation. A claim arriving
     from a phone or a tag waits its turn. */
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  const t = takeOffer(r, "1", PRI, T1);
  assert.equal(t.changed, false);
  assert.equal(t.why, "offered");
  const late = takeOffer(r, "1", PRI, new Date(NOW(5)).toISOString());
  assert.equal(late.changed, true, "once it has lapsed the seat is anybody's");
});

test("the desk seating somebody directly ends the round", () => {
  /* Otherwise a round keeps running against a chair that is already full. */
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  const seated = claimStation(r, "1", ANA, T1).row;
  assert.equal(offerOf(seated, "1"), null);
  assert.equal(roll(seated, TWO, 1).changed, false);
});

test("the desk can skip somebody, with a reason, and it is written down", () => {
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  const s = skipOffer(r, "1", T1, { by: "Marisol", why: "on a callback" });
  assert.equal(s.changed, true);
  assert.equal(offerOf(s.row, "1").id, null);
  assert.deepEqual(offerOf(s.row, "1").passed, ["p-dev"]);
  const ev = s.row.history.at(-1);
  assert.equal(ev.action, "station-skipped");
  assert.equal(ev.id, "p-dev");
  assert.equal(ev.by, "Marisol");
  assert.equal(ev.reason, "on a callback");
  assert.equal(ev.station, "1");
  /* And the next roll hands the chair to the next person rather than back. */
  assert.equal(roll(s.row, TWO, 1).row.offers["1"].id, "p-pri");
});

test("skipping nothing is not a change", () => {
  assert.equal(skipOffer({}, "1", T1).changed, false);
  assert.equal(skipOffer(roll(inLine(), TWO, 0).row, "1", T1).why, "nothing offered");
});

test("a skip does not move anybody in the line", () => {
  /* Passing on a chair is not declining a call. If it cost somebody their
     place then sitting down would be a gamble against their own next up. */
  const r = roll(inLine(DEV, PRI), TWO, 0).row;
  const s = skipOffer(r, "1", T1, { by: "Marisol", why: "on a callback" }).row;
  assert.deepEqual(s.line.map((p) => p.id), ["p-dev", "p-pri"]);
  assert.equal(s.line[0].status, "waiting");
});

test("the board reads as seats plus the line behind them", () => {
  let row = inLine(DEV, PRI, ANA);
  row = claimStation(row, "1", DEV, T1).row;
  row = roll(row, TWO, 0, { skip: [TEST_ID] }).row;
  const b = stationLine(TWO, row, { now: NOW(1), skip: [TEST_ID] });
  assert.equal(b.free, 1);
  assert.equal(b.full, false);
  assert.deepEqual(b.waiting.map((p) => p.id), ["p-pri", "p-ana"]);
  /* Priya's name is already on station 2. She is waiting, but she is not
     waiting for the NEXT chair to come free — Ana is. Drawing her in both
     places reads as two different facts about one person. */
  assert.deepEqual(b.queued.map((p) => p.id), ["p-ana"]);
  assert.equal(b.next.id, "p-ana", "whoever the next free seat belongs to");
  const two = b.seats.find((s) => s.n === "2");
  assert.equal(two.offerTo, "p-pri");
  assert.equal(two.offerLabel, "Priya Ramanan");
  assert.ok(two.offerLeftMs > 0 && two.offerLeftMs <= OFFER_MS);
  assert.equal(b.seats.find((s) => s.n === "1").offerTo, null, "an occupied seat offers nothing");
});

test("a full room is a full room, and everybody else is the waiting list", () => {
  let row = inLine(DEV, PRI, ANA);
  row = claimStation(row, "1", DEV, T1).row;
  row = claimStation(row, "2", PRI, T1).row;
  const b = stationLine(TWO, row, { now: NOW(1) });
  assert.equal(b.full, true);
  assert.equal(b.free, 0);
  assert.deepEqual(b.waiting.map((p) => p.id), ["p-ana"], "the people in the chairs are not waiting for one");
  /* With no free seat there is no offer to hold, so the queue is the whole
     waiting list — which is what a full room sends people to. */
  assert.deepEqual(b.queued.map((p) => p.id), ["p-ana"]);
});

test("no seats is not a full room", () => {
  /* A store that has not drawn a plan should not read as "every station taken". */
  assert.equal(stationLine({ seats: [] }, inLine(DEV)).full, false);
});

test("an offer has no time left once it is taken or spent", () => {
  assert.equal(offerLeftMs(null), 0);
  assert.equal(offerLeftMs({ id: null, passed: [] }), 0);
  assert.equal(offerLeftMs({ id: "p-dev", until: new Date(NOW(0)).toISOString() }, NOW(1)), 0);
});

test("an empty room with nobody waiting is left alone entirely", () => {
  /* A store that never opens this screen should not gain an offers object for
     seats nobody has ever asked for. */
  assert.equal(roll({ line: [] }, TWO, 0).changed, false);
  assert.equal(roll({}, TWO, 0).changed, false);
});

test("a freed seat is not handed straight back to whoever just left it", () => {
  /* Watched happen on a real board: the desk frees station 1 and the person
     who stood up is offered it again a second later, because they are still
     high in the line and waiting the moment they are released. */
  const ONE = { seats: [{ n: "1", x: 0, y: 0 }] };
  let row = inLine(DEV, PRI);
  row = claimStation(row, "1", DEV, T1).row;
  row = releaseStation(row, "1", AT(60), "out").row;
  assert.equal(roll(row, ONE, 61).row.offers["1"].id, "p-pri", "it goes to the person who has not sat");
});

test("having had a turn costs a place for a chair and nothing in the line", () => {
  /* The separation the whole phase rests on: the Phone Line orders who gets
     the next CALL, and it is not touched by any of this. */
  let row = inLine(DEV, PRI, ANA);
  row = claimStation(row, "1", DEV, T1).row;
  row = releaseStation(row, "1", AT(60), "lunch").row;
  row.line[0].status = "waiting";
  assert.deepEqual(waitingFor(row).map((p) => p.id), ["p-pri", "p-ana", "p-dev"]);
  assert.deepEqual(row.line.map((p) => p.id), ["p-dev", "p-pri", "p-ana"], "the line itself is untouched");
});

test("once everybody has had a turn, longest since they got up goes first", () => {
  let row = inLine(DEV, PRI);
  row = claimStation(row, "1", DEV, T1).row;
  row = releaseStation(row, "1", AT(10), "out").row;      // Dev up at ten past
  row = claimStation(row, "1", PRI, AT(10)).row;
  row = releaseStation(row, "1", AT(70), "out").row;      // Priya up an hour later
  for (const p of row.line) p.status = "waiting";
  assert.deepEqual(waitingFor(row).map((p) => p.id), ["p-dev", "p-pri"]);
});

test("an open sit does not count as a turn taken", () => {
  /* Somebody in a chair is filtered out anyway; what matters is that a sit
     with no end does not sort a person who is elsewhere to the back. */
  let row = inLine(DEV, PRI);
  row = claimStation(row, "1", DEV, T1).row;
  assert.deepEqual(waitingFor(row).map((p) => p.id), ["p-pri"]);
});

/* ---- the room, drawn to fill a phone ---- */
import { tightenPlan } from "../api/_stations.mjs";

test("a plan with a tall empty band underneath it is stretched to fill the box", () => {
  /* On a desk that band costs nothing. On a phone the map is the screen, and a
     third of it showing nothing is a third of the screen wasted. */
  const t = tightenPlan(DEFAULT_STATION_PLAN);
  const y = (n) => seatsOf(t).find((s) => s.n === n).y;
  assert.ok(y("1") > 24 && y("4") > 58, "both rows move down");
  assert.ok(y("4") <= 100 - 1, "and the lowest still leaves room for its chip");
  assert.ok(y("4") / y("1") - 58 / 24 < 0.01, "the rows keep their spacing");
});

test("only the vertical is stretched", () => {
  /* Width is the axis a phone is short of; stretching it would put the seats
     through the walls. */
  const t = tightenPlan(DEFAULT_STATION_PLAN);
  assert.deepEqual(seatsOf(t).map((s) => s.x), seatsOf(DEFAULT_STATION_PLAN).map((s) => s.x));
});

test("the walls come with the seats, and stay inside the box", () => {
  const t = tightenPlan(DEFAULT_STATION_PLAN);
  const z = t.zones[0];
  assert.ok(z.y + z.h <= 100.01, "no zone hangs out of the room");
  assert.ok(z.h > 60, "and it still reads as a room rather than a strip");
});

test("a plan that already fills its box is handed back untouched", () => {
  const full = { seats: [{ n: "1", x: 10, y: 90 }] };
  assert.equal(tightenPlan(full), full);
  assert.equal(tightenPlan({ seats: [] }).seats.length, 0);
  assert.equal(tightenPlan(null), null);
});

test("seats drawn under the floor's key survive the stretch", () => {
  const t = tightenPlan({ tables: [{ n: "1", x: 5, y: 20 }, { n: "2", x: 20, y: 40 }] });
  assert.equal(seatsOf(t).length, 2);
  assert.ok(seatsOf(t)[1].y > 40);
});

/* ---- what the room is for: rotation, or just who is at the desks ---- */
import { STATION_MODES, stationModeOf, ownerOf } from "../api/_stations.mjs";

test("a store runs a rotation unless it says otherwise", () => {
  /* The default has to be rotation or every store already using the Phone Line
     changes behaviour the day this ships. */
  assert.equal(stationModeOf(null, "a"), "rotation");
  assert.equal(stationModeOf({ stores: [{ id: "a" }] }, "a"), "rotation");
  assert.equal(stationModeOf({ stores: [{ id: "a", stationMode: "open" }] }, "a"), "open");
  assert.deepEqual(STATION_MODES, ["rotation", "open"]);
});

test("a mode nobody recognises is a rotation", () => {
  /* A typo in a config should not quietly turn a store's phone room off. */
  for (const m of ["", "bdc", "OPEN", null, 3]) {
    assert.equal(stationModeOf({ stores: [{ id: "a", stationMode: m }] }, "a"), "rotation", String(m));
  }
});

test("a desk can belong to somebody without being claimed by them", () => {
  /* The whole of the BDC view. Seating somebody because it is usually their
     chair would put a sit in the record for a person who is not in the
     building, and the hours that sit collects would be attributed to them. */
  const plan = { seats: [{ n: "1", x: 10, y: 10, owner: "p-dev" }, { n: "2", x: 40, y: 10 }] };
  const board = stationBoard(plan, {});
  const one = board.find((s) => s.n === "1");
  assert.equal(one.owner, "p-dev");
  assert.equal(one.taken, false, "a name on a desk is not a person in it");
  assert.equal(one.id, null);
  assert.equal(board.find((s) => s.n === "2").owner, null);
  assert.equal(ownerOf(null), null);
});

test("who is in a desk and whose desk it is are two different facts", () => {
  const plan = { seats: [{ n: "1", x: 10, y: 10, owner: "p-dev" }] };
  const row = claimStation({}, "1", PRI, T1).row;
  const seat = stationBoard(plan, row).find((s) => s.n === "1");
  assert.equal(seat.owner, "p-dev");
  assert.equal(seat.id, "p-pri", "and the board can say somebody is in somebody else's chair");
});

test("an owned desk still greys and frees like any other", () => {
  const plan = { seats: [{ n: "1", x: 10, y: 10, owner: "p-dev" }] };
  const row = claimStation({}, "1", DEV, T1).row;
  const seat = stationPresence(plan, row, { now: NOW(20) }).find((s) => s.n === "1");
  assert.equal(seat.state, "held");
  assert.equal(seat.owner, "p-dev");
});

test("a room that does not rotate shows no offers, even with some on the row", () => {
  /* Switching the rotation off has to take the countdowns off the board with
     it. Nothing else would ever clear them: the roll that moves an offer on is
     the very thing that was switched off. */
  const row = roll(inLine(DEV, PRI), TWO, 0).row;
  const on = stationLine(TWO, row, { now: NOW(1) });
  assert.equal(on.seats.find((s) => s.n === "1").offerTo, "p-dev");
  const off = stationLine(TWO, row, { now: NOW(1), offers: false });
  assert.equal(off.seats.find((s) => s.n === "1").offerTo, null);
  assert.equal(off.seats.find((s) => s.n === "1").offerLeftMs, 0);
  assert.deepEqual(off.queued.map((p) => p.id), ["p-dev", "p-pri"],
    "and nobody is held back as already spoken for");
});
