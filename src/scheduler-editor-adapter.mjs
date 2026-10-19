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
import { monthDays, staffingMonth, validDate, validMonth } from "./scheduler-calendar-model.mjs";

export class EditorInputError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "EditorInputError";
    this.code = code;
  }
}
const refuse = (code, detail) => { throw new EditorInputError(code, detail); };

// The app's name match for departure records, as the calendar does it.
const norm = (v) => (typeof v === "string" ? v : "").trim().toLowerCase().replace(/\s+/g, " ");
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
 * Given the day the editor opens (`today`), someone who left before this month began, or who starts after
 * it ends, is left out: they could only ever show as an unknown person on days that are not theirs.
 * `teams` and `memberships` are given outright, even empty, so the editor never seeds placeholder
 * teams or people.
 */
export function editorStore(store, data, timezone, today) {
  if (!store || typeof store.id !== "string" || !ID.test(store.id)) refuse("store", "id");
  const roster = Array.isArray(data?.roster) ? data.roster : [];
  const seen = new Set();
  const people = [];
  const monthStart = validDate(today) ? `${today.slice(0, 7)}-01` : null;
  const monthEnd = monthStart ? monthDays(today.slice(0, 7)).at(-1) : null;
  const dayOf = (v) => (typeof v === "string" && validDate(v.slice(0, 10)) ? v.slice(0, 10) : null);
  const left = (p) => {
    const rec = (Array.isArray(data?.departed) ? data.departed : []).find((d) => d && (d.id === p.id || (d.id == null && typeof d.name === "string" && norm(d.name) === norm(p.name))));
    return rec ? dayOf(rec.at) : null;
  };
  for (const p of roster) {
    if (!p || typeof p.id !== "string" || !p.id || !p.roleId || seen.has(p.id)) continue;
    // The editor writes ids into its markup as they are, so an id that is not a plain token is refused outright,
    // not dropped: a person quietly missing from the roster would be worse than an editor that says it cannot open.
    if (!ID.test(p.id)) refuse("roster", "person id");
    seen.add(p.id);
    if (monthStart && ((left(p) && left(p) < monthStart) || (dayOf(p.hiredAt) && dayOf(p.hiredAt) > monthEnd))) continue;
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
export function assignmentResolver(data, { isOff, only } = {}) {
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
    // Only people the editor knows: an id it was not given would be a stranger to the planner.
    const ids = off.map((p) => p.id).filter((id) => !only || only.has(id));
    return ids.length ? { on: [], off: ids } : null;
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
    try { if (zonedToday(timezone, instant()) === null) return { ok: false, reason: "timezone" }; } catch { return { ok: false, reason: "timezone" }; }
    const stores = [editorStore(store, data, timezone, zonedToday(timezone, instant()))];
    return {
      ok: true,
      stores,
      assignmentForDay: assignmentResolver(data, { isOff, only: new Set(stores[0].people.map((p) => p.id)) }),
      today: () => {
        let day = null;
        try { day = zonedToday(timezone, instant()); } catch { /* an unreadable clock is no date */ }
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
