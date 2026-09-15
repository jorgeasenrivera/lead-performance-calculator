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
| A5 | **The roster card's sizing.** One CSS rule, `.s2g4 svg`, was written as a descendant selector and caught the 9px verdict glyphs as well as the dial, drawing them at 68x34. Labels spilled onto their neighbours and the row ran off the card. Fixed, with the wrap breakpoint, the label that wraps in its column, the dock clearance and the demo seed's units. Approved 14 September, items 1 to 5. | Claude | `claude/mobile-site-optimization-qvei7u` | `src/Manager.jsx`, `scripts/demo-seed.mjs` | in review | #331 |
| A6 | **The desks caption on the Live Activity.** It reads "1 and 2 and 3 and 4 and 5 and 6 are open" because the free desk numbers are joined with the word "and". It should say "6 desks open". Written and held: there is no Swift toolchain in a web session, and the pull request's own iOS check could not run because the Expo account has used its free-plan builds for the month. It merges when a real build can check it. The patch is on `claude/desks-caption`. | Claude | `claude/desks-caption` | `native/targets/queue/QueueActivity.swift` | blocked on the Expo build quota | - |
| A7 | **Make the required checks reliable on Windows.** Git currently converts the checkout to CRLF, which breaks source guards written against LF, and five tests turn a Windows file URL into `C:\\C:\\...`. Keep code files on LF and resolve file URLs with Node's cross-platform helper so Codex can run the same required checks Claude and CI run. No product behaviour or pixels change. | Codex | `codex/windows-checks` | `.gitattributes`, `test/` | in progress | - |
| A4 | **Move the restore point out of the store row.** Every save currently ships a copy of the state it is replacing. Putting the restore point in a key of its own makes a save smaller and a store row easier to read. Noted in the September audit and deliberately not taken then, because it is bigger than the rest of that batch. | - | - | `src/LeadPerformanceCalculator.jsx`, `api/`, `test/` | open | - |

## Settled

**The reports outage, 12 to 15 September.** Nine of ten stores stopped filing at about 15:10 ET on 12 September and it ran for three days. The cause was `lpc-mail`'s `INGEST_URL` pointing at a Vercel deployment URL rather than the site's domain: Vercel removed that deployment and every report since was posted to a 404 and dropped. Nothing else showed it, because a 404 never reaches the function and so never reaches `app_errors`, and the endpoint itself tested healthy throughout. Jorge repointed both workers at `https://www.sageonline.io/...` on 15 September and stores began filing again the same morning. The morning brief now checks for silence first, so a repeat is a one-morning outage rather than a three-day one.

Worth knowing for next time: these must never point at a `*-<hash>-<org>.vercel.app` URL. Those are per-deployment and Vercel collects them. Only the domain is stable.

## Outside the repo, for Jorge

These are not agent work. They are here so nobody proposes them again.

| # | Item | Status |
|---|------|--------|
| J1 | Delete the empty "sage" Expo project on the jorgeasenriv team, then retry the transfer. | waiting on Jorge |
| J2 | Delete the Vercel project `lead-performance-calculator-srnl`. | done 14 September |
| J3 | Have a word with a salesperson about the PIN coming out of sign-in (#326). It is the only recent change that alters what they do on a Sunday morning. | waiting on Jorge |

## Done

| # | Item | Owner | PR |
|---|------|-------|-----|
| D1 | The PIN stage removed from sign-in. Picking a name is the whole of it. | Claude | #326 |
| D2 | One way to say two names are one person: one sentence, one audit line. | Claude | #327 |
| D3 | Printing opens one window, and the sign-in poster takes the room. | Claude | #328 |
| D4 | The two-tap check measures from inside the page and reads the server until it settles. | Claude | #329 |
