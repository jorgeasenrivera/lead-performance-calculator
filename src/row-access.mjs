/**
 * The day's rows, for the screens that have no account (C92).
 * -------------------------------------------------------------------------
 * `floor_public` and `queue_public` close to the public key once
 * supabase/pending/02-lock.sql is applied. Signed-in staff keep reading and
 * writing them directly. A phone that scanned today's QR code, a phone at a
 * table tag, and a TV go through /api/floor-row instead, carrying today's code
 * or the TV's key.
 *
 * Those screens say what they hold when they open (rememberDayCode,
 * rememberWallKey); the row helpers in the app ask viaFor() before every read
 * and write and take this road when it answers. A screen that registered
 * nothing, which is every signed-in screen, never comes here.
 */

/* Tickets share queue_public; their ids start with this. The server's
   api/_floor-access.mjs takes it from here, so there is one copy. */
export const TICKET_PREFIX = "ticket:";

const codes = new Map();   // `${store}|${date}` -> today's code
const walls = new Map();   // store -> the TV's key
const CODE_KEY = (store) => `lpc:day-code:${store}`;

/* The code is kept on the phone too, for one reason: a table tag carries no
   code of its own, and the phone at the table has to be the phone that
   scanned today. One per store, so yesterday's is simply replaced. */
export function rememberDayCode(store, date, token) {
  if (!store || !date || !token) return;
  codes.set(`${store}|${date}`, token);
  try { localStorage.setItem(CODE_KEY(store), `${date}|${token}`); } catch (e) {}
}
export function storedDayCode(store, date) {
  try {
    const v = localStorage.getItem(CODE_KEY(store)) || "";
    const i = v.indexOf("|");
    return i > 0 && v.slice(0, i) === date ? v.slice(i + 1) : null;
  } catch (e) { return null; }
}
export function dayCodeFor(store, date) { return codes.get(`${store}|${date}`) || null; }
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
  const code = codes.get(`${a.store}|${a.date}`);
  if (code) return { ...a, headers: { "x-sage-day-token": code } };
  const key = walls.get(a.store);
  if (key) return { ...a, headers: { "x-sage-wall-key": key } };
  return null;
}

async function call(headers, body, fetchImpl) {
  const r = await (fetchImpl || fetch)("/api/floor-row", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
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

/** { same: true, stamp } when `stamp` is current, else { row, stamp }. Throws when refused. */
export function readVia(via, stamp, fetchImpl) {
  return call(via.headers, { op: "read", room: via.room, store: via.store, date: via.date, ...(stamp ? { stamp } : {}) }, fetchImpl);
}
/** Replaces the row, as the pages' own writes do. Throws when refused. */
export function writeVia(via, data, fetchImpl) {
  return call(via.headers, { op: "write", room: via.room, store: via.store, date: via.date, data }, fetchImpl);
}
/** Files a ticket with today's code for that store; false when there is none or it is refused. */
export async function ticketVia(store, date, ticket, fetchImpl) {
  const code = codes.get(`${store}|${date}`);
  if (!code) return false;
  try { await call({ "x-sage-day-token": code }, { op: "ticket", store, data: ticket }, fetchImpl); return true; }
  catch (e) { return false; }
}
/* The public topic 01-doorbell.sql rings on every write to a row. */
export const doorbellTopic = (table, id) => `row:${table}:${id}`;
