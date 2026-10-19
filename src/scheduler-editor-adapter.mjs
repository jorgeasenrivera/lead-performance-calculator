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

const dayOf = (v) => (typeof v === "string" && validDate(v.slice(0, 10)) ? v.slice(0, 10) : null);

/**
 * Everyone on the roster with the dates they were employed, bound by id (first record of an id wins, as in
 * the calendar). The editor writes ids into its markup as they are, so an id that is not a plain token is
 * refused outright, not dropped: a person quietly missing from the roster would be worse than an editor
 * that says it cannot open.
 */
function rosterWithBounds(data) {
  const roster = Array.isArray(data?.roster) ? data.roster : [];
  const departed = Array.isArray(data?.departed) ? data.departed : [];
  const seen = new Set();
  const out = [];
  for (const p of roster) {
    if (!p || typeof p.id !== "string" || !p.id || !p.roleId || seen.has(p.id)) continue;
    if (!ID.test(p.id)) refuse("roster", "person id");
    seen.add(p.id);
    const name = typeof p.name === "string" && p.name ? p.name : "Unnamed";
    const rec = departed.find((d) => d && (d.id === p.id || (d.id == null && norm(d.name) === norm(name))));
    out.push({ person: { id: p.id, name, off: null, start: null, end: null, maxHours: null }, hired: dayOf(p.hiredAt), left: rec ? dayOf(rec.at) : null });
  }
  if (out.length > MAX_PEOPLE) refuse("roster", "too many people");
  return out;
}

/**
 * The planner's store for one real store. People are the whole roster, so a month the editor has not been
 * opened in can still be reached; each month's own people come from `monthPeople`. Availability and hours are
 * null: nothing the app holds says them. `teams` and `memberships` are given outright, even empty, so the
 * editor never seeds placeholder teams or people.
 */
export function editorStore(store, data, timezone) {
  if (!store || typeof store.id !== "string" || !ID.test(store.id)) refuse("store", "id");
  return {
    id: store.id,
    name: typeof store.name === "string" && store.name ? store.name : store.id,
    // The store's own zone: the planner reads it for shift times, and the clock uses the same one.
    ...(typeof timezone === "string" && timezone ? { timezone } : {}),
    people: rosterWithBounds(data).map((r) => r.person),
    rules: [],
    history: [],
    teams: [],
    memberships: [],
  };
}

/**
 * Who is on a month's roster: everyone employed on at least one day of it (both ends inclusive, as the app's
 * `servedOn`). Somebody who left before the month, or starts after it, would only be an unknown person on days
 * that are not theirs. Asked for any month the editor reaches, so opening in October and moving to November
 * gives the roster that opening in November would.
 */
export function monthPeople(data) {
  const bounds = rosterWithBounds(data);
  return (month) => {
    if (!validMonth(month)) return [];
    const days = monthDays(month);
    const first = days[0], last = days.at(-1);
    return bounds
      .filter((r) => !(r.left && r.left < first) && !(r.hired && r.hired > last))
      .map((r) => structuredClone(r.person));
  };
}

/**
 * The editor's `assignmentForDay(day, index)`: who is listed off on a day, by the app's own rule,
 * inside each person's employment (the calendar's `staffingMonth`). Who is working is not known, so
 * `on` is empty and the editor shows the day as needing a schedule. A day with nobody listed off is null.
 * Only people on that month's roster are named: an id the planner was not given would be a stranger to it.
 */
export function assignmentResolver(data, { isOff, peopleFor } = {}) {
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
    const known = typeof peopleFor === "function" ? new Set(peopleFor(day.slice(0, 7)).map((p) => p.id)) : null;
    const ids = (month(day.slice(0, 7)).byDate[day]?.off ?? []).map((p) => p.id).filter((id) => !known || known.has(id));
    return ids.length ? { on: [], off: ids } : null;
  };
}

const isEpoch = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Everything `mountMonthApp` needs, or a named reason it cannot be had.
 *
 * The records must be provably this store's and this sign-in's: `data.__storeId` is the store they were loaded
 * for, and `dataEpoch` is the principal epoch they were loaded under (taken from the same auth snapshot as
 * `principalEpoch`, the one the caller holds now). Missing or different, nothing from `data` is shown: a store
 * switch would otherwise show the last store's people, and a new sign-in the last person's.
 */
export function editorProps({ store, data, isOff, timezone, now, principalEpoch, dataEpoch } = {}) {
  try {
    if (!store || typeof store.id !== "string" || !ID.test(store.id)) return { ok: false, reason: "store" };
    if (data?.__storeId !== store.id) return { ok: false, reason: "not-ready" };
    if (!isEpoch(principalEpoch) || principalEpoch !== dataEpoch) return { ok: false, reason: "principal" };
    // `now` is an instant or a function giving one, so the date is asked again on every use.
    const instant = typeof now === "function" ? now : () => now ?? new Date();
    try { if (zonedToday(timezone, instant()) === null) return { ok: false, reason: "timezone" }; } catch { return { ok: false, reason: "timezone" }; }
    const stores = [editorStore(store, data, timezone)];
    const peopleFor = monthPeople(data);
    return {
      ok: true,
      stores,
      assignmentForDay: assignmentResolver(data, { isOff, peopleFor }),
      peopleForMonth: (index, month) => (index === 0 ? peopleFor(month) : []),
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
