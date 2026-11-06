# Accessibility foundations (C115)

From a read-only audit of main at `66381521`, and the first slice of work on it. This
slice changes one line of `index.html` and adds a helper that nothing uses yet. It
changes no screen, no stylesheet, no palette, radius or motion, and no native file.

## What this slice does

- **Zoom is allowed.** `index.html` no longer carries `maximum-scale=1.0` or
  `user-scalable=no`. Everything else in the viewport is as it was: `width=device-width`,
  `initial-scale=1.0`, `viewport-fit=cover`.
- **`src/dialog-focus.mjs`** is the focus lifecycle of a dialog as a function: move focus in
  on open, keep Tab inside, close on Escape, give focus back to the opener. It is the
  behaviour `useSelectorFocus` already gives the room picker and the menu in
  `Manager.jsx`, made standalone and tested. It imports nothing and reads no global.
  Nothing imports it.
- **Tests.** `test/dialog-focus.test.mjs` (the helper, against a stand-in document) and
  `test/audit-static.test.mjs` (the viewport contract, the helper's boundary, the house rule
  on dashes). Both run under `node --test` with no dependencies.

## How the helper decides things

- **Which controls count.** The selector only finds candidates. Each one is then checked, whichever
  part of the selector matched it: it must be visible, not inert, not `:disabled` (which includes
  controls under a disabled fieldset, except in its first legend), not skipped by a negative `tabindex`,
  and, for a `<summary>`, either the first one of its `<details>` or one with an explicit `tabindex`.
  Visible means `checkVisibility` where the engine has it. Where it does not, three things stand in:
  boxes (`display:none`), the DOM (content of a closed `<details>`, which is everything but its first
  `<summary>`), and computed style (`visibility:hidden` and `collapse`, which are inherited, and a
  `content-visibility:hidden` ancestor, which is not, so ancestors are walked). Boxes alone are not enough:
  Chromium 141 leaves skipped content its boxes (`getClientRects().length` is 1) while refusing it focus,
  and `checkVisibility` says it is hidden. With no computed style at all, `content-visibility:hidden`
  and `visibility:hidden` cannot be seen (a stated limit, below).
- **Focus must land.** Opening tries the chosen control, then each candidate in turn, and checks
  that focus arrived each time, then the container. Restoring does the same. A refusal is
  not trusted as success.
- **Each document has its own stack of open dialogs.** Only the top dialog of a document answers
  that document's Escape and Tab. `dialogDepth()` counts all of them, `dialogDepth(doc)` one document's.
- **A dialog is registered before focus moves**, because moving focus runs the page's focus
  handlers, and one of them may open a dialog. If opening throws, that opening is removed; a dialog
  that opened properly while it ran stays, with its opener repaired.
- **Restoring yields to a newer dialog.** Returning focus also runs caller code (focus handlers, the
  `fallback`). If that opens a dialog, the new one owns focus: release stops, reports `kept`, and does
  not go on to the next target. The `fallback` is asked for only when the opener cannot be used.
- **Where focus goes back to.** The opener, if it is still there and can take focus. If another dialog
  is still open beneath, focus goes to the opener only when the opener is inside that dialog, and
  otherwise into that dialog (outcome `beneath`), since sending it outside would let it out of a modal.
  Closing dialogs out of order passes each one's opener along to every dialog above it.
- **Positive `tabindex` is not supported inside a dialog.** A browser visits those first, in
  their own order, and there is no way to follow that from outside without taking over every Tab. If
  any control in the dialog has one, the helper moves every Tab itself, in document order, so focus
  still cannot leave; the order is the markup's, not the numbers'. No positive `tabindex` exists in
  `src`, `index.html` or `public` today (read-only search; the values in use are 0 and -1, and one is
  `value ? 0 : -1`).
- **Not covered and not verified:** radio groups (one stop in a browser, one each here), shadow roots,
  a control inside an iframe inside the dialog, `<area>`, the browser's own toolbar, screen readers.

## Corrections the audit carries

- The app already has text-size settings. The salesperson shell offers Normal, Large (1.15)
  and Largest (1.3), at `LeadPerformanceCalculator.jsx` near `TEXT_SIZES`. The gap is that it
  stops at 130%, short of the 200% a text-zoom check asks for. Whether the manager has an
  equivalent was not checked.
- Removing the zoom lock does not need a 16px-input CSS change in the same step. iOS zooms on
  focus into a field under 16px with or without the lock, as far as is known; that is
  unverified on a device. The 16px change is a visible change on a phone, so it goes to Jorge
  on a proposal page first.
- `scripts/scheduler-performance/shared-system.css` is not the production token system. It is
  imported by the scheduler preview only (`entry.jsx`), and `build.mjs` copies it into the
  preview. Production loads `src/manager-signal.css` through `Manager.jsx`.
- A suspicion that `html { touch-action: pan-x pan-y }` (`LeadPerformanceCalculator.jsx`,
  near the `-webkit-text-size-adjust` rule) might still block pinch zoom was tested in
  headless Chromium with mobile emulation: with the viewport open, a 2x pinch reached scale
  2 with and without that rule, and with the old viewport it stayed at 1. That is one engine.
  WebKit, which is what the app's WebView is, was not tested.

## What was found, in order

**First run of the helper (three failing tests).** The first one was a bug: the selector
matches a `<button tabindex="-1">`, which Tab skips. That was fixed. The other two were wrong
expectations in the tests (focus stays on a control inside a dialog that is still attached), and
the tests were corrected. The log kept for that run is a reconstruction made after the fixes, not the
first transcript.

**Independent review (18 October), which asked for changes.** It found, and revision 2 fixed:

1. Disabled controls with a tabindex were treated as candidates, and opening never checked that
   focus had landed, so focus could stay on the opener behind the dialog or Tab could leave at the end.
2. One module-wide stack tied unrelated documents together: Escape and Tab in one document went dead
   when another opened a dialog later.
3. Moving focus before registering put a dialog opened from a focus handler underneath the one that
   opened it, so Escape reached the wrong one.
4. Closing dialogs out of order repaired only the dialog directly above, leaving a stale opener two levels up.
5. Positive `tabindex` was not followed. It is now an explicit unsupported case, as above.

It also showed two guards that could be removed without any test failing (Escape while composing
text, and reading the candidate list afresh on every Tab). Both now have tests.

**Re-review of revision 2.** It confirmed those fixes and found five smaller things, fixed in revision 3:

1. Restoring focus had no guard against a dialog opened by the focus it was restoring, so release
   went on to the next target and took focus back from the newer dialog.
2. Without `checkVisibility`, a `visibility:hidden` control was still a Tab boundary, so Tab could leave
   the dialog. Computed style now answers there. A browser run of the original wider fixture then showed
   the same escape for `content-visibility:hidden` content and closed `<details>` content (below).
3. A failed opening did not repair the opener of a child dialog that had opened properly before the
   error, so the child returned nowhere.
4. A second `<summary>` with an explicit `tabindex` was filtered out although the tabindex makes it
   focusable, so it could not be reached.
5. The test cleanup compared an already relative figure to the starting count again, so one early
   registration failed every test after it. That was in the tests, not the helper.

The "every order" test had also sampled five orders, not all of them; it now covers all 24.

**The browser fixture that failed, kept.** The first Chromium run of revision 3 failed one check, on the
original no-`checkVisibility` fixture (display none, `hidden`, `content-visibility:hidden` and a closed
`<details>`), and that failure is not a flaw in the probe. The exact behaviour, reproducible with
`chromium-skipped-content-behaviour.mjs` in the bundle: the control under `content-visibility:hidden`
(`cv`) and the control inside the closed details (`in1`) each report one box, computed `visibility` of
`visible`, `checkVisibility` false, and focus refused. With the method removed, a dialog whose last
candidate is such a control let real Tab leave: `content-visibility:hidden` last gave `after, real, after`,
and a closed details last gave `s1, after, real, s1`. A narrowed fixture (display none and `hidden`
only) passed and was kept apart, labelled as narrowed; it is not evidence for the original contract.
Revision 3 closes it inside the helper: closed-details content is excluded from the DOM, and a
`content-visibility:hidden` ancestor is excluded through computed style. The original fixture and the
two escape fixtures now pass with real keys.

## What each check shows

- **Stand-in tests (`node --test`).** 74 on the helper and 4 static. The stand-in models focus, removal,
  listener order, Tab with positive `tabindex` first, `:disabled` including fieldsets, `visibility`
  (through `checkVisibility` and through computed style), closed `<details>` and synchronous focus
  handlers. It is a model, so it shows the logic, not the browser.
- **Mutation check.** 34 one-line removals of behaviour from the helper each make at least one test fail
  (the harness exits nonzero if one does not). Survivors in earlier rounds each led to more tests.
- **Chromium 141 (headless, desktop, keyboard only), 67 checks,** with real key presses except where
  marked, and with `Element.prototype.checkVisibility` removed in the page for the no-method cases. The
  one composing-Escape check is synthetic: a `KeyboardEvent` with `isComposing`, not a driven IME. One
  further observation is recorded and not counted: the neither-API limit below. The same script fails 14
  checks against the helper as it was at revision 2 (10 for the re-review findings, 4 for skipped content)
  and 4 against revision 3 before the skipped-content correction, which is how the findings were
  reproduced in a browser. These scripts live outside the repository, in
  the review bundle.

## Supported-engine assumption

The helper's main path assumes an engine with `checkVisibility` (as best I recall, Chromium 105, Safari
17.4 and Firefox 106 and later; that was not checked here). Where it is missing, the fallback described
above stands in. The fallback was exercised only by removing the method inside Chromium 141, which
simulates an older engine and is not one. WebKit, Firefox and older engines were not run. With neither
`checkVisibility` nor `getComputedStyle`, a dialog whose last candidate is a `content-visibility:hidden`
or `visibility:hidden` control can let Tab leave (`after, real, after` in the simulation, recorded and not
counted); closed `<details>` content is still handled, since that needs only the DOM.

## What none of it shows

- **WebKit,** which is what the app's WebView is, was not run. Neither was Firefox.
- **Engines without `checkVisibility`:** exercised only by removing the method inside Chromium, which is a
  simulation and not an older engine.
- **Positive `tabindex`** is unsupported by design, as above; no browser other than Chromium 141 was run for it.
- **Physical devices:** touch, the on-screen keyboard moving the visual viewport, iOS and Android WebViews.
- **Screen readers:** names and announcements on open and close. The helper does not make the page
  behind a dialog inert and does not set `aria-modal`.
- **Radio groups, shadow roots, controls inside an iframe inside the dialog.**
- **Any real screen.** The helper is not wired in.

## Still to do, not done here

Integration patches, from the owners of the files (nothing here edits them):

- `Manager.jsx` (owner of #485): `aria-modal="true"` on the dialogs `ToolSheet` (near line
  2326), `FrPop` (4683), the Biggest Loser modal (8050), the round-up sheet (11606) and the
  associate card (12577); a call to `openDialogFocus` beside the existing Escape handler in
  each; an Escape handler for the Biggest Loser modal if it has none; and an `id`/`htmlFor`
  pair on the six help-form labels (near line 1995). Line numbers are from main at
  `66381521` and will have moved.
- `LeadPerformanceCalculator.jsx`: the `Overlay` portal and the dialogs "My day", "Help" and
  "Leaving the lot". Blocked by the one-writer rule while #485 is open.
- `native/App.js`: the Android back handler returns `true` after `goBack()` even with no
  history, so back does nothing. A fix needs `canGoBack` tracking, and an Expo build.
- `manager-signal.css`: focus-ring contrast on dark surfaces, radius tiers, tap sizes, and
  the unused `--sg-*` tokens. Visual, so a proposal page first. Any edit to it also changes
  the hash pinned in `scripts/scheduler-performance/build.mjs`.

Checks still owed before any of that ships, none run in this slice: 320, 390 and 1440 pixel
layouts; 200% text; keyboard traversal, touch and focus visibility on the real screens;
reduced motion; and a phone check of the zoom change (Rule 5) in WebKit and on Android.

## Open questions

- Is a pinch on the iOS app's WebView meant to zoom? The zoom lock was probably added for
  reasons that are not written down. Worth five minutes on a phone before the zoom change
  merges. That phone and WebView check is a separate merge gate on the `index.html` change; nothing in
  the helper's tests can establish it.
- Whether to give the dialog helper an `aria-modal` or `inert` step for the page behind. This
  slice only moves, traps and returns focus; it does not make the background inert.
- When the helper is wired in, whether a positive `tabindex` found at open should also be reported
  in development. Today it is tolerated silently, with the document-order behaviour above.
