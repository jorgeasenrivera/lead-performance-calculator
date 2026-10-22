/**
 * The scheduler calendar's data contract, held to its three rules: delivered is
 * only a reported count, Off is only a listed day, and another store's or
 * month's answer is no answer. Every row below is synthetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthDays, calendarCells, storeToday, validMonth, validDate, deliveriesMonth, deliveredText, deliveredValue,
  cellClass, cellLabel, summaryText, staffingMonth, scheduleReview, dayDetail,
} from "../src/scheduler-calendar-model.mjs";
import { salesHeat } from "../scripts/scheduler-performance/month-model.mjs";
import { servedOn } from "../api/_people-status.mjs";

const MONTH = "2026-10", TODAY = "2026-10-14", STORE = "store-a", EPOCH = 3;
const stamp = { timestamp: "2026-10-13T22:05:00.000Z", basis: "report_sent" };
const split = (n) => ({ new: n, used: 0 });
const opts = (over = {}) => ({ storeId: STORE, month: MONTH, today: TODAY, principalEpoch: EPOCH, ...over });

// A full month in the reader's shape. `counts` maps a date to a number (a reported
// day) or to a status string; anything else is a missing day.
const reported = (counts = {}, extra = {}) => ({
  status: "ready", storeId: STORE, month: MONTH, principalEpoch: EPOCH,
  days: monthDays(MONTH).map((date) => {
    const v = counts[date];
    return typeof v === "number"
      ? { date, status: "provisional", count: v, vehicles: split(v), asOf: stamp }
      : { date, status: typeof v === "string" ? v : "missing", count: null, vehicles: { new: null, used: null }, asOf: null };
  }),
  ...extra,
});
const month = (counts, extra) => deliveriesMonth(reported(counts, extra), opts());
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
    const m = deliveriesMonth({ ...reported({ "2026-10-01": 5 }), status }, opts());
    assert.equal(m.available, false);
    assert.equal(m.reason, status);
    assert.equal(m.total, null);
    assert.ok(m.days.every((d) => d.state === "unavailable" && d.units === null), status);
  }
  const none = deliveriesMonth(null, opts());
  assert.equal(none.available, false);
  assert.match(summaryText(none), /unavailable/i);
  assert.match(summaryText(deliveriesMonth({ status: "denied" }, opts())), /access/i);
});

test("another store's, month's or session's answer is no answer", () => {
  const ask = (snapshot, over = {}) => deliveriesMonth(snapshot, opts(over));
  assert.equal(ask(reported({ "2026-10-01": 5 }, { storeId: "store-b" })).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }, { month: "2026-09" })).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { storeId: "store-b" }).reason, "stale");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { storeId: null }).reason, "stale", "no store, no answer");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { month: "2026-11" }).reason, "stale");
  // The session epoch the reader fetched under must be the one the caller holds now.
  assert.equal(ask(reported({ "2026-10-01": 5 }, { principalEpoch: EPOCH - 1 })).reason, "stale", "an older session");
  assert.equal(ask(reported({ "2026-10-01": 5 }, { principalEpoch: undefined })).reason, "stale", "a snapshot with no epoch");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { principalEpoch: undefined }).reason, "stale", "a caller with no epoch: nothing shows");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { principalEpoch: "3" }).reason, "stale", "an epoch that is not a number");
  assert.equal(ask(reported({ "2026-10-01": 5 }), { principalEpoch: EPOCH }).available, true);
});

test("a forged partial snapshot cannot colour a day or add to a total", () => {
  const forged = (mutate) => {
    const r = reported({ "2026-10-01": 7 });
    mutate(r.days[0], r);
    return deliveriesMonth(r, opts());
  };
  const cases = {
    "count with no timestamp": (d) => { d.asOf = null; },
    "count with an empty asOf": (d) => { d.asOf = {}; },
    "null timestamp": (d) => { d.asOf = { timestamp: null, basis: "report_sent" }; },
    "not an ISO timestamp": (d) => { d.asOf = { timestamp: "yesterday", basis: "report_sent" }; },
    "an impossible timestamp": (d) => { d.asOf = { timestamp: "2026-13-45T99:00:00.000Z", basis: "report_sent" }; },
    "a timestamp without milliseconds": (d) => { d.asOf = { timestamp: "2026-10-13T22:05:00Z", basis: "report_sent" }; },
    "no basis": (d) => { d.asOf = { timestamp: stamp.timestamp }; },
    "an unknown basis": (d) => { d.asOf = { timestamp: stamp.timestamp, basis: "fetched" }; },
    "no vehicles object": (d) => { delete d.vehicles; },
    "vehicles that do not add up": (d) => { d.vehicles = { new: 2, used: 2 }; },
    "half a split": (d) => { d.vehicles = { new: 7, used: null }; },
    "a count that is not whole": (d) => { d.count = 2.5; d.vehicles = { new: 2.5, used: 0 }; },
    "a negative count": (d) => { d.count = -1; d.vehicles = { new: -1, used: 0 }; },
    "a text count": (d) => { d.count = "7"; },
    "NaN": (d) => { d.count = NaN; },
    "an unknown status": (d) => { d.status = "settled"; },
    "a missing day carrying a count": (d) => { d.status = "missing"; d.count = 7; },
    "a conflict carrying a timestamp": (d) => { d.status = "conflict"; d.count = null; d.vehicles = { new: null, used: null }; },
    "a date outside the month": (d) => { d.date = "2026-09-30"; },
    "not a date at all": (d) => { d.date = "2026-99-01"; },
    "a null row": (d, r) => { r.days[0] = null; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const m = forged(mutate);
    assert.equal(m.available, false, name);
    assert.equal(m.reason, "malformed", name);
    assert.equal(m.total, null, name);
    assert.ok(m.days.every((d) => d.state === "unavailable" && d.units === null && d.level === null && !d.best), name);
  }
  // One bad day anywhere ruins the month, as it does in the reader.
  const late = reported({ "2026-10-01": 7 });
  late.days[20].asOf = { timestamp: "x", basis: "report_sent" };
  late.days[20].status = "provisional"; late.days[20].count = 3; late.days[20].vehicles = { new: 3, used: 0 };
  assert.equal(deliveriesMonth(late, opts()).reason, "malformed");
  // Duplicate and missing dates.
  const dup = reported({}); dup.days[1] = { ...dup.days[0] };
  assert.equal(deliveriesMonth(dup, opts()).reason, "malformed");
  const short = reported({}); short.days.pop();
  assert.equal(deliveriesMonth(short, opts()).reason, "malformed");
  const long = reported({}); long.days.push({ ...long.days[0] });
  assert.equal(deliveriesMonth(long, opts()).reason, "malformed");
  const notArray = reported({}); notArray.days = {};
  assert.equal(deliveriesMonth(notArray, opts()).available, false);
});

test("a negative or fractional epoch never matches, even when both sides agree", () => {
  for (const bad of [-1, -3, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
    const m = deliveriesMonth(reported({ "2026-10-01": 5 }, { principalEpoch: bad }), opts({ principalEpoch: bad }));
    assert.equal(m.available, false, String(bad));
    assert.equal(m.reason, "stale", String(bad));
    assert.equal(m.total, null, String(bad));
  }
  assert.equal(deliveriesMonth(reported({ "2026-10-01": 5 }, { principalEpoch: 0 }), opts({ principalEpoch: 0 })).available, true, "zero is a valid epoch");
  assert.equal(deliveriesMonth(reported({ "2026-10-01": 5 }, { principalEpoch: Number.MAX_SAFE_INTEGER }), opts({ principalEpoch: Number.MAX_SAFE_INTEGER })).available, true);
});

test("a monthly total past the safe integers is unavailable, never rounded", () => {
  const big = Number.MAX_SAFE_INTEGER;
  const huge = reported({ "2026-10-01": big, "2026-10-02": big });
  const m = deliveriesMonth(huge, opts());
  assert.equal(m.available, false);
  assert.equal(m.reason, "overflow");
  assert.equal(m.total, null);
  assert.ok(m.days.every((d) => d.units === null && d.level === null && !d.best));
  assert.equal(summaryText(m), "Deliveries are unavailable right now.");
  // One more than safe by a single vehicle, and spread over many days.
  const edge = deliveriesMonth(reported({ "2026-10-01": big, "2026-10-02": 1 }), opts());
  assert.equal(edge.available, false, "2^53 is not a total");
  const spread = {}; for (let i = 1; i <= 14; i++) spread[`2026-10-${String(i).padStart(2, "0")}`] = Math.floor(big / 7);
  assert.equal(deliveriesMonth(reported(spread), opts()).available, false, "each day safe, the month not");
  // Exactly the largest safe total is still exact.
  const exact = deliveriesMonth(reported({ "2026-10-01": big - 5, "2026-10-02": 5 }), opts());
  assert.equal(exact.available, true);
  assert.equal(exact.total, big);
});

test("a bad month or date fails closed instead of throwing", () => {
  assert.equal(validDate("2026-99-01"), false);
  assert.equal(validDate("2026-10-14"), true);
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-10-14T00:00:00Z"), false);
  assert.equal(validDate(20261014), false);
  assert.equal(validDate(null), false);
  assert.equal(validMonth("2026-00"), false);
  for (const bad of [{ month: "2026-13" }, { month: "nope" }, { month: undefined }, { today: "2026-99-01" }, { today: "x" }, { today: undefined }]) {
    let m;
    assert.doesNotThrow(() => { m = deliveriesMonth(reported({ "2026-10-01": 5 }), opts(bad)); }, JSON.stringify(bad));
    assert.equal(m.available, false);
    assert.equal(m.total, null);
    assert.doesNotThrow(() => summaryText(m));
  }
  assert.doesNotThrow(() => deliveriesMonth(undefined));
  assert.doesNotThrow(() => staffingMonth({ month: "2026-13", roster }));
  assert.doesNotThrow(() => staffingMonth({ month: undefined }));
  assert.equal(staffingMonth({ month: "2026-13", roster }).evidence, "unavailable");
  assert.equal(scheduleReview({}, "2026-13").present, false);
});

test("New and Used are shown only when they add up to the count", () => {
  const ok = month({ "2026-10-01": 5 });
  assert.deepEqual(row(ok, "2026-10-01").split, { new: 5, used: 0 });
  const unsplit = reported({ "2026-10-01": 5 });
  unsplit.days[0].vehicles = { new: null, used: null };
  const m = deliveriesMonth(unsplit, opts());
  assert.equal(m.available, true);
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

test("employment bounds are the app's own: inclusive at both ends", () => {
  const crew = [...roster,
    { id: "h1", name: "Hired Late", roleId: "sales", hiredAt: "2026-10-15" },
    { id: "d1", name: "Left Early", roleId: "sales" }];
  const s = staff({ roster: crew, departed: [{ name: "  left   EARLY ", at: "2026-10-10T12:00:00.000Z" }] });
  const listed = (date, id) => [...day(s, date).off, ...day(s, date).overridden, ...day(s, date).present, ...day(s, date).unknown].some((p) => p.id === id);
  // Hired on the 15th: not on the 14th, counted on the 15th.
  assert.equal(listed("2026-10-01", "h1"), false, "not Off or anything else before they started");
  assert.equal(listed("2026-10-14", "h1"), false, "the day before they started");
  assert.equal(listed("2026-10-15", "h1"), true, "the day they started");
  assert.equal(listed("2026-10-31", "h1"), true);
  // Left on the 10th: counted on the 10th, gone from the 11th. Matched by name as the app does.
  assert.equal(listed("2026-10-09", "d1"), true);
  assert.equal(listed("2026-10-10", "d1"), true, "the day they left still counts");
  assert.equal(listed("2026-10-11", "d1"), false, "the day after");
  assert.equal(listed("2026-10-31", "d1"), false);
  // A listed day off before somebody started is not an Off.
  const early = staff({ roster: crew, daysOff: { h1: ["2026-10-01", "2026-10-15"] } });
  assert.equal(day(early, "2026-10-01").off.some((p) => p.id === "h1"), false, "a new hire has no days off before they started");
  assert.equal(day(early, "2026-10-15").off.some((p) => p.id === "h1"), true, "but can be off on the day they start");
  // The departure can also arrive by id.
  const byId = staff({ roster: crew, departed: [{ id: "d1", at: "2026-10-10" }] });
  assert.equal(day(byId, "2026-10-10").unknown.some((p) => p.id === "d1"), true);
  assert.equal(day(byId, "2026-10-11").unknown.some((p) => p.id === "d1"), false);
  // An unreadable date is no bound, as no start date has always meant the whole month.
  const odd = staff({ roster: [{ id: "q", name: "Odd Dates", roleId: "sales", hiredAt: "soon" }], departed: [{ name: "odd dates", at: "never" }] });
  assert.equal(day(odd, "2026-10-01").unknown.length, 1);
  assert.equal(day(odd, "2026-10-31").unknown.length, 1);
});

test("the model agrees with the app's servedOn on every date around both bounds", () => {
  const person = { id: "x", name: "Edge Case", roleId: "sales", hiredAt: "2026-10-15T09:00:00.000Z" };
  const leftAt = "2026-10-20";
  const s = staff({ roster: [person], departed: [{ name: "Edge Case", at: leftAt }] });
  for (const date of monthDays(MONTH)) {
    const here = [...day(s, date).off, ...day(s, date).overridden, ...day(s, date).present, ...day(s, date).unknown].length === 1;
    assert.equal(here, servedOn(person, date, leftAt), date);
  }
});

test("another store's records are masked when they are not ready", () => {
  const s = staff({ ready: false, daysOff: { p1: ["2026-10-14"] }, scheduleSource: source, roster });
  assert.equal(s.evidence, "unavailable");
  assert.equal(s.rosterCount, 0);
  assert.ok(Object.values(s.byDate).every((d) => !d.off.length && !d.unknown.length && !d.present.length));
  const detail = dayDetail("2026-10-14", month({}), s);
  assert.equal(detail.staffingReady, false);
  assert.equal(detail.offText, "schedule not loaded");
  assert.equal(detail.scheduleKnown, false);
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
    const r = { status: "ready", storeId: STORE, month: m, principalEpoch: EPOCH,
      days: monthDays(m).map((date) => ({ date, status: "missing", count: null, vehicles: { new: null, used: null }, asOf: null })) };
    const out = deliveriesMonth(r, opts({ month: m, today: `${m}-${String(n).padStart(2, "0")}` }));
    assert.equal(out.days.length, n);
    assert.ok(out.days.every((d) => d.state === "missing"));
  }
  const next = deliveriesMonth({ status: "ready", storeId: STORE, month: "2026-11", principalEpoch: EPOCH, days: monthDays("2026-11").map((date) => ({ date, status: "missing", count: null, vehicles: { new: null, used: null }, asOf: null })) },
    opts({ month: "2026-11", today: "2026-10-31" }));
  assert.ok(next.days.every((d) => d.state === "future"), "the day before a month starts, all of it is still to come");
});
