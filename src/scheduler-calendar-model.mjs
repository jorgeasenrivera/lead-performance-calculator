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
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
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
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

const NONE = Object.freeze({ units: null, split: null, asOf: null, level: null, best: false, bestLabel: "" });

function unavailableMonth(month, reason) {
  const days = monthDays(month).map((date) => ({ date, state: "unavailable", reason, ...NONE }));
  return Object.freeze({ available: false, reason, days, total: null, reportedDays: 0, bestDays: [] });
}

/**
 * One month of daily deliveries, as the screen shows it.
 *
 * `reported` is the reader's snapshot: { status, days, storeId, month }. Only a
 * snapshot that is ready, and for exactly this store and month, is read at all.
 * `today` is the store's date; a date after it is pending whatever the rows say.
 */
export function deliveriesMonth(reported, { storeId, month, today }) {
  if (!validMonth(month) || !validDate(today)) throw new Error("A month and today's date are required.");
  const status = reported?.status;
  if (status !== "ready") {
    const known = ["idle", "loading", "denied", "unavailable"];
    return unavailableMonth(month, known.includes(status) ? status : "unavailable");
  }
  // A snapshot carries the store and month it was fetched for. Both must match
  // what is on screen now, or this is another store's or another month's answer.
  if (!storeId || reported.storeId !== storeId || reported.month !== month || !Array.isArray(reported.days)) {
    return unavailableMonth(month, "stale");
  }
  const dates = monthDays(month);
  const rows = new Map();
  for (const row of reported.days) {
    if (!row || !dates.includes(row.date) || rows.has(row.date)) return unavailableMonth(month, "malformed");
    rows.set(row.date, row);
  }

  const days = dates.map((date) => {
    if (date > today) return { date, state: "future", reason: null, ...NONE };
    const row = rows.get(date);
    if (!row || !REPORTER_STATUSES.includes(row.status)) return { date, state: "unavailable", reason: "no row", ...NONE };
    if (row.status === "provisional") {
      // A count that is not a whole number of vehicles is not a count. Drop the day
      // to unknown rather than round it into something that looks reported.
      if (!isCount(row.count)) return { date, state: "unavailable", reason: "bad count", ...NONE };
      const v = row.vehicles;
      const split = v && isCount(v.new) && isCount(v.used) && v.new + v.used === row.count
        ? Object.freeze({ new: v.new, used: v.used }) : null;
      const asOf = row.asOf && typeof row.asOf.timestamp === "string" && typeof row.asOf.basis === "string"
        ? Object.freeze({ timestamp: row.asOf.timestamp, basis: row.asOf.basis }) : null;
      return { date, state: "reported", reason: null, units: row.count, split, asOf, level: null, best: false, bestLabel: "" };
    }
    return { date, state: row.status, reason: null, ...NONE };
  });

  const reportedRows = days.filter((d) => d.state === "reported");
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
    total: reportedRows.length ? reportedRows.reduce((n, d) => n + d.units, 0) : null,
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
      stale: "Deliveries are unavailable right now.", malformed: "Deliveries are unavailable right now.",
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
 *   roster          [{ id, name, roleId }]       people with a role are on the board
 *   departed        [{ id, at }]                 not counted from the day they left
 *   daysOff         { [id]: [date] }             listed by an uploaded schedule
 *   forcedOff       { [id]: [date] }             marked off by a manager
 *   presentAnyway   { [date]: [id] }             a manager said they were here
 *   scheduleSource  { [month]: { file, at, kind, off, unmatched } }
 *   isOff(id, date) optional, the app's own rule (a listed day somebody plainly
 *                   worked is not off). Without it the raw lists decide, and the
 *                   result says so in `rule`.
 *
 * People are bound by roster id. A name is only ever a label.
 */
export function staffingMonth({ month, roster = [], departed = [], daysOff = {}, forcedOff = {},
  presentAnyway = {}, scheduleSource = {}, isOff = null }) {
  const dates = monthDays(month);
  const people = [];
  const seen = new Set();
  for (const p of roster) {
    if (!p || typeof p.id !== "string" || !p.id || !p.roleId || seen.has(p.id)) continue;
    seen.add(p.id);
    people.push({ id: p.id, name: typeof p.name === "string" && p.name ? p.name : "Unnamed" });
  }
  people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const left = new Map();
  for (const d of departed) if (d && typeof d.id === "string" && stamp(d.at)) left.set(d.id, d.at.slice(0, 10));
  const source = scheduleSource?.[month] || null;
  const anyOff = people.some((p) => dates.some((d) => listed(daysOff, p.id, d) || listed(forcedOff, p.id, d)));
  const evidence = source ? "schedule" : anyOff ? "marks" : "none";

  const byDate = {};
  for (const date of dates) {
    const off = [], overridden = [], present = [], unknown = [];
    for (const p of people) {
      if (left.has(p.id) && left.get(p.id) <= date) continue;
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
  const offText = people.off.length ? `${people.off.length} off` : staffing.evidence === "none" ? "no schedule on file" : "no one listed off";
  return Object.freeze({
    date, title: dateText(date), delivered: row, deliveredValue: deliveredValue(row),
    asOf: row.asOf, split: row.split, off: people.off, overridden: people.overridden,
    present: people.present, notListedOff: people.unknown, offText,
    scheduleKnown: staffing.evidence !== "none", durations: "unknown",
  });
}
