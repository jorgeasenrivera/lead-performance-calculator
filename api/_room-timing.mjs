/**
 * When a room should open, worked out from what the caller hands in.
 * -------------------------------------------------------------------------
 * C114. A pure contract for "open the room one hour before the store opens,
 * in the store's own time zone", written so it can be tested without a clock,
 * a database or a network. Nothing here reads a clock, a store record, a
 * secret or a table; the room settings, the store's opening hours, the zone
 * and the moment all come in as arguments, and the answer is a plain object.
 *
 * What it can prove: for the inputs given, which rooms are on, which instant
 * a room opens, whether that instant has passed, and which day row would be
 * wanted. Two callers with the same inputs get the same answer, and callers
 * at different moments after the opening get the same row key and the same
 * opening instant, so asking twice cannot ask for two different rows.
 *
 * What it does not do, on purpose: create a row, check who is asking, deny a
 * disabled room to a request, remember a person's last tab, read or change
 * any setting, or pick a default for a store nobody configured. Those belong
 * to the endpoints and the screens, and they are future integration with
 * their own acceptance tests.
 *
 * Two things the live policy has not settled are inputs here, never choices:
 *
 *   offsetPolicy  "wall"     take 60 minutes off the opening time on the
 *                            store's clock face, then find that moment.
 *                 "elapsed"  find the opening moment, then take 60 real
 *                            minutes off it.
 *                 These differ only near a clock change. With no policy given
 *                 the answer is the shared one when they agree and
 *                 "unresolved" with both candidates when they do not.
 *   gapPolicy     a clock time that does not exist (spring forward).
 *                 "later"    the moment after the gap, with the offset that
 *                            was in force before it (02:30 becomes 03:30).
 *                 "earlier"  the moment before the gap, with the offset in
 *                            force after it (02:30 becomes 01:30).
 *   foldPolicy    a clock time that happens twice (fall back).
 *                 "first" or "second" occurrence.
 *
 * A missing gap or fold policy is "unresolved" with the candidates listed
 * when, and only when, the time in question is one of those times.
 *
 * Unlike the live room settings, a room the caller has not set to true is
 * off here. The live defaults (floor on, line off) are a separate decision
 * and are not repeated by this file. No store is named in this file; a store
 * with no entry in the supplied settings is simply unconfigured.
 */

export const ROOMS3 = ["floor", "line", "online"];
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STORE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MIN = 60000;
const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => new Date(ms).toISOString();

/* ---- which rooms a store has on ---- */

function storeOf(config, storeId) {
  const list = config && Array.isArray(config.stores) ? config.stores : [];
  return list.find((s) => s && s.id === storeId) || null;
}

/** { on, reason } for one room. Anything but a real true is off. */
export function roomEnabled(config, storeId, room) {
  if (!ROOMS3.includes(room)) return { on: false, reason: "room-unknown" };
  const st = storeOf(config, storeId);
  if (!st) return { on: false, reason: "store-unconfigured" };
  const set = st.rooms;
  if (!set || typeof set !== "object") return { on: false, reason: "rooms-unconfigured" };
  if (typeof set[room] !== "boolean") return { on: false, reason: "room-unconfigured" };
  return set[room] ? { on: true, reason: null } : { on: false, reason: "room-disabled" };
}

/** The rooms that are on, in the fixed order floor, line, online. */
export const enabledRooms = (config, storeId) => ROOMS3.filter((r) => roomEnabled(config, storeId, r).on);

/** The day row a room keeps for a store's day. Same shape the row addressing uses. */
export const rowKeyFor = (room, storeId, day) => (room === "online" ? `${storeId}:${day}:online` : `${storeId}:${day}`);

/* ---- the clock in a zone, from an instant ---- */

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

function validZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { formatter(tz); return true; } catch (e) { return false; }
}

function fields(ms, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${pad(o.hour === "24" ? 0 : +o.hour)}:${o.minute}` };
}

const wallMs = (day, hm) => {
  const m = DAY_RE.exec(day);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +hm.slice(0, 2), +hm.slice(3));
};

/* The zone's offset from UTC at an instant, in ms: the clock face read as if
   it were UTC, less the instant itself. */
function offsetAt(ms, tz) {
  const f = fields(ms, tz);
  return wallMs(f.day, f.hm) - Math.floor(ms / MIN) * MIN;
}

const dayShift = (day, n) => {
  const m = DAY_RE.exec(day);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/* The weekday of a calendar day is the same in every zone, so UTC noon is safe. */
const weekdayKey = (day) => {
  const m = DAY_RE.exec(day);
  return DAY_KEYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getUTCDay()];
};

/** A clock time moved by whole minutes on the clock face, rolling the day. */
function shiftWall(day, hm, deltaMin) {
  const total = +hm.slice(0, 2) * 60 + +hm.slice(3) + deltaMin;
  const days = Math.floor(total / 1440);
  const rest = total - days * 1440;
  return { day: dayShift(day, days), hm: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

/* ---- a clock time to instants: one, two (fold) or none (gap) ---- */

function wallInstants(day, hm, tz) {
  const w = wallMs(day, hm);
  const before = offsetAt(w - DAY_MS, tz);
  const after = offsetAt(w + DAY_MS, tz);
  const hits = [];
  for (const off of new Set([before, after])) {
    const c = w - off;
    const f = fields(c, tz);
    if (f.day === day && f.hm === hm && !hits.includes(c)) hits.push(c);
  }
  hits.sort((a, b) => a - b);
  if (hits.length === 1) return { kind: "unique", ms: hits[0] };
  if (hits.length === 2) return { kind: "fold", first: hits[0], second: hits[1] };
  return { kind: "gap", earlier: w - after, later: w - before };
}

function pickWall(day, hm, tz, gapPolicy, foldPolicy) {
  const r = wallInstants(day, hm, tz);
  if (r.kind === "unique") return { ok: true, ms: r.ms };
  if (r.kind === "fold") {
    if (foldPolicy === "first") return { ok: true, ms: r.first };
    if (foldPolicy === "second") return { ok: true, ms: r.second };
    return { ok: false, reason: "fold-policy-required", candidates: { first: iso(r.first), second: iso(r.second) } };
  }
  if (gapPolicy === "earlier") return { ok: true, ms: r.earlier };
  if (gapPolicy === "later") return { ok: true, ms: r.later };
  return { ok: false, reason: "gap-policy-required", candidates: { earlier: iso(r.earlier), later: iso(r.later) } };
}

/* ---- the opening instant for one day ---- */

/**
 * The instant a room opens for one store day: the store's opening time on
 * `day`, less `offsetMinutes` (60 unless told otherwise), in `tz`.
 *
 * { day, openingHm, tz, offsetMinutes?, offsetPolicy?, gapPolicy?, foldPolicy? }
 *   -> { ok: true, opensAtMs, opensAt, policyIndependent }
 *    | { ok: false, reason, candidates? }
 */
export function openingInstant(a) {
  const { day, openingHm, tz } = a || {};
  const offsetMinutes = a && a.offsetMinutes !== undefined ? a.offsetMinutes : 60;
  const { offsetPolicy, gapPolicy, foldPolicy } = a || {};
  if (typeof day !== "string" || !DAY_RE.test(day)) return { ok: false, reason: "invalid-day" };
  if (typeof openingHm !== "string" || !HHMM.test(openingHm)) return { ok: false, reason: "invalid-opening-time" };
  if (!validZone(tz)) return { ok: false, reason: "invalid-timezone" };
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 1440) return { ok: false, reason: "invalid-offset-minutes" };
  if (offsetPolicy !== undefined && offsetPolicy !== "wall" && offsetPolicy !== "elapsed") return { ok: false, reason: "invalid-offset-policy" };
  if (gapPolicy !== undefined && gapPolicy !== "earlier" && gapPolicy !== "later") return { ok: false, reason: "invalid-gap-policy" };
  if (foldPolicy !== undefined && foldPolicy !== "first" && foldPolicy !== "second") return { ok: false, reason: "invalid-fold-policy" };

  const elapsed = () => {
    const r = pickWall(day, openingHm, tz, gapPolicy, foldPolicy);
    return r.ok ? { ok: true, ms: r.ms - offsetMinutes * MIN } : r;
  };
  const wall = () => {
    const w = shiftWall(day, openingHm, -offsetMinutes);
    return pickWall(w.day, w.hm, tz, gapPolicy, foldPolicy);
  };
  const done = (ms, policyIndependent) => ({ ok: true, opensAtMs: ms, opensAt: iso(ms), policyIndependent });

  if (offsetPolicy === "elapsed") { const r = elapsed(); return r.ok ? done(r.ms, false) : r; }
  if (offsetPolicy === "wall") { const r = wall(); return r.ok ? done(r.ms, false) : r; }
  const e = elapsed(); if (!e.ok) return e;
  const w = wall(); if (!w.ok) return w;
  if (e.ms === w.ms) return done(e.ms, true);
  return { ok: false, reason: "offset-policy-required", candidates: { wall: iso(w.ms), elapsed: iso(e.ms) } };
}

/* ---- the decision for one day, against a moment ---- */

function scheduleFor(openingHours, closedDates, day) {
  if (Array.isArray(closedDates) && closedDates.includes(day)) return { kind: "closed", reason: "closed-date" };
  if (!openingHours || typeof openingHours !== "object") return { kind: "manual", reason: "schedule-missing" };
  const v = openingHours[weekdayKey(day)];
  if (v === "closed") return { kind: "closed", reason: "closed-day" };
  if (v === undefined || v === null || v === "") return { kind: "manual", reason: "hours-blank" };
  if (typeof v !== "string" || !HHMM.test(v)) return { kind: "manual", reason: "hours-invalid" };
  return { kind: "scheduled", openingHm: v };
}

function decideDay(c, day) {
  const base = { day, rowKey: rowKeyFor(c.room, c.storeId, day) };
  const s = scheduleFor(c.openingHours, c.closedDates, day);
  if (s.kind !== "scheduled") return { ...base, status: s.kind, reason: s.reason, plan: null };
  const o = openingInstant({ day, openingHm: s.openingHm, tz: c.tz, offsetMinutes: c.offsetMinutes,
    offsetPolicy: c.offsetPolicy, gapPolicy: c.gapPolicy, foldPolicy: c.foldPolicy });
  if (!o.ok) return { ...base, status: "unresolved", reason: o.reason, openingHm: s.openingHm, candidates: o.candidates || null, plan: null };
  const open = c.nowMs >= o.opensAtMs;
  return { ...base, status: open ? "open" : "pending", reason: null, openingHm: s.openingHm, opensAt: o.opensAt,
    policyIndependent: o.policyIndependent,
    plan: open ? { kind: "ensure-row", rowKey: base.rowKey, day, opensAt: o.opensAt } : null };
}

const unresolved = (reason, detail) => ({ status: "unresolved", reason, detail: detail || null, plan: null });

/**
 * decideRoomNow({ config, storeId, room, tz, now, openingHours, closedDates?,
 *                 offsetMinutes?, offsetPolicy?, gapPolicy?, foldPolicy? })
 *
 * `now` is a Date or epoch milliseconds, supplied by the caller. The answer is
 * for the store's own day at that moment, plus `early`: the next day's
 * decision when its opening (an opening just after midnight, less the hour)
 * has already arrived, otherwise null.
 *
 *   status "off"         the room is not on for this store (see `reason`)
 *          "manual"      no usable time for the day; the desk opens it
 *          "closed"      closed that day, or on a closed date; never opens
 *          "pending"     opens at `opensAt`, which has not come yet
 *          "open"        `opensAt` has come; `plan` is the row to ensure
 *          "unresolved"  an input is bad, or a policy the live system has not
 *                        decided is needed (see `reason`, `candidates`)
 *
 * `plan` is a description of what a caller would do, never something done.
 */
export function decideRoomNow(input) {
  const i = input || {};
  if (typeof i.storeId !== "string" || !STORE_RE.test(i.storeId)) return unresolved("invalid-store");
  if (!ROOMS3.includes(i.room)) return unresolved("invalid-room");
  if (!validZone(i.tz)) return unresolved("invalid-timezone");
  const nowMs = i.now instanceof Date ? i.now.getTime() : i.now;
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return unresolved("invalid-now");
  const on = roomEnabled(i.config, i.storeId, i.room);
  if (!on.on) return { status: "off", reason: on.reason, storeId: i.storeId, room: i.room, plan: null };

  const c = { ...i, nowMs };
  const today = fields(nowMs, i.tz).day;
  const here = decideDay(c, today);
  /* An opening that falls in the first hour of tomorrow is due before tomorrow
     starts. Looked at only for tomorrow, and only reported once it has come. */
  const next = decideDay(c, dayShift(today, 1));
  return { ...here, storeId: i.storeId, room: i.room, tz: i.tz, early: next.status === "open" ? next : null };
}
