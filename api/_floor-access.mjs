/**
 * Who may read a day's floor and phone-line rows through the server (C92).
 * -------------------------------------------------------------------------
 * `floor_public` and `queue_public` have been open to anybody holding the
 * site's public key, which is in every copy of the page: read, insert and
 * update, any store, any day. supabase/pending/02-lock.sql closes them to
 * everyone who is not signed in; signed-in staff keep using them directly,
 * for their own stores.
 *
 * With the QR sign-in retired (C99, Jorge, 28 September) the one screen left
 * with nobody signed in is the TV showing the line. This file is the whole of
 * the rule for the two kinds of visitor the endpoint serves:
 *
 *   wall      a TV: reads today's row for one store, with a key made for that
 *             store (an HMAC under WALL_KEY_SECRET). Writes nothing.
 *   staff     signed in, and the store is theirs: an admin, the store on an
 *             approved profile, or their account linked to a person on that
 *             store's floor. The same three as `can_use_store` in the lock.
 *             Staff ask here for a TV's key, to put in its link.
 *
 * Pure: no database, no clock of its own. Everything it decides on is passed in.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ROOMS = ["floor", "line", "online"];
export const WALL_HEADER = "x-sage-wall-key";

const STORE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The row a room keeps for a store's day, and the table it lives in. */
export function rowAddress(room, store, date) {
  if (!ROOMS.includes(room) || !STORE_RE.test(String(store || "")) || !DATE_RE.test(String(date || ""))) return null;
  if (room === "floor") return { table: "floor_public", id: `${store}:${date}` };
  return { table: "queue_public", id: room === "line" ? `${store}:${date}` : `${store}:${date}:online` };
}

/** The store's own day, in the store's timezone, not the server's. */
export function storeDay(at = new Date(), tz = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
}

/* Staff: the same three ways in as can_use_store(). An inactive profile is
   out whatever else is true; a pending one gets in only through a link a
   manager made, which is how an associate's account reaches the floor. */
export function staffMayUse({ profile, linkedStores = [] } = {}, store) {
  if (!profile || profile.active === false) return false;
  if (profile.role === "admin") return true;
  if (!profile.pending && Array.isArray(profile.stores) && profile.stores.includes(store)) return true;
  return linkedStores.includes(store);
}

/* A TV's key: made from a server secret and the store, so one store's key
   opens nothing at another, and nothing has to be stored to check it. */
export function wallKey(store, secret) {
  if (!secret || String(secret).length < 32 || !STORE_RE.test(String(store || ""))) return "";
  return createHmac("sha256", secret).update(`wall:${store}`).digest("base64url").slice(0, 32);
}

export function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

const deny = (status, why) => ({ ok: false, status, why });

/**
 * decide({ op, room, store, date, today, via })
 *   op    "read" | "wallkey"
 *   via   { kind: "wall", ok } | { kind: "staff", allowed } | null
 * Returns { ok: true } or { ok: false, status, why }.
 */
export function decide({ op, room, store, date, today, via }) {
  if (op === "wallkey") {
    if (!STORE_RE.test(String(store || ""))) return deny(400, "which store");
    if (!via || via.kind !== "staff") return deny(401, "sign in first");
    return via.allowed ? { ok: true } : deny(403, "not one of your stores");
  }
  if (op !== "read") return deny(400, "unknown op");
  if (!rowAddress(room, store, date)) return deny(400, "which store, which day, which room");
  if (!via) return deny(401, "sign in, or use the TV's link");
  if (via.kind === "staff") return via.allowed ? { ok: true } : deny(403, "not one of your stores");
  if (via.kind === "wall") {
    if (!via.ok) return deny(403, "that screen's key is not this store's");
    if (date !== today) return deny(403, "a wall screen shows today");
    return { ok: true };
  }
  return deny(401, "sign in, or use the TV's link");
}

export function readable(row) {
  return row ? { row: row.data, stamp: row.updated_at || null } : { row: null, stamp: null };
}
