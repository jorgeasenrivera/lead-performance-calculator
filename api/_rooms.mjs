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
