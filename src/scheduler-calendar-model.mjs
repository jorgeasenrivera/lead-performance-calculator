/**
 * The scheduler calendar's data contract.
 * -------------------------------------------------------------------------
 * Pure functions, no React, no network, no clock of their own. The screen hands
 * in what the app already holds (the roster, the days off, the schedule file a
 * manager applied, the month of daily deliveries the reader returned) and gets
 * back what a person can be shown. Nothing here fetches or writes.
 *
 * Three rules hold the whole file, and the tests pin each of them:
 *
 *   1. Delivered is only ever a count somebody reported. A day with no report is
 *      unknown, a day still to come is pending, and neither is ever a zero. A
 *      reported zero is a zero.
 *   2. Off is only ever a day somebody listed. Not being listed off does not make
 *      a person On, so everyone else is "not listed off", never "working".
 *   3. If what was handed in does not belong to this store and month, there is no
 *      answer. Showing the last month's numbers under this month's name is worse
 *      than showing nothing.
 *
 * The delivery shape is the reader's (X19, `projectReportedMonth`): days of
 * { date, status, count, vehicles, asOf } with status provisional, missing,
 * incomplete or conflict. This file takes that shape as input and does not import
 * the reader, so the reader keeps its own scope and review.
 */

export const STORE_TIME_ZONE = "America/New_York";

export function validMonth(month) {
  return typeof month === "string" && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month);
}
export function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // 2026-99-01 matches the shape and is not a date; toISOString throws on it.
  const t = new Date(date + "T12:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === date;
}
export function monthDays(month) {
  if (!validMonth(month)) throw new Error("Choose a month from 2000 to 2100.");
  const [year, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

// The dealership's day, not the browser's: a phone abroad or a laptop set to UTC
// must not move today's date.
export function storeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Monday first, padded to whole weeks, null for the blanks.
export function calendarCells(month) {
  const days = monthDays(month);
  const leading = (new Date(days[0] + "T12:00:00Z").getUTCDay() + 6) % 7;
  const cells = [...Array(leading).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function dateText(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(date + "T12:00:00Z"));
}
export function monthText(month) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(month + "-01T12:00:00Z"));
}

/* ------------------------------------------------------------------ deliveries */

const REPORTER_STATUSES = ["provisional", "missing", "incomplete", "conflict"];
const BASES = ["report_sent", "report_received"];
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
// A session epoch is a counter: whole and never negative, as the reader's own check has it.
const isEpoch = (n) => Number.isSafeInteger(n) && n >= 0;

const NONE = Object.freeze({ units: null, split: null, asOf: null, level: null, best: false, bestLabel: "" });

function unavailableMonth(month, reason) {
  const days = validMonth(month) ? monthDays(month).map((date) => ({ date, state: "unavailable", reason, ...NONE })) : [];
  return Object.freeze({ available: false, reason, days, total: null, reportedDays: 0, bestDays: [] });
}

// One reader row, held to the reader's whole contract (X19 `projectReportedMonth`), not
// just the field the screen happens to use. A count with no real timestamp and basis is
// not a report, and a forged row must not be able to colour a day or add to a total.
function validRow(row, dates) {
  if (!row || typeof row !== "object" || !dates.includes(row.date) || !REPORTER_STATUSES.includes(row.status)) return false;
  const v = row.vehicles;
  if (!v || typeof v !== "object") return false;
  if (row.status !== "provisional") return row.count === null && v.new === null && v.used === null && row.asOf === null;
  if (!isCount(row.count)) return false;
  const a = row.asOf;
  if (!a || typeof a !== "object" || typeof a.timestamp !== "string" || !STAMP.test(a.timestamp) || !BASES.includes(a.basis)) return false;
  const t = new Date(a.timestamp);
  if (Number.isNaN(t.getTime()) || t.toISOString() !== a.timestamp) return false;
  const unsplit = v.new === null && v.used === null;
  return unsplit || (isCount(v.new) && isCount(v.used) && v.new + v.used === row.count);
}

/**
 * One month of daily deliveries, as the screen shows it.
 *
 * `reported` is the reader's snapshot: { status, days, storeId, month, principalEpoch }.
 * It is read only when it is ready, for exactly this store and month, carries the same
 * principal epoch the caller holds now, and every row meets the reader's full contract.
 * Any one bad row, a missing or duplicate date, or an epoch that is not the caller's
 * makes the whole month unavailable, as the reader itself does. A caller that does not
 * pass `principalEpoch` gets no answer: nothing shows until a real reader is wired.
 * `today` is the store's date; a date after it is pending whatever the rows say.
 */
export function deliveriesMonth(reported, { storeId, month, today, principalEpoch } = {}) {
  if (!validMonth(month) || !validDate(today)) return unavailableMonth(month, "malformed");
  const status = reported?.status;
  if (status !== "ready") {
    const known = ["idle", "loading", "denied", "unavailable"];
    return unavailableMonth(month, known.includes(status) ? status : "unavailable");
  }
  // A snapshot carries the store, month and session it was fetched for. All three must
  // match what is on screen now, or this is another store's, month's or account's answer.
  if (typeof storeId !== "string" || !STORE_ID.test(storeId) || reported.storeId !== storeId || reported.month !== month
      || !isEpoch(principalEpoch) || reported.principalEpoch !== principalEpoch || !Array.isArray(reported.days)) {
    return unavailableMonth(month, "stale");
  }
  const dates = monthDays(month);
  if (reported.days.length !== dates.length) return unavailableMonth(month, "malformed");
  const rows = new Map();
  for (const row of reported.days) {
    if (!validRow(row, dates) || rows.has(row.date)) return unavailableMonth(month, "malformed");
    rows.set(row.date, row);
  }

  const days = dates.map((date) => {
    const row = rows.get(date);
    if (date > today) return { date, state: "future", reason: null, ...NONE };
    if (row.status === "provisional") {
      const v = row.vehicles;
      const split = isCount(v.new) && isCount(v.used) ? Object.freeze({ new: v.new, used: v.used }) : null;
      return { date, state: "reported", reason: null, units: row.count, split,
        asOf: Object.freeze({ timestamp: row.asOf.timestamp, basis: row.asOf.basis }), level: null, best: false, bestLabel: "" };
    }
    return { date, state: row.status, reason: null, ...NONE };
  });

  const reportedRows = days.filter((d) => d.state === "reported");
  // Every day is a safe integer, but their sum need not be. Past 2^53 a total is a rounded
  // guess, so there is no total: the month shows as unavailable.
  let total = 0;
  for (const d of reportedRows) {
    if (total > Number.MAX_SAFE_INTEGER - d.units) return unavailableMonth(month, "overflow");
    total += d.units;
  }
  const maximum = reportedRows.length ? Math.max(...reportedRows.map((d) => d.units)) : null;
  const bestDays = maximum > 0 ? reportedRows.filter((d) => d.units === maximum).map((d) => d.date) : [];
  const tied = bestDays.length > 1;
  for (const d of days) {
    if (d.state !== "reported") continue;
    // Colour is relative to the month's own best day. A month of zeros has no best
    // day, so nothing is crowned.
    d.level = maximum > 0 ? Math.round((d.units / maximum) * 4) : 0;
    d.best = bestDays.includes(d.date);
    d.bestLabel = d.best ? (tied ? "Best recorded · tied" : "Best recorded") : "";
  }
  return Object.freeze({
    available: true, reason: null, days: days.map(Object.freeze),
    total: reportedRows.length ? total : null,
    reportedDays: reportedRows.length, bestDays,
  });
}

// What a cell and a day sheet say for a day, in the words the approved preview uses.
export function deliveredText(row) {
  switch (row.state) {
    case "reported": return `${row.units} delivered`;
    case "future": return "sales not yet available";
    case "missing": return "delivered unknown";
    case "incomplete": return "report incomplete";
    case "conflict": return "reports disagree";
    default: return "delivered unavailable";
  }
}
export function deliveredValue(row) {
  switch (row.state) {
    case "reported": return String(row.units);
    case "future": return "Pending";
    case "missing": return "Unknown";
    case "incomplete": return "Incomplete";
    case "conflict": return "Conflict";
    default: return "Unavailable";
  }
}
export function cellClass(row, today) {
  const base = row.state === "reported" ? `heat-${row.level}` : `sales-${row.state}`;
  return base + (row.best ? " best" : "") + (row.date === today ? " today" : "");
}
export function cellLabel(row) {
  const bits = [dateText(row.date), deliveredText(row)];
  if (row.bestLabel) bits.push(row.bestLabel.toLowerCase());
  return bits.join(", ");
}
export function summaryText(model) {
  if (!model.available) {
    return {
      idle: "Deliveries are not loaded.", loading: "Loading deliveries.",
      denied: "You do not have access to deliveries for this store.",
      unavailable: "Deliveries are unavailable right now.",
      stale: "Deliveries are unavailable right now.", malformed: "Deliveries are unavailable right now.", overflow: "Deliveries are unavailable right now.",
    }[model.reason] || "Deliveries are unavailable right now.";
  }
  if (model.total === null) return "No recorded deliveries yet this month.";
  return `${model.total} delivered on ${model.reportedDays} recorded ${model.reportedDays === 1 ? "day" : "days"} so far.`;
}

/* -------------------------------------------------------------------- staffing */

const stamp = (value) => (typeof value === "string" && value ? value : null);
const listed = (map, id, date) => Array.isArray(map?.[id]) && map[id].includes(date);

/**
 * Who is off on each day of the month, and what is not known.
 *
 * Inputs are the store's own records, by the keys the app already uses:
 *   roster          [{ id, name, roleId, hiredAt? }]  people with a role are on the board
 *   roster[].hiredAt  a date or timestamp         not counted before the day they started
 *   departed        [{ name, at }] (or { id })   not counted after the day they left
 *   daysOff         { [id]: [date] }             listed by an uploaded schedule
 *   forcedOff       { [id]: [date] }             marked off by a manager
 *   presentAnyway   { [date]: [id] }             a manager said they were here
 *   scheduleSource  { [month]: { file, at, kind, off, unmatched } }
 *   isOff(id, date) optional, the app's own rule (a listed day somebody plainly
 *                   worked is not off). Without it the raw lists decide, and the
 *                   result says so in `rule`.
 *
 * People are bound by roster id. A name is only ever a label, except where the app's own
 * departed records carry only a name; those are matched the way the app matches them.
 *
 * Employment bounds are the app's `servedOn`: both ends inclusive, so somebody is counted
 * on the day they started and on the day they left, and not before or after. A person who
 * is not employed on a date is not listed at all that day, neither off nor not listed off.
 *
 * `ready: false` means the records handed in are not known to belong to this store (the
 * caller checks), so no person, day off or schedule is shown from them.
 */
// The app's name match for departure records (`norm` in the parsers).
const norm = (v) => (typeof v === "string" ? v : "").trim().toLowerCase().replace(/\s+/g, " ");
const dayOf = (v) => (typeof v === "string" && validDate(v.slice(0, 10)) ? v.slice(0, 10) : null);

export function staffingMonth({ month, roster = [], departed = [], daysOff = {}, forcedOff = {},
  presentAnyway = {}, scheduleSource = {}, isOff = null, ready = true }) {
  if (!validMonth(month)) return Object.freeze({ evidence: "unavailable", rule: "listed", rosterCount: 0, byDate: {} });
  const dates = monthDays(month);
  if (!ready) {
    const byDate = Object.fromEntries(dates.map((date) => [date, Object.freeze({ date, off: [], overridden: [], present: [], unknown: [] })]));
    return Object.freeze({ evidence: "unavailable", rule: "listed", rosterCount: 0, byDate });
  }
  const people = [];
  const seen = new Set();
  for (const p of Array.isArray(roster) ? roster : []) {
    if (!p || typeof p.id !== "string" || !p.id || !p.roleId || seen.has(p.id)) continue;
    seen.add(p.id);
    people.push({ id: p.id, name: typeof p.name === "string" && p.name ? p.name : "Unnamed", hired: dayOf(p.hiredAt) });
  }
  people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const leftOn = (p) => {
    const rec = (Array.isArray(departed) ? departed : []).find((d) => d && (d.id === p.id || (d.id == null && norm(d.name) === norm(p.name))));
    return rec ? dayOf(rec.at) : null;
  };
  const left = new Map(people.map((p) => [p.id, leftOn(p)]));
  const source = scheduleSource?.[month] || null;
  const anyOff = people.some((p) => dates.some((d) => listed(daysOff, p.id, d) || listed(forcedOff, p.id, d)));
  const evidence = source ? "schedule" : anyOff ? "marks" : "none";

  const byDate = {};
  for (const date of dates) {
    const off = [], overridden = [], present = [], unknown = [];
    for (const p of people) {
      // servedOn: a day before the start or after the departure is not theirs. Both ends count.
      if ((p.hired && date < p.hired) || (left.get(p.id) && date > left.get(p.id))) continue;
      const forced = listed(forcedOff, p.id, date);
      const onFile = listed(daysOff, p.id, date);
      const effective = typeof isOff === "function" ? isOff(p.id, date) === true : forced || onFile;
      if (effective) {
        const fromFile = listed(source?.off, p.id, date);
        off.push({
          id: p.id, name: p.name,
          // A manager's own mark outranks the file, so it is named first.
          source: forced ? "manager" : fromFile ? "schedule" : "on file",
          file: !forced && fromFile ? source.file || null : null,
          at: !forced && fromFile ? stamp(source.at) : null,
        });
      } else if (forced || onFile) {
        overridden.push({ id: p.id, name: p.name });
      } else if (listed(presentAnyway, date, p.id)) {
        present.push({ id: p.id, name: p.name });
      } else {
        unknown.push({ id: p.id, name: p.name });
      }
    }
    byDate[date] = Object.freeze({ date, off, overridden, present, unknown });
  }
  return Object.freeze({
    evidence, rule: typeof isOff === "function" ? "app" : "listed", rosterCount: people.length, byDate,
  });
}

// The file a manager applied for this month, for showing back what it said.
export function scheduleReview(scheduleSource, month) {
  const s = scheduleSource?.[month];
  if (!s) return Object.freeze({ present: false });
  const off = s.off && typeof s.off === "object" ? s.off : {};
  const unmatched = Array.isArray(s.unmatched) ? s.unmatched : [];
  return Object.freeze({
    present: true, file: s.file || null, at: stamp(s.at), kind: s.kind || null,
    people: Object.keys(off).length,
    offDays: Object.values(off).reduce((n, dates) => n + (Array.isArray(dates) ? dates.length : 0), 0),
    unmatched: unmatched.length, needsReview: unmatched.length > 0,
  });
}

/* ------------------------------------------------------------------- day sheet */

// Everything the day sheet shows for one date, from the two models above. The
// shift length of anyone is unknown: no source the app holds carries one, so it
// is not guessed.
export function dayDetail(date, deliveries, staffing) {
  const row = deliveries.days.find((d) => d.date === date);
  if (!row) throw new Error("That date is not in this month.");
  const people = staffing.byDate[date];
  if (!people) throw new Error("That date is not in this month.");
  const offText = people.off.length ? `${people.off.length} off` : staffing.evidence === "unavailable" ? "schedule not loaded"
    : staffing.evidence === "none" ? "no schedule on file" : "no one listed off";
  return Object.freeze({
    date, title: dateText(date), delivered: row, deliveredValue: deliveredValue(row),
    asOf: row.asOf, split: row.split, off: people.off, overridden: people.overridden,
    present: people.present, notListedOff: people.unknown, offText,
    scheduleKnown: staffing.evidence === "schedule" || staffing.evidence === "marks", staffingReady: staffing.evidence !== "unavailable",
    durations: "unknown",
  });
}
