# LPC — Handoff 4

Written Aug 15, 2026. **Read alongside HANDOFF_2.md and HANDOFF_3.md.** HANDOFF_2 has the
architecture, the duplicated-component trap and the verification recipe. HANDOFF_3 has the RLS
incident, the mail pipeline, and Classic Honda's unparsed PDF. All of that is still accurate.

This document covers the session of Aug 15 and what the next session should do first.

---

## 0. STATE: everything is merged

`main` is at **`7aa64cf`**. Three pull requests merged this session, in order:

| PR | What |
|---|---|
| #2 | Mobile defects, the dot-matrix bottom bar, and the morning round-up |
| #3 | Live Floor / The Line / Online were a dead end; pages opened scrolled |
| #4 | The Board was the other dead end; the rule renamed `solo-top` |

Nothing is outstanding. `claude/mobile-site-optimization-qvei7u` is level with `main`.

**HANDOFF_3's "first five minutes" list is done or obsolete.** PR #1 merged, the RLS audit
question closed with it.

---

## 1. THE MORNING ROUND-UP (new feature, live)

A briefing on the first sign-in of the day: **what improved, what worsened, what to work on, what
to be aware of.** A full sheet once a day, then a one-line bar carrying the tallies as the way back
into it. Seen-today is per device, in `localStorage`, keyed `lpc:roundup:<store>:<date>`.

Code: `RU_TRENDS` (~11623), `ruEvaluate` (~11656), `buildRoundUp` (~11707), `RoundUp` (~11833).

### What it can and cannot trend, and why

This shaped the whole feature, so do not undo it by accident.

- **Activity has a real past.** Every day lands in `data.activity[day]` and, for the last 45, in
  its own row (`lpc:store:<id>:act:<day>`). So this week compares against last week today,
  retroactively, with nothing new stored.
- **The board rates had none.** The Delivery Summary *overwrites* the month's totals on every
  import, and `data.snapshots` is trimmed to a single entry to keep the blob small. Yesterday's
  Delivery % was genuinely gone.

### The digest row, and the key that matters

`digestKey` (line ~1657) writes `lpc:store:<id>:digest:<day>` once a day. Counts only: how many
people are evaluated, the verdict buckets, and how many sit below each standard.

**The prefix is not cosmetic.** RLS permits exactly five patterns, `lpc:config:%`, `lpc:audit:%`,
`lpc:board:%`, `lpc:store:%` and `lpc:backup:%`, the last two gated by
`has_store(split_part(key,':',3))`. A new `lpc:digest:%` would have been **refused, and
`saveShared` fails quietly**: a round-up that silently never learns. Nesting it under
`lpc:store:<id>:` puts it on the existing store policy with **no SQL to run and nothing widened**.

Any future key must clear the same bar. Check `supabase-rls-restore.sql` before inventing a prefix.

### Deliberate calls

- **Texts and emails are never trended.** They are not graded anywhere else, because automated
  follow-up fires whether or not a person is in. Ranking a week of them would contradict that.
- **Days with no rows are skipped, not counted as zero.** A store that does not import on a Sunday
  has not had a bad Sunday.
- Quiet by default: a prior week under 5 events is ignored, moves under 10% are dropped, and a
  digest more than four days off the mark is refused rather than compared against the wrong week.
  *Be aware* says which of the two reasons applies.
- The write is never allowed to matter: guarded per store per day, skipped when nobody is
  evaluated, and a failure costs tomorrow's comparison rather than anything on screen.

---

## 2. THE BOTTOM BAR SPEAKS THE APP'S LANGUAGE NOW

It was the one surface still using Unicode furniture (`◎ ⇪ ▤ ↺ ⋯`) while everything beside it drew
through `PixIcon`. Every button now goes through `PixIcon` on the 9x9 grid.

Glyphs were chosen for what the button opens (`NAV_ICON`, ~15100). Two things fell out of doing it
properly: no glyph repeats inside a bar (`▦` was doing Home, Plates *and* Overview), and **Tickets
had no entry at all**, so it fell back to a bullet.

### NAV_SHORT only shortens; it must never rename

`NAV_SHORT` (~15115) was doing two jobs. Shortening "License Plates" to "Plates" is its purpose.
Turning **Standards into "Rules"** and **Overview into "Home"** is renaming, and neither word
appears anywhere else in the app, so the tab and the drawer entry it opened disagreed about where
you were going. It now only shortens; anything already short enough is left out and falls through
to its real label. Widest resulting label is "Standards" at 52.8px in a 62.4px tab at 320px.

### The icon set had a real redundancy. It is closed now.

**Six glyphs were drawn at two grids and meant the same thing:** `check`, `close`, `warn`,
`triup`, `tridown`, `dot`. `PixIcon` took a `fine` prop that chose between them, and the override
was reachable from every call site.

It got used, by this session's own nav work: the bottom bar drew the **Standards tick and the
Tickets warning at 9x9** while the same two marks were 5x5 everywhere else. Jorge spotted the
mismatch by eye and could not name it, which is exactly how that class of thing shows up.

`PixIcon` no longer lets `fine` apply to a glyph that exists at the coarse grid. A mark can be
drawn one way only, and nobody has to remember which. The prop still works for everything else,
where there is one drawing and the flag was a no-op anyway. **Do not reintroduce the override.**
If a mark ever genuinely needs the detailed grid, give it a distinct name so the two never
compete.

---

## 3. MOBILE DEFECTS FIXED, WITH THE MEASUREMENTS

Every one confirmed by rendering in Chromium and measuring, not by eye. Reuse that habit.

| Defect | Cause | Result |
|---|---|---|
| Header painted **under** page content | `.topbar` dropped to `z-index:40` on mobile while `.hero` is 220 and `.hero-band` is 240 | back to 300 |
| Import page **253px wider than the phone** | `.up-row` kept its desktop six-column grid, needing 643px | stacks; 0px overflow |
| Help button ate the **More tab** | `bottom:18px` over a bar measuring 55px before the home-indicator inset | clears by 12px |
| **Every page started ~50px down** | the `<=720px` block forced `.topbar-right` to `width:100%` on its own row, obsolete once the bottom bar existed | 77px → 48px |
| Metric card **opened off-screen** | centred on a dial whose centre is ~86px from the edge, so a 262px card could not fit | anchors to the strip |
| The round-up sheet **rendered in Times** | `Overlay` portals it to `document.body`, outside `.lpc`, and `.lpc` is where the font is set | the sheet restates it |
| Board **sat further down after closing** the sheet | scroll chaining | `overscroll-behavior:contain` |
| Import badge **sat on its glyph** | plus it was a padded pill shrunk with `transform:scale`, which is why the digits looked soft | hangs off the corner, drawn at real size |

---

## 4. THE THREE SHELLS: DONE, AND WHAT IT COST

This was the most important open item in the previous handoff. It is closed.

There used to be **three separate topbars**, and only one rendered the bottom bar: The Board's, the
performance shell's, and `FloorModule`'s. The mobile rules hid the tool switcher because "switching
lives in the More drawer" — true of the performance shell, false of every module that returned
before that shell was built, because those modules could not reach the drawer at all. Both
self-contained modules were dead ends on a phone: open Live Floor or The Board and there was no way
back. The patch was `solo-top`, a class meaning *this header has no bottom bar under it*, whose CSS
wedged a horizontally scrolling strip of six tool buttons into those headers.

**`AppShell`** (~17205) is now the only shell. All three call sites render through it, so every
module gets the same header, drawer and way out by construction rather than by remembering. What
differs is passed in: `right` for a module's own header bits (store picker, saving dot), and
`navItems` / `navValue` / `navOnChange` for whatever tabs it has, if any.

Two commits, in this order, and the order mattered:

1. **`switchTool`** — the tool-switch rule existed in **five** copies (three topbars, the drawer,
   the bottom bar). They had drifted only cosmetically, but five copies is five places to disagree,
   and that is exactly how Live Floor / The Line / Online became dead ends: a module was added to
   one copy and not the others. Agreeing the behaviour first is what made moving the markup safe.
   `chooseModule` is deliberately *not* folded in — it runs at sign-in, sets `entered`, leaves the
   tab alone.
2. **`AppShell`** — the markup.

What fell out:

- `solo-top` and its eight mobile rules are gone. One rule replaces them: `.topbar.no-botnav
  .hamburger { display:flex !important; }`, which brings the hamburger back for a module with no
  tabs. The Board is the only one today.
- Those headers are **one row** on a phone instead of two, which was part of the "page starts
  halfway down" complaint.
- Live Floor gained a bottom bar for its Live Floor / Settings tabs. Its subtab is named `floor`,
  not `board`, in that bar — `NAV_SHORT` shortens `board` to "Board", which is a different tool.
  See §2: NAV_SHORT shortens, it must never rename.
- Live Floor's header gained `BrandMenu`, so sign out, help and replay-intro work there like
  everywhere else. It previously had a bare logo and a loose Sign out button.
- `MobileDrawer` no longer prints a "Go to" heading over an empty list.
- `drawerOpen` moved out of the app component into `AppShell`, the only thing that opens it.

**A new module now needs nothing.** Render `<AppShell>` and pass what differs. There is no class to
remember and no question about whether the header has a bottom bar.

Caveat on verification: Supabase is unreachable from the build container, so this was verified by
build, by static structure, and by a console-error check on the sign-in screen — not by driving a
signed-in phone viewport. Check the three modules on the preview before trusting it.

---

## 5. THE DESIGN DIRECTION, SETTLED WITH JORGE

Agreed over several rounds of drafts. **None of it is built yet.** Build against this rather than
re-deciding it.

**Navigation.** The bottom bar carries **tools**, not sections; the centre button is that tool's
primary verb (Import on Performance, Assign next on Live Floor); sections move to a strip in the
page. Labels stay, six tools with icons alone is the problem we just spent a week fixing. Tool
names are honest: The Board is The Board, and the performance dashboard is no longer called Board.
Visual treatment is the notch and the halo ring, with the accent sliding between tabs.

**Colour, and the rule that makes any brand safe.** Store palettes are per-store
(`primary` / `deep` / `accent`) and several franchises collide with status. Measured:

- Honda red `#CC0000` vs Restricted `#E5473C`: **ΔE 9.4** normal vision, below the 15 floor
- Toyota red `#C8102E` vs Restricted: **ΔE 9.5**
- **Nearing `#C77800` vs Restricted `#E5473C`: ΔE 12.2 normal, 3.3 under deuteranopia**, this one
  is independent of brand and is exactly why the coaching sheet already carries a word and a mark

So: **brand paints identity** (hero, header, active tab, the ring) and never a graded value. **Data
marks are one neutral hue**, the same in every store. **Status stays reserved**, always with the
word beside it, never a fill and never on a chart.

Health is **not** colour-coded and never was: the hero ring is painted in the store's **accent**
and the verdict word carries the judgement. Shading a status colour to fit a brand was tried and
measured. Against the Driver's Mart teal, amber cannot clear 3:1 in the light direction at all
(1.89 at its palest) and the dark direction lands on `#281800`. Do not reintroduce it.

**Charts.** Forms by job: one headline gets a dial, change over time gets a line, ranked magnitudes
get bars. No pie, no second y-axis. Delivery plots all three channels as **percent of their own
target**, so the dashed target rule holds still while the line morphs between Internet, Phone and
Showroom. Beating a target is celebrated, the line lifts past the rule, the overshoot fills green,
a badge springs in. The three channel hues were validated, not chosen. Worst all-pairs CVD ΔE 9.2,
worst normal-vision 24.0.

**The phone board is at desktop parity** and should stay there: floor health, weakest standard with
its `METRICS[].play` coaching line, talk-to-these-first, top performers, then the roster with each
person's speedometers. Roster shows the top five and a button for the rest, ranked by the site's
own comparison, `oppsOf(b) - oppsOf(a) || a.order - b.order`, so phone and desktop cannot
disagree about who is first. There is a field to find a salesperson. Cards are pressed, not
labelled with a "Dive" button, and the detail blooms over the view.

Drafts, all live and interactive:

- Navigation directions, https://claude.ai/code/artifact/0a81c416-15a1-4995-9169-e5891d9ecb9e
- Centre-button treatments, https://claude.ai/code/artifact/0c82159f-8b44-4725-9b16-7e3a06d4bfc6
- Bolder passes, https://claude.ai/code/artifact/55c04dbc-5b3b-4ce2-8f28-b002ea5f1507
- The combined light-mode draft, https://claude.ai/code/artifact/49d2888d-53c7-45e8-806d-d4d9856889ea
- **The one Jorge approved**, https://claude.ai/code/artifact/2c4929a5-e434-4dcc-a3b4-b843a66251b3

Dark mode is deliberately untouched. The app is light throughout and a half-converted app is worse
than either.

---

## 6. VERIFICATION THAT EARNED ITS KEEP

Run HANDOFF_2 section 2's scanners every time. Beyond that, three habits found real bugs this
session that reading would not have:

1. **Render it and measure it.** `scrollIntoView({block:"nearest"})` was moving the page 407px on
   mount; "nearest" still scrolls every ancestor including the document. Every layout claim in this
   session's PRs is a measurement at 320 / 360 / 390 / 430.
2. **Exercise the logic against fabricated data.** The round-up was run against two full weeks, one
   short week, no activity, an empty store, and cleared/below-target moving in both directions. It
   caught two copy bugs: "2 people more cleared" (wrong word order) and "against 2 7 days ago" (two
   numbers colliding).
3. **Compute colour, never eyeball it.** Every ΔE above came from a validator.

Playwright is not a project dependency and should not become one. Install it ad hoc, use
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`, and revert `package.json`
afterwards.

---

## 7. OPEN ITEMS

Carried from HANDOFF_3, still open: Smart Assign; Classic Honda's unrecognised PDF layout; split
storage for months/plates/schedule; verify auto close-out; confirm backups succeed; year-level
activity import; publishing top-performer averages to the board row; the staleness flag only
evaluating while the tracker is open; `&test=1` discoverable; the board row guessable by store id;
anonymous queue sign-in rate limiting.

New from this session:

1. **The shell merge is done** (section 4). Section 5 assumed it and can now be built. It has not
   been checked on a real phone against a live Supabase — do that first.
2. **Board vs Dashboard.** The bar says "Board" for a tab the drawer calls Dashboard, while **The
   Board is a separate tool in the switcher**. It also has to cover "Combined Board" in the group
   view. Deliberately left for Jorge to name.
3. **Rate trends need a second day.** The digest started writing when PR #2 merged, so the first
   day showed only activity trends. It should be filling in now; worth confirming.

---

## 8. FIRST FIVE MINUTES OF THE NEXT SESSION

1. Open the preview on a phone and check all three modules: The Board, Live Floor, The Line. Each
   should have one header row and a way out — a bottom bar, or the hamburger on The Board.
2. Confirm the round-up's rate trends have started appearing now that digests exist.
3. Build section 5 on top of AppShell.
