# LPC — Handoff 3

Written Aug 14, 2026. **Read alongside HANDOFF_2.md, which is still accurate.**
HANDOFF_2 has the architecture, the duplicated-component trap (section 1), the
verification recipe (section 2) and the working agreements (section 13). None of that
changed. This document covers only what happened in the session of Aug 14 and what the
next session needs to do first.

---

## 0. STATE: pushed, and open as PR #1

All work is on `claude/handoff-continuation-8oxasd` and pushed. It is open as
**https://github.com/jorgeasenrivera/lead-performance-calculator/pull/1**. Pushing further
commits to that branch updates the PR; do not open a second one.

**The push was blocked for most of the Aug 14 session, and the cause is worth recording.**
The Claude GitHub App was *authorized* but never *installed*. Those are different things:
authorized is an account-level grant to act on your behalf, installed is what attaches the
app to repositories with a permission set such as `Contents: read and write`. GitHub said
so plainly on the app page: "Claude has not been installed on any accounts you have access
to." Symptom: reads succeed, every write returns 403, and no token changes it, because the
permission does not exist on the repo for any credential to use. "Configure" is missing
because there is no installation to configure.

Fixed by installing the app (All repositories, read and write to code). The running session
picked it up immediately, with no restart needed.

If writes ever 403 again, check **Installed** GitHub Apps, not Authorized. And do not go
looking for a read-only Contents scope to flip on an existing installation, which was a
wrong guess made twice during that session.

## 1. DEPLOYING (both files, together)

Merging PR #1 covers this. **Do not cherry-pick the JSX alone.** `api/ingest.mjs` carries the Delivery Summary
vehicle-split parsing and the `names.delivery` fix. If the JSX ships alone, new/used stays
hidden and the hourly email import keeps writing the old shape.

Note the ingest file is **`api/ingest.mjs`**, not `api/ingest.js` as HANDOFF_2 says.

---

## 2. RLS: WHAT HAPPENED, AND WHERE IT LANDED

`supabase-setup.sql` ends with three policies granting `using (true)` on select,
insert and update for `app_data`. The anon key ships in the browser bundle by design;
RLS is the only boundary. The file's own comment said the app's email, PIN and domain
gate controls access, which is client-side and is not a boundary.

**It was pasted whole into the SQL editor on the live database.** The file's header
says to do exactly that, and a warning comment had been added above the policy block
without making it inert, which is not a safeguard. The audit afterwards showed the
damage was worse than a stray permissive policy:

The real policies were **named** `app_data read`, `app_data write` and `app_data
update`, each carrying the key-pattern list. The setup file opens its policy block by
dropping exactly those names. So it deleted the security model and put `true` in its
place. Only `lpc:board:%` and `lpc:backup:%` still had real rules afterwards, because
those live in separately named policies. **Nothing at all covered `lpc:config:%`,
`lpc:audit:%` or `lpc:store:%`** — which is why simply dropping the three open
policies would have taken the app down rather than secured it.

**Resolved by `supabase-rls-restore.sql`**, which drops and recreates in one
transaction. Patterns from HANDOFF_2 section 3; `has_store()` confirmed to exist
because the surviving backup policies call it. Ran successfully Aug 15.

**Two things now permanent:**

1. Every access-widening statement in `supabase-setup.sql` is commented out. It must
   stay that way. The table, trigger and index definitions above it still run, which is
   all that file was ever for.
2. `supabase-rls-audit.sql` is read-only and safe on production. Run it before and
   after any policy change.

**Watch for one regression:** the anonymous sign-in pages read `lpc:config:v2` for the
support contact and per-store activity standards. Under `to authenticated` that read is
refused and the code swallows it, so the pages still work but fall back to default
standards and lose the Help contact. The narrow fix (anon select, config only) is
written out at the foot of the restore file, unapplied.

Verified clean separately: no `SERVICE_ROLE`, no `INGEST_SECRET`, no JWTs in the built
bundle, and no source maps emitted.

On "stop people inspecting element": you cannot. Everything shipped to a browser is
readable and minified code is one click from pretty-printed. Obfuscators and
devtools-blockers cost real debuggability and buy minutes. What matters is what a
logged-out person with the anon key can *do*, and that lives entirely in RLS.

---

## 2b. THE MAIL PIPELINE, AND THE DAY IT ATE ITSELF

Reports stopped arriving for three days. The cause was our own worker, and the
shape of it is worth keeping because it will not be obvious the next time.

`workers/lpc-mail.js` used to throw on any ingest failure, on the reasoning that a
throw shows red in the dashboard and a silent gap does not. Right about visibility,
wrong about the mechanism. **Throwing inside an email handler does not log a failure,
it rejects the message at SMTP level**, and the sending service is told the mailbox
would not take it. DriveCentric sends through Mandrill, Mandrill retries a rejected
message, the retry meets the same unparseable PDF and is rejected again, and repeated
hard delivery failures against one address are how an ESP decides the address is dead
and suppresses it.

Evidence: one Mandrill message id, `20260811173729`, retried Aug 11 to Aug 14, every
attempt logged `Delivery failed`, after which nothing reached
`driversmartwinterpark@hollercrmreports.com` at all, including hand-sent tests.
Classic Honda's Daily Activity is the report that cannot be parsed, so that one report
was poisoning delivery for every other store.

**Fixed in `9baaba7`.** Rejection is now reserved for the only case a retry can fix:
endpoint unreachable, or 5xx. A 4xx means the endpoint read the message and cannot file
it, which no retry changes. Oversized messages and missing config are accepted too.
Everything still logs an error, so Observability is unchanged.

**The address changed as a result.** Reports now go to `reports@hollercrmreports.com`.
Confirmed working Aug 14 20:21: `200 {"ok":true,"store":"classic-honda",
"type":"delivery-summary","count":93}`, board republished for 17 people.

Three things follow from this that are easy to trip over:

1. **`driversmartwinterpark@` is still suppressed on Mandrill's side**, which is
   DriveCentric's account, not ours. Treat it as dead. Its routing rule is harmless to
   leave in place.
2. **`reports@` is neutral, so CSV attachments no longer route by address.** The store
   is taken from the address local-part for CSVs and from the PDF header for PDFs.
   Everything currently scheduled is PDF, so this is fine, but a CSV schedule would be
   declined with nowhere to file it. That is the reason to keep a store-named address.
3. **If reports go quiet again, check the sender's suppression list first.** An address
   on it swallows every send silently, and nothing in Cloudflare will show you a thing,
   because the mail never arrives.

Also learned from the same logs: the DriveCentric reports are **scheduled at fixed
times**, and the schedule is in the subject line ("Daily Activity 1:30 - CH", "Daily
Summary 2:30 - HH"). They arrive in an early-afternoon burst and then stop, because
nothing more is due. HANDOFF_2 calling them "hourly-ish" is wrong. This is why the
rolling quiet-window flag was removed in `a2e318c`: it turned every ordinary evening
amber from about half past two onward.

---

## 2c. CLASSIC HONDA'S DAILY ACTIVITY, AND WHAT IT STILL NEEDS

The 1:30 CH report is a 14 page, 286 line `Daily Activity Report` that no mapper
matches. It declines cleanly, which is now harmless. Two things block writing a mapper,
and neither should be guessed past:

1. **No column headers anywhere in the dump.** Five unlabelled numbers per row, two
   rows per person. Which is calls, texts, emails, videos, appointments is unknown, and
   filing wrong-but-plausible numbers is worse than filing none.
2. **Every value in the sample was zero**, on a file named `8-11-2026` that arrived on
   the 14th. That report looks misconfigured at the DriveCentric end.

There is also an unresolved ambiguity: the lines read store, figures, figures, name,
figures, figures, name, so the values belong either to the name above or the name
below. An all-zero sample cannot separate the two, and getting it wrong shifts every
person's numbers by one, silently.

**`lpc:config:unparsed:v1` now holds up to 900 lines with the page, y and x of every
fragment**, newest first, last four reports. Read that row out of Supabase once a CH
report with real numbers lands, and the mapper can be written from it without anyone
ever obtaining the PDF.

## 3. WHAT CHANGED THIS SESSION (16 commits)

| Commit | What |
|---|---|
| `762620d` | My day closing tiles graded like The Board; Help sheet position fixed |
| `07c2a02` | New/used vehicle split parsed and shown; coaching sheet de-duplicated; tracker polish |
| `ffe1c10` | Coaching sheet rebuilt as Record and Plan; queue mirror written |
| `2910be4` | Standards shown beside every rate; coaching block in the checklist |
| `71e1b1c` | Daily tracker: fewer words, standard below the list, points on the dot grid |
| `9184660` | Coaching sheet fills the page; texts/emails columns for Driver's Mart |
| `1b58a77` | Fixed the incomplete-file flag contradicting the import checklist |
| `32e0f91` | Metric dials now show for people who are *passing* |
| `e9b9b56` | Per-store daily report cutoff, with grace and staleness windows |
| `592bef0` | Daily report image-only; backfill labelled; cutoff scoped to the report |
| `ef98735` | Biggest Loser podium on the tracker; named on the report image |
| `a6c269f` | Read-only RLS audit script; setup file flagged as unsafe |
| `a2e318c` | Dropped the rolling quiet check; Cloudflare's logs disproved it |
| `b988c6f` | Keep the dump when a PDF layout is not recognised |
| `586ddff` | Store the whole page geometry, not the first 120 lines |
| `9baaba7` | Stop the worker rejecting mail it cannot parse; worker into the repo |

### Bugs found and fixed, worth knowing about

1. **`.help-sheet` ran its entry animation with `animation-fill-mode: both`.** A *filling*
   transform animation leaves the computed transform as an identity matrix rather than
   `none`, and any transform other than `none` makes an element the containing block for
   fixed descendants. So the nested Help overlay sized itself against the scrolled sheet
   and was clipped by its overflow. Measured: a fixed probe read `top=-343 h=787` against
   an 844px viewport; with the animation removed, `top=0 h=844`. Fixed at the root
   (`backwards`) and guarded by portalling both sheets to `document.body`.

2. **The queue coaching mirror never existed.** Every queue event is pushed to the
   `queue_public` row via `mutateQueueRow`, while `queueCoachingStats` reads
   `data.queue[date].history` off the *store document*, which nothing wrote. Live Floor's
   mirror was an empty stub. `hasData` was false for everyone. `FloorModule` now mirrors
   both, off refs, only when event counts move, no audit entry, 95-day window.

3. **The incomplete-file flag contradicted the import checklist.** Two causes.
   (a) The combined Delivery Summary ticks every per-channel box in `M.imports` but never
   wrote `M.names.delivery`, and `M.names` is what the per-associate check reads — so for
   every store on the PDF, the delivery half of that check was silently skipped.
   (b) `requiredTypes` treated a type as required if `names[t]` merely *exists*, and `[]`
   is truthy — so any import that parsed nobody marked every associate permanently
   "waiting on" that report. Both fixed, in the app and the ingest.

4. **Metric dials were gated on `ev.status === "fail"`.** Clearing your standards made your
   numbers vanish from the row.

5. **The daily report's month name came off the wall clock**, so a report backfilled on the
   1st for the 31st carried the wrong month.

6. **Caught by the scanner, not the build:** an `outreach` flag first landed in the wrong
   function. Valid syntax, clean build, `ReferenceError` on render. This is exactly the
   white-screen class HANDOFF_2 section 2 warns about. **Run the scanners.**

---

## 4. VERIFICATION USED THIS SESSION

HANDOFF_2 section 2's scanners caught a real bug the build did not. Run them every time.
Expected residual output for this file: `ClipboardItem`, `DOMParser` — both legitimate
browser globals, both pre-existing.

Also worth reusing: rendering the real component in Chromium and *measuring*, rather than
eyeballing. Used to confirm the Help sheet lands flush at the viewport bottom, the task
dial number is centred (0.1px off), and the coaching sheet fills 96% of a Letter page at
worst case while still fitting on one.

**Em/en dashes: 76 exist in the file, all pre-existing** (inside base64 image blobs and the
board's generated HTML). Zero were added this session. Do not "fix" the 76.

---

## 5. NOT VISUALLY VERIFIED

Build- and scanner-clean, but never rendered. Look at these first after deploying:

- **`e9b9b56` / `592bef0`** — the global `select` restyle (25 dropdowns, one rule; a cramped
  dropdown is the first symptom), and the cutoff banner in the daily report modal.
- **`ef98735`** — the Biggest Loser podium in the tracker sidebar. Three names side by side
  in a narrow column, first names only, ellipsised. Could be tight. Also the canvas heading
  changed from `TOP OFFENDERS` to `BIGGEST LOSER`, which shifts the date beside it slightly.

---

## 6. OPEN ITEMS

Carried from HANDOFF_2: Smart Assign; Classic Honda's unrecognised PDF layout; split
storage for months/plates/schedule; verify auto close-out; confirm backups succeed;
year-level activity import; product name (standing recommendation is still **The Board**).

New from this session:

1. **Publish top-performer averages to the board row** so My day can show the coaching
   sheet's habit bars. The sign-in page is anonymous and only holds the published board
   row, so it currently cannot show "you vs the top 6" — it shows the weakest-channel
   focus block instead, which is the same call the sheet's alert makes.
2. **The staleness flag only evaluates while someone has the tracker open.** It is a
   render-time calculation, not a monitor. If nobody opens the tab that evening, nothing
   tells anyone. Making it actually notify means a scheduled check in the ingest.
3. **`&test=1` and `TEST_ID` are discoverable** by reading the bundle. Low stakes, but it
   is not a secret.
4. **The board row is world-readable if you can guess a store id**, and `classic-mazda` is
   guessable. Consider an unguessable suffix so the TV URL is the capability.
5. **Anonymous queue sign-in is identity-by-PIN.** Worth rate-limiting.
6. **Jorge's idea, not yet built:** feed coaching further into the daily checklist so people
   are "constantly being coached". The Start here block is the first step of this.

---

## 7. TWO TRUNCATED MESSAGES WORTH RE-ASKING

Jorge's messages were cut off mid-sentence twice, and the work proceeded on a best reading:

1. *"do it only for Driver's Mart Winter Park as it…"* — the texts/emails tracker columns.
   Built as a named store-id list plus a `trackerOutreach` per-store override, so changing
   the scope is one edit.
2. *"maybe make it more obvious that they…"* — read as *that they're doing well*. Cleared
   rows got a green edge and crushing-it rows a stronger one. If he meant something else
   (a badge tier, a separate section, something on the podium), it is unbuilt.

---

## 8. DESIGN DECISIONS MADE THIS SESSION, SO THEY ARE NOT UNDONE

- **The coaching sheet is Record on the left, Plan on the right, signature block removed**
  ("it's a coach, not a slam"). One page is a **hard limit**: failing standards cut to
  three, change list to three, habits to five. It must be printable on any day of the
  month, so a pace projection needs three worked days behind it or it says so instead.
- **It prints in grayscale.** Status is carried by fill (solid vs hatched), by a mark, and
  by a word — never by colour alone. Do not reintroduce colour-only encoding.
- **"Biggest Loser" is deliberate and is Jorge's call.** His reasoning: the coaching sheet
  is where somebody gets helped; this is the board for missing a daily minimum, and a blunt
  name carrying humour lands better on a floor than a gentle one that still ranks the
  bottom three. It is month-to-date, on both the tracker and the report image.
- **Texts and emails are never graded** — no tick, no cross, no target. Automated follow-up
  fires whether or not a person is present, which is the same reason `workedAnyway` counts
  calls and videos but not texts and emails.
- **The daily report is an image only.** The text version was removed; keeping two
  renderings of the same numbers in step only works until either changes.
- **The report cutoff governs the report and nothing else.** It has no say over ingest or
  over what a salesperson sees.

---

## 9. FIRST FIVE MINUTES OF THE NEXT SESSION

1. Run `supabase-rls-audit.sql` (read only) and read sections 1, 3 and 4 of its output.
   That is the open question in section 2 and it outranks everything else.
2. Open the Vercel preview deploy on PR #1 and check the three surfaces in section 5.
3. Merge PR #1, both files together.
4. Then pick up section 6.
