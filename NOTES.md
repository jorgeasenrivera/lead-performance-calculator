# Notes — asked for, not built yet

Things Jorge has asked for that are not in the app, and the decisions behind them.
Separate from the HANDOFF files on purpose: those describe a session, this outlives one.

---

## Goal accountability, with a hard stop — BUILT 2026-08-21

**Asked for 2026-08-21, in Jorge's words:**

> if someone in the store keeps not getting to their goal I want it to flag it and make it
> obvious for them and they can't do anything in the app until they write down why they're
> not able to fix everything.

The intent: missing a goal repeatedly should not be something a person can keep scrolling
past. The app notices, says so plainly to the person it is about, and then stops being
useful to them until they have written down what is in their way.

Where the goals live, per Jorge:

- the **store's** monthly goal is set by a manager, under Stores
- an **individual's** goal is written in the **daily tracker, under coaching** — not in the
  store document's `goals` field

So the flag is driven off the coaching entries, not off store goals.

### What was decided, and what it does now

The rule and everything that follows from it are in `api/_goal-standing.mjs`, checked by
`test/goal-standing.test.mjs`. The screen is My Day, in the app.

1. **What counts as "keeps not getting to".** Jorge chose **three of the last five**, and
   the store can change both numbers (`repeatDays`, `repeatWindow` under Standards). Days
   off and days with no report are **skipped**, not counted either way — a day nobody
   worked is not a day somebody failed. Somebody who signed in and did nothing HAS worked,
   which the figures alone cannot tell apart, so the sign-in record decides it.
2. **What counts as a bad day: calls and videos**, against the store's own minimums.
   Deliberately NOT the RockEd mark, which is the third leg of the daily points system:
   the mark is not published with the floor figures, so a phone cannot read it, and a flag
   defined partly on something one side cannot see is two definitions of a bad day wearing
   one name — the shape of the last six faults in this system. If the mark is ever wanted
   in the rule, publish it first and change `dayBelow` in one place.
3. **Who it applies to.** Salespeople. Still open: whether a manager should be held to the
   store goal the same way.
4. **Where the written reason goes.** On the **day's floor row**, and that is forced rather
   than chosen: the store document is readable only by somebody signed in with that store
   (`lpc:store:%` is gated on `has_store`) and the person who owes the note is holding a
   phone that never signs in at all. The floor row is the one record both sides can read
   and write. There is deliberately **no field for it on the store document** — that would
   have been a field nothing ever wrote, which is exactly what `repeatFlags` turned out to
   be.
5. **A manager can lift it**, with a reason and their name against it, recorded next to the
   notes. A lift covers days up to the day it was lifted for, so a later bad day raises it
   again rather than the lift standing for ever. Still open: whether a lift should also go
   into the audit log.

The flag itself is never stored. It is derived from the days every time, so there is no
piece of state for a merge to settle or a stale tab to resurrect.

### Still to build

- **The manager's side.** The notes are written and nothing prompts anybody to read them,
  which is the void this file warned about. A manager needs to see who is flagged, read
  what they wrote, and lift it from there.
- The settings screen now describes the rule correctly; it described a "repeat offender"
  flag that never existed for as long as the app has been running.

### What the block covers — DECIDED 2026-08-21

A hard block that caught the morning **QR sign-in to the line** would stop someone taking an
up. Locking a salesperson off the floor is the most expensive thing this app could do to a
store, and it would land on whoever is already having the worst month — which is the
opposite of what the flag is for.

Jorge agreed the split. **The block stops them reviewing, never working.**

| stays open | blocked until they write |
|---|---|
| sign in to the line, by QR or otherwise | their numbers, their trend, their standing |
| take an up | the board, the summary, anything ranking them |
| log a delivery, and anything else the floor needs | |

The test of a candidate screen: if being locked out of it costs the store a sale, it stays
open. Everything a salesperson does that puts money on the board keeps working; the part
that tells them how they are doing is what waits on the note.

Worth building the block as a list of screens it applies to rather than a list of exceptions,
so that a screen added later is open by default. A new screen that silently joins the blocked
set is how this ends up costing a sale a year from now.

---

## Merge policy decisions — BUILT 2026-08-21

Answers given 2026-08-21, in response to the scope of the "one guard" merge work.
All of it is in now: the merge is `api/_store-merge.mjs`, every field declares its
rule in `FIELD_POLICY`, the seven that had no rule have one, and `applyDecisions`
runs every recorded decision over whatever a merge produces. Kept here because the
reasoning is worth more than the outcome.

| Field | Decision |
|---|---|
| `goals` | Store-level, set by a manager. Individual goals are not here — they live in the daily tracker under coaching. Last writer wins, with a stamp. |
| `restrictions` | Needs a per-person stamp (`restrictionsAt`), like `daysOff`/`daysOffAt`. Reason given: many managers across many stores and many reps working the same system at once, so two managers editing different people must both survive. |

### The four fields Jorge asked about, and what they actually do

Established by reading every reference, 2026-08-21:

- **`qualified` — live, keep.** The RockEd training mark: per day, per person, a manager
  taps whether they qualified in RockEd that day. Feeds the standards scoring.
- **`stars` — legacy, read-only.** The old form of the same mark: a star count against a
  bar of 40 instead of a yes/no. **Nothing writes it any more** — tapping the new control
  deletes the old star value so the two cannot disagree. It is only still read so that old
  months keep scoring. It can shrink, never grow.
- **`repeatFlags` — dead, and now deleted.** Every reference in the app and the pipeline was
  copy-through: snapshot lists and an undo-restore list. Nothing read a value out of it and
  nothing wrote one in; it was carried from document to document for no reason. Jorge chose
  deletion over a merge rule. It is in `DEAD_FIELDS` and drains on the next save of each
  store, so there is no job to run. An old snapshot restored through undo can bring one
  back; the next save takes it out again.
- **`statsExcluded` — live, keep.** People left out of the store's *benchmark averages*, so
  one outlier does not drag the store's comparison numbers around. Toggled per person on
  the coaching screen, where it shows as an "out of stats" badge.

**`statsExcluded` got its stamps.** It was an array removed with a plain `filter`, which
would have become the sixth instance of the removal-does-not-survive bug the moment anybody
made it a union. It is a union now, with a stamped *pair* behind it — the first attempt used
a single removal stamp and re-excluding somebody after putting them back could never win,
because the other tab's removal stamp was unioned back every time.

**The sixth instance turned up anyway, somewhere else.** Marking a roll-up row as ignored
strips its figures, but the merge hands back the server's month whole, so the units walked
back into the store's total while the name correctly stayed off every list. Found by writing
the tests rather than by anybody noticing a wrong total. That is what `applyDecisions` is
for: every decision is carried out again at the end of every merge, so a branch that hands
data back cannot quietly undo one.
