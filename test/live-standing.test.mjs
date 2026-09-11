/**
 * The lock screen's one message, built from the two day rows.
 * -------------------------------------------------------------------------
 * The shell never re-decides which lane leads, so the order here is the whole
 * of that decision; and a build-17 shell reads only the v1 fields, so what
 * they say from each lane is what an old phone shows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { liveEnvelope, floorLane, phoneLane, hotOf, decidePhone } from "../api/_live-standing.mjs";

const NOW = Date.parse("2026-09-11T14:02:11Z");
const iso = (ms) => new Date(ms).toISOString();
const STORE = "s1";
const config = { stores: [{ id: STORE, stationMode: "rotation",
  stationPlan: { seats: [{ n: "1", x: 1, y: 1 }, { n: "2", x: 2, y: 1 }] } }] };
const P = (id, status = "waiting", extra = {}) => ({ id, label: id.toUpperCase(), status, statusAt: iso(NOW - 60000), ...extra });
const roster = [{ id: "do", label: "Dev O.", name: "Dev Ortiz" }, { id: "ma", label: "Mar A." }, { id: "gg", label: "Gil G." }];

test("floor lane: position, ahead and up read as the floor's card does", () => {
  const row = { line: [P("ma", "customer", { table: 2 }), P("do"), P("gg")], roster };
  const f = floorLane(row, "do", NOW);
  assert.equal(f.position, 2);
  assert.equal(f.ahead, 0);
  assert.equal(f.status, "up");
  assert.equal(f.line.length, 3);
  assert.equal(f.line[1].me, true);
  assert.equal(floorLane(row, "zz", NOW), null, "not on the floor: no lane");
});

test("phone lane: on the cord when every desk is taken, in desk order", () => {
  const row = { line: [P("ma"), P("do"), P("gg")], roster,
    stations: { 1: { id: "x1", label: "X One", at: iso(NOW - 3600000) }, 2: { id: "x2", label: "X Two", at: iso(NOW - 3600000) } },
    sits: [{ id: "ma", in: iso(NOW - 7200000), out: iso(NOW - 3600000) }] };
  const p = phoneLane(config, STORE, row, "do", NOW);
  assert.equal(p.state, "cord");
  /* ma has had a desk today, so do is asked first even though ma is ahead on the line */
  assert.equal(p.ahead, 0);
  assert.equal(p.position, 1);
  assert.equal(p.line[0].me, true);
  assert.equal(p.desks.length, 2);
  assert.equal(p.desks[0].who, "X");
});

test("phone lane: an offer carries the desk and when it runs out", () => {
  const row = { line: [P("do"), P("ma")], roster,
    stations: { 2: { id: "x2", label: "X Two", at: iso(NOW - 3600000) } },
    offers: { 1: { id: "do", label: "Dev O.", until: iso(NOW + 150000) } } };
  const p = phoneLane(config, STORE, row, "do", NOW);
  assert.equal(p.state, "offer");
  assert.equal(p.desk, "1");
  assert.equal(p.until, iso(NOW + 150000));
  assert.equal(p.desks[0].open, true, "the desk offered to you is open to you");
  assert.equal(p.line[0].me, true, "on an offer you stand at the front of the cord");
  const other = phoneLane(config, STORE, row, "ma", NOW);
  assert.equal(other.state, "cord", "an offer standing for somebody else is not a free desk");
  assert.equal(other.desks[0].open, false);
  assert.equal(other.desks[0].who, "Dev");
});

test("phone lane: at a desk, and free desks in open mode", () => {
  const row = { line: [P("do"), P("ma")], roster, stations: { 2: { id: "do", label: "Dev O.", at: iso(NOW - 600000) } } };
  const d = phoneLane(config, STORE, row, "do", NOW);
  assert.equal(d.state, "desk");
  assert.equal(d.desk, "2");
  assert.equal(d.since, iso(NOW - 600000));
  const open = { stores: [{ id: STORE, stationMode: "open" }] };
  const f = phoneLane(open, STORE, row, "ma", NOW);
  assert.equal(f.state, "free");
  assert.deepEqual(f.free, ["1", "3", "4", "5", "6"]);
});

test("phone lane: a line with no room is just a line", () => {
  const bare = { stores: [{ id: STORE }] };
  const row = { line: [P("ma"), P("do")], roster };
  const p = phoneLane(bare, STORE, row, "do", NOW);
  assert.equal(p.state, "cord");
  assert.equal(p.ahead, 1);
  assert.equal(p.desks, undefined);
});

test("hot: offer beats up beats ask beats next; quiet is null", () => {
  assert.equal(hotOf({ status: "up" }, { state: "offer" }), "phone");
  assert.equal(hotOf({ status: "up" }, { state: "cord", ahead: 0 }), "floor");
  assert.equal(hotOf({ status: "waiting", nudge: true }, { state: "desk" }), "floor");
  assert.equal(hotOf({ status: "customer", ask: "fly" }, { state: "cord", ahead: 0 }), "floor");
  assert.equal(hotOf({ status: "waiting", ahead: 3 }, { state: "cord", ahead: 0 }), "phone");
  assert.equal(hotOf({ status: "waiting", ahead: 3 }, { state: "desk" }), null);
  assert.equal(hotOf(null, null), null);
});

test("envelope: both lanes, the leading lane fills the v1 fields", () => {
  const floorRow = { line: [P("do"), P("gg")], roster, storeName: "Store One" };
  const queueRow = { line: [P("do"), P("ma")], roster, stations: { 2: { id: "do", label: "Dev O.", at: iso(NOW - 600000) } } };
  const e = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow, queueRow, now: NOW });
  assert.equal(e.v, 2);
  assert.equal(e.storeName, "Store One");
  assert.equal(e.rep, "Dev O.");
  assert.equal(e.hot, "floor");
  assert.equal(e.floor.status, "up");
  assert.equal(e.phone.state, "desk");
  assert.equal(e.queue, "Live Floor");
  assert.equal(e.status, "up");
  assert.equal(e.ahead, 0);
});

test("envelope: an offer leads, and reads as up to an old shell", () => {
  const floorRow = { line: [P("gg"), P("do")], roster };
  const queueRow = { line: [P("do")], roster, stations: { 2: { id: "x", label: "X", at: iso(NOW) } },
    offers: { 1: { id: "do", label: "Dev O.", until: iso(NOW + 100000) } } };
  const e = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow, queueRow, now: NOW });
  assert.equal(e.hot, "phone");
  assert.equal(e.queue, "Phone Line");
  assert.equal(e.status, "up");
  assert.equal(e.position, 1);
  assert.equal(e.ahead, 0);
  assert.equal(e.phone.until, iso(NOW + 100000));
});

test("envelope: both quiet falls to the room opened last; one lane stands alone", () => {
  const floorRow = { line: [P("gg"), P("do")], roster };
  const queueRow = { line: [P("ma"), P("do")], roster, stations: { 1: { id: "x", label: "X", at: iso(NOW) }, 2: { id: "y", label: "Y", at: iso(NOW) } } };
  const a = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow, queueRow, lastRoom: "line", now: NOW });
  assert.equal(a.hot, null);
  assert.equal(a.queue, "Phone Line");
  const b = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow, queueRow, lastRoom: "floor", now: NOW });
  assert.equal(b.queue, "Live Floor");
  const only = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow: null, queueRow, now: NOW });
  assert.equal(only.floor, undefined);
  assert.equal(only.queue, "Phone Line");
  assert.equal(only.ahead, 1);
});

test("envelope: on neither line is gone", () => {
  const e = liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: "do", floorRow: { line: [P("gg")] }, queueRow: null, now: NOW });
  assert.equal(e.status, "gone");
  assert.equal(e.floor, undefined);
  assert.equal(liveEnvelope({ config, store: STORE, date: "2026-09-11", meId: null, floorRow: null, queueRow: null }), null);
});

test("decidePhone: an offer buzzes once, a seat and a freed desk move quietly", () => {
  const full = { line: [P("do"), P("ma")], roster, stations: { 1: { id: "x", label: "X", at: iso(NOW) }, 2: { id: "y", label: "Y", at: iso(NOW) } } };
  const offered = { ...full, stations: { 2: full.stations[2] }, offers: { 1: { id: "do", label: "Dev O.", until: iso(NOW + 180000) } } };
  const plan = decidePhone(config, STORE, full, offered, NOW);
  const mine = plan.find((x) => x.id === "do");
  assert.equal(mine.kind, "offer");
  assert.equal(mine.desk, "1");
  assert.equal(mine.title, "Desk 1 is yours");
  assert.equal(decidePhone(config, STORE, offered, offered, NOW).length, 0, "an offer still standing does not buzz again");
  const seated = { ...full, stations: { 1: { id: "do", label: "Dev O.", at: iso(NOW) }, 2: full.stations[2] } };
  assert.equal(decidePhone(config, STORE, offered, seated, NOW).find((x) => x.id === "do").kind, "seated");
  const open = { stores: [{ id: STORE, stationMode: "open", stationPlan: config.stores[0].stationPlan }] };
  const freed = { ...full, stations: { 2: full.stations[2] } };
  assert.equal(decidePhone(open, STORE, full, freed, NOW).find((x) => x.id === "ma").kind, "freed");
  assert.equal(decidePhone({ stores: [{ id: STORE }] }, STORE, full, freed, NOW).length, 0, "no room, nothing to say beyond the line");
});
