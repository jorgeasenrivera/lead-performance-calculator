# In flight

The board. One row per item, and a row is claimed by committing it to `main`
before the work starts. That commit is the lock: it needs no shared runtime and
it survives an agent losing its session. If two claims race, the one already on
`main` wins and the other agent takes something else.

Release a claim in the same pull request that finishes the work, by setting the
row to done and adding the pull request number.

**Rules that live on this board**

- Never work an item claimed by somebody else, and never push to their branch.
- At most one open branch may touch `src/LeadPerformanceCalculator.jsx` or
  `src/Manager.jsx`. Check the Files column before claiming.
- If the hot files are taken, take an item under `api/`, `scripts/`,
  `supabase/`, `test/`, `workers/`, `native/` or `docs/`, or review the open
  pull request instead.

Status is one of: `open`, `in progress`, `needs approval` (a visual change
waiting on Jorge's proposal page), `in review`, `done`.

---

## Open

| # | Item | Owner | Branch | Files | Status | PR |
|---|------|-------|--------|-------|--------|-----|
| A1 | **The Online room.** The under construction page is built and live. The room itself still exists: its tool pill, sign-in parameter, salesperson tab, `LEAD_VARIANTS` entry and row family. Jorge marked this LATER, so it is not to be removed until he says. | - | - | `src/Manager.jsx`, `src/LeadPerformanceCalculator.jsx` | open (deferred by Jorge) | - |
| A2 | **Ten stores with no goal.** Four of fourteen stores have set a monthly goal. The prompt that would ask for one is not built. Marked LATER. Needs a proposal page before anything is drawn. | - | - | `src/Manager.jsx` | open (deferred by Jorge, needs approval) | - |
| A3 | **Drop `public.queue_identity`.** Six rows, last touched 22 August, and nothing reads or writes it since the PIN came out in #326. Dropping a table cannot be undone, so it waits for Jorge to say the word. A migration under `supabase/migrations/`, nothing else. | - | - | `supabase/migrations/` | open (waiting on Jorge) | - |
| A4 | **Move the restore point out of the store row.** Every save currently ships a copy of the state it is replacing. Putting the restore point in a key of its own makes a save smaller and a store row easier to read. Noted in the September audit and deliberately not taken then, because it is bigger than the rest of that batch. | - | - | `src/LeadPerformanceCalculator.jsx`, `api/`, `test/` | open | - |

## Outside the repo, for Jorge

These are not agent work. They are here so nobody proposes them again.

| # | Item | Status |
|---|------|--------|
| J1 | Delete the empty "sage" Expo project on the jorgeasenriv team, then retry the transfer. | waiting on Jorge |
| J2 | Delete the Vercel project `lead-performance-calculator-srnl`. | waiting on Jorge |
| J3 | Have a word with a salesperson about the PIN coming out of sign-in (#326). It is the only recent change that alters what they do on a Sunday morning. | waiting on Jorge |

## Done

| # | Item | Owner | PR |
|---|------|-------|-----|
| D1 | The PIN stage removed from sign-in. Picking a name is the whole of it. | Claude | #326 |
| D2 | One way to say two names are one person: one sentence, one audit line. | Claude | #327 |
| D3 | Printing opens one window, and the sign-in poster takes the room. | Claude | #328 |
| D4 | The two-tap check measures from inside the page and reads the server until it settles. | Claude | #329 |
