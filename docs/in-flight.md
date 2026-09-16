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

**The ids carry the prefix of whoever wrote the row.** `C` for Claude, `X` for
Codex, each counting up its own run: `C1`, `C2`, `X1`. Pick the next free number
in **your own** letter and you cannot collide with the other agent, because
nobody else is drawing from it. Jorge settled this on 15 September.

The prefix is the row's author, not the item's owner. A row Claude writes for
Codex to own is still a `C` row, because the point is the moment of writing: two
agents both reaching for "the next free number" in one shared run is the race,
and an owner prefix does not fix it when one agent opens an item for the other.
The Owner column says who has it.

This was learned the hard way, twice in one afternoon. Codex claimed A7, Claude
claimed A7 two minutes later, and then both agents fixed it at once and made a
second collision: Claude dropped its row, Codex renamed its own to A8, and
Claude wrote a new row at A8 having read the board before Codex's rename landed.
A read, a write, and somebody else's write in between. A shared counter needs
coordination that a commit race does not provide.

If two rows ever do take one id, the row already on `main` keeps it and the
later push moves. Renumber your own row, never the other agent's.

The Done table is keyed by pull request number for the same reason: it is
already unique, and an invented id there was one more counter to race on.

Status is one of: `open`, `in progress`, `needs approval` (a visual change
waiting on Jorge's proposal page), `in review`, `done`.

---

## Open

| # | Item | Owner | Branch | Files | Status | PR |
|---|------|-------|--------|-------|--------|-----|
| C1 | **The Online room.** The under construction page is built and live. The room itself still exists: its tool pill, sign-in parameter, salesperson tab, `LEAD_VARIANTS` entry and row family. Jorge marked this LATER, and said LATER again on 15 September, so it is not to be removed until he says. | - | - | `src/Manager.jsx`, `src/LeadPerformanceCalculator.jsx` | open (deferred by Jorge) | - |
| C2 | **Ten stores with no goal.** Four of fourteen have set one. **This row used to say the prompt was not built, and that was wrong.** `StoreHero` already offers `/ set a goal · last month N` on a month with none, already turns `/ N goal` into a button titled Change this month's goal, and already writes an audit line on every set. Every admin and manager sees it. What is missing is that nothing *asks*: the control waits to be noticed. And the audit line carries the new figure but not the old, with no confirmation, so an accident and a decision read the same. Jorge chose **stays** and **both** on 15 September, and it is built and pushed. One finding changed the shape: `storeGoalFor` falls back to the store's standing figure, so a card keyed on "this store has no goal" would never appear again for the four stores that have ever set one. `goalMonthState` tells a month's own figure from one it carried. The carried-over wording is new and still needs Jorge's word. Settled 15 September: the card **stays**, the audit gets **both** halves, and goals are **month specific with the figure written in**. The standing-figure fallback in `storeGoalFor` is gone, along with the two screens that had inlined it by hand. Four store-months that were borrowing a goal now correctly show none: Holler Ford July and August, Holler Honda July, Driver's Mart Winter Park July. | Claude | `claude/mobile-site-optimization-qvei7u` | `src/Manager.jsx`, `api/_store-month.mjs` | done | #343 |
| C4 | **The desks caption on the Live Activity.** It reads "1 and 2 and 3 and 4 and 5 and 6 are open" because the free desk numbers are joined with the word "and". It should say "6 desks open". Written and held: there is no Swift toolchain in a web session, and the pull request's own iOS check could not run because the Expo account has used its free-plan builds for the month. It merges when a real build can check it. The patch is on `claude/desks-caption`. | Claude | `claude/desks-caption` | `native/targets/queue/QueueActivity.swift` | done | #340 |
| X1 | **Make the required checks reliable on Windows.** Git currently converts the checkout to CRLF, which breaks source guards written against LF, and five tests turn a Windows file URL into `C:\\C:\\...`. Keep code files on LF and resolve file URLs with Node's cross-platform helper so Codex can run the same required checks Claude and CI run. No product behaviour or pixels change. | Codex | `codex/windows-checks` | `.gitattributes`, `test/` | in review | #336 |
| C5 | **Review the `--dvh` and safe-area division inside the text-size zoom.** Merged in #334. One rule redefines `--dvh`, `--sat` and `--sab` inside the four zoom roots so the phone's own measurements are not enlarged along with the words, and it carries every full-height salesperson screen. Verified by measurement and pixel diff in Chromium only, so WebKit is the open question, along with whether `--satx` can leak to the manager and two hand-tuned constants no test holds. The brief is the issue. | Codex | - | review only, no branch | open | #335 |
| C9 | **"Short by 126 at this pace" is not a pace figure.** `storePace.short` is `goal.bar - totalUnits`, the plain gap still to sell. The line calls it "at this pace", which is a projection. Holler Ford: goal 200, sold 74, so it says short by 126, while at this pace the store lands on 159 and is 41 short. Either the words or the number is wrong, and `needPerDay` uses `short` correctly, so it is the words. Copy, so it needs Jorge. | Claude | Claude | `claude/short-at-pace` | done | #344 |
| C12 | **The manager's sticky header is see-through on a phone.** `.topstack` is `position:sticky` with no background at all. On the desk `.topbar` happens to fill it, so nothing shows. On a phone the stack is 100px tall, `.topbar` covers the top 58 and `.sect-strip` the bottom 33 at 14% opacity, so the hero scrolls straight through a 9px band and through the tab pills themselves. `.topstack::after` paints a 20px white fade under the whole thing, which on the green hero reads as the white line that never goes away. Mobile only: on the desk the stack is 62px and the bar covers all of it. | Claude | `claude/mobile-site-optimization-qvei7u` | `src/Manager.jsx` | done | #343 |
| C6 | **Move the restore point out of the store row.** Every save currently ships a copy of the state it is replacing. Putting the restore point in a key of its own makes a save smaller and a store row easier to read. Noted in the September audit and deliberately not taken then, because it is bigger than the rest of that batch. | - | Claude | `claude/restore-point` | done | #346 |

## Settled

**The reports outage, 12 to 15 September.** Nine of ten stores stopped filing after 12 September and it ran for three days: the reports for the 13th and the 14th never arrived, and the 15th's did once it was fixed.

Corrected 15 September: this first said the outage began "at about 15:10 ET on 12 September", read off the last time those store rows were written. That was wrong about the schedule. Reports arrive in the MORNING, which the restored run showed plainly, all ten stores between 09:01 and 09:34 ET. So the 12th's reports had already filed that morning, the URL broke early that afternoon, and the first delivery actually lost was the morning batch of the 13th. The cause was `lpc-mail`'s `INGEST_URL` pointing at a Vercel deployment URL rather than the site's domain: Vercel removed that deployment and every report since was posted to a 404 and dropped. Nothing else showed it, because a 404 never reaches the function and so never reaches `app_errors`, and the endpoint itself tested healthy throughout. Jorge repointed both workers at `https://www.sageonline.io/...` on 15 September and stores began filing again the same morning. The morning brief now checks for silence first, so a repeat is a one-morning outage rather than a three-day one.

Worth knowing for next time: these must never point at a `*-<hash>-<org>.vercel.app` URL. Those are per-deployment and Vercel collects them. Only the domain is stable.

**The scanlines on the round-up head.** The white hairlines across the manager round-up's green head are `.s2-hero::before`'s scanline texture, a white line every three points at three percent, and they are on the dashboard hero card at the same strength. Measured on a flat patch of each at three times scale, with the layer switched off and on: 5.73 luminance steps on the round-up against 5.25 on the hero. They read harder on the round-up only because its head is 102 points tall against the hero's 373, so the same three-stop gradient is compressed and runs darker under them.

Jorge decided on 15 September that they stay: they are part of the character of the site. **Not to be proposed again, and not to be tidied away by anybody who reads the round-up head as a rendering fault.** It is deliberate.

Two dead ends, recorded so nobody walks them twice. The heavy `.s2-noise` layer, which draws the same lines at twenty two percent, is not involved: it sits at `opacity:0` unless the hero is in its grey lost-signal state. And the rounded corner is not leaking the sheet's own background: painting `.ru-sheet` red produces no red at the corner, the clip is clean. Also worth knowing: there are two round-ups, one in `Manager.jsx` and one on the salesperson side, and a question about "the round-up" needs to say which.

**For whoever takes the Windows checks (`X1`).** #334 added seven more source guards to `test/feel.test.mjs`, and several of them match across a line break, for example `` /@container mchead \(max-width:300px\)\{\n  \.mc-corner\{ flex-direction:row;/ ``. They are written against LF and they will fail on a CRLF checkout, which is the thing that item is fixing. They are not a new kind of problem, the file already had them at lines 143, 168, 169, 202 and 222, but they are new instances and they landed after that claim was made. Rebase on `main` before measuring, or the count will be short.

Two claims were numbered A7 on 15 September, by two agents within two minutes of each other. That is what the owner prefixes at the top of this file exist to stop. Worth knowing that the board's ids are not a reliable lock on their own: the row is.

**The 13th and the 14th of September are gone.** The outage cost nine of ten
stores two morning batches, and the reports for those two days were never
resent. Jorge decided on 15 September to live with them as lost rather than
chase a backfill from DriveCentric. So any figure covering that window is short
for nine stores, and it is short on purpose: nobody should go looking for a bug
in it, and nobody should propose the backfill again without Jorge raising it
first.

**Running the stock split backfill (#342).** Written, merged, and not run.
Nothing changes for a month already filed until somebody runs it with live
credentials, which no web session has. The order that makes sense:

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/backfill-stock-split.mjs --store holler-ford --month 2026-09
```

a dry run on one store first, check the new and used it prints against the PDF
for that store, then the same line with `--write`, then drop the filters for the
other nine. It says what it would do and writes nothing until told.

Worth knowing: only 31 August onwards can be recovered, because that is as far
back as the stored reports go. Anything earlier keeps the estimate, and there is
no way to get it back.

## Outside the repo, for Jorge

These are not agent work. They are here so nobody proposes them again.

| # | Item | Status |
|---|------|--------|
| J1 | Delete the empty "sage" Expo project on the jorgeasenriv team, then retry the transfer. | waiting on Jorge |
| J2 | Delete the Vercel project `lead-performance-calculator-srnl`. | done 14 September |
| J3 | Have a word with a salesperson about the PIN coming out of sign-in (#326). | done 15 September |
| J4 | **Run the stock-split backfill.** `node scripts/backfill-stock-split.mjs` says what it would do and changes nothing; `--write` does it. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the real project, which no agent has and none should. Ten files to read, one per store per month. Jorge asked to be reminded, so raise it at the start of every session until it is done. | waiting on Jorge |
| J5 | **The Expo plan.** Upgraded by Jorge on 15 September, and proved rather than assumed: #340 got a real iOS check (build 32, four and a half minutes, not the 62-second skip that means "could not check") and merged. | done 15 September |

## Done

| PR | Item | Owner |
|----|------|-------|
| #326 | The PIN stage removed from sign-in. Picking a name is the whole of it. | Claude |
| #327 | One way to say two names are one person: one sentence, one audit line. | Claude |
| #328 | Printing opens one window, and the sign-in poster takes the room. | Claude |
| #329 | The two-tap check measures from inside the page and reads the server until it settles. | Claude |
| #331 | One selector drew the 9px verdict glyphs at 68 by 34, and three sizings fell out of it. | Claude |
| #332 | One line for the labels, and a morning brief that notices silence. | Claude |
| #333 | There was no third write: the settle rule was reading a chain mid flight. | Claude |
| #334 | The screen's own measurements are not text: the text size is a zoom, and it was enlarging the phone's height and its safe areas along with the words. | Claude |
| #337 | The Online room's under construction page says what a manager gets out of it, in one line, instead of three bullets about the plumbing. | Claude |
| #338 | The Online hero is a sign and a sentence, clear of the header by the 64px the other pages leave. The tape on a phone had been 0px tall since it was written. | Claude |
| #339 | `public.queue_identity` dropped, the PIN's table, with its six rows. Nothing had read it since #326. | Claude |
| #341 | New and used are counted off the report's own rows instead of scaled from the people's, so the stock split is whole cars. | Claude |
| #342 | A backfill for the stock split on months already filed, dry run by default. Written and tested, **not yet run against production**: `scripts/backfill-stock-split.mjs`. | Claude |
