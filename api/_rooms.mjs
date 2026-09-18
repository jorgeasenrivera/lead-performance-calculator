/**
 * Which rooms a store gives its people.
 * -------------------------------------------------------------------------
 * Two rooms exist for a salesperson's phone — the floor and the phone line —
 * and almost no store runs both. A store with no phone up system should not
 * hand its people a tab for one, and a store that runs its BDC off the phones
 * and never uses a floor rotation should not be made to look at an empty
 * showroom.
 *
 * So it is a per-store setting rather than a build-time truth, with defaults
 * chosen so that turning this on changes nothing for anybody:
 *
 *   floor   on. It is where a linked salesperson already lands, and switching
 *           it off by default would take away the app they have today.
 *   line    off. Most stores run no phone up system at all, and a tab into a
 *           line nobody uses is worse than no tab.
 *
 * A store that wants the phone line on its people's phones turns it on, which
 * is one switch and the honest way round: the store that has the feature is
 * the store that asks for it.
 */

export const ROOMS = ["floor", "line"];

const DEFAULTS = { floor: true, line: false };

/** What this store gives its people, as a plain object of booleans. */
export function roomsOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === storeId);
  const set = (st && st.rooms) || null;
  const out = { ...DEFAULTS };
  for (const k of ROOMS) if (set && typeof set[k] === "boolean") out[k] = set[k];
  return out;
}

/** The rooms this store gives, in the order they are shown. */
export const roomListOf = (config, storeId) => {
  const r = roomsOf(config, storeId);
  return ROOMS.filter((k) => r[k]);
};

/**
 * Which room to open, given what the store offers and what this person last
 * looked at.
 *
 * A store can turn a room off while somebody is standing in it, and the
 * remembered choice then points nowhere. Falling back to the first room the
 * store does offer is better than a blank screen, and better than sending them
 * to a room the store just said it does not have.
 *
 * Null when a store offers nothing at all, which is a real state — somebody
 * has switched both off — and the caller says so rather than drawing an empty
 * shell.
 */
export function openRoom(config, storeId, remembered) {
  const list = roomListOf(config, storeId);
  if (!list.length) return null;
  return list.includes(remembered) ? remembered : list[0];
}

/* ---- when a room opens on its own ----
   A day's row is what makes a room "open": the desk used to create it, at the
   wall, whenever a manager got to it, and a floor whose manager was late was a
   floor that said "not open" to everybody on it. Jorge, 18 September: open it
   at a set time instead, per weekday, because the floors open at different
   times on different days.

   The times live on the store: hours: { floor: { mon: "09:00", ... }, line:
   { ... } }, a time per weekday, blank for "the desk opens it", which is what
   every store has until somebody sets one. Store time, which is Eastern
   everywhere this runs, and the reader says so. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The store's opening times, as { floor: {mon..sun}, line: {mon..sun} }, blanks as null. */
export function hoursOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === storeId);
  const set = (st && st.hours) || {};
  const out = {};
  for (const room of ROOMS) {
    out[room] = {};
    for (const d of DAY_KEYS) {
      const v = set[room] && set[room][d];
      out[room][d] = typeof v === "string" && HHMM.test(v) ? v : null;
    }
  }
  return out;
}

/** "HH:MM" the room opens on the given day (YYYY-MM-DD), or null when the desk opens it. */
export function openAtFor(config, storeId, room, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m || !ROOMS.includes(room)) return null;
  /* The weekday of a calendar day is the same in every zone, so UTC noon is
     safe to ask. */
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getUTCDay();
  return hoursOf(config, storeId)[room][DAY_KEYS[dow]];
}

/** The clock in a zone: { day: "YYYY-MM-DD", hm: "HH:MM" }. */
export function localClock(at = new Date(), tz = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(at).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

/** Whether a room set to open at `at` has opened by the clock `hm`, both "HH:MM". */
export const openedBy = (at, hm) => !!at && !!hm && hm >= at;

/** "09:00" as people say it: "9:00 AM". */
export function clockLabel(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
