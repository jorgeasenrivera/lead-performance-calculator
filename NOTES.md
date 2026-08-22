# Notes — asked for, not built yet

Things Jorge has asked for that are not in the app, and the decisions behind them.
Separate from the HANDOFF files on purpose: those describe a session, this outlives one.

---

## Sage — the identity, and the arrival (a Claude Design handoff)

Jorge brought a full design package: the Lead Performance Calculator becomes **Sage**, with
a new mark, a rebuilt sign-in screen, a 2.7-second arrival into the dashboard, and five
smaller transitions. The handoff is exact — every colour, timing and easing measured — and it
ships one file meant to be used as-is, `SageMark.jsx`.

### Part 1 — the identity — BUILT 2026-08-22

The mark is one drawing on a 9x9 grid, which is **the same grid `PixIcon` already uses**, so
the identity and the app's own iconography come off one ruler rather than merely sitting next
to each other. The assets are all generated from that single pattern, so any size can be
regenerated rather than redrawn.

- `public/` carries the SVGs and PNGs; `index.html` declares the favicon, the 32px raster and
  the Apple touch icon; the title is Sage.
- The old `useFavicon` painted an icon in at runtime from an inline copy of the old logo. It
  would now overwrite the real favicon with a second-best version of it a moment after load,
  so it is gone; only the title-setting is kept.
- `Logo` is kept as the name every call site uses and now renders the mark. Its two states
  survive: `animated` is the float, and `loading` is the identity's **seven dots lighting one
  at a time** rather than the old spinner — which is Part 4's loading pattern, brought
  forward because it is what the old spinner was standing in for.
- The old mark's arc, needle and spinner CSS is deleted rather than left orphaned, including
  its reduced-motion overrides.

**One deviation from "ships as-is":** `SageMark.jsx` is JSX with no React import, which works
under the automatic JSX runtime this app's Vite build uses and throws under a classic
transform — including the harness every screen here is checked in. Imported rather than
assumed; costs nothing either way.

**One thing deliberately not renamed:** the *Lead Performance Summary* report, and its CSV
filename `Lead-Performance-Summary_YYYY-MM.csv`. That is the name of a document managers have
folders of, and renaming it silently breaks their filing. Worth deciding on purpose.

### Parts 2-4 — still to build

- **Part 2, the sign-in screen.** No card, form on the ground, drifting blobs and a 925-dot
  field, and the mark building dot by dot as the form is typed.
- **Part 3, the arrival.** 2.7s: hold, gather, stretch, flash, assemble. **This overlaps an
  existing feature** — the app already plays a cinematic on the first sign-in of each calendar
  day, with the same per-device per-day `localStorage` key. The arrival replaces it; two of
  them stacked would be a minute of animation before anybody sees a number.
- **Part 4, the smaller transitions.** Tool warp, tab pill, metric bloom, person sheet,
  loading and saving dots. The loading dots are done.

The handoff's performance notes are worth keeping verbatim; they were expensive to find.

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

### The manager's side — BUILT 2026-08-21

Asked for the same day: *"start on my side, I want the notes to go to me."* Two things,
because "go to me" means both of them:

- **It arrives.** A note raises a ticket as well as writing the floor row, so it rides the
  one rail in this app that already reaches a person: it lands in Tickets under **Behind**,
  and Supabase carries it out to whatever webhook the store has set — the same route a
  wrong-number report takes. Which kinds are worth interrupting somebody for is decided in
  one place, `worthSending` in `api/_report-alert.mjs`. The alert says plainly that there is
  nothing to action, because it arrives beside reports that do need chasing.
- **It can be reviewed.** *Behind the standard* on the Live Floor, next to the off-lot
  backlog, because they are the same job at the same moment: who is flagged, the days and
  figures behind it, what they wrote, and who has not answered yet. Lifting is there, with a
  reason and a name against it.

The ticket is a delivery, not the record. The floor row is the record — it is what clears
the flag and what the panel reads back — and a ticket that fails to save can never cost
somebody their day back.

Both sides read the fortnight of floor rows through the same two functions, `readFloorDays`
and `standingFor`, for the reason this repository has learned six times: one record with two
readers written separately ends up as two answers about the same week.

Still open: whether a manager should be held to the store goal the same way, and whether a
lift should also go into the audit log. The settings screen now describes the rule correctly;
it described a "repeat offender" flag that never existed for as long as the app has run.

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

## The Line went white — 2026-08-22

A toolbar button added to the wrong one of two components that draw an almost identical
toolbar. It read `behindCount`, which is a `useState` in the Live Floor board and does not
exist in the phone line, so **the whole tab threw on render and the screen went blank.**

Nothing caught it. The build is happy — the name is valid syntax — and every static check in
the suite reads the `api/` files, while the app is 26,000 lines of one file with dozens of
components that look like each other on purpose. The fault before this one (`squash is not
defined`) was the same shape one layer down.

**The guard**: every `const [x, setX] = useState(...)` belongs to exactly one component. If
another component mentions that name and has no local binding for it, it is reaching into a
scope it does not have. Deliberately narrow — a general undefined-name check over JSX is a
research project and a noisy one — and it catches the exact shape that reached production.

Three things went wrong while writing the check, all worth keeping:

- It stripped comments before slicing components, and the scanner does not preserve line
  structure, so `^function` matched 99 of ~200 components. **QueueTab was not one of them: the
  check passed on the bug it was written for by never looking at it.** It slices raw and
  strips per body now, with a vacuity guard asserting it sees 150+ components including
  QueueTab by name.
- "Any name after an open brace" counted as a declaration, so `{behindCount` in the JSX
  declared behindCount. A usage is not a binding.
- A JSX prop (`storeId={...}`) and an object key (`storeId: st.id`) are not variable reads.
  Names used that way anywhere in the file are skipped rather than guessed at.

---

## Fewer words, more picture — STARTED 2026-08-22

> reducing the "wordiness" of the page … I want more visuals throughout the website instead of
> words

This app explains itself, and that is deliberate: half of what it does is a judgement about a
person's month, and a screen that makes one without saying why is a screen nobody should
trust. The cost crept up on it — **3,905 words of prose permanently on the manager's screens**,
so the page read every morning is mostly sentences somebody read once, in March.

### The rule

- If the sentence tells you something **the screen already shows**, it goes entirely.
- If it carries **a decision somebody would otherwise get wrong** — a leaver keeps their cars,
  a fold cannot be split back apart — it goes behind `<Explain>`: one line always visible, the
  paragraph one click away.
- **Empty states stay.** "Nothing on the list yet, paste the drawer of dealer plates above" is
  the only thing on the screen at that moment; deleting it leaves a blank rectangle.
- **Rarely-used destructive screens keep their prose.** Backup, Repair and the store wizard are
  where a wrong click costs a store its records, and they are read by somebody who has not been
  there in six months. Explanation earns its place there and nowhere is it more expensive to
  have folded away.

`<Explain>` is a native `<details>`: keyboard-accessible and findable by in-page search for
free, and no state for a screen full of them to hold.

### Done so far

| screen | permanent prose |
|---|---|
| People | 566 → 69 words |
| Plates | 193 → 81 |
| Import | 175 → 131 |
| Coaching | 109 → 76 |

3,905 → 3,071 across the app. Still to do: Floor Config (203), Baseline Import (126), Tickets
(111), Missed Standards (104, mine — written last week and already too long), Help (91).

### Own Your Outcome: drawn, not folded away

The plan on a person's card is the one thing in the app somebody is asked to ACT on — go and
find 34 leads — and whether they do it turns entirely on whether they believe the 34. The
app's answer to that was a sixty-word paragraph explaining the arithmetic, which is right and
which nobody reads twice.

Folding that into an `<Explain>` would have been **worse than leaving it**: the reasoning IS
the persuasion here, so hiding it hides the only reason to trust the number. So it is drawn:
four blocks and three arrows — the gap, their own sales mix (as a stacked bar), their own
closing rates, the leads that follow — each figure carrying a dot in its channel's colour so
three percentages say WHICH three without a legend. Same chain, same numbers, read in a second,
and it stacks into a downward flow on a phone.

Two more sentences became evidence rather than reassurance. "Built from this person's own
conversion history, not a number anybody made up" is a *claim*; **Their own record · 33 cars
across 71 working days** is the thing that makes it true, and it is shorter. The coaching
bar's "drawn from your own floor rather than a number someone made up" got the same treatment:
**Your own floor · 6 of 18, by units delivered**.

The rule this adds to the sweep: **where the words are the reason to believe a number, draw
them — do not fold them away.**

---

## History and Summary — REWORKED 2026-08-21

> I feel like we haven't given any recent love to the history and summary tabs

### History showed no history

It listed one month's figures in a table and let you change which month with a dropdown, so
every month looked exactly like every other one. The one question a history tab is for — is
this getting better? — was the one thing it could not answer, and the only way to find out
was to write the numbers down and change the dropdown.

- **Every figure now carries its move** since the month before, in points, with a 0.5-point
  deadband so a rounding wobble is never dressed up as a trend. Points rather than percent of
  a percent, because "up four points" is what a manager says out loud.
- **The month it compares against is the previous month ON RECORD**, not last month by the
  calendar. A store that imported nothing in July should be read against June rather than
  against nothing.
- **The verdict trail**: how each person was judged in each of the last eight months, oldest
  on the left, each month under the standards that were in force at the time. A run of reds
  turning green is a coaching story, and it was in the data all along with nothing drawing it.
- The first month on record says so and draws no arrows, rather than comparing against zero.

### Summary led with a caption

The four numbers the page is read for were a run-on sentence under the title — "4 restricted ·
2 in grace period · 9 cleared". They are tiles now, the site's own, already used on the
Dashboard. **Paused right now** is deliberately its own number rather than folded into
"below standard": it is the only one where somebody is not being handed leads this minute.

### Nothing to judge is not the same as judged and found wanting — FIXED

Somebody with NO figures at all in a month was judged **Restrict**, because a missing value
counted as a failed requirement: a new hire in their first week, somebody on leave, a store
whose report had not landed. Jorge asked for it fixed on both screens, so it is fixed in
`evaluateAssociate` where both read it — a new `no-data` status, shown as **No figures yet**.

The bar is deliberately EVERY required figure absent. One missing number out of four is a
real shortfall against that requirement and still counts.

### The board row, restructured — same day

> Remove the words on the bar underneath. The speedometers are not lined up with each other.
> I want the lead bar to take up a longer length within the tile.

- **The dials never lined up** because the row was a flex line with TWO auto margins in it —
  one before the dials, one before the lead count — so free space split between them and the
  dials landed wherever the verdict's wording left them. "Nearing the limit" and "Below
  standard, room left" are different widths, so no two rows agreed. It is a grid of fixed
  tracks now: column four is under column four on every row.
- **The bar is in the row** and takes whatever is left, which is most of it. It used to sit
  under the row capped at 520px — the smallest object on a line with room for it to be the
  largest — with a sentence beneath restating what it and the verdict already said.
- **The sentences are gone**, kept as the bar's own `title`. A manager who wants the wording
  has it on hover; the page is not nine paragraphs long. What is left under a row is the one
  thing that was never a restatement: the Confirm-removed-from-leads action.
- Below 1200px the row wraps instead, bar on its own line, so nothing is pushed off the edge.
- **The lead count is two sub-columns**, not one right-aligned string: "74 / 80" and "82 / 100"
  are different widths, so aligning the whole thing put the slash somewhere different on every
  row. The number ends where every number ends; the cap starts where every cap starts.
- **Every verdict pill is one width**, so they read as a column rather than a ragged edge.
- **Everything that identifies a person is one grid cell.** The rank badge, the crushing-it
  badge and the incomplete flag come and go, and each used to be a child of the row's grid —
  so a row with a badge pushed everything after it into the next track and the dials fell out
  of line the moment somebody had a good month.

### Crushing it, in gold

Forty per cent over every requirement is not a good month, it is a different league, and it
had the same small green line down the card that everybody clearing standard gets. It is gold
now, and the whole row wears it: the edge, the badge, their lead bar, and their verdict pill.
Nothing moves and nothing changes size — the same row, wearing something. It costs nothing to
say well done properly.

### Next: more pictures, fewer words, everywhere else

Jorge's follow-up, not yet started: the same pass over the rest of the site.

---

## Positions, told apart — BUILT 2026-08-21

> I'd like there to be a visual difference between job types like BDC and sales and so on
> and group them accordingly, keep it fun.

The People list was one grey run of names, and a manager reading it is almost always after
one group of them: the BDC's numbers, or who is actually on the floor selling. The position
was there in small grey type, doing none of the work of telling them apart.

- **The colour is the position's own**, set under Settings and already drawn on the standards
  table. The same identity turning up in a second place, not a new one invented for this
  screen. The settings table now draws the same badge, so a colour picked there is visibly
  the colour it becomes on People.
- **Warm, because the site is.** The seeded role colours were an iOS-ish blue, purple, teal
  and slate that had never matched the amber, lime and clay this site's cards are tinted
  with. Nobody had noticed because they were never seen together until this screen put four
  of them on one page. They are now amber, olive, brick and warm stone, migrated on load —
  and ONLY where the colour is one nobody chose (a seeded default or the old ramp), so a
  store that picked its own keeps it.
- **The colour stays in the heading.** A bar down the left of each row and a ring around each
  face were both tried and both removed: the bar was a louder second copy of what the heading
  already says and a hard vertical edge is a shape this site does not use, and the ring put a
  warm outline around a face whose fill is a hue off the person's own name — two palettes
  arguing on one 30-pixel object.
- **The glyph comes off the position's NAME**, not its id, because the ids are whatever
  somebody typed. Every store invents its own titles — "Internet Sales", "Product
  Specialist", "Client Advisor" — so a new position gets something that fits on the day it
  is added, with a stable fallback off the id for a title nothing recognises. Nobody is
  asked to choose an icon they did not ask for.
- **Groups follow the order positions are listed under Settings**, never alphabetically by
  job title, which would put the BDC above the floor at every store in the group for no
  reason anybody chose. Empty groups are not drawn: a heading with nobody under it reads as
  a position with nobody in it, which is a different and alarming thing.
- **Select these N** per group, because that is the batch a manager actually arrives with.
  Quiet but never hidden until hover: half the people on this screen are on an iPad, where
  a control that only appears for a mouse does not exist at all.

### The row's own buttons, and room at the edges — same day

Every row carried four solid blue pills, so a list of people read as a wall of buttons with
some names in it. They are all ordinary, occasional actions — somebody leaves, somebody
moves store — and none of them is what a manager came to the screen to do; the list itself
is. They are outlined and quiet now, turn solid under the pointer, and only **Not ours**
takes a colour, because it is the only one that removes a person's figures from the store's
books.

The buttons on the ALERT cards stayed solid on purpose. Those cards are a decision somebody
came to make; the list is something they came to read.

On a phone the labels stay and the row wraps. Dropping them to icons fits the row and turns
four unlabelled marks into a guessing game, one of which is destructive.

And the tab had no gutter at all: the Dashboard sits in `.board-page` (32px sides, 1440
ceiling) and every other tab in this module was rendered bare into `.page`, which carries no
padding, so on a wide monitor a card ran from one edge of the glass to the other. Import,
Summary, History, Standards and People now share one `.tab-page` gutter.

Deliberately per tab rather than on `.page` itself: the activity module's tracker is a dense
table that has always had the full width, and a 1440 ceiling would change a screen nobody
asked about. The admin tabs are still bare for the same reason — nobody has complained, and
guessing is how a screen somebody relies on gets narrowed overnight.

"No position yet" is a real state and a common one — every name a report brings in arrives
without one — so it gets its own grey identity rather than being lumped in with the first
position on the list.

---

## Picking the person yourself — BUILT 2026-08-21

> the merging names selector only pops up if the site notices that it has a name that's
> similar, I want to also have the ability to pick it as well

True, and the wrong way round. The app offered the fold only where it had already worked out
the answer — the mangled-name list and the holding pen — and said nothing on the two lists
where a person is most likely to know something the measure never will. A nickname, a maiden
name, a first name spelled the way a family spells it: no edit distance finds those, and a
manager recognises them at a glance.

One picker now, in four places: the holding pen, the strangers-in-the-figures list, beside
the app's guess on a misread name (so a wrong guess can be redirected instead of merged
wrongly or left alone for ever), and inside a person's own Details — which is the case none
of the others could reach, two entries the store claims BOTH of. The suggestion still sorts
to the top; the whole roster is always under it. The measure sorts, the person decides.

Folding a person the store claims asks first, because they come off the roster. Folding a
name in the figures does not, because nothing is lost either way.

---

## The removal bug, instance seven — FIXED 2026-08-21

Reported as *"trying to merge and it's still clicking and then reverting back"*, twenty-four
names at Holler Honda, all of them a column heading welded onto a real person's name.

Instance five fixed the FIGURES: a folded name's numbers came back with the server's month.
Instance seven was the same fold and the same trap one layer over, in the LISTS. `sameAs`
takes the misspelling off the roster and out of the holding pen by deleting it, and both of
those are unions in the merge — the roster so a stale tab cannot drop somebody, the holding
pen so two reports can each hold half of one unclaimed person. So the server handed the name
straight back and the screen offered it again seconds later.

Found by running the fold through the real merge with the misspelling seeded on each list in
turn: roster and pendingPeople came back, excluded and departed did not (they carry stamps
already). Both are now carried out again by `foldAliases`, over whatever the lists say after
a merge, with no new stamp: **the alias is the record**, it is already a union, and it
already survives every merge. A seventh stamp would have been a seventh way of saying the
same thing.

The check now seeds the name on **every list a store keeps**, not the two that were reported.
"We fixed the two in the report" is what produced instances two through six.

One consequence worth knowing: while a name is an alias it cannot be on any list. Somebody
genuinely called that would need the alias removed first — which is right, and there is now a
screen for it: **Spellings folded into people**, under the People list.

**Undoing a fold is a stamp, not a deletion** — instance eight, pre-empted. `aliases` is a
union so that a tab which has never heard of a fold cannot drop it, which means deleting a
key would be undone by the first save from any other tab. So `aliasesAt` and `aliasesGone` are
a stamped pair, settled by time in both directions, and an alias with no stamp predates
anybody's decision to undo it, so the undo wins.

What an undo can and cannot give back: the spelling is free from the next report onwards and
can be claimed or ignored like any other name. The FIGURES do not come apart — five and three
became eight when the fold was made and nothing records which of the eight came from where.
The screen says so rather than guessing at somebody's month.

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
