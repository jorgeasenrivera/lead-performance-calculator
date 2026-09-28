/**
 * Who may read and write a day's floor and phone-line rows (C92).
 * -------------------------------------------------------------------------
 * `floor_public` and `queue_public` have been open to anybody holding the
 * site's public key, which is in every copy of the page: read, insert and
 * update, any store, any day, and each row carries the day's sign-in token.
 * The QR code on the wall looked like the lock and was not one.
 *
 * Three kinds of visitor are let in once the tables close, and this file is
 * the whole of the rule for each. The endpoint (floor-row.mjs) only fetches
 * what these need and does what they say.
 *
 *   staff     signed in, and the store is theirs: an admin, the store on
 *             their profile, or their account linked to a person on that
 *             store's floor. The same three as `can_use_store` in
 *             supabase/pending/02-lock.sql, which is what lets signed-in
 *             phones keep reading and writing the tables directly.
 *   token     no account: holds one of today's codes from a QR on the wall.
 *             Today's rows at that store: the floor's and the lines'. Any of
 *             today's codes will do, because each proves the person is in
 *             that showroom today, and a salesperson's own screen reads both
 *             rooms. Never to make a row, or to change the code on one.
 *   wall      a TV showing the line and its QR code. Reads today's row for
 *             one store, with a key made for that store; writes nothing.
 *
 * Pure: no database, no clock of its own. Everything it decides on is passed in.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ROOMS = ["floor", "line", "online"];
export const TOKEN_HEADER = "x-sage-day-token";
export const WALL_HEADER = "x-sage-wall-key";
export const MAX_ROW_BYTES = 256 * 1024;      // the largest live row is 14 KB
export const MAX_TICKET_BYTES = 16 * 1024;
/* One copy, shared with the app, which files the same rows (see no-duplicates). */
export { TICKET_PREFIX } from "../src/row-access.mjs";

const STORE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The row a room keeps for a store's day, and the table it lives in. */
export function rowAddress(room, store, date) {
  if (!ROOMS.includes(room) || !STORE_RE.test(String(store || "")) || !DATE_RE.test(String(date || ""))) return null;
  if (room === "floor") return { table: "floor_public", id: `${store}:${date}`, dateCol: "fdate" };
  return { table: "queue_public", id: room === "line" ? `${store}:${date}` : `${store}:${date}:online`, dateCol: "qdate" };
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
 * decide({ op, room, store, date, today, via, row, data, expect, stamp })
 *   op    "read" | "write" | "ticket"
 *   via   { kind: "staff", allowed } | { kind: "token", ok } | { kind: "wall", ok } | null
 *         a token's `ok` is whether it matched any of today's rows at the store
 *   row   the row as it stands: { data, updated_at } or null when there is none
 *   data  for a write, the whole new row; for a ticket, the ticket
 * Returns { ok: true } or { ok: false, status, why }.
 */
export function decide({ op, room, store, date, today, via, row, data, expect }) {
  if (!["read", "write", "ticket"].includes(op)) return deny(400, "unknown op");
  if (op !== "ticket" && !rowAddress(room, store, date)) return deny(400, "which store, which day, which room");
  if (op === "ticket" && !STORE_RE.test(String(store || ""))) return deny(400, "which store");
  if (!via) return deny(401, "sign in, or scan today's code");

  if (via.kind === "staff") {
    if (!via.allowed) return deny(403, "not one of your stores");
  } else if (via.kind === "wall") {
    if (!via.ok) return deny(403, "that screen's key is not this store's");
    if (op !== "read") return deny(403, "a wall screen only reads");
    if (date !== today) return deny(403, "a wall screen shows today");
  } else if (via.kind === "token") {
    /* A code read off the wall at 9 in the morning opens today's rows at that
       store and nothing else, and stops opening them at midnight. */
    if (date !== today) return deny(403, "that code was for another day");
    if (!via.ok) return deny(403, "that code is not today's");
    if (op !== "ticket" && !row) return deny(404, "that room is not open today");
  } else return deny(401, "sign in, or scan today's code");

  if (op === "write") {
    if (!data || typeof data !== "object" || Array.isArray(data)) return deny(400, "a row is an object");
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_ROW_BYTES) return deny(413, "too large");
    if (via.kind === "token") {
      /* The room is the desk's to open and its code the desk's to set. */
      if (!row.data || data.token !== row.data.token) return deny(403, "the code cannot be changed from a phone");
    }
    if (expect && row && row.updated_at && expect !== row.updated_at) return deny(409, "the row moved; read it again");
  }
  if (op === "ticket") {
    if (!data || typeof data !== "object" || !data.id || !/^[A-Za-z0-9_-]{4,64}$/.test(String(data.id))) return deny(400, "a ticket needs an id");
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_TICKET_BYTES) return deny(413, "too large");
  }
  return { ok: true };
}

/* What a reader gets back. The desk's code travels to those who already
   hold it or show it on the wall; nothing else is trimmed, because the
   screens that read the row today read all of it. */
export function readable(row) {
  return row ? { row: row.data, stamp: row.updated_at || null } : { row: null, stamp: null };
}
