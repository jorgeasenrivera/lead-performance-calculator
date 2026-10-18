/**
 * The scheduler calendar's data contract, held to its three rules: delivered is
 * only a reported count, Off is only a listed day, and another store's or
 * month's answer is no answer. Every row below is synthetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthDays, calendarCells, storeToday, validMonth, deliveriesMonth, deliveredText, deliveredValue,
  cellClass, cellLabel, summaryText, staffingMonth, scheduleReview, dayDetail,
} from "../src/scheduler-calendar-model.mjs";
import { salesHeat } from "../scripts/scheduler-performance/month-model.mjs";

const MONTH = "2026-10", TODAY = "2026-10-14", STORE = "store-a";
const stamp = { timestamp: "2026-10-13T22:05:00.000Z", basis: "report_sent" };
const split = (n) => ({ new: n, used: 0 });

// A full month in the reader's shape. `counts` maps a date to a number (a reported
// day) or to a status string; anything else is a missing day.
const reported = (counts = {}, extra = {}) => ({
  status: "ready", storeId: STORE, month: MONTH,
  days: monthDays(MONTH).map((date) => {
    const v = counts[date];
    return typeof v === "number"
      ? { date, status: "provisional", count: v, vehicles: split(v), asOf: stamp }
      : { date, status: typeof v === "string" ? v : "missing", count: null, vehicles: { new: null, used: null }, asOf: null };
  }),
  ...extra,
});
const month = (counts, extra) => deliveriesMonth(reported(counts, extra), { storeId: STORE, month: MONTH, today: TODAY });
const row = (model, date) => model.days.find((d) => d.date === date);

test("the month grid is Monday first and padded to whole weeks", () => {
  const cells = calendarCells(MONTH);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.indexOf("2026-10-01"), 3, "1 October 2026 is a Thursday");
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(calendarCells("2026-02").filter(Boolean).length, 28);
  assert.equal(calendarCells("2028-02").filter(Boolean).length, 29);
  assert.throws(() => monthDays("2026-13"));
  assert.equal(validMonth("2026-10"), true);
});

test("today is the dealership's date, not the browser's", () => {
  assert.equal(storeToday(new Date("2026-10-15T02:30:00Z")), "2026-10-14", "late evening in New York is still the 14th");
  assert.equal(storeToday(new Date("2026-10-15T05:30:00Z")), "2026-10-15");
});

test("a reported count is a count, and a reported zero stays a zero", () => {
  const m = month({ "2026-10-01": 4, "2026-10-02": 0, "2026-10-03": 8 });
  assert.equal(m.available, true);
  assert.equal(row(m, "2026-10-02").state, "reported");
  assert.equal(row(m, "2026-10-02").units, 0);
  assert.equal(deliveredText(row(m, "2026-10-02")), "0 delivered");
  assert.equal(deliveredValue(row(m, "2026-10-02")), "0");
  assert.equal(cellClass(row(m, "2026-10-02"), TODAY), "heat-0");
  assert.equal(m.total, 12);
  assert.equal(m.reportedDays, 3);
});

test("a day with no report is unknown, never a zero", () => {
  const m = month({ "2026-10-01": 4, "2026-10-05": "incomplete", "2026-10-06": "conflict" });
  for (const [date, state, value] of [["2026-10-02", "missing", "Unknown"], ["2026-10-05", "incomplete", "Incomplete"], ["2026-10-06", "conflict", "Conflict"]]) {
    assert.equal(row(m, date).state, state);
    assert.equal(row(m, date).units, null, `${date} carries no number`);
    assert.equal(deliveredValue(row(m, date)), value);
    assert.match(cellClass(row(m, date), TODAY), /^sales-/);
    assert.doesNotMatch(cellLabel(row(m, date)), /\b0 delivered/);
  }
  assert.equal(m.total, 4, "unknown days add nothing");
});

test("a day still to come is pending whatever the rows say", () => {
  // The reader would never send a count for the future; if one arrived it is not shown.
  const m = month({ "2026-10-20": 9 });
  const future = row(m, "2026-10-20");
  assert.equal(future.state, "future");
  assert.equal(future.units, null);
  assert.equal(deliveredValue(future), "Pending");
  assert.equal(deliveredText(future), "sales not yet available");
  assert.equal(m.total, null);
  assert.equal(row(m, "2026-10-14").state, "missing", "today itself is judged by its own report");
});

test("no reported day means no total, not a total of zero", () => {
  const m = month({});
  assert.equal(m.total, null);
  assert.equal(m.reportedDays, 0);
  assert.equal(summaryText(m), "No recorded deliveries yet this month.");
  assert.equal(summaryText(month({ "2026-10-01": 1 })), "1 delivered on 1 recorded day so far.");
  assert.equal(summaryText(month({ "2026-10-01": 1, "2026-10-02": 2 })), "3 delivered on 2 recorded days so far.");
});

test("a snapshot that is not ready is not read", () => {
  for (const status of ["idle", "loading", "denied", "unavailable"]) {
    const m = deliveriesMonth({ ...reported({ "2026-10-01": 5 }), status }, { storeId: STORE, month: MONTH, today: TODAY });
    assert.equal(m.available, false);
    assert.equal(m.reason, status);
    assert.equal(m.total, null);
    assert.ok(m.days.every((d) => d.state === "unavailable" && d.units === null), status);
  }
  const none = deliveriesMonth(null, { storeId: STORE, month: MONTH, today: TODAY });
  assert.equal(none.available, false);
  assert.match(summaryText(none), /unavailable/i);
  assert.match(summaryText(deliveriesMonth({ status: "denied" }, { storeId: STORE, month: MONTH, today: TODAY })), /access/i);
});

test("another store's or month's answer is no answer", () => {
  const ask = (snapshot, over = {}) => deliveriesMonth(snapshot, { storeId: STORE, month: MONTH, today: TODAY, ...over });
  assert.equal(ask(reported({ "2026-10-01": 5 }, { storeId: "store-b" })).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }, { month: "2026-09" })).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { storeId: "store-b" }).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { storeId: null }).reason, "stale", "no store, no answer");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { month: "2026-11" }).reason, "stale");
});

test("malformed rows never become a number", () => {
  const dup = reported({ "2026-10-01": 5 });
  dup.days.push({ ...dup.days[0] });
  assert.equal(deliveriesMonth(dup, { storeId: STORE, month: MONTH, today: TODAY }).reason, "malformed");
  const outside = reported({});
  outside.days[0] = { ...outside.days[0], date: "2026-09-30" };
  assert.equal(deliveriesMonth(outside, { storeId: STORE, month: MONTH, today: TODAY }).reason, "malformed");

  const bad = reported({ "2026-10-01": 5 });
  const at = (date) => bad.days.findIndex((d) => d.date === date);
  bad.days[at("2026-10-02")] = { date: "2026-10-02", status: "provisional", count: 2.5, vehicles: { new: 2.5, used: 0 }, asOf: stamp };
  bad.days[at("2026-10-03")] = { date: "2026-10-03", status: "provisional", count: -1, vehicles: { new: -1, used: 0 }, asOf: stamp };
  bad.days[at("2026-10-04")] = { date: "2026-10-04", status: "provisional", count: "7", vehicles: split(7), asOf: stamp };
  bad.days[at("2026-10-05")] = { date: "2026-10-05", status: "provisional", count: NaN, vehicles: split(1), asOf: stamp };
  bad.days[at("2026-10-06")] = { date: "2026-10-06", status: "settled", count: 3, vehicles: split(3), asOf: stamp };
  bad.days.splice(at("2026-10-07"), 1);
  const m = deliveriesMonth(bad, { storeId: STORE, month: MONTH, today: TODAY });
  assert.equal(m.available, true);
  for (const d of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]) {
    assert.equal(row(m, d).state, "unavailable", d);
    assert.equal(row(m, d).units, null, d);
  }
  assert.equal(m.total, 5, "only the good day counts");
});

test("New and Used are shown only when they add up to the count", () => {
  const ok = month({ "2026-10-01": 5 });
  assert.deepEqual(row(ok, "2026-10-01").split, { new: 5, used: 0 });
  const odd = reported({ "2026-10-01": 5 });
  odd.days[0].vehicles = { new: 2, used: 2 };
  assert.equal(row(deliveriesMonth(odd, { storeId: STORE, month: MONTH, today: TODAY }), "2026-10-01").split, null);
  const unsplit = reported({ "2026-10-01": 5 });
  unsplit.days[0].vehicles = { new: null, used: null };
  const m = deliveriesMonth(unsplit, { storeId: STORE, month: MONTH, today: TODAY });
  assert.equal(row(m, "2026-10-01").split, null);
  assert.equal(row(m, "2026-10-01").units, 5, "an unsplit count is still a count");
});

test("the report's own timestamp and basis travel with the count", () => {
  const r = row(month({ "2026-10-01": 5 }), "2026-10-01");
  assert.deepEqual(r.asOf, stamp);
});

test("colour is relative to the month's best day, with ties named", () => {
  const m = month({ "2026-10-01": 10, "2026-10-02": 5, "2026-10-03": 0, "2026-10-04": 10, "2026-10-05": 1 });
  assert.equal(row(m, "2026-10-01").level, 4);
  assert.equal(row(m, "2026-10-02").level, 2);
  assert.equal(row(m, "2026-10-03").level, 0);
  assert.equal(row(m, "2026-10-05").level, 0, "1 of 10 rounds to the lowest step");
  assert.deepEqual(m.bestDays, ["2026-10-01", "2026-10-04"]);
  assert.equal(row(m, "2026-10-01").bestLabel, "Best recorded · tied");
  assert.equal(cellClass(row(m, "2026-10-01"), TODAY), "heat-4 best");
  const sole = month({ "2026-10-01": 10, "2026-10-02": 5 });
  assert.equal(row(sole, "2026-10-01").bestLabel, "Best recorded");
  assert.equal(cellLabel(row(sole, "2026-10-01")), "Thursday, October 1, 10 delivered, best recorded");
});

test("a month of zeros crowns nobody", () => {
  const m = month({ "2026-10-01": 0, "2026-10-02": 0 });
  assert.deepEqual(m.bestDays, []);
  assert.ok(m.days.filter((d) => d.state === "reported").every((d) => d.level === 0 && !d.best && d.bestLabel === ""));
  assert.equal(m.total, 0, "a recorded zero month is a total of zero");
  assert.equal(summaryText(m), "0 delivered on 2 recorded days so far.");
});

test("today is marked and only today", () => {
  const m = month({ "2026-10-14": 3 });
  assert.equal(cellClass(row(m, "2026-10-14"), TODAY), "heat-4 best today");
  assert.doesNotMatch(cellClass(row(m, "2026-10-13"), TODAY), /today/);
});

test("the colour scale matches the approved preview's for the same reported days", () => {
  const counts = { "2026-10-01": 3, "2026-10-02": 9, "2026-10-03": 0, "2026-10-04": 9, "2026-10-06": 5 };
  const live = month(counts);
  const preview = salesHeat({ history: Object.entries(counts).map(([day, units]) => ({ day, state: "known", units })) }, MONTH, TODAY);
  for (const p of preview.filter((r) => r.state === "known")) {
    assert.equal(row(live, p.day).level, p.level, p.day);
    assert.equal(row(live, p.day).best, p.best, p.day);
    assert.equal(row(live, p.day).bestLabel, p.bestLabel, p.day);
  }
});

/* -------------------------------------------------------------------- staffing */

const roster = [
  { id: "p3", name: "Casey Lane", roleId: "sales" },
  { id: "p1", name: "Alex Moss", roleId: "sales" },
  { id: "p2", name: "Blair Quinn", roleId: "sales" },
  { id: "x1", name: "No Role", roleId: "" },
];
const source = { [MONTH]: { file: "october.pdf", at: "2026-10-01T13:00:00.000Z", kind: "a team grid, with OFF and VAC lines",
  off: { p1: ["2026-10-14"] }, unmatched: [] } };
const staff = (over = {}) => staffingMonth({ month: MONTH, roster, ...over });
const day = (s, date = "2026-10-14") => s.byDate[date];

test("people are bound by roster id and sorted by name", () => {
  const s = staff();
  assert.deepEqual(day(s).unknown.map((p) => p.id), ["p1", "p2", "p3"]);
  assert.equal(s.rosterCount, 3, "a person with no role is not on the board");
  const dup = staff({ roster: [...roster, { id: "p1", name: "Impostor", roleId: "sales" }] });
  assert.equal(dup.rosterCount, 3);
  assert.equal(day(dup).unknown.find((p) => p.id === "p1").name, "Alex Moss", "the first record of an id wins");
});

test("a listed day off is Off, with where it came from", () => {
  const s = staff({ daysOff: { p1: ["2026-10-14"], p2: ["2026-10-14"] }, forcedOff: { p2: ["2026-10-14"] }, scheduleSource: source });
  const off = day(s).off;
  assert.deepEqual(off.map((p) => [p.id, p.source]), [["p1", "schedule"], ["p2", "manager"]]);
  assert.equal(off[0].file, "october.pdf");
  assert.equal(off[0].at, "2026-10-01T13:00:00.000Z");
  assert.equal(off[1].file, null, "a manager's mark is not the file's");
  assert.deepEqual(day(s).unknown.map((p) => p.id), ["p3"]);
  assert.equal(s.evidence, "schedule");
});

test("a listed day with no named source is on file, not invented", () => {
  const s = staff({ daysOff: { p1: ["2026-10-14"] } });
  assert.equal(day(s).off[0].source, "on file");
  assert.equal(day(s).off[0].file, null);
  assert.equal(s.evidence, "marks");
});

test("not being listed off never makes anyone On", () => {
  const s = staff({ daysOff: { p1: ["2026-10-14"] }, scheduleSource: source });
  const d = day(s, "2026-10-15");
  assert.deepEqual(d.off, []);
  assert.deepEqual(d.present, []);
  assert.deepEqual(d.unknown.map((p) => p.id), ["p1", "p2", "p3"]);
  const detail = dayDetail("2026-10-15", month({}), s);
  assert.equal(detail.offText, "no one listed off");
  assert.equal(detail.notListedOff.length, 3);
  assert.equal("working" in detail, false);
});

test("with no schedule and no marks the month says so", () => {
  const s = staff();
  assert.equal(s.evidence, "none");
  const detail = dayDetail("2026-10-14", month({}), s);
  assert.equal(detail.scheduleKnown, false);
  assert.equal(detail.offText, "no schedule on file");
  assert.equal(detail.durations, "unknown", "no source carries a shift length");
});

test("only a manager's say-so makes someone Present", () => {
  const s = staff({ presentAnyway: { "2026-10-14": ["p2"] }, daysOff: { p1: ["2026-10-14"] } });
  assert.deepEqual(day(s).present.map((p) => p.id), ["p2"]);
  assert.deepEqual(day(s).unknown.map((p) => p.id), ["p3"]);
});

test("the app's own off rule wins when it is handed in, and the override is visible", () => {
  // p1 is listed off but plainly worked; the app's rule says not off.
  const isOff = (id, date) => id === "p2" && date === "2026-10-14";
  const s = staff({ daysOff: { p1: ["2026-10-14"], p2: ["2026-10-14"] }, isOff });
  assert.equal(s.rule, "app");
  assert.deepEqual(day(s).off.map((p) => p.id), ["p2"]);
  assert.deepEqual(day(s).overridden.map((p) => p.id), ["p1"]);
  assert.equal(staff().rule, "listed");
});

test("someone who has left is not counted from the day they left", () => {
  const s = staff({ departed: [{ id: "p3", at: "2026-10-10T12:00:00.000Z" }] });
  assert.equal(day(s, "2026-10-09").unknown.some((p) => p.id === "p3"), true);
  assert.equal(day(s, "2026-10-10").unknown.some((p) => p.id === "p3"), false);
  assert.equal(day(s, "2026-10-20").unknown.some((p) => p.id === "p3"), false);
});

test("a day listed in another month is not this month's", () => {
  const s = staff({ daysOff: { p1: ["2026-09-30", "2026-11-01"] } });
  assert.equal(s.evidence, "none");
  assert.ok(Object.values(s.byDate).every((d) => d.off.length === 0));
});

test("the applied schedule is shown back, and unmatched names ask for review", () => {
  assert.deepEqual(scheduleReview({}, MONTH), { present: false });
  const clean = scheduleReview(source, MONTH);
  assert.equal(clean.file, "october.pdf");
  assert.equal(clean.people, 1);
  assert.equal(clean.offDays, 1);
  assert.equal(clean.needsReview, false);
  const loose = scheduleReview({ [MONTH]: { ...source[MONTH], unmatched: ["Dana"] } }, MONTH);
  assert.equal(loose.unmatched, 1);
  assert.equal(loose.needsReview, true);
});

test("a day sheet reconciles with the grid it came from", () => {
  const deliveries = month({ "2026-10-01": 4, "2026-10-02": 0, "2026-10-05": "conflict" });
  const s = staff({ daysOff: { p1: ["2026-10-02"] }, scheduleSource: source });
  for (const r of deliveries.days) {
    const detail = dayDetail(r.date, deliveries, s);
    assert.equal(detail.deliveredValue, deliveredValue(r), r.date);
    assert.equal(detail.delivered, r, r.date);
    assert.equal(detail.off.length, s.byDate[r.date].off.length, r.date);
  }
  assert.equal(dayDetail("2026-10-01", deliveries, s).deliveredValue, "4");
  assert.equal(dayDetail("2026-10-02", deliveries, s).deliveredValue, "0");
  assert.equal(dayDetail("2026-10-02", deliveries, s).offText, "1 off");
  assert.throws(() => dayDetail("2026-11-01", deliveries, s));
});

test("month boundaries: 28, 30 and 31 day months", () => {
  for (const [m, n] of [["2026-02", 28], ["2026-09", 30], ["2026-10", 31], ["2028-02", 29]]) {
    const r = { status: "ready", storeId: STORE, month: m,
      days: monthDays(m).map((date) => ({ date, status: "missing", count: null, vehicles: { new: null, used: null }, asOf: null })) };
    const out = deliveriesMonth(r, { storeId: STORE, month: m, today: `${m}-${String(n).padStart(2, "0")}` });
    assert.equal(out.days.length, n);
    assert.ok(out.days.every((d) => d.state === "missing"));
  }
  const next = deliveriesMonth({ status: "ready", storeId: STORE, month: "2026-11", days: monthDays("2026-11").map((date) => ({ date, status: "missing", count: null, vehicles: { new: null, used: null }, asOf: null })) },
    { storeId: STORE, month: "2026-11", today: "2026-10-31" });
  assert.ok(next.days.every((d) => d.state === "future"), "the day before a month starts, all of it is still to come");
});
