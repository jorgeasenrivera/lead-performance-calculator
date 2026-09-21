---
name: proposal-page
description: Write a Sage proposal page or state sheet for Jorge in the house style, one decision per item, with the decision buttons and the copy button that paste the decisions back. Use whenever rule 5 applies (a visual change on the phone or the wall) or a state sheet in docs/sheets changes.
---

# The proposal page

Rule 5 in AGENTS.md: nothing visual ships without Jorge's approval, on a
published page with a decision per item. Every page so far was a hand-copied
stylesheet, and by the fourth one they had drifted. This is the one they are
written from now.

## How

1. Copy `template.html` from this folder to the scratchpad (a proposal) or to
   `docs/sheets/<name>.html` (a state sheet, which is kept in the repo).
2. Replace `TITLE`, `DATE` (for example `18 September`), `ROW` (the board row,
   `C29`) and `KEY` (a slug for this page's memory, `two-sheets`). The
   `<title>` is two to four words, the name of the thing, no explainer.
3. Write it. The shape that has worked:
   - **What is there today.** One `.fact` per paragraph, measured, with the
     number and where it was measured. What the code does, not what it should.
   - **One section per item**, lettered and numbered (`A1`, `A2`, `B1`): the
     eyebrow carries the id, the `.item` carries the case, and the `.decide`
     row carries the buttons. `data-item` is the id and the name, because that
     is what the copy button pastes back. Put the recommended option first and
     mark it with `<span class="rec">Recommended</span>`.
   - **Stated, not decided.** A table of what the page assumes, so Jorge can
     say if one is wrong without a button for each.
   - **Decisions.** The copy button and the note. Leave them as they are.
4. Publish it with the Artifact tool, put the link on the board row, set the
   row to `needs approval`, and stop. The build waits for the decisions.
5. When the decisions come back, record them on the page (`<p class="note">
   <b>Decided DATE: Yes.</b></p>` under each item) and, for a sheet, commit the
   page in the same pull request as the change.

## The house rules, on the page

- No em dashes. Commas, colons, full stops.
- Write for somebody with five seconds and a customer walking in. Say the
  thing, do not describe the thing. Name what a person recognises.
- Every number on the page was measured, and the page says where.
- Say what you doubt. A page that only argues for its own plan wastes the
  second reader.
- A sketch (`.phone`, `.bar`, `.seg` in the stylesheet) when a picture says it
  faster than a paragraph. The sketches use the corner's own palette so they
  read as the screen and not as the page.

## What the buttons do

Each `.decide` remembers its choice in localStorage on the phone it was pressed
on, under `sage:proposal:KEY`. "Copy the decisions" writes one line per item,
`<data-item>: <choice or undecided>`, headed "Decisions from Jorge, DATE", and
puts it on the clipboard for pasting back into the session. Nothing leaves the
phone on its own.
