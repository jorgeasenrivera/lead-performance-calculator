# Notes — asked for, not built yet

Things Jorge has asked for that are not in the app, and the decisions behind them.
Separate from the HANDOFF files on purpose: those describe a session, this outlives one.

---

## Goal accountability, with a hard stop

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

### What has to be decided before this can be built

1. **What counts as "keeps not getting to".** Consecutive days short? A count inside a
   rolling window — three of the last five? Below goal by any margin, or by some amount?
   This is the whole trigger and there is no sensible default to guess at.
2. **Who it applies to.** Salespeople only, or managers against the store goal too?
3. **Where the written reason goes.** Into the coaching record for that person, visible to
   their manager? Somewhere the manager is actually prompted to read it, or it will be
   written into a void.
4. **Whether a manager can lift it**, and whether lifting it is recorded.
5. **How much of the app the block covers.** See the risk below — this one matters most.

### The risk worth naming before it is built

A hard block that catches the morning **QR sign-in to the line** would stop someone taking
an up. Locking a salesperson out of the floor is the most expensive thing this app could
do to a store, and it would land on whoever is already having the worst month.

The block should keep them out of the parts of the app that are about *reviewing* their
performance, and let them keep *working*. Sign in to the line, take an up, log a delivery —
those stay open. Confirm with Jorge before building either way.

---

## Merge policy decisions (for the store-merge work)

Answers given 2026-08-21, in response to the scope of the "one guard" merge work.

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
- **`repeatFlags` — dead.** Every reference in the app and the pipeline is copy-through:
  snapshot lists and restore lists. Nothing reads a value out of it and nothing writes one
  in. Safe to delete rather than write a merge rule for.
- **`statsExcluded` — live, keep.** People left out of the store's *benchmark averages*, so
  one outlier does not drag the store's comparison numbers around. Toggled per person on
  the coaching screen, where it shows as an "out of stats" badge.

**Worth knowing about `statsExcluded`:** it is an array, and removing somebody from it is a
plain `filter`. It is not merged at all today, so a removal does stick — but a second
manager's concurrent addition is silently lost. If it is ever changed to a union without
stamps, it becomes the sixth instance of the removal-does-not-survive bug. Give it stamps
when the merge policy table is built.
