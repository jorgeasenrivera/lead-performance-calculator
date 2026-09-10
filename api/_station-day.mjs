/**
 * Whether any of this worked.
 * -------------------------------------------------------------------------
 * Phase six, and the only one whose whole purpose is to answer a question
 * rather than to make something possible. Every phase before it wrote a record
 * that nothing read: the sits from phase one, the presence from phase two, the
 * hourly snapshots from phase five. This is what they were for.
 *
 * The same records answer two different questions depending on which way you
 * group them.
 *
 *   by person    attribution. Marisol was in from ten to twelve and picked up
 *                six. Whether sitting there produced anything.
 *   by station   occupancy. Station 3 was covered nine to eleven and empty
 *                until two. Whether the seats are staffed at the hours the
 *                phone actually rings.
 *
 * The second is the one that says whether the process change was worth making.
 * A room where every chair is full of the wrong people at the wrong times is a
 * different problem from a room nobody sits in, and the two look identical in
 * any figure that does not have the clock in it.
 *
 * ---- what this cannot say ----
 * Attribution is hour-granular because the Delivery Summary carries counts and
 * not timestamps, and the rule for a partial hour was settled in _hours.mjs:
 * an hour counts for the window that covered MOST of it. So a sit gets whole
 * hours or none, and two people who shared an hour cannot be told apart inside
 * it. That is a real limit and the screens say so rather than implying a
 * precision the report never had.
 *
 * Occupancy has no such limit — the sits are minute-granular — so it is
 * measured as a fraction of each hour rather than as a yes or no. Fifteen
 * minutes of cover is not the same as an hour of it and should not draw the
 * same.
 */

import { betweenHours, hourStart } from "./_hours.mjs";
import { seatsOf, sitMinutes } from "./_stations.mjs";

const HOUR = 3600000;

/** The hour labels a day is drawn across, from the store's open to its close.
    Widened to hold anything that actually happened outside them, because a sit
    at eight in the morning is a fact whatever the sign on the door says. */
export function dayHours(row, { open = "09:00", close = "20:00" } = {}) {
  let lo = Number(String(open).slice(0, 2));
  let hi = Number(String(close).slice(0, 2));
  if (!Number.isFinite(lo)) lo = 9;
  if (!Number.isFinite(hi)) hi = 20;
  for (const sit of (row && row.sits) || []) {
    if (!sit || !sit.in) continue;
    const a = Number(hourIn2(sit.in, row));
    const b = Number(hourIn2(sit.out || sit.in, row));
    if (Number.isFinite(a)) lo = Math.min(lo, a);
    if (Number.isFinite(b)) hi = Math.max(hi, b + 1);
  }
  hi = Math.min(24, Math.max(hi, lo + 1));
  const out = [];
  for (let h = lo; h < hi; h++) out.push(String(h).padStart(2, "0"));
  return out;
}

/* Which store hour an instant falls in, found by walking back from the day's
   own anchor rather than reading a clock in the server's zone. */
function hourIn2(iso, row) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return NaN;
  for (let h = 0; h < 24; h++) {
    const s = hourStart(t, h);
    if (t >= s && t < s + HOUR) return h;
  }
  return NaN;
}

/**
 * One sit, with what arrived while it was running.
 *
 * `nameKey` is the normalised full name the hourly buckets are keyed by; the
 * sits are keyed by person id, and the two lists are joined here rather than
 * in three screens that would each do it slightly differently.
 */
export function sitFigures(sit, hours, nameKey, now = Date.now()) {
  const min = sitMinutes(sit, now);
  const got = (hours && nameKey)
    ? betweenHours(hours, nameKey, sit.in, sit.out || new Date(now).toISOString())
    : { op: 0, ca: 0, ct: 0, ap: 0, hours: 0 };
  return { ...sit, min, ...got };
}

/**
 * One person's day: every sit with its figures, and the totals underneath.
 *
 * `counted` is how many whole hours the figures actually cover, which is
 * usually fewer than the minutes suggest and is the honest denominator for
 * "per seated hour". A person who sat for two stretches of forty minutes has
 * eighty minutes at the desk and quite possibly no hour attributed to them at
 * all, and saying that out loud is better than dividing by 1.33.
 */
export function personDay(row, personId, hours, nameKey, now = Date.now()) {
  const sits = ((row && row.sits) || [])
    .filter((s) => s && s.id === personId)
    .map((s) => sitFigures(s, hours, nameKey, now));
  const t = { min: 0, op: 0, ca: 0, ct: 0, ap: 0, counted: 0 };
  for (const s of sits) {
    t.min += s.min; t.op += s.op; t.ca += s.ca; t.ct += s.ct; t.ap += s.ap;
    t.counted += s.hours;
  }
  return { sits, ...t, perHour: t.counted > 0 ? t.op / t.counted : null };
}

/** Everybody who sat today, most time at the desk first. */
export function attribution(row, hours, keyOf, now = Date.now()) {
  const ids = [...new Set(((row && row.sits) || []).map((s) => s && s.id).filter(Boolean))];
  return ids
    .map((id) => ({ id, ...personDay(row, id, hours, keyOf ? keyOf(id) : null, now),
      label: (((row && row.sits) || []).find((s) => s.id === id) || {}).label || "" }))
    .sort((a, b) => b.min - a.min);
}

/**
 * Every seat across the day, as a fraction of each hour it was staffed.
 *
 * A fraction rather than a yes or no because the sits are minute-granular and
 * fifteen minutes of cover is not an hour of it. Clamped at one: two people
 * overlapping in a chair — which a move can produce for a moment — is not two
 * hours of coverage.
 */
export function occupancy(plan, row, { open, close, now = Date.now() } = {}) {
  const labels = dayHours(row, { open, close });
  const sits = ((row && row.sits) || []).filter((s) => s && s.in);
  const anchor = sits.length ? Date.parse(sits[0].in) : now;

  const seats = seatsOf(plan).map((seat) => {
    const n = String(seat.n);
    const mine = sits.filter((s) => String(s.st) === n);
    const cells = labels.map((h) => {
      const a = hourStart(anchor, h), b = a + HOUR;
      let cover = 0, who = "", best = 0;
      for (const s of mine) {
        const from = Date.parse(s.in);
        const to = s.out ? Date.parse(s.out) : now;
        const overlap = Math.max(0, Math.min(b, to) - Math.max(a, from));
        if (!overlap) continue;
        cover += overlap;
        if (overlap > best) { best = overlap; who = s.label || ""; }
      }
      return { hour: h, cover: Math.min(1, cover / HOUR), who };
    });
    return { n, cells, min: mine.reduce((m, s) => m + sitMinutes(s, now), 0) };
  });

  /* How much of the room was staffed each hour. This is the line a manager
     actually reads: not whether a chair was used, but whether the room was
     covered when the phone was ringing. */
  const byHour = labels.map((h, i) => {
    const on = seats.reduce((n, s) => n + (s.cells[i].cover >= 0.5 ? 1 : 0), 0);
    return { hour: h, staffed: on, of: seats.length,
      pct: seats.length ? on / seats.length : 0 };
  });

  return { hours: labels, seats, byHour,
    min: seats.reduce((m, s) => m + s.min, 0),
    /* The quietest hour the room was open, which is the one worth asking
       about. Ties go to the earliest, so the answer is stable. */
    thinnest: byHour.length ? byHour.reduce((a, b) => (b.staffed < a.staffed ? b : a)) : null };
}
