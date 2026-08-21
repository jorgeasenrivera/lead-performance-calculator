/**
 * Three of the last five, and the note that clears it.
 * -------------------------------------------------------------------------
 * The rule Jorge asked for, and the edges that decide whether it is fair.
 *
 * Fairness is most of the work here. A flag that fires on somebody's day off, or
 * on a day whose report has not arrived yet, or on a new hire's first week, is
 * worse than no flag at all: it lands hardest on the person least able to argue
 * with a screen, which is the same failure the month-average bounds were fixed
 * for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalStanding, owesNote, makeNote, addNote, makeLift, notesFor, dayBelow, didWork,
  gates, GATED_WHILE_OWING, NEVER_GATED } from "../api/_goal-standing.mjs";

/* The notes list, wherever the caller keeps it. A salesperson's phone writes the
   day's floor row because that is what it is allowed to write; this file does not
   care, and neither do these checks. */
const write = (notes, text, opts) => addNote(notes, makeNote(text, opts));

const D = (n) => `2026-08-${String(n).padStart(2, "0")}`;
/* Days as the app hands them over: already filtered to days this person worked
   and that have figures. Most recent last here, to prove order does not matter. */
const days = (...flags) => flags.map((below, i) => ({ day: D(10 + i), below }));

// ---- the trigger ----
test("three bad days out of the last five raises it", () => {
  const s = goalStanding(days(true, false, true, false, true));
  assert.equal(s.flagged, true, JSON.stringify(s));
  assert.equal(s.missed, 3);
  assert.equal(s.latestMiss, D(14), "the note has to answer for the most recent one");
});

test("two out of five does not", () => {
  assert.equal(goalStanding(days(true, false, true, false, false)).flagged, false);
});

test("three bad days longer ago than the window do not count", () => {
  // Three bad, then five clean: the bad ones have fallen out of the last five.
  const s = goalStanding(days(true, true, true, false, false, false, false, false));
  assert.equal(s.flagged, false, JSON.stringify(s));
  assert.equal(s.counted, 5, "only the last five are looked at");
});

test("the order they arrive in makes no difference", () => {
  const forwards = days(true, false, true, false, true);
  const backwards = [...forwards].reverse();
  assert.deepEqual(goalStanding(backwards), goalStanding(forwards));
});

test("somebody with fewer than five days on record can still be flagged", () => {
  /* A new hire three days in who has missed all three is missing the standard,
     and waiting for five days to accumulate would be a fortnight of silence. */
  const s = goalStanding(days(true, true, true));
  assert.equal(s.flagged, true);
  assert.equal(s.counted, 3);
});

test("but somebody with no days on record is never flagged", () => {
  // The first morning, before any report has landed.
  assert.equal(goalStanding([]).flagged, false);
  assert.equal(goalStanding(null).flagged, false);
});

test("the store can set its own bar", () => {
  const d = days(true, false, true, false, false);
  assert.equal(goalStanding(d, { need: 2, window: 5 }).flagged, true);
  assert.equal(goalStanding(d, { need: 3, window: 5 }).flagged, false);
});

// ---- what counts as a bad day ----
test("short on calls or short on videos is a bad day", () => {
  const std = { minCalls: 16, minVideos: 2 };
  assert.equal(dayBelow({ calls: 20, video: 3 }, std), false);
  assert.equal(dayBelow({ calls: 4, video: 3 }, std), true, "short on calls");
  assert.equal(dayBelow({ calls: 20, video: 0 }, std), true, "short on videos");
  assert.equal(dayBelow({ calls: 16, video: 2 }, std), false, "exactly the bar is met");
});

test("a store that asks for nothing flags nobody", () => {
  assert.equal(dayBelow({ calls: 0, video: 0 }, { minCalls: 0, minVideos: 0 }), false);
});

// ---- which days count at all ----
test("a day with nothing on it is not a day somebody failed", () => {
  /* A day off, or a day whose report has not landed. The caller drops these
     before the trigger ever sees them, and getting this wrong is the difference
     between a flag people trust and one they learn to ignore. */
  assert.equal(didWork(null), false);
  assert.equal(didWork({}), false);
  assert.equal(didWork({ calls: 0, video: 0, tasks: 0 }), false);
  assert.equal(didWork({ uploadedAt: "2026-08-20T18:00:00.000Z" }), false,
    "the report landing is not the same as somebody working");
});

test("any figure at all makes it a day that counts", () => {
  assert.equal(didWork({ calls: 1 }), true);
  assert.equal(didWork({ visits: 2 }), true, "an up taken is a day worked");
  assert.equal(didWork({ units: 1 }), true);
});

// ---- the note ----
test("writing the note clears it", () => {
  const s = goalStanding(days(true, false, true, false, true));
  assert.equal(owesNote([], s), true);
  const notes = write([], "No inventory in my segment all week.",
    { by: "Fin Smith", forDay: s.latestMiss, missed: s.missed, of: s.counted });
  assert.equal(owesNote(notes, s), false);
  assert.equal(notesFor(notes)[0].text, "No inventory in my segment all week.");
});

test("a blank note does not count as one", () => {
  const s = goalStanding(days(true, true, true));
  assert.equal(owesNote(write([], "   ", { forDay: s.latestMiss }), s), true,
    "whitespace cleared the flag");
});

test("a good day does not ask for the note again", () => {
  /* Three bad days, then a clean one. Still flagged — the three are inside the
     window — but there is nothing new to answer for, so the note stands. */
  const s1 = goalStanding(days(true, true, true));
  const notes = write([], "why", { forDay: s1.latestMiss });
  const s2 = goalStanding(days(true, true, true, false));
  assert.equal(s2.flagged, true, "should still be flagged: " + JSON.stringify(s2));
  assert.equal(s2.latestMiss, s1.latestMiss, "the clean day is not something to answer for");
  assert.equal(owesNote(notes, s2), false, "asked again for no new reason");
});

test("another bad day does ask again", () => {
  /* The whole point of "keeps not getting to their goal": one note does not
     settle a month. */
  const s1 = goalStanding(days(true, false, true, false, true));
  const notes = write([], "why", { forDay: s1.latestMiss });
  const s2 = goalStanding(days(true, false, true, false, true, true));
  assert.equal(owesNote(notes, s2), true);
});

test("an old note does not cover a fresh flag", () => {
  const notes = write([], "from last month", { forDay: "2026-07-02" });
  assert.equal(owesNote(notes, goalStanding(days(true, true, true))), true);
});

test("notes are kept, newest first, and never overwritten", () => {
  let n = write([], "first", { at: "2026-08-10T09:00:00.000Z" });
  n = write(n, "second", { at: "2026-08-12T09:00:00.000Z" });
  assert.deepEqual(notesFor(n).map((x) => x.text), ["second", "first"]);
});

test("a note says whose it is, since they all land in one shared day record", () => {
  /* The notes are read back out of the day's floor row, which everybody at the
     store writes to. A note that cannot name its author is one its author can
     never be shown to have written, and the flag asks them again tomorrow. */
  const n = makeNote("why", { who: "fin smith", id: "a1" });
  assert.equal(n.who, "fin smith");
  assert.equal(n.id, "a1");
  const l = makeLift({ who: "fin smith", id: "a1", by: "Jorge" });
  assert.equal(l.who, "fin smith");
  assert.equal(l.id, "a1");
});

test("the note records what it was answering for", () => {
  const s = goalStanding(days(true, false, true, false, true));
  const n = notesFor(write([], "why", { forDay: s.latestMiss, missed: s.missed, of: s.counted,
    by: "u1", name: "Fin Smith" }))[0];
  assert.equal(n.missed, 3);
  assert.equal(n.of, 5);
  assert.equal(n.name, "Fin Smith");
});

// ---- a manager can lift it ----
test("a manager can lift it, and it is recorded", () => {
  const s = goalStanding(days(true, true, true));
  const lift = makeLift({ by: "Jorge", why: "Out on a family matter", forDay: s.latestMiss });
  assert.equal(owesNote([], s, lift), false);
  assert.equal(lift.by, "Jorge");
  assert.equal(lift.why, "Out on a family matter");
});

test("but a lift does not stand for ever", () => {
  const s1 = goalStanding(days(true, true, true));
  const lift = makeLift({ by: "Jorge", forDay: s1.latestMiss });
  const s2 = goalStanding(days(true, true, true, true));   // another bad day after
  assert.equal(owesNote([], s2, lift), true, "the lift covered days it never saw");
});

// ---- what the block covers ----
test("the gate never touches the floor", () => {
  /* Whatever else changes, signing in and taking an up must keep working. This
     is the one part of the decision that costs the store money if it is wrong. */
  for (const open of NEVER_GATED) {
    assert.equal(gates(open), false, `${open} must stay open: locking it costs a sale`);
  }
});

test("it stands in front of the one reviewing surface a salesperson has", () => {
  assert.deepEqual(GATED_WHILE_OWING, ["myday"]);
  assert.equal(gates("myday"), true);
});

test("a surface nobody has ruled on is open", () => {
  /* The list is what is gated, not what is allowed, so a surface added next year
     does not silently join it. */
  assert.equal(gates("some-new-screen-in-2027"), false);
  assert.equal(gates(""), false);
  assert.equal(gates(null), false);
});
