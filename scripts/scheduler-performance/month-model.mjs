import {
  addDays,
  weekday,
  ruleFor,
  forecast,
} from "../scheduler-proposal/model.mjs";
export function validMonth(month) {
  return (
    typeof month === "string" &&
    /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month) &&
    month >= "2014-01" &&
    month <= "2100-12"
  );
}
export function monthDays(month) {
  if (!validMonth(month))
    throw Error("Choose a month from January 2014 to December 2100.");
  const [year, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
export function shiftMonth(month, delta) {
  monthDays(month);
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  const result = date.toISOString().slice(0, 7);
  if (!validMonth(result)) throw Error("Month outside prototype range.");
  return result;
}
// A draft owns its settings and overrides. Viewing another month never mutates it.
export function createPlanner(stores) {
  const drafts = new Map();
  const key = (index, month) => `${index}:${month}`;
  const get = (index, month) => {
    monthDays(month);
    if (!stores[index]) throw Error("Unknown store");
    const k = key(index, month);
    if (!drafts.has(k))
      drafts.set(k, {
        store: {
          ...stores[index],
          people: structuredClone(stores[index].people),
          rules: structuredClone(stores[index].rules),
        },
        overrides: {},
        accepted: false,
        reviewFingerprint: null,
      });
    return drafts.get(k);
  };
  const rows = (index, month) => {
    get(index, month);
    return proposeMonth(
      month,
      (day) =>
        drafts.get(key(index, day.slice(0, 7))) || {
          store: stores[index],
          overrides: {},
        },
    );
  };
  const reset = (index, month) => {
    drafts.delete(key(index, month));
    return get(index, month);
  };
  return { get, rows, reset, drafts };
}
export function proposeMonth(month, resolveDay) {
  const dates = monthDays(month);
  const lead = (weekday(dates[0]) + 6) % 7;
  const start = addDays(dates[0], -lead);
  let used = {};
  return Array.from({ length: dates.length + lead }, (_, i) => {
    const day = addDays(start, i);
    if (weekday(day) === 1) used = {};
    const { store, overrides } = resolveDay(day);
    for (const p of store.people) used[p.id] ??= 0;
    const rule = ruleFor(store.rules, day),
      estimate = forecast(store.history, day);
    const state = !rule
      ? "unknown"
      : rule.holidays[day] ||
        (rule.closedDays.includes(weekday(day)) ? "closed" : "open");
    if (state !== "open")
      return {
        day,
        state,
        rule,
        estimate: null,
        ids: [],
        issues:
          state === "unknown"
            ? ["Store hours or holiday status unknown. Manager input needed."]
            : [],
        required: null,
      };
    const hours = rule.close - rule.open;
    if (
      !(hours > 0) ||
      !Number.isInteger(rule.minimum) ||
      rule.minimum < 1 ||
      (rule.useCapacity && !(rule.capacity > 0))
    )
      return {
        day,
        state: "unknown",
        rule,
        ids: [],
        issues: ["Enter valid store hours, minimum coverage and capacity."],
        required: null,
      };
    const required = Math.max(
      rule.minimum,
      rule.useCapacity && estimate
        ? Math.ceil(estimate.high / rule.capacity)
        : 0,
    );
    const eligible = store.people
      .filter(
        (p) =>
          !p.off.includes(weekday(day)) &&
          p.start <= rule.open &&
          p.end >= rule.close &&
          used[p.id] + hours <= p.maxHours,
      )
      .sort((a, b) => used[a.id] - used[b.id] || a.id.localeCompare(b.id));
    const ids = overrides[day] ?? eligible.slice(0, required).map((p) => p.id);
    const issues = [];
    for (const id of ids) {
      const p = store.people.find((p) => p.id === id);
      if (!p) {
        issues.push("Unknown person.");
        continue;
      }
      if (p.off.includes(weekday(day))) issues.push(`${p.name}: day off.`);
      if (p.start > rule.open || p.end < rule.close)
        issues.push(`${p.name}: does not cover store hours.`);
      used[id] += hours;
      if (used[id] > p.maxHours)
        issues.push(`${p.name}: weekly hours exceeded.`);
    }
    if (ids.length < required)
      issues.push(
        `${required - ids.length} more needed for entered coverage/capacity.`,
      );
    if (!estimate)
      issues.push(
        "Delivery history unknown or insufficient. Minimum coverage still applies.",
      );
    return {
      day,
      state,
      rule,
      estimate,
      required,
      ids,
      hours,
      issues,
      override: Object.hasOwn(overrides, day),
    };
  }).filter((row) => row.day.startsWith(month + "-"));
}

// Recorded deliveries never borrow from a planning range, including future dates.
export function recordedDay(store, day, today) {
  if (day > today) return { state: "future", units: null };
  const row = store.history.find((r) => r.day === day);
  return row?.state === "known"
    ? { state: "known", units: row.units }
    : row?.state === "closed"
      ? { state: "closed", units: null }
      : { state: "unknown", units: null };
}
export function monthSales(store, month, today) {
  const days = monthDays(month).map((day) => ({
    day,
    ...recordedDay(store, day, today),
  }));
  const known = days.filter((r) => r.state === "known");
  return {
    days,
    total: known.length ? known.reduce((n, r) => n + r.units, 0) : null,
    known: known.length,
    unknown: days.filter((r) => r.state === "unknown").length,
    closed: days.filter((r) => r.state === "closed").length,
    future: days.filter((r) => r.state === "future").length,
    best:
      known.toSorted(
        (a, b) => b.units - a.units || a.day.localeCompare(b.day),
      )[0] || null,
  };
}

export const STORE_TIME_ZONE = "America/New_York";
export function storeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function calendarCells(month) {
  const days = monthDays(month),
    leading = (weekday(days[0]) + 6) % 7;
  const cells = [...Array(leading).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}
