/**
 * When a room should open, worked out from what the caller hands in.
 * -------------------------------------------------------------------------
 * C114. A pure contract for "open the room one hour before the store opens,
 * in the store's own time zone", written so it can be tested without a clock,
 * a database or a network. Nothing here reads a clock, a store record, a
 * secret or a table; the room settings, the store's opening hours, the zone
 * and the moment all come in as arguments, and the answer is a plain object.
 * No public function throws: a bad input is a named result.
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
 *                 "unresolved" when they do not, with both branches shown.
 *   gapPolicy     a clock time that does not exist (spring forward).
 *                 "later"    the moment after the gap, with the offset that
 *                            was in force before it (02:30 becomes 03:30).
 *                 "earlier"  the moment before the gap, with the offset in
 *                            force after it (02:30 becomes 01:30).
 *   foldPolicy    a clock time that happens twice (fall back).
 *                 "first" or "second" occurrence.
 *
 * A missing gap or fold policy is "unresolved" when, and only when, the time
 * in question is one of those times.
 *
 * Candidates. Every unresolved result that lists `candidates` lists the
 * instants the ROOM would open at, which is what `opensAt` would be if that
 * choice were made (`candidatesFor` says so). Under "elapsed" the clock time
 * that is ambiguous is the store's opening time, so each candidate is that
 * moment less the offset; under "wall" it is the clock time an hour earlier,
 * so each candidate is already a room-opening instant. With no offset policy
 * `branches` carries both, each in its own terms: { ok: true, opensAt } or
 * { ok: false, reason, candidates }.
 *
 * Supported range. Days from 1000-01-01 to 9999-12-31 on the Gregorian
 * calendar, written exactly YYYY-MM-DD with four digits. What a day string
 * gets back:
 *   - not in that shape (10000-01-01, 2026-2-3, a non-string), or not on the
 *     calendar (30 February, month 13, a 29 February in a year that has
 *     none): "invalid-day";
 *   - a real four-digit day in years 0000 to 0999: "day-out-of-range". Those
 *     years are unsupported, never read as 1900 to 1999.
 * Days worked out rather than supplied are handled where they arise: an
 * opening whose hour falls on a day outside the range (1000-01-01 at 00:30
 * less an hour) is "day-out-of-range" under every policy, and a next day past
 * 9999-12-31 is `earlyReason: "day-out-of-range"` on a decision. A moment is
 * accepted only when it is a real Date instant and the store's own day at that
 * moment is in range.
 *
 * Range checks happen before a result is exposed, once, in the same place for
 * an explicit policy and for each branch shown when none is given. The
 * candidates of an unresolved result are not range-checked: a candidate within
 * one offset of year 1000 or 9999 could be listed and then resolve to
 * "day-out-of-range" when chosen. No real zone has a clock change there (418
 * zones scanned, none within three days of either end), so it has not been
 * reproduced, and it is left as a known limit.
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
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;
const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => new Date(ms).toISOString();

/* ---- the calendar, kept as numbers and written out only at the edge ---- */

/* The instant of a clock face read as UTC. Built with setUTCFullYear so the
   years 0 to 99 are what they say and not 1900 to 1999. */
function epoch(y, m, d, h = 0, mi = 0, s = 0) {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t.getTime();
}

const MIN_INSTANT = epoch(MIN_YEAR, 1, 1);
const MAX_INSTANT = epoch(MAX_YEAR + 1, 1, 1) - 1;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => (m === 2 ? (isLeap(y) ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);

/** "YYYY-MM-DD" to { ok: true, y, m, d }, or { ok: false, reason }. */
function checkDay(s) {
  const m = typeof s === "string" ? DAY_RE.exec(s) : null;
  if (!m) return { ok: false, reason: "invalid-day" };
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { ok: false, reason: "invalid-day" };
  if (y < MIN_YEAR || y > MAX_YEAR) return { ok: false, reason: "day-out-of-range" };
  return { ok: true, y, m: mo, d };
}

const inRange = (day) => day.y >= MIN_YEAR && day.y <= MAX_YEAR;
const dayStr = (day) => `${String(day.y).padStart(4, "0")}-${pad(day.m)}-${pad(day.d)}`;

function dayShift(day, n) {
  const t = new Date(0);
  t.setUTCFullYear(day.y, day.m - 1, day.d + n);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/* The weekday of a calendar day is the same in every zone, so UTC noon is safe. */
const weekdayKey = (day) => DAY_KEYS[new Date(epoch(day.y, day.m, day.d, 12)).getUTCDay()];

/** A clock time moved by whole minutes on the clock face, rolling the day. */
function shiftWall(day, hm, deltaMin) {
  const total = +hm.slice(0, 2) * 60 + +hm.slice(3) + deltaMin;
  const days = Math.floor(total / 1440);
  const rest = total - days * 1440;
  return { day: dayShift(day, days), hm: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

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

/** The day row a room keeps for a store's day, or null when any part is not valid. */
export function rowKeyFor(room, storeId, day) {
  if (!ROOMS3.includes(room) || typeof storeId !== "string" || !STORE_RE.test(storeId) || !checkDay(day).ok) return null;
  return room === "online" ? `${storeId}:${day}:online` : `${storeId}:${day}`;
}

/* ---- the clock in a zone, from an instant ---- */

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

function validZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { formatter(tz); return true; } catch (e) { return false; }
}

/* Only called for instants that are real Date values. The year is read as a
   number, so a year of five digits at the very end of the range is a number
   and not a failed match. */
function fields(ms, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: o.hour === "24" ? 0 : +o.hour, mi: +o.minute, s: +o.second };
}

/* The zone's offset from UTC at an instant, in ms: the clock face read as if
   it were UTC, less the instant itself. Seconds are kept because some zones
   before the 1900s ran on local mean time with a whole number of seconds. */
function offsetAt(ms, tz) {
  const f = fields(ms, tz);
  return epoch(f.y, f.m, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

/* Whether an instant is inside the supported moments and the zone's day at
   that moment is a supported day. */
function momentInRange(ms, tz) {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= MIN_INSTANT && ms <= MAX_INSTANT && inRange(fields(ms, tz));
}

/* ---- a clock time to instants: one, two (fold) or none (gap) ---- */

function wallInstants(day, hm, tz) {
  const h = +hm.slice(0, 2), mi = +hm.slice(3);
  const w = epoch(day.y, day.m, day.d, h, mi);
  const before = offsetAt(w - DAY_MS, tz);
  const after = offsetAt(w + DAY_MS, tz);
  const hits = [];
  for (const off of new Set([before, after])) {
    const c = w - off;
    const f = fields(c, tz);
    if (f.y === day.y && f.m === day.m && f.d === day.d && f.h === h && f.mi === mi && f.s === 0 && !hits.includes(c)) hits.push(c);
  }
  hits.sort((a, b) => a - b);
  if (hits.length === 1) return { kind: "unique", ms: hits[0] };
  if (hits.length === 2) return { kind: "fold", first: hits[0], second: hits[1] };
  return { kind: "gap", earlier: w - after, later: w - before };
}

/* One clock time to one instant under the gap and fold policies. `shift` is
   taken off every instant it reports, so the candidates of an unresolved time
   are the same instants the corresponding choices would resolve to. */
function pickWall(day, hm, tz, gapPolicy, foldPolicy, shift = 0) {
  const r = wallInstants(day, hm, tz);
  if (r.kind === "unique") return { ok: true, ms: r.ms - shift };
  if (r.kind === "fold") {
    if (foldPolicy === "first") return { ok: true, ms: r.first - shift };
    if (foldPolicy === "second") return { ok: true, ms: r.second - shift };
    return { ok: false, reason: "fold-policy-required", candidates: { first: iso(r.first - shift), second: iso(r.second - shift) } };
  }
  if (gapPolicy === "earlier") return { ok: true, ms: r.earlier - shift };
  if (gapPolicy === "later") return { ok: true, ms: r.later - shift };
  return { ok: false, reason: "gap-policy-required", candidates: { earlier: iso(r.earlier - shift), later: iso(r.later - shift) } };
}

/* ---- the opening instant for one day ---- */

const branchOf = (r) => (r.ok ? { ok: true, opensAt: iso(r.ms) } : r.candidates ? { ok: false, reason: r.reason, candidates: r.candidates } : { ok: false, reason: r.reason });

/**
 * The instant a room opens for one store day: the store's opening time on
 * `day`, less `offsetMinutes` (60 unless told otherwise), in `tz`.
 *
 * { day, openingHm, tz, offsetMinutes?, offsetPolicy?, gapPolicy?, foldPolicy? }
 *   -> { ok: true, opensAtMs, opensAt, policyIndependent }
 *    | { ok: false, reason, candidates?, candidatesFor?, branches? }
 */
export function openingInstant(a) {
  const { day, openingHm, tz } = a || {};
  const offsetMinutes = a && a.offsetMinutes !== undefined ? a.offsetMinutes : 60;
  const { offsetPolicy, gapPolicy, foldPolicy } = a || {};
  /* The day first, before the time or the zone: a day that is not on the
     calendar has to be named as such, whatever else is wrong. */
  const dd = checkDay(day);
  if (!dd.ok) return { ok: false, reason: dd.reason };
  if (typeof openingHm !== "string" || !HHMM.test(openingHm)) return { ok: false, reason: "invalid-opening-time" };
  if (!validZone(tz)) return { ok: false, reason: "invalid-timezone" };
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 1440) return { ok: false, reason: "invalid-offset-minutes" };
  if (offsetPolicy !== undefined && offsetPolicy !== "wall" && offsetPolicy !== "elapsed") return { ok: false, reason: "invalid-offset-policy" };
  if (gapPolicy !== undefined && gapPolicy !== "earlier" && gapPolicy !== "later") return { ok: false, reason: "invalid-gap-policy" };
  if (foldPolicy !== undefined && foldPolicy !== "first" && foldPolicy !== "second") return { ok: false, reason: "invalid-fold-policy" };

  /* One place decides whether a resolved instant is usable. Both branches go
     through it before they are used for anything, an explicit policy's answer
     and a branch shown beside the other one alike, so a branch can never say
     ok for an instant the same policy chosen explicitly would refuse. */
  const settle = (r) => (r.ok && !momentInRange(r.ms, tz) ? { ok: false, reason: "day-out-of-range" } : r);
  const elapsed = () => settle(pickWall(dd, openingHm, tz, gapPolicy, foldPolicy, offsetMinutes * MIN));
  const wall = () => {
    const w = shiftWall(dd, openingHm, -offsetMinutes);
    if (!inRange(w.day)) return { ok: false, reason: "day-out-of-range" };
    return settle(pickWall(w.day, w.hm, tz, gapPolicy, foldPolicy));
  };
  const done = (r, policyIndependent) => ({ ok: true, opensAtMs: r.ms, opensAt: iso(r.ms), policyIndependent });
  const stop = (r) => (r.candidates ? { ok: false, reason: r.reason, candidates: r.candidates, candidatesFor: "room-opening" } : { ok: false, reason: r.reason });

  if (offsetPolicy === "elapsed") { const r = elapsed(); return r.ok ? done(r, false) : stop(r); }
  if (offsetPolicy === "wall") { const r = wall(); return r.ok ? done(r, false) : stop(r); }

  /* No offset policy: work out both and keep both. */
  const e = elapsed(), w = wall();
  const branches = { wall: branchOf(w), elapsed: branchOf(e) };
  if (!e.ok || !w.ok) return { ...stop(e.ok ? w : e), branches };
  if (e.ms === w.ms) return done(e, true);
  return { ok: false, reason: "offset-policy-required", candidates: { wall: iso(w.ms), elapsed: iso(e.ms) }, candidatesFor: "room-opening", branches };
}

/* ---- the decision for one day, against a moment ---- */

function scheduleFor(openingHours, closedDates, day) {
  if (Array.isArray(closedDates) && closedDates.includes(dayStr(day))) return { kind: "closed", reason: "closed-date" };
  if (!openingHours || typeof openingHours !== "object") return { kind: "manual", reason: "schedule-missing" };
  const v = openingHours[weekdayKey(day)];
  if (v === "closed") return { kind: "closed", reason: "closed-day" };
  if (v === undefined || v === null || v === "") return { kind: "manual", reason: "hours-blank" };
  if (typeof v !== "string" || !HHMM.test(v)) return { kind: "manual", reason: "hours-invalid" };
  return { kind: "scheduled", openingHm: v };
}

function decideDay(c, day) {
  const text = dayStr(day);
  const base = { day: text, rowKey: rowKeyFor(c.room, c.storeId, text) };
  const s = scheduleFor(c.openingHours, c.closedDates, day);
  if (s.kind !== "scheduled") return { ...base, status: s.kind, reason: s.reason, plan: null };
  const o = openingInstant({ day: text, openingHm: s.openingHm, tz: c.tz, offsetMinutes: c.offsetMinutes,
    offsetPolicy: c.offsetPolicy, gapPolicy: c.gapPolicy, foldPolicy: c.foldPolicy });
  if (!o.ok) return { ...base, status: "unresolved", reason: o.reason, openingHm: s.openingHm, candidates: o.candidates || null,
    candidatesFor: o.candidatesFor || null, branches: o.branches || null, plan: null };
  const open = c.nowMs >= o.opensAtMs;
  return { ...base, status: open ? "open" : "pending", reason: null, openingHm: s.openingHm, opensAt: o.opensAt,
    policyIndependent: o.policyIndependent,
    plan: open ? { kind: "ensure-row", rowKey: base.rowKey, day: text, opensAt: o.opensAt } : null };
}

const unresolved = (reason) => ({ status: "unresolved", reason, plan: null });

/**
 * decideRoomNow({ config, storeId, room, tz, now, openingHours, closedDates?,
 *                 offsetMinutes?, offsetPolicy?, gapPolicy?, foldPolicy? })
 *
 * `now` is a Date or epoch milliseconds, supplied by the caller. The answer is
 * for the store's own day at that moment, plus `early`: the next day's
 * decision when its opening (an opening just after midnight, less the hour)
 * has already arrived, otherwise null. When there is no next day in the
 * supported range, `early` is null and `earlyReason` says "day-out-of-range".
 *
 *   status "off"         the room is not on for this store (see `reason`)
 *          "manual"      no usable time for the day; the desk opens it
 *          "closed"      closed that day, or on a closed date; never opens
 *          "pending"     opens at `opensAt`, which has not come yet
 *          "open"        `opensAt` has come; `plan` is the row to ensure
 *          "unresolved"  an input is bad, or a policy the live system has not
 *                        decided is needed (see `reason`, `candidates`,
 *                        `branches`)
 *
 * `plan` is a description of what a caller would do, never something done.
 */
export function decideRoomNow(input) {
  const i = input || {};
  if (typeof i.storeId !== "string" || !STORE_RE.test(i.storeId)) return unresolved("invalid-store");
  if (!ROOMS3.includes(i.room)) return unresolved("invalid-room");
  if (!validZone(i.tz)) return unresolved("invalid-timezone");
  const nowMs = i.now instanceof Date ? i.now.getTime() : i.now;
  if (!momentInRange(nowMs, i.tz)) return unresolved("invalid-now");
  const on = roomEnabled(i.config, i.storeId, i.room);
  if (!on.on) return { status: "off", reason: on.reason, storeId: i.storeId, room: i.room, plan: null };

  const c = { ...i, nowMs };
  const f = fields(nowMs, i.tz);
  const today = { y: f.y, m: f.m, d: f.d };
  const here = decideDay(c, today);
  /* An opening that falls in the first hour of tomorrow is due before tomorrow
     starts. Looked at only for tomorrow, and only reported once it has come. */
  const tomorrow = dayShift(today, 1);
  if (!inRange(tomorrow)) return { ...here, storeId: i.storeId, room: i.room, tz: i.tz, early: null, earlyReason: "day-out-of-range" };
  const next = decideDay(c, tomorrow);
  return { ...here, storeId: i.storeId, room: i.room, tz: i.tz, early: next.status === "open" ? next : null, earlyReason: null };
}
