/**
 * Whether any of this worked.
 * -------------------------------------------------------------------------
 * Phase six reads what the five before it wrote, so the tests that matter are
 * the joins: sits keyed by person id against hourly buckets keyed by a
 * normalised name, and minute-granular sits against hour-granular figures.
 *
 * The other half is occupancy, where the thing worth pinning down is that
 * fifteen minutes of cover does not read the same as an hour of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHours, sitFigures, personDay, attribution, occupancy } from "../api/_station-day.mjs";
import { stampHours } from "../api/_hours.mjs";
import { claimStation, releaseStation } from "../api/_stations.mjs";

const DEV = { id: "p-dev", label: "Dev Okonjo" };
const PRI = { id: "p-pri", label: "Priya Ramanan" };
const DEV_KEY = "dev okonjo";
const TWO = { seats: [{ n: "1", x: 10, y: 10 }, { n: "2", x: 40, y: 10 }] };

/* Ten in the morning, New York, on a day the store is open. EDT is UTC-4. */
const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 10, h + 4, m));
const iso = (h, m = 0) => at(h, m).toISOString();
const day = (opp, calls = 0) => ({ oppPhone: opp, calls });

/* Running totals stamped hourly, the way an import leaves them. */
const hoursTo = (...pairs) => {
  let h = {};
  for (const [hour, opp, calls] of pairs) h = stampHours(h, { [DEV_KEY]: day(opp, calls) }, at(hour));
  return h;
};

test("a sit carries what arrived while it was running", () => {
  const hours = hoursTo([10, 2, 30], [11, 5, 44], [12, 6, 51]);
  const sit = { st: "1", id: "p-dev", label: "Dev Okonjo", in: iso(10, 5), out: iso(11, 50) };
  const f = sitFigures(sit, hours, DEV_KEY, at(13).getTime());
  assert.equal(f.min, 105);
  assert.equal(f.hours, 2, "ten and eleven, both covered for most of the hour");
  assert.equal(f.op, 2 + 3);
  assert.equal(f.ca, 30 + 14);
  assert.equal(f.st, "1", "and it is still the sit");
});

test("a sit with nothing recorded against it reads as nothing, not as a gap", () => {
  const sit = { st: "1", id: "p-dev", in: iso(10), out: iso(12) };
  const f = sitFigures(sit, null, DEV_KEY, at(13).getTime());
  assert.equal(f.op, 0);
  assert.equal(f.hours, 0);
  assert.equal(f.min, 120, "the time at the desk is still known");
});

test("the join is by name, because that is what the buckets are keyed by", () => {
  /* The sits carry a person id and the hourly figures carry a normalised full
     name. Getting this wrong attributes nothing to everybody, silently. */
  const hours = hoursTo([10, 4], [11, 9]);
  const sit = { st: "1", id: "p-dev", in: iso(10), out: iso(12) };
  assert.equal(sitFigures(sit, hours, DEV_KEY, at(13).getTime()).op, 4 + 5);
  assert.equal(sitFigures(sit, hours, "p-dev", at(13).getTime()).op, 0, "the id is not a key here");
});

test("a person's day adds up, and says how many hours it can actually stand behind", () => {
  /* Two stretches of forty minutes is eighty minutes at the desk and quite
     possibly no attributed hour at all. Saying so beats dividing by 1.33. */
  const hours = hoursTo([10, 3], [11, 8], [12, 10]);
  let row = claimStation({}, "1", DEV, iso(10, 5)).row;
  row = releaseStation(row, "1", iso(11, 50), "lunch").row;
  row = claimStation(row, "2", DEV, iso(12, 40)).row;
  const d = personDay(row, "p-dev", hours, DEV_KEY, at(13).getTime());
  assert.equal(d.sits.length, 2);
  assert.equal(d.min, 105 + 20);
  assert.equal(d.counted, 2, "the second sit started too late to own the twelve o'clock hour");
  assert.equal(d.op, 3 + 5);
  assert.equal(d.perHour, 4);
});

test("nobody with no hours is divided by zero", () => {
  const row = claimStation({}, "1", DEV, iso(10, 40)).row;
  const d = personDay(row, "p-dev", {}, DEV_KEY, at(11).getTime());
  assert.equal(d.counted, 0);
  assert.equal(d.perHour, null, "not Infinity, and not a cheerful zero");
});

test("everybody who sat today, longest at the desk first", () => {
  let row = claimStation({}, "1", DEV, iso(10)).row;
  row = claimStation(row, "2", PRI, iso(11)).row;
  const a = attribution(row, {}, () => null, at(13).getTime());
  assert.deepEqual(a.map((x) => x.id), ["p-dev", "p-pri"]);
  assert.equal(a[0].label, "Dev Okonjo");
  assert.deepEqual(attribution({}, {}, () => null), [], "a day with no sits is empty, not broken");
});

test("occupancy is a fraction of the hour, not a yes or no", () => {
  /* Fifteen minutes of cover is not an hour of it and must not draw the same. */
  let row = claimStation({}, "1", DEV, iso(10, 45)).row;
  row = releaseStation(row, "1", iso(11, 30), "out").row;
  const o = occupancy(TWO, row, { open: "09:00", close: "13:00", now: at(13).getTime() });
  const seat = o.seats.find((s) => s.n === "1");
  const cell = (h) => seat.cells.find((c) => c.hour === h);
  assert.ok(Math.abs(cell("10").cover - 0.25) < 0.001, "a quarter of ten o'clock");
  assert.ok(Math.abs(cell("11").cover - 0.5) < 0.001, "half of eleven");
  assert.equal(cell("09").cover, 0);
  assert.equal(cell("12").cover, 0);
  assert.equal(cell("10").who, "Dev Okonjo");
});

test("two people in one chair is not two hours of coverage", () => {
  /* A move produces an overlap for an instant, and a fraction over one would
     put a station above full. */
  const row = { sits: [
    { st: "1", id: "a", label: "A", in: iso(10), out: iso(11) },
    { st: "1", id: "b", label: "B", in: iso(10), out: iso(11) },
  ] };
  const o = occupancy(TWO, row, { open: "09:00", close: "12:00", now: at(12).getTime() });
  assert.equal(o.seats.find((s) => s.n === "1").cells.find((c) => c.hour === "10").cover, 1);
});

test("the room's own line is how many seats were staffed each hour", () => {
  /* Not whether a chair was used, but whether the room was covered when the
     phone was ringing. */
  let row = claimStation({}, "1", DEV, iso(10)).row;
  row = claimStation(row, "2", PRI, iso(10)).row;
  row = releaseStation(row, "2", iso(11), "lunch").row;
  const o = occupancy(TWO, row, { open: "09:00", close: "13:00", now: at(13).getTime() });
  const h = (x) => o.byHour.find((b) => b.hour === x);
  assert.equal(h("09").staffed, 0);
  assert.equal(h("10").staffed, 2);
  assert.equal(h("11").staffed, 1, "one went to lunch");
  assert.equal(h("10").of, 2);
  assert.equal(h("10").pct, 1);
  assert.equal(o.thinnest.hour, "09", "the quietest hour is the one worth asking about");
});

test("an open sit runs to now rather than to nothing", () => {
  const row = claimStation({}, "1", DEV, iso(10)).row;
  const o = occupancy(TWO, row, { open: "09:00", close: "13:00", now: at(11, 30).getTime() });
  const seat = o.seats.find((s) => s.n === "1");
  assert.equal(seat.cells.find((c) => c.hour === "10").cover, 1);
  assert.ok(Math.abs(seat.cells.find((c) => c.hour === "11").cover - 0.5) < 0.001);
  assert.equal(seat.min, 90);
});

test("the day is drawn across the store's hours, widened by anything outside them", () => {
  /* A sit at eight in the morning is a fact whatever the sign on the door says. */
  assert.deepEqual(dayHours({}, { open: "09:00", close: "12:00" }), ["09", "10", "11"]);
  const early = { sits: [{ st: "1", id: "a", in: iso(7, 30), out: iso(8, 15) }] };
  assert.equal(dayHours(early, { open: "09:00", close: "12:00" })[0], "07");
  const late = { sits: [{ st: "1", id: "a", in: iso(19), out: iso(21, 10) }] };
  assert.equal(dayHours(late, { open: "09:00", close: "20:00" }).at(-1), "21");
});

test("a store with no hours set still draws a day", () => {
  assert.equal(dayHours({}, {}).length, 11);
  assert.equal(dayHours({}, { open: "nonsense", close: "" })[0], "09");
});
