/**
 * The day's row, for a TV showing the line (C92).
 * -------------------------------------------------------------------------
 * `floor_public` and `queue_public` close to the public key once
 * supabase/pending/02-lock.sql is applied. Signed-in staff keep reading and
 * writing them directly. A TV has nobody signed in, so it reads through
 * /api/floor-row with the key in its link (Jorge chose this on 28 September).
 * With the QR sign-in retired (C99), it is the only screen that does.
 *
 * The TV says what it holds when it opens (rememberWallKey); the row helpers
 * in the app ask viaFor() before reading and take this road when it answers.
 * A screen that registered nothing, which is every signed-in screen, never
 * comes here.
 */

/* Tickets share queue_public; their ids start with this. */
export const TICKET_PREFIX = "ticket:";

const walls = new Map();   // store -> the TV's key

export function rememberWallKey(store, key) { if (store && key) walls.set(store, key); }

/* The rows the endpoint serves, by the table and id the app already uses:
   floor_public "store:date", queue_public "store:date" and "store:date:online". */
export function addressOf(table, id) {
  const m = /^([^:]+):(\d{4}-\d{2}-\d{2})(?::(online))?$/.exec(String(id || ""));
  if (!m) return null;
  if (table === "floor_public" && !m[3]) return { room: "floor", store: m[1], date: m[2] };
  if (table === "queue_public") return { room: m[3] ? "online" : "line", store: m[1], date: m[2] };
  return null;
}

/* What this screen holds for that row, or null for "use the table directly". */
export function viaFor(table, id) {
  const a = addressOf(table, id);
  if (!a) return null;
  const key = walls.get(a.store);
  return key ? { ...a, headers: { "x-sage-wall-key": key } } : null;
}

/** { same: true, stamp } when `stamp` is current, else { row, stamp }. Throws when refused. */
export async function readVia(via, stamp, fetchImpl) {
  const r = await (fetchImpl || fetch)("/api/floor-row", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...via.headers },
    body: JSON.stringify({ op: "read", room: via.room, store: via.store, date: via.date, ...(stamp ? { stamp } : {}) }),
  });
  let out = null;
  try { out = await r.json(); } catch (e) { out = null; }
  if (!r.ok) {
    const e = new Error((out && out.error) || `floor-row ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return out || {};
}

/* The public topic 01-doorbell.sql rings on every write to a row. */
export const doorbellTopic = (table, id) => `row:${table}:${id}`;
