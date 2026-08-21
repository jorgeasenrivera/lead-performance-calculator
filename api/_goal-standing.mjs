/**
 * Somebody who keeps missing the standard, and the note they owe about it.
 * -------------------------------------------------------------------------
 * Jorge, in his own words:
 *
 *   if someone in the store keeps not getting to their goal I want it to flag it
 *   and make it obvious for them and they can't do anything in the app until
 *   they write down why they're not able to fix everything
 *
 * The app has been promising a version of this for a long time and not doing it.
 * The store settings screen says, under the daily standards:
 *
 *   Missing that on 3 days in a month flags someone as a repeat offender
 *   automatically.
 *
 * Nothing flagged anybody. `repeatDays` was read in exactly two places — that
 * sentence, and the defaults it came from — and the `repeatFlags` field that was
 * presumably meant to hold the answer was carried from document to document
 * without anything ever writing to it. It has since been deleted.
 *
 * ---- what counts as missing ----
 * Calls and videos, against the store's own minimums. One definition, used by
 * the manager's screen and by the salesperson's phone alike.
 *
 * Deliberately NOT the RockEd mark, which is the third leg of the daily points
 * system. The mark is not published with the floor figures, so a phone cannot
 * see it, and a flag defined partly on something one side cannot read is two
 * definitions of a bad day wearing one name — the exact shape of the last five
 * faults in this system. Calls and videos are on both sides, so both sides
 * agree. If the mark is ever wanted in here, publish it first and change this in
 * one place.
 *
 * The caller still decides which days COUNT — days off and days with no report
 * are filtered out before they get here — because only the caller knows the
 * schedule.
 *
 * ---- the trigger ----
 * Three of the last five working days, per Jorge. Days off and days with no
 * report are skipped rather than counted as either, exactly as the streak
 * reading already does: a day nobody worked is not a day somebody failed.
 *
 * ---- why the flag itself is not stored ----
 * It is derived, every time, from the days. Only the notes and the lifts are
 * written down, and they are append-only. That is deliberate: a stored flag
 * would be one more piece of state that a merge has to settle and a stale tab
 * could resurrect, which is the shape of every bad week this system has had.
 * Nothing to resurrect if there is nothing stored.
 */

/**
 * ---- where the note and the lift live ----
 * On the day's floor row, not on the store document, and that is forced rather
 * than chosen. The store document is readable only by somebody signed in with
 * that store — `lpc:store:%` is gated on has_store — and the person who owes the
 * note is holding a phone that never signs in at all. The floor row is the one
 * record both a salesperson's phone and a manager's browser can read and write,
 * which is already how somebody joins the line. So both sides read the same
 * list, and neither is guessing at the other's copy.
 *
 * This file does not know any of that. It takes a list of notes and a lift and
 * says whether a note is owed; the caller fetches them from wherever they are.
 */

/** The standards a store is judged by, as far as this file is concerned. */
export const DEFAULT_TRIGGER = { need: 3, window: 5 };

/* What makes a day a day somebody worked. A row of nothing at all is a day off
   or a day with no report, and flagging either would land the flag on the one
   person who cannot argue with it — the same unfairness the month-average
   bounds were fixed for. The caller pairs this with who actually signed in,
   which it knows and this file does not: somebody who signed in and did nothing
   HAS worked, and that is a bad day rather than a day off. */
export const ACTIVITY_FIELDS = ["calls", "video", "text", "email", "contacted",
  "tasks", "apptScheduled", "apptConfirmed", "apptShow", "visits", "units"];
export function didWork(row) {
  if (!row) return false;
  return ACTIVITY_FIELDS.some((f) => (Number(row[f]) || 0) > 0);
}

/**
 * Is somebody flagged, given their recent days?
 *
 * `days` is [{ day: "YYYY-MM-DD", below: boolean }], already filtered by the
 * caller to days the person actually worked and that have figures. Order does
 * not matter; it is sorted here.
 */
export function goalStanding(days, opts = {}) {
  const need = Number(opts.need) || DEFAULT_TRIGGER.need;
  const window = Number(opts.window) || DEFAULT_TRIGGER.window;
  const recent = [...(days || [])]
    .filter((d) => d && d.day)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
    .slice(0, window);
  const missed = recent.filter((d) => d.below);
  /* The day the note has to cover. A note written before the most recent bad day
     cannot be an explanation for it, which is what makes this keep asking of
     somebody who keeps missing rather than letting one note settle a month. */
  const latestMiss = missed.length ? missed[0].day : null;
  return {
    flagged: missed.length >= need && recent.length > 0,
    missed: missed.length,
    need,
    window,
    counted: recent.length,
    days: missed.map((d) => d.day),
    latestMiss,
  };
}

/**
 * Is a day below the standard? The single definition, used by both sides.
 *
 * `row` is a day's figures as the floor publishes them; `std` the store's
 * minimums. A row that carries neither figure is not a bad day — it is a day
 * with no report yet, and the caller should not have passed it.
 */
export function dayBelow(row, std) {
  const r = row || {};
  const minCalls = Number(std?.minCalls) || 0;
  const minVideos = Number(std?.minVideos) || 0;
  const calls = Number(r.calls) || 0;
  const video = Number(r.video) || 0;
  return calls < minCalls || video < minVideos;
}

/** Notes newest first. Takes the list, not the document it came out of.
 *
 *  Where notes live is the caller's business, and it is not one place: a
 *  salesperson's phone can write the day's floor row and cannot write the store
 *  document, so the note is written where the person writing it is allowed to
 *  write. This file has no opinion about that, which is why it takes a list. */
export function notesFor(notes) {
  return [...(notes || [])].filter(Boolean)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/**
 * Does this person owe a note right now?
 *
 * Flagged, and nothing written that covers their most recent bad day. A note
 * covers a day if it was written for that day or later — so a good day does not
 * re-raise it, and another bad day does.
 */
export function owesNote(notes, standing, lift) {
  if (!standing || !standing.flagged) return false;
  if (isLifted(lift, standing)) return false;
  return !notesFor(notes).some((n) => String(n.forDay || "") >= String(standing.latestMiss || ""));
}

/**
 * A manager can lift it, and lifting is recorded like every other decision here.
 * Lifting covers the days up to the day it was lifted for, so a later bad day
 * raises it again rather than the lift standing for ever.
 */
export function isLifted(lift, standing) {
  if (!lift || !lift.forDay) return false;
  return String(lift.forDay) >= String((standing && standing.latestMiss) || "");
}

/** The note itself. Append-only: the caller adds it, nothing is ever edited. */
export function makeNote(text, opts = {}) {
  const body = String(text || "").trim();
  if (!body) return null;
  const at = opts.at || new Date().toISOString();
  return {
    at,
    /* The day this note answers for, so a later bad day is not covered by an
       earlier explanation. */
    forDay: opts.forDay || at.slice(0, 10),
    /* WHOSE note it is, and it has to be on the note itself: these are read back
       out of a shared day record that everybody at the store writes to, so a note
       that cannot say who wrote it is a note nobody can find again. */
    who: opts.who || "",
    id: opts.id || "",
    by: opts.by || "",
    name: opts.name || "",
    text: body,
    /* What was true when it was written, so a manager reading it later knows what
       they were being asked about rather than having to reconstruct it. */
    missed: Number(opts.missed) || 0,
    of: Number(opts.of) || 0,
  };
}

/** Add one to a list, newest first, without ever dropping what is there. */
export function addNote(notes, note) {
  if (!note) return notes || [];
  return [note, ...(notes || []).filter(Boolean)].slice(0, 200);
}

/** A manager waives it for now, with a reason and their name against it. */
export function makeLift(opts = {}) {
  const at = opts.at || new Date().toISOString();
  return { at, forDay: opts.forDay || at.slice(0, 10),
    who: opts.who || "", id: opts.id || "",
    by: opts.by || "", why: String(opts.why || "").trim() };
}

/* =========================================================================
   What the block covers.

   Jorge settled the principle: the block stops somebody reviewing their
   performance and never stops them working. Signing in to the line, taking an up
   and logging a delivery stay open however far behind they are, because locking
   a salesperson off the floor is the most expensive thing this app could do to a
   store and it would land on whoever is already having the worst month.

   Then the code decided the rest. A salesperson never reaches Summary, History,
   Standards or the Dashboard — those are manager tabs, and a list naming them
   would have been a block on nothing at all, which is worse than no block
   because it looks like one. What a salesperson actually has is the sign-in
   flow and MY DAY, the panel showing their own figures and checklist. So My Day
   is where the note stands, and the sign-in around it is untouched.

   My Day is not made unopenable. Being shut out of the one screen that would
   tell them why would be absurd. The gate REPLACES its contents with the record
   — these are the days, this is the standard — and the box to answer in, and
   hands the day back the moment something is written.

   A LIST OF WHAT IS GATED, not a list of exceptions. A surface added next year
   is open until somebody decides otherwise, because one silently joining this
   set is how it ends up costing a sale.
   ========================================================================= */
export const GATED_WHILE_OWING = [
  "myday",   // their own figures and checklist: the reviewing surface they have
];

/** Is this surface one the note stands in front of? */
export function gates(surface) {
  return GATED_WHILE_OWING.includes(String(surface || "").toLowerCase());
}

/** The floor, which the flag never touches however far behind somebody is. */
export const NEVER_GATED = ["line", "floor", "online", "signin", "queue", "help"];
