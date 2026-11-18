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
   { ... } }, a time per weekday. Blank is the room's default, which is
   what every store has until somebody sets one: the desk for Phone Line, an
   hour before the store for Live Floor (below). Store time, which is Eastern
   everywhere this runs, and the reader says so. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The store's opening times, as { floor: {mon..sun}, line: {mon..sun} }, blanks as null.

    The store's own open and close ride along untouched when they are there.
    They share the `hours` key, and the rooms setup saves a room time by
    spreading this object back onto the store: built from the room times alone,
    that save erased the store's hours and put every hourly view back on its
    9 to 11:30 default. Carrying them here fixes the save without touching it. */
export function hoursOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === storeId);
  const set = (st && st.hours) || {};
  const out = {};
  for (const k of ["open", "close"]) if (typeof set[k] === "string") out[k] = set[k];
  for (const room of ROOMS) {
    out[room] = {};
    for (const d of DAY_KEYS) {
      const v = set[room] && set[room][d];
      out[room][d] = typeof v === "string" && HHMM.test(v) ? v : null;
    }
  }
  return out;
}

/* ---- Live Floor's own rule ----
   Jorge, 17 October (D5): Live Floor opens an hour before the store does.
   Jorge, 18 November (Q3): a store with no hours set is taken as a 9 AM store,
   so its floor opens at 8 until somebody sets its real hours. A time set for
   the weekday in the rooms setup still wins, which is how a store with a late
   Sunday says so.

   Floor only. Phone Line keeps its own times and the desk otherwise: the
   contract is explicit that the early hour is not to spread to it.

   The store's hours are the { open, close } pair on the store, set in the
   store's setup. They share the `hours` key with the per-room times above,
   which is why hoursOf reads only `floor` and `line` from it and this reads
   only `open`.

   Daylight saving asks nothing of this: every time here is a wall-clock
   "HH:MM" in Eastern, compared against the Eastern clock (localClock), so 8 AM
   is 8 AM in July and in December. */
export const ASSUMED_OPEN = "09:00";
export const FLOOR_LEAD_MIN = 60;

/** The store's own opening time, "HH:MM", or the 9 AM it is taken to be. */
export function storeOpenOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === storeId);
  const v = st && st.hours && st.hours.open;
  return typeof v === "string" && HHMM.test(v) ? v : ASSUMED_OPEN;
}

/** "HH:MM" this many minutes earlier, held at midnight rather than wrapping
    into the day before. */
export function minutesBefore(hhmm, min) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = Math.max(0, h * 60 + m - min);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** When Live Floor opens on its own if no weekday time is set: an hour before the store. */
export const floorDefaultOf = (config, storeId) => minutesBefore(storeOpenOf(config, storeId), FLOOR_LEAD_MIN);

/** "HH:MM" the room opens on the given day (YYYY-MM-DD), or null when the desk opens it. */
export function openAtFor(config, storeId, room, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m || !ROOMS.includes(room)) return null;
  /* The weekday of a calendar day is the same in every zone, so UTC noon is
     safe to ask. */
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getUTCDay();
  const set = hoursOf(config, storeId)[room][DAY_KEYS[dow]];
  if (set) return set;
  return room === "floor" ? floorDefaultOf(config, storeId) : null;
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
