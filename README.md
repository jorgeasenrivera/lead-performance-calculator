# Sage

A dealership runs on two questions nobody has time to answer: who is up, and how
is the month going. Sage answers both on a phone in the five seconds a
salesperson has between customers, and on a desk screen a manager glances at
between calls. It reads the reports the store already emails itself, keeps the
floor's rotation honest, and says who is short and by how much, in words rather
than in a spreadsheet.

This file is the map. `AGENTS.md` is the short list of rules that hold whichever
agent is working, and it is the one to read every session. This one is worth
reading once, properly, before the first change.

---

## Contents

1. [The shape of it](#1-the-shape-of-it)
2. [Running it](#2-running-it)
3. [The checks, and what they are for](#3-the-checks-and-what-they-are-for)
4. [Where things live](#4-where-things-live)
5. [The data](#5-the-data)
6. [Deployment](#6-deployment)
7. [The house style](#7-the-house-style)
8. [Working alongside another agent](#8-working-alongside-another-agent)
9. [A worked example](#9-a-worked-example)
10. [Things that will bite you](#10-things-that-will-bite-you)

---

## 1. The shape of it

A React 18 single page app built by Vite, a handful of serverless functions on
Vercel, and Postgres at Supabase. No framework beyond that, no state library, no
component library. Two files carry nearly all of the app:

| file | lines | what it is |
|---|---:|---|
| `src/LeadPerformanceCalculator.jsx` | ~17,000 | the core: the salesperson's phone, both rooms, sign-in, the shared helpers, the design tokens, and every stylesheet in the app |
| `src/Manager.jsx` | ~28,000 | the manager's surface, lazily loaded: the boards, the desk, People, Import, the reports, the printed sheets |

Their size is the single most important fact about working here. See
[section 8](#8-working-alongside-another-agent).

**Three rooms.** Live Floor is the walk-in rotation, Phone Line is the phone
opportunity queue, and Online exists but has never been used by any store and
currently shows an under construction page.

**Two audiences, one truth.** A salesperson sees their own corner: where they are
in the line, their day, their month. A manager sees the store. Both read the same
rows, so they cannot disagree.

---

## 2. Running it

```bash
npm install
npm run dev            # http://localhost:5173 against whatever .env.local points at
```

`.env.local` carries `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It is
gitignored and stays that way. Never commit one.

### Against the local mock, which is how you should usually work

`scripts/mock-supabase.mjs` is a small stand-in for Supabase, seeded from
`scripts/demo-seed.mjs` with a whole demo store: fourteen people, a month of
figures, a floor with a line on it. It needs no network and no credentials.

```bash
printf 'VITE_SUPABASE_URL=http://127.0.0.1:5433\nVITE_SUPABASE_ANON_KEY=mock-anon-key\n' > .env.local
SALESPERSON=1 node scripts/mock-supabase.mjs &     # port 5433
npm run build && npx vite preview --port 5178 --host 127.0.0.1 &
```

`SALESPERSON=1` seeds the salesperson's own screens as well, and the feel harness
refuses to run without it. Sign in as `demo@sageonline.app` with any password.

To stop the mock, match the exact command so you do not kill your own shell:

```bash
for pid in $(pgrep -f '^node scripts/mock-supabase.mjs$'); do kill $pid; done
```

---

## 3. The checks, and what they are for

Three checks reached production in one week once, all found by somebody noticing
a wrong number on a screen days later. Every one was catchable in milliseconds.
That is why these exist, and why none of them is optional.

```bash
npm test        # every test under test/, Node's own runner, no network, under a second
npm run build   # a build that fails is as broken as a test that fails
npm run check   # both of the above
npm run feel    # the phone, measured in a real browser
```

### `npm test`

Roughly forty files under `test/`. Almost every case is a fault that reached
production first, kept so the second time is free. `test/README.md` says which
fault each one holds the line on. Two are worth knowing about up front:

- `test/feel.test.mjs` holds the phone's feel **in the source**: no control
  greyed out for a round trip, taps committed before the server answers, rails
  that spring on `transform`, the motion tokens used rather than raw numbers, and
  the shape of the recent cut list work. It is the fastest way to catch a change
  that quietly undoes a decision.
- `test/no-duplicates.test.mjs` is structural, and `test/README.md` explains it.

### `npm run feel`

The feel harness drives the real app in a real browser against the mock, with a
dealership's 400 ms added to every data request, and fails over the bar:

| bar | what it means |
|---|---|
| a tab under 150 ms | the other room is the screen the phone already had |
| a tap drawn under 100 ms | drawn in the frame it landed in, not after the server answers |
| two taps in one round trip | the second wins, on the screen and on the server |
| a press that gives, with one tick | the control moves under the finger and buzzes once |
| a return sign-in in about a second | signing in again the same day takes the short way |

Setup, in this session's environment:

```bash
FEEL_URL=http://127.0.0.1:5178/ \
FEEL_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
npm run feel
```

`FEEL_LAG` sets the added delay per request (default 400). `FEEL_CPU=4` throttles
the processor four times over, which is roughly a three year old phone on a hot
afternoon. `FEEL_DEBUG=1` narrates.

`FEEL_BROWSER=webkit` runs it in Playwright's WebKit instead of Chromium. WebKit
is what the app's WebView is, and Chromium at phone width is not the phone:
the glitches that reach Jorge from the lot are the kind only WebKit shows. CI
runs both; the WebKit run reports without blocking until it has been green on
three merges, then it blocks like the other. This session's container has no
WebKit, so here it is the Chromium run and CI is the WebKit one.

Two things the harness has taught, both the hard way, both now written into it:

- **Scope every room selector.** Both rooms stay mounted and the hidden one comes
  first in the markup, so an unscoped `.sf-seg-btn` click lands on a
  `display:none` button and does nothing. Use the `ROOM` constant.
- **Do not measure through the channel you are loading.** Sampling the screen
  forty times a second from outside the browser starves on a loaded runner and
  reports a tap it never looked for. The screen records itself in the page now,
  and the server is read until two reads agree.

### In CI

`.github/workflows/checks.yml` runs both jobs on every push and every pull
request, the feel job inside Playwright's own image so the numbers come from the
same machine every time. On a pull request the table is posted as a comment, so
every diff says what it did to the phone.

`.github/workflows/sage-app.yml` builds the phone app and hands it to TestFlight
or Google Play, from a browser, on demand.

**Do not merge red.** If a check fails for a reason you believe is not yours,
prove it in the pull request and fix the measurement. Do not loosen a bar and do
not add a retry.

---

## 4. Where things live

```
src/
  LeadPerformanceCalculator.jsx  the core, the phone, both rooms, the styles
  Manager.jsx                    the manager's surface, lazily loaded
  SageMark.jsx                   the identity, one drawing on the 9x9 PixIcon grid
  FenceEditor.jsx                the lot boundary editor
  report.js                      what the phone reports about itself: errors, web vitals
  sw.js                          the worker that keeps the fonts on a phone with no signal
api/                             Vercel functions. _underscored files are shared modules,
                                 not endpoints, and are where the testable logic lives
scripts/
  mock-supabase.mjs              the local stand-in for Supabase
  demo-seed.mjs                  the demo store it is seeded from
  feel.mjs                       the feel harness
test/                            the checks, and test/README.md on why each exists
supabase/migrations/             the schema, baseline plus migrations
workers/lpc-mail.js              the Cloudflare email worker that catches the store's reports
native/                          the Expo shell around the site, and its own README
docs/routines.md                 the three scheduled jobs that look after Sage unattended
docs/in-flight.md                the board: who is working on what
docs/handoff.md                  messages between the two agents
NOTES.md                         asked for, not built yet, and the decisions behind it
HANDOFF_3.md, HANDOFF_4.md       what a past session knew
```

The `api/_*.mjs` modules matter more than they look. Anything worth testing lives
in one of them so a test can reach it without a browser: `_people-status.mjs`
(who works here and who two spellings belong to), `_stations.mjs` (the desks),
`_store-merge.mjs` (what happens when two tabs save the same store),
`_report-parsers.mjs` (reading the store's emailed reports).

---

## 5. The data

Supabase project `dydfevdnpppvxgdptiwv`. The tables that matter:

| table | what it holds |
|---|---|
| `app_data` | the store document and everything keyed off it: config, daily rows, backups, boards |
| `floor_public` | one row per store per day, the Live Floor: the line, the assists, the history |
| `queue_public` | the same for the Phone Line |
| `floor_people` | the link between an account and a person on the roster |
| `profiles` | accounts |
| `deal_events` | the read-only feed from DriveCentric that flips a salesperson to "with a guest" without anybody remembering to |
| `app_errors` | every crash on a phone, failed write and server fault, grouped by fingerprint |
| `app_vitals` | INP, LCP and CLS from real phones, with the build, the room and the store |
| `queue_identity` | dead since #326. Six rows. Nothing reads it. See `docs/in-flight.md` item C3 |

Row level security is the only boundary, so treat every policy change as a
security change. Schema changes are migrations under `supabase/migrations/`,
never ad hoc SQL against the live project.

The reports arrive by email: the store forwards them to an address that a
Cloudflare worker catches and posts to `/api/ingest`, which parses and files them.
`test/parsers.test.mjs` and `test/ingest-routing.test.mjs` are what stand between
that and a fortnight of one store showing another store's salespeople.

---

## 6. Deployment

The site is on Vercel and deploys from `main`. `api/*.mjs` are its functions.
Supabase holds the data. The phone app is an Expo shell around the site, built by
`.github/workflows/sage-app.yml` on demand, never on anybody's laptop.

Three scheduled jobs look after Sage unattended, documented word for word in
`docs/routines.md`: an hourly error watch that reads `app_errors` and can open
(and in narrow, stated conditions merge) a fix; a morning brief; and a nightly
demo store reset. If you change `src/report.js`, `api/_report.mjs` or the error
schema, read that file, because a routine depends on it.

---

## 7. The house style

**No em dashes.** Anywhere a person reads: the app, commit messages, pull
requests, comments. A comma, a colon or a full stop does the job.

**Write for five seconds.** The reader has a customer walking in and may not be
technical. Show rather than describe. One verdict per row, said in a colour, in a
glyph and in a word, so it survives a mono laser printer, a bright lot and a
colour blind reader.

**Comments explain why.** Look at any block of this codebase: the comment says
what was tried, what broke, and what it cost. That is deliberate. Match it. A
comment that restates the code is noise; a comment that records the reason is the
only copy of that reason there will ever be.

**Motion is tokens, not numbers.** `--t-press`, `--t-release`, `--t-exit`,
`--t-swap`, `--t-settle`, `--t-wipe`, and `MOTION` in the script. A new surface
uses these. `test/feel.test.mjs` holds the two copies together.

**Type and iconography come off one ruler.** Geist, Geist Mono and Space Grotesk
are served from `public/fonts` and cached by the worker, so a lot with no signal
still draws Sage in Sage's faces. `PixIcon` and the Sage mark are one 9x9 grid.

**Nothing visual ships without approval.** Jorge approves visual changes in
advance, on a published proposal page with a decision per item: Approve, Adjust,
or No. A pull request description is not a substitute. Copy, layout, colour,
motion, a new control, a removed control: all of it. If your change leaves the
pixels identical, say so plainly in the pull request.

---

## 8. Working alongside another agent

Two agents work on Sage: Claude Code and Codex. The point of two is not twice the
branches. It is that each reviews what the other could not see. Everything here
exists to get that benefit without the two of you fighting over the same file.

### The one fact that drives all of this

`src/LeadPerformanceCalculator.jsx` is ~17,000 lines and `src/Manager.jsx` is
~28,000. Almost every feature lands in one of them. Two open branches that both
touch one of these **will** conflict, and resolving a conflict in a file that size
is worse than doing the work twice. Every rule below follows from that.

### The board

`docs/in-flight.md`. One row per item: what, who, which branch, which files.

Alongside it, `docs/handoff.md` carries messages between the agents. The board
says who owns what; the handoff says what one agent needs the other to know. It
is the only channel they have, since one runs in a web session and the other on
the desktop, so anything urgent still goes through Jorge. Each agent writes only
in its own section, which is what stops two writers landing on the same line.

Claiming is a commit to `main` **before the work starts**:

```bash
git fetch origin main && git checkout -B main origin/main
# fill in owner, branch, files, status "in progress" on your row
git commit -am "Claim: <item>" && git push origin main
```

That commit is the lock. It needs no shared runtime, works across two different
tools, and survives either agent losing its session. If two claims race, the one
already on `main` wins and the loser picks something else. The claim is released
in the same pull request that finishes the work.

### The single writer rule

**At most one agent may have an open branch touching either big file.** The board
says who. This is the rule that actually prevents the pain, and it is worth more
than any merge strategy.

If the hot files are taken, there is plenty that does not collide:

- `api/` and its `_*.mjs` modules, where the testable logic lives
- `test/`, and the harness in `scripts/`
- `supabase/migrations/`
- `workers/`, `native/`, `docs/`
- database analysis, proposal pages, copy, the design thinking
- **reviewing the other agent's open pull request**, which is worth more than a
  second branch

And the corollary: **no wholesale reformatting.** No import reordering, no
prettier pass, no comment reflow, no rename across a file. One whitespace sweep
through either file turns every open branch into a conflict.

### Branches, pull requests, merges

- One item, one branch, one pull request, merged the day it is written.
- `claude/<slug>` and `codex/<slug>`, so `git log` says who did what.
- Rebase on `main` before every push. A week-old branch costs a day.
- Squash merge. The pull request title becomes the commit subject.
- After a merge, the other agent rebases before its next push.

### Isolation

Each agent already works in its own container or worktree, so filesystem
isolation is free and neither of you should ever be on the other's branch. If you
ever do run two agents on one machine, give each its own `git worktree`. Never two
agents in one working directory: the index lock and the checkouts will collide.

### Review, which is the actual point

When the other agent opens a pull request, read it before it merges. Look for the
thing a second reader catches: a claim in the description that the diff does not
support, a cost the author did not notice, a simpler shape, a test that asserts
the implementation rather than the behaviour. Say it in a review comment, with
the evidence.

Three of sixteen findings in the September audit were wrong on a closer read of
the code. A second reader would have caught them sooner, and that is the whole
argument for this arrangement.

### Splitting by strength

Rough guide, not a rule:

- **Deep reading of a large existing file, motion and feel work, anything where
  the reason matters more than the code:** whoever has the context already.
- **A second opinion on a diff, a spec read closely, an algorithm checked:** the
  other one.
- **Database analysis, parsers, the API modules, migrations, the harness:** either,
  and these collide least, so they are the natural parallel work.

The one thing neither should do is start a second branch on a hot file because
the first one is taking a while.

---

## 9. A worked example

Codex picks up item C6, moving the restore point out of the store row. The `C`
says Claude wrote that row; the Owner column is what says who has it now.

1. **Read** `AGENTS.md`, then this file, then `docs/in-flight.md`, then
   `docs/handoff.md`.
2. **Check the hot files.** C6 touches `src/LeadPerformanceCalculator.jsx`. The
   board shows no open branch on it, so the item is takeable. If Claude had one
   open, Codex would take C3 (a migration) or review instead.
3. **Claim it.** Edit the C6 row: owner Codex, branch `codex/restore-point-key`,
   files, status in progress. Commit to `main`, push. The lock is live.
4. **Branch** from the `main` commit that carries the claim.
5. **Build it.** Small commits, comments that say why, no em dashes.
6. **Check it.** `npm test`, `npm run build`, and `npm run feel` because the core
   file is in the diff.
7. **Prove it.** A restore is a thing you can exercise against the mock. Do it, and
   put what happened in the pull request: what you ran, what came back, what the
   row looked like before and after.
8. **Open the pull request.** Say what changed, what it costs, what you did not do
   and why. Set the C6 row to in review in the same branch.
9. **Ask Claude to review it.** It looks for the claim the diff does not support.
10. **Merge** when both checks are green and the review is answered. Set the row to
    done with the pull request number, in the same merge.
11. **Say so**, in a sentence, so Jorge knows the state without opening GitHub.

---

## 10. Things that will bite you

- **Both rooms stay mounted.** The hidden one is first in the markup. Scope every
  selector to the visible room, in tests and in probes, or you will act on a
  `display:none` control and conclude the app lost your tap.
- **`saveShared(key, value, quiet)`.** The third argument suppresses the buzz.
  Housekeeping writes must pass it, or a tidy-up that clears three hundred rows
  buzzes somebody's phone three hundred times. That happened.
- **A write is a read and then a save.** At a dealership's lag that is most of two
  seconds, so anything that waits on "the server has it now" must wait for the
  row to settle rather than for a fixed clock.
- **The audit log is read by a person.** One action name per outcome. Three
  wordings for one event means a manager cannot tell whether they already did it.
- **The demo store is real data to the tests.** `scripts/demo-seed.mjs` is what
  the mock and the harness are built on. Changing it can move a bar.
- **Dropping anything is forever.** Tables, rows, backups. If it cannot be undone,
  it waits for Jorge, and it says so on the board.
- **`npm ci` before CI-shaped work.** The lockfile is committed; if you change a
  dependency, say so loudly, because it is the one file both agents always touch.
