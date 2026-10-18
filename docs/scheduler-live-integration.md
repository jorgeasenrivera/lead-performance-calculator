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
| `test/scheduler-calendar-model.test.mjs` | 27 synthetic guards for the contract. Part of `npm test`. |
| `scripts/probe-scheduler-calendar.mjs` | Builds the component alone and checks it in a real browser (Chromium, or WebKit with `FEEL_BROWSER=webkit`). Not part of `npm test`. |

## What is not here

- **`src/Manager.jsx` is untouched.** It is held until the owner of #485 acknowledges a
  serialized handoff. No import, no entry button, no open and close state.
- **No parser, endpoint, auth adapter, month transport or projector.** X14 #455, X15 #456,
  X19 #462 and X20 #463 keep their files. This code takes the reader's snapshot as a prop
  and does not import the reader.
- **No writes.** The screen reads props and calls back for a retry. It saves nothing, and it
  does not edit a schedule. Editing the schedule (the approved editor in the preview) is
  the next piece, and it is not started.
- **No backend, database, schema, credential, permission or deployment change, and no live
  data query.** Every row in the tests and the probe is synthetic.

## The three rules

1. **Delivered is only a count somebody reported.** A reported zero is a zero. A day with
   no report is `Unknown`, a day still to come is `Pending`, and neither is ever a zero. A
   month with no reported day has no total (`null`), not a total of zero.
2. **Off is only a day somebody listed.** Not being listed off does not make a person On.
   Everyone else is "Not listed off", in a closed list, with a line saying so. A person
   is called Present only when a manager said so (`presentAnyway`).
3. **Another store's or month's answer is no answer.** The snapshot carries the store and
   month it was fetched for, and both must match what is on screen, or the month shows as
   unavailable.

## Inputs, by the keys the app already uses

| Prop | From | Notes |
|---|---|---|
| `storeId`, `month` | the caller | The screen never picks a month. The month is the real Eastern business month unless the caller moves it. |
| `today` | optional | Defaults to the dealership's date (`America/New_York`), not the browser's. |
| `reported` | the reader's snapshot `{status, days, storeId, month}` | `days` are `{date, status, count, vehicles, asOf}` with status `provisional`, `missing`, `incomplete` or `conflict`. Only `status: "ready"` is read. |
| `roster` | `data.roster` | People with a `roleId`. Bound by `id`; a name is only a label. First record of an id wins. |
| `departed` | `data.departed` | `[{id, at}]`. Not counted from the day they left. |
| `daysOff`, `forcedOff` | `data.daysOff`, `data.forcedOff` | `{[id]: [date]}`. Dated membership, one date at a time. |
| `presentAnyway` | `data.presentAnyway` | `{[date]: [id]}`. |
| `scheduleSource` | `data.scheduleSource` | `{[month]: {file, at, kind, off, unmatched}}`. Shown back so a month read wrong is visible next to what the file said. Unmatched names ask for review. |
| `isOff(id, date)` | optional | The app's own rule (`isOff` in `LeadPerformanceCalculator.jsx`), so a listed day somebody plainly worked is not off. Without it the raw lists decide, and the model says so (`rule: "listed"`). |
| `layout` | the caller | `"panel"` (desktop, tablet) or `"compact"` (phone: a toggle, closed until asked). |
| `selectedDate`, `onSelectDate`, `onRetry` | the caller | Controlled or uncontrolled selection. A retry button shows only for `unavailable`, never for `denied`. |

### How the states read

| Reader status | Screen |
|---|---|
| `provisional` with a whole-number count | `N delivered`, with the report's own time and basis ("As of Oct 13, 6:05 PM, report sent. Not final."), and New and Used only when they add up to the count |
| `missing` | `Unknown` |
| `incomplete` | `Incomplete`, its own mark |
| `conflict` | `Conflict`, its own mark |
| a date after today | `Pending`, whatever the rows say |
| a bad count (not whole, negative, text) or a status the contract does not know | that day is unavailable, never rounded into a number |
| `idle`, `loading`, `denied`, `unavailable`, or a store or month mismatch, or duplicate or out-of-month rows | the whole month is unavailable; the grid stays, every date neutral |

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
