# Working on Sage

Read this before you touch anything. It is the short list of rules that hold
whichever agent is at the keyboard. `README.md` is the long version: what the
app is, where everything lives, how to run it, and the reasoning behind the
rules below. Read that once, then keep this one in mind every session.

This file is the canonical one. `CLAUDE.md` imports it so Claude Code and Codex
read the same rules rather than two copies that drift.

---

## 1. Claim your work before you write a line

`docs/in-flight.md` is the board. One row per item: what it is, who owns it,
which branch, which files it will touch.

`docs/handoff.md` is the other half of starting a session: messages between the
two of us, because Claude runs in a web session and Codex runs on the desktop
and neither can reach the other except through this repository or through Jorge.
Read the board, then the handoff, then write. Each of us writes only in our own
section of it, which is why it cannot collide.

Claiming is a commit, straight to `main`, before the work starts:

```
git fetch origin main && git checkout -B main origin/main
# edit docs/in-flight.md: fill in owner, branch, files, status "in progress"
git commit -am "Claim: <item>" && git push origin main
```

That commit is the lock. It needs no shared runtime and it survives either of us
losing a session. If two claims race, the one already on `main` wins and the
other agent picks something else. Release the claim in the same pull request that
finishes the work, by setting the row to done.

**Never work an item that is claimed by somebody else. Never work on somebody
else's branch.**

## 2. One writer at a time on the two big files

`src/LeadPerformanceCalculator.jsx` is about 17,000 lines and `src/Manager.jsx`
about 28,000. Nearly every feature lands in one of them, so two open branches
that both touch one of these will conflict, and resolving a conflict in a file
that size is worse than doing the work twice.

So: **at most one agent may have an open branch touching either file.** The board
shows who. If those are taken and you want work, take something under `api/`,
`scripts/`, `supabase/`, `test/`, `workers/`, `native/` or `docs/`, or review the
other agent's open pull request, which is worth more than a second branch.

Corollary, and it matters: **no wholesale reformatting.** No reordering imports,
no reflowing comments, no prettier pass, no renaming across a file. One
whitespace sweep through either file turns every open branch into a conflict.

## 3. Small pull requests, merged often

One item, one branch, one pull request, merged the day it is written. Every merge
shrinks the conflict surface for whoever is still working. Rebase on `main`
before every push. A branch that lives a week is a branch that costs a day.

Branch names say who and what: `claude/<slug>` or `codex/<slug>`.

## 4. What must be true before you push

```
npm test        # 38 guards, no network, under a second
npm run build   # a build that fails is as broken as a test that fails
npm run feel    # the phone's bars, in a real browser (README says how)
```

The feel harness needs the mock and a preview server up. `npm test` and
`npm run build` are not optional, ever. `npm run feel` is required for anything
that touches a salesperson screen, the rooms, or motion. In CI it runs twice,
in Chromium and in WebKit (`FEEL_BROWSER=webkit`), because WebKit is what the
app's WebView is and Chromium at phone width is not the phone.

Both run again in CI on every push and every pull request. Do not merge red. If
a check fails for a reason you believe is not yours, say so in the pull request
with the evidence, and do not loosen the check to get past it.

## 5. Nothing visual ships without approval

Jorge approves visual changes in advance, on a published proposal page with a
decision per item. This is not a formality and it is not satisfied by describing
the change in a pull request.

If your work would change what a screen looks like, stop and produce the
proposal first. Copy changes, layout, colour, motion, a new control, a removed
control: all of it. Refactors that leave the pixels identical do not need it, and
you should say plainly in the pull request that the pixels are identical.

**Two surfaces have a state sheet, and the sheet wins.** `docs/sheets/` holds
one for the Live Activity card and one for the rooms' transitions: every state,
what it carries, what it costs, what moves and what holds. A change to either
surface is checked against its sheet, not against the last screenshot, and the
sheet is updated in the same pull request. Jorge decides the sheet; a fix that
needs the sheet to change is a proposal first.

**A visual change on the phone is not merged until it has been on a phone.**
Web and native both. The pull request goes up, the preview or the TestFlight
build lands, Jorge has five minutes with it, and then it merges. Merge first
and screenshot after is what produced nine builds and three rounds of the same
card on 18 September. Nothing here is urgent enough to skip the five minutes;
a room that is down is fixed on `main` directly and is the one exception.
Native is the awkward case: the TestFlight build follows the merge, not the
pull request, so a native change is compiled on the pull request (in Xcode on
GitHub's runner, which spends no Expo build) before it merges, goes out one
at a time, and gets its five minutes on TestFlight before the next one
merges. Every merge that touches `native/` is an Expo build, and the plan
has a monthly limit, so native changes that are not urgent wait and merge
together.

## 5a. Findings from the phone are batched

Jorge's screenshots from the lot come in through the day. They are collected
on the board as one row, fixed in one pass, built once, and tried once, on a
phone, before the pass merges. Not one pull request per screenshot: each of
those disturbs its neighbour, and each build lags the fix, so the next
screenshot is often of a build that predates the last fix and reads as churn.
The exception is the same as above: a room that is down.

## 6. House rules for anything a person reads

- **No em dashes.** Not in the app, not in a pull request, not in a commit
  message, not in a comment. Use a comma, a colon, or a full stop.
- Write for somebody who has five seconds and a customer walking in. Say the
  thing, do not describe the thing.
- Name what a person recognises, not how the system is built.
- Comments explain **why**, and are worth the room when the reason is not
  obvious from the code. That is the house voice; match it.

## 7. Secrets

Never commit one. Not a key, not a token, not a `.env`. `.env.local` is ignored
and stays that way. If a stack trace or a log carries a token, quote the message
and the file and line only.

## 8. Signing your work

Commit messages end with the two lines your own tool is configured to add.
Claude's are:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

Codex should sign its own commits the equivalent way, so `git log` says who did
what without anybody having to guess. Pull request bodies carry the matching
footer.

## 9. Say what you actually found

If you were wrong, say you were wrong, in the commit and in the pull request.
Three of sixteen findings in the September audit were wrong on a closer read of
the code, and saying so in the pull request was worth more than the twelve that
were right. If a check is flaky, diagnose it, do not retry it. If you did half of
what was asked, say which half and why.

## 10. Review each other

When the other agent opens a pull request, read it before it merges. You are
looking for the thing a second reader catches: a claim that does not match the
code, a cost the author did not notice, a simpler shape. Ask for a read the same
way: a message in `docs/handoff.md` pointing at an issue that says how far you
actually got, and where you would look first. "Please review" wastes the second
reader; the places you doubt your own work do not. This is where two of us
is genuinely better than one of us twice, so spend the time here rather than on a
second branch.
