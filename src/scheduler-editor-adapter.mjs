/**
 * What the month editor is handed, from the records the dashboard already holds.
 * Pure data in, pure data out: no React, no network, no storage, no clock of its own.
 *
 * The editor (scripts/scheduler-performance/month-app-core.mjs) takes stores, an assignment
 * resolver and a clock. This file builds those three from a store, its roster and its days off,
 * and refuses, by name, anything it cannot bind to a real store. Nothing is invented to fill a gap:
 * a person's hours, the store's hours, history, teams and memberships are carried as unknown (or
 * as empty lists the editor will not seed over), and a day is never marked worked.
 */
import { staffingMonth, validDate, validMonth } from "./scheduler-calendar-model.mjs";

export class EditorInputError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "EditorInputError";
    this.code = code;
  }
}
const refuse = (code, detail) => { throw new EditorInputError(code, detail); };

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_PEOPLE = 500;

/** The calendar date in an IANA zone, or null when the zone or the instant cannot be read. */
export function zonedToday(timezone, now = new Date()) {
  if (typeof timezone !== "string" || !timezone) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (name) => parts.find((p) => p.type === name)?.value;
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    return validDate(day) ? day : null;
  } catch {
    return null;
  }
}

/**
 * The planner's store for one real store. People are the roster's, bound by id (first record of an
 * id wins, as in the calendar). Availability and hours are null: nothing the app holds says them.
 * `teams` and `memberships` are given outright, even empty, so the editor never seeds placeholder
 * teams or people.
 */
export function editorStore(store, data, timezone) {
  if (!store || typeof store.id !== "string" || !ID.test(store.id)) refuse("store", "id");
  const roster = Array.isArray(data?.roster) ? data.roster : [];
  const seen = new Set();
  const people = [];
  for (const p of roster) {
    if (!p || typeof p.id !== "string" || !p.id || !p.roleId || seen.has(p.id)) continue;
    seen.add(p.id);
    people.push({ id: p.id, name: typeof p.name === "string" && p.name ? p.name : "Unnamed", off: null, start: null, end: null, maxHours: null });
  }
  if (people.length > MAX_PEOPLE) refuse("roster", "too many people");
  return {
    id: store.id,
    name: typeof store.name === "string" && store.name ? store.name : store.id,
    // The store's own zone: the planner reads it for shift times, and the clock above uses the same one.
    ...(typeof timezone === "string" && timezone ? { timezone } : {}),
    people,
    rules: [],
    history: [],
    teams: [],
    memberships: [],
  };
}

/**
 * The editor's `assignmentForDay(day, index)`: who is listed off on a day, by the app's own rule,
 * inside each person's employment (the calendar's `staffingMonth`). Who is working is not known, so
 * `on` is empty and the editor shows the day as needing a schedule. A day with nobody listed off is null.
 */
export function assignmentResolver(data, { isOff } = {}) {
  const cache = new Map();
  const month = (m) => {
    if (!cache.has(m)) {
      cache.set(m, staffingMonth({
        month: m,
        roster: data?.roster, departed: data?.departed, daysOff: data?.daysOff, forcedOff: data?.forcedOff,
        presentAnyway: data?.presentAnyway, scheduleSource: data?.scheduleSource,
        isOff: typeof isOff === "function" ? (id, date) => isOff(data, id, date) : null,
      }));
    }
    return cache.get(m);
  };
  return (day, index = 0) => {
    if (index !== 0 || typeof day !== "string" || !validDate(day) || !validMonth(day.slice(0, 7))) return null;
    const off = month(day.slice(0, 7)).byDate[day]?.off ?? [];
    return off.length ? { on: [], off: off.map((p) => p.id) } : null;
  };
}

/**
 * Everything `mountMonthApp` needs, or a named reason it cannot be had. `ready` is the caller's
 * proof that `data` belongs to `store` (the dashboard's `data.__storeId` matches the selected store):
 * without it nothing from `data` is shown, because a store switch would otherwise show the last store's people.
 */
export function editorProps({ store, data, isOff, timezone, now, ready } = {}) {
  try {
    if (!store || typeof store.id !== "string" || !ID.test(store.id)) return { ok: false, reason: "store" };
    if (ready === undefined ? data?.__storeId !== store.id : ready !== true) return { ok: false, reason: "not-ready" };
    // `now` is an instant or a function giving one, so the date is asked again on every use.
    const instant = typeof now === "function" ? now : () => now ?? new Date();
    if (zonedToday(timezone, instant()) === null) return { ok: false, reason: "timezone" };
    return {
      ok: true,
      stores: [editorStore(store, data, timezone)],
      assignmentForDay: assignmentResolver(data, { isOff }),
      today: () => {
        const day = zonedToday(timezone, instant());
        if (day === null) throw new EditorInputError("timezone", "today");
        return day;
      },
      index: 0,
    };
  } catch (e) {
    if (e instanceof EditorInputError) return { ok: false, reason: e.code };
    throw e;
  }
}
