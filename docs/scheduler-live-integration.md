# Scheduler live integration: calendar scaffold

X26, source only. Branch `claude/scheduler-live-integration`, started at main
`d7e81f8`. The approved look and behavior is the #486 preview at `e3caf183`; this
is the first of the live pieces. **Nothing imports it. Nothing is activated.**

## What is here

| File | What it is |
|---|---|
| `src/scheduler-calendar-model.mjs` | Pure data contract. No React, no network, no clock of its own. |
| `src/scheduler-calendar.jsx` | The screen: a month of actual daily deliveries, and for a chosen date who is listed off. Draws what the model returns. |
| `src/scheduler-calendar.css` | Scoped under `.sc-calendar`, so it cannot reach another screen. The heat scale, cell shapes and colors are the approved calendar's. |
| `test/scheduler-calendar-model.test.mjs` | 32 synthetic guards for the contract. Part of `npm test`. |
| `scripts/probe-scheduler-calendar.mjs` | Builds the component alone and checks it in a real browser (Chromium, or WebKit with `FEEL_BROWSER=webkit`). Not part of `npm test`. |

## What is not here

- **`src/Manager.jsx` is untouched on this branch.** #485's owner has frozen its branch
  (H-X52), so the bounded Manager patch is written and checked, but it is not pushed: it
  would turn the preview's Manager pin and the frozen runtime manifest red. See "The
  Manager patch" below.
- **No parser, endpoint, auth adapter, month transport or projector.** X14 #455, X15 #456,
  X19 #462 and X20 #463 keep their files. This code takes the reader's snapshot as a prop
  and does not import the reader.
- **No writes.** The screen reads props and calls back for a retry. It saves nothing, and it
  does not edit a schedule. Editing the schedule (the approved editor in the preview) is
  the next piece, and it is not started.
- **No backend, database, schema, credential, permission or deployment change, and no live
  data query.** Every row in the tests and the probe is synthetic.

## The dashboard entry

`SchedulerCalendarEntry({ store, data, isOff, layout, reported, principalEpoch })` in
`src/scheduler-calendar.jsx` is the one thing the dashboard places. It owns the open and
closed state (a button on a wide screen, the calendar's own toggle on a phone) and binds
the store's own records to the calendar: `store.id`, `data.roster`, `data.departed`,
`data.daysOff`, `data.forcedOff`, `data.presentAnyway`, `data.scheduleSource`, and the
app's own `isOff(data, id, date)`. The month is the real Eastern business month. Until the
reader is wired it passes an `idle` snapshot (and the records are masked whenever `data.__storeId` is not the selected store's id), so the screen says "Deliveries are not
loaded." and still shows days off; it never stands a number in for a missing one.

## The Manager patch (proposed replacement, held, not pushed)

The approved experience replaces the old calendar surface instead of sitting beside it, and
the new view carries no inferred staffing. Under the build-time flag `SCHEDULER_CALENDAR`
(`import.meta.env.VITE_SCHEDULER_CALENDAR === "1"`, which no deploy sets) the patch:

- **Desktop (`StoreHero`):** renders the entry in place of `SignalSchedule`, which removes the
  "N working today" chip and the old month grid together. The entry is one button in the
  side rail; the calendar opens as a dialog because the rail is too narrow for full-size
  dates.
- **Phone (`BoardRoomPhone`):** hides the old month button (`bp-r1`) and the "N on" button
  (`bp-r3`, which counts everyone not listed off as working), and adds the compact calendar
  as the last row of the hero.
- **Flag off:** every legacy element renders exactly as before. The patch is 15 added lines
  and no removed or reindented line, plus the lazy import in the style of `FenceEditor`.

It is not pushed, for reasons that need their own review:

1. The preview build pins `Manager.jsx` by hash and refuses a changed file, and its transform
   removes the same `bp-r1` and `bp-r3` buttons by their text, so the wrapped versions break
   it. Reconciling that is a `build.mjs` change, outside the recorded build exception.
2. `scripts/search-runtime.sha256` lists `Manager.jsx`. Against this base it already reports
   `LeadPerformanceCalculator.jsx` as a mismatch; the patch adds a second. That manifest is not
   touched here.
3. Hiding the on/off surfaces and replacing the desktop schedule chip are visible changes on
   the dashboard, so they need Jorge's approval and a look on a phone (Rule 5).

## Inputs, by the keys the app already uses

| Prop | From | Notes |
|---|---|---|
| `storeId`, `month` | the caller | The screen never picks a month. The month is the real Eastern business month unless the caller moves it. |
| `today` | optional | Defaults to the dealership's date (`America/New_York`), not the browser's. |
| `reported`, `principalEpoch` | the reader's snapshot `{status, days, storeId, month, principalEpoch}`, and the epoch the caller holds now | `days` are `{date, status, count, vehicles, asOf}` with status `provisional`, `missing`, `incomplete` or `conflict`. Only `status: "ready"` is read, and only when every row meets the reader's whole contract (see below). |
| `roster` | `data.roster` | People with a `roleId`. Bound by `id`; a name is only a label. First record of an id wins. `hiredAt` is the start date. |
| `departed` | `data.departed` | `[{name, at}]` as the app keeps it, matched by name the way the app does (`id` is accepted too). |
| `daysOff`, `forcedOff` | `data.daysOff`, `data.forcedOff` | `{[id]: [date]}`. Dated membership, one date at a time. |
| `presentAnyway` | `data.presentAnyway` | `{[date]: [id]}`. |
| `scheduleSource` | `data.scheduleSource` | `{[month]: {file, at, kind, off, unmatched}}`. Shown back so a month read wrong is visible next to what the file said. Unmatched names ask for review. |
| `isOff(id, date)` | optional | The app's own rule (`isOff` in `LeadPerformanceCalculator.jsx`), so a listed day somebody plainly worked is not off. Without it the raw lists decide, and the model says so (`rule: "listed"`). |
| `layout` | the caller | `"panel"` (desktop, tablet) or `"compact"` (phone: a toggle, closed until asked). |
| `selectedDate`, `onSelectDate`, `onRetry` | the caller | Controlled or uncontrolled selection. A retry button shows only for `unavailable`, never for `denied`. |

### Employment bounds

The app's own `servedOn`: both ends inclusive. Somebody is counted on the day they started
and on the day they left, and not before or after. Outside those days they are not listed at
all, neither Off nor Not listed off, so a hire on the 15th has no days off on the 1st. A
date that cannot be read is no bound, as no start date has always meant the whole month. A
test compares the model with `servedOn` on every date of a month around both bounds.

### The reader's whole contract

A `provisional` row needs a whole-number count, an `asOf` with a real millisecond ISO
timestamp and a known basis, and a New and Used split that is either both null or adds up to
the count. The other statuses need a null count, null split and null `asOf`. One bad row, a
duplicate or missing date, or a date outside the month makes the whole month unavailable,
as the reader's own projection does. A count with no timestamp is never coloured and never
added to a total. A date or month that cannot be read fails closed and does not throw. A month whose days
each fit a safe integer but whose sum does not is unavailable, never a rounded total.

### How the states read

| Reader status | Screen |
|---|---|
| `provisional` with a whole-number count | `N delivered`, with the report's own time and basis ("As of Oct 13, 6:05 PM, report sent. Not final."), and New and Used only when they add up to the count |
| `missing` | `Unknown` |
| `incomplete` | `Incomplete`, its own mark |
| `conflict` | `Conflict`, its own mark |
| a date after today | `Pending`, whatever the rows say |
| `idle`, `loading`, `denied`, `unavailable`, a store, month or epoch mismatch, or any row that breaks the contract | the whole month is unavailable; the grid stays, every date neutral |

## Differences from the preview, on purpose

- **A month of zeros crowns nobody.** The preview marks every zero day "Best recorded ·
  tied" when the best is zero. Live code marks a best day only when it is above zero.
- **No "Closed" state.** The reader's contract has no closed status, so a closed day reads
  as `missing` until a source says otherwise. It is not invented.
- **`Incomplete` and `Conflict` are shown as themselves** instead of folding into Unknown,
  because the reader keeps them apart.
- **No fixtures, no harness.** The preview's fictional fixtures and historical-weekday
  forecasts are not used anywhere in this path.

## Known limits

- **Shift lengths are unknown.** No source the app holds carries one, so none is shown or
  guessed (`durations: "unknown"` in the day detail).
- **Off-day provenance is per month, not per date.** `scheduleSource[month].off` says which
  dates a file listed; `daysOffAt` is one stamp per person and is not used. The current
  per-person CAS merge does not make date-level concurrent edits safe, and this screen does
  not edit.
- **Provisional is not final.** Every count carries "Not final" until the reader has a
  status for it. Outstanding reader review items (same-session auth refetch, non-integer
  counts, timing margin, raw-source expiry) stay with X19 and X20. This model rejects
  non-integer counts itself rather than waiting for them.
- **Desktop side panel and larger calendar.** The component is one responsive card. The
  placement (side panel beside the Performance hero, the dialog on the dashboard) is
  `Manager.jsx` work and waits for the handoff.
- **Not yet checked on a phone.** Rule 5 still applies before anything is merged or shown
  as done.

## Checks

```
node --test test/scheduler-calendar-model.test.mjs
node scripts/probe-scheduler-calendar.mjs                  # Chromium
FEEL_BROWSER=webkit node scripts/probe-scheduler-calendar.mjs
```

The probe needs Playwright (`FEEL_PLAYWRIGHT` or the project's own) and runs axe when
`AXE_CORE` points at its package directory; it says so when axe was not run.
`npm test` and `npm run build` are unchanged by this branch: the build does not reach these
files because nothing imports them.

## The month review provider (source only, not wired)

`scripts/scheduler-performance/month-review.mjs` makes "reviewed" something an editor and a
server can both compute from the same explicit input. It adds no algorithm. It builds a
planner from the input through the planner's public API (`createPlanner`, `get`, `rows`) and
returns the rows that planner returns, so issues, coverage, forecast, eligibility and
neighbouring weeks are the planner's own. `month-model.mjs` is not changed.

**What a month's rows depend on, all carried in the input.** The store the planner started
with (people, rules, history, planning policy, timezone, and the teams and memberships that
seed team snapshots); the current ordered teams and memberships; the month's own draft and
the draft of every neighbouring month in its Monday to Sunday span, each with its own store
copy and overrides; and a base assignment for every span day, written out and null where
there is none. A month with no draft resolves to the base store with no overrides, as the
planner does today. There is no fallback to a function or a fixture, and a store that does not
carry its teams and memberships is refused, because the planner would otherwise seed
placeholders.

**Two fingerprints, kept apart.**

| Value | What it is | Use |
|---|---|---|
| `legacyFingerprint` | exactly `JSON.stringify(rows)`, the value the editor compares today | compatibility only; depends on key order, so a server cannot rely on it |
| `digest` | SHA-256 of key-sorted `{definition, scope, span, rows}`, definition `month-review/1` | what a server recomputes and compares |

The rows are whole rows, so forecasts, pinned history and policy, and neighbouring weeks are all
in both. A change to the canonical form is a new definition string, and a pinned test fails
until that is done on purpose. Hashing is never this file's own: the caller supplies `sha256`,
and it is checked against nine known answers on every use.

**Trusted recomputation.** `verifyReview(input, {definition, digest}, {sha256})` recomputes and
compares, and on a match returns only `{ok, digest, openIssues}`, never the rows. A claim that
carries its own rows, issue count or fingerprint is refused, and so is input that carries a
caller's `openIssues` or `recomputedFingerprint`. Every answer from the supplied `sha256` must be
64 lowercase hex and the same on a second ask, and it is first checked against known answers that
include non-ASCII text, a 1000 character input and both sides of the 56 and 64 byte block edges.

**Input is strict.** Plain JSON only, copied and frozen: plain objects, and plain dense arrays with
no extra properties or holes (a subclass, getter or holey array is refused; a proxy is copied by descriptors, so nothing of it survives, and an array's length is
checked before it is walked). It is bounded in depth, nodes, characters, key length and per-record
counts, and in time: assignments times memberships is capped, because the planner looks up
memberships per person per day. Every key of a day record is named and the keys the planner reads
(`on`, `off`, `shifts`, `generationLocks`, `generation`, and so on) are type-checked, so bad input is
refused here with a named code and does not fail inside the planner; any planner exception is
rethrown as a named `planner` refusal. Months outside the planner's own range are refused as
`scope`. Unknown keys, missing span days, a missing scope month draft, a store id that is not the
scope's, non-finite numbers, accessors and `__proto__` are all refused.

**Export proves itself.** `exportReviewInput` takes the planner, the `stores` it was created with
(unchanged) and its `assignmentForDay`, rebuilds a planner from the exported input, and refuses with
`parity` unless the rows match the live planner byte for byte. State the input cannot carry, such
as a base store changed after the planner was made, is therefore refused and not exported. Like
`rows()`, it creates the month's draft if there is none, and a falsy `assignmentForDay` answer is
"no assignment", as in the planner.

**Known limits.**
- `month-model.mjs` imports `scripts/scheduler-proposal/model.mjs`, which holds the pure date and
  rule helpers and also the synthetic `fixtures()`. The provider never calls `fixtures()` (a test
  reads its source), but a server importing it loads that module. Splitting the pure helpers out
  needs that file's owner.
- The planner's forecast text currently ends "Fictional illustration, not a calibrated forecast."
  That string is part of the rows, so it is in the fingerprint. It is the planner's wording, not
  changed here.
- Nothing calls this yet: no editor, server, storage or database wiring.
