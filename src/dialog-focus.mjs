/* The focus lifecycle of a dialog, on its own: move focus in when it opens, keep
   Tab inside while it is open, close on Escape, and hand focus back to whatever
   opened it. The room picker and the menu already do this inside Manager.jsx
   (useSelectorFocus); this is the same behaviour as a function that nothing
   else is needed to run, so it can be tested and later wired in one screen at a
   time. Nothing imports it yet.

   It reads no global. The caller passes the dialog's node and the document is
   taken from it, so a test can hand in a stand-in and a page can hand in an
   iframe's. Each document keeps its own stack of open dialogs.

   What it is built for, and what it is not:
   - Ordinary markup: buttons, links, fields, summaries, tabindex 0 and -1.
   - Hidden controls: checkVisibility where the engine has it. Where it does not: boxes, the DOM (closed
     <details> content), and computed style (visibility:hidden and collapse, and a content-visibility:hidden
     ancestor). With no computed style either, content-visibility:hidden and visibility:hidden cannot be seen,
     and a dialog whose last control is hidden that way can let Tab out. The no-method paths were exercised
     only by removing the method inside Chromium 141, not in an older engine.
   - A positive tabindex inside the dialog is NOT supported. A browser visits
     those first, in their own order, which this cannot follow without taking
     over every Tab. If any is present the helper moves every Tab itself, in
     document order, so focus still cannot leave; the order is the markup's, not
     the numbers'. Nothing in the app uses a positive tabindex today.
   - Not covered, and not verified: radio groups (one stop in a browser, one each
     here), shadow roots, controls inside an iframe inside the dialog, <area>,
     the browser's own toolbar, screen readers. docs/accessibility-audit.md lists
     what was and was not checked in a real browser, and in which engine. */

export const FOCUSABLE_SELECTOR = [
  "a[href]", "area[href]", "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])', "select:not([disabled])", "textarea:not([disabled])",
  "summary", '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(",");

/* Dialogs that are open, per document, oldest first. Only the last one in a
   document answers that document's Escape and Tab, which is what makes a dialog
   opened over a dialog behave, without one document's dialog silencing another's. */
const stacks = new WeakMap();
let total = 0;
const stackOf = (doc) => { let stack = stacks.get(doc); if (!stack) { stack = []; stacks.set(doc, stack); } return stack; };

// The selector above only finds candidates: it matches a disabled <button tabindex="0"> through
// its tabindex, a <button tabindex="-1"> that Tab skips, and every <summary>. Whether a control can
// really be reached is decided here, once, for every candidate whichever arm matched it.
const rendered = (el) => typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
// Content a closed <details> hides (everything but its first <summary>). Chromium 141 leaves such content its
// boxes and refuses it focus, so boxes alone call it visible. The DOM is enough to tell, no style needed.
const inClosedDetails = (el) => {
  for (let n = el; n.parentElement; n = n.parentElement) {
    const p = n.parentElement;
    const open = p.open === true || (typeof p.hasAttribute === "function" && p.hasAttribute("open"));
    if (p.localName === "details" && !open && [...p.children].find((child) => child.localName === "summary") !== n) return true;
  }
  return false;
};
// checkVisibility sees all of that: visibility:hidden, content-visibility and closed details. Without it, three
// things stand in. Boxes (display:none). The DOM (closed details, above). Computed style for visibility:hidden and
// collapse, which is inherited so ancestors count, and for content-visibility:hidden on an ancestor, which is
// not inherited, so ancestors are walked: that subtree keeps its boxes in Chromium 141 and refuses focus.
// With no computed style at all, content-visibility:hidden cannot be seen: a stated limit.
const shown = (el) => {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  if (!rendered(el) || inClosedDetails(el)) return false;
  const view = el.ownerDocument && el.ownerDocument.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const v = view.getComputedStyle(el).visibility;
    if (v === "hidden" || v === "collapse") return false;
    for (let a = el.parentElement; a; a = a.parentElement) if (view.getComputedStyle(a).contentVisibility === "hidden") return false;
  }
  return true;
};
const inert = (el) => typeof el.closest === "function" && el.closest("[inert]") !== null;
// :disabled covers a disabled fieldset's controls, except those in its first legend.
const disabled = (el) => el.disabled === true || (typeof el.matches === "function" && el.matches(":disabled"));
const tabindexOf = (el) => (typeof el.getAttribute === "function" ? Number.parseInt(el.getAttribute("tabindex"), 10) : Number.NaN);
// Only the first <summary> of a <details> is its toggle, unless an explicit tabindex makes another one focusable
// (that is what the tabindex does, and Tab skips it only when the value is negative, which is filtered elsewhere).
const summaryOk = (el) => el.localName !== "summary" || Number.isFinite(tabindexOf(el)) || (Boolean(el.parentElement) && el.parentElement.localName === "details"
  && [...el.parentElement.children].find((child) => child.localName === "summary") === el);
const eligible = (el) => shown(el) && !inert(el) && !disabled(el) && summaryOk(el);
const defaultFocusables = (node) => [...node.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => eligible(el) && !(tabindexOf(el) < 0));
// Somewhere focus may be sent on purpose, which includes a tabindex -1 heading Tab skips.
const defaultCanFocus = (el) => Boolean(el.isConnected) && eligible(el);

/* With a document, how many dialogs are open in it; without, in all of them. */
export function dialogDepth(doc) { return doc ? (stacks.get(doc) || []).length : total; }

/* Returns release(). Call it when the dialog goes away, however it went: Escape,
   the close button, the scrim, an unmount. It is safe to call twice and from
   inside onClose. It says what it did with focus: "restored" (to the opener),
   "fallback", "beneath" (the dialog still open under this one took it), "kept"
   (focus was already somewhere the person put it, restore is off, or a newer dialog
   took focus while this one was restoring), "none", "not-top" (another dialog is above
   this one) or "already-released".
   If opening throws, that opening is not left registered. A dialog that opened properly
   while it ran (from a focus handler, say) stays, with its opener repaired. */
export function openDialogFocus(node, options = {}) {
  const { onClose, initialFocus, fallback, restore = true, focusables = defaultFocusables, canFocus = defaultCanFocus } = options;
  const doc = options.doc || node.ownerDocument;
  const stack = stackOf(doc);
  const was = doc.activeElement;
  const entry = {
    node, doc, focusables, closing: false, released: false, addedTabindex: false,
    // Focus that is already inside the dialog (an autofocused field) is not an opener.
    opener: was && was !== doc.body && !node.contains(was) ? was : null,
  };

  // A dialog with nothing to tab to still needs somewhere for focus to live.
  entry.focusContainer = () => {
    if (!node.hasAttribute("tabindex")) { node.setAttribute("tabindex", "-1"); entry.addedTabindex = true; }
    node.focus({ preventScroll: true });
    return doc.activeElement === node;
  };

  const onKey = (e) => {
    if (entry.released || stack[stack.length - 1] !== entry) return;
    if (e.key === "Escape") {
      // Composing text in an IME uses Escape to cancel the composition, not the dialog.
      if (e.isComposing || !onClose) return;
      e.preventDefault(); e.stopPropagation();
      // A dialog that animates out takes a moment to release; a second Escape in
      // that moment must not close it twice.
      if (entry.closing) return;
      entry.closing = true;
      try { onClose(); } catch (error) { entry.closing = false; throw error; }
      return;
    }
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    // Read afresh every time: controls come and go while a dialog is open.
    const all = focusables(node), last = all.length - 1;
    if (!all.length) { e.preventDefault(); if (doc.activeElement !== node) entry.focusContainer(); return; }
    const at = all.indexOf(doc.activeElement);
    let to = null;
    // At -1 focus is on the container, a heading made focusable, or outside the dialog.
    if (at === -1) to = e.shiftKey ? all[last] : all[0];
    // A positive tabindex changes where a browser goes next, so do not ask it.
    else if (all.some((el) => tabindexOf(el) > 0)) to = all[(at + (e.shiftKey ? last : 1)) % all.length];
    else if (e.shiftKey && at === 0) to = all[last];
    else if (!e.shiftKey && at === last) to = all[0];
    if (!to) return;
    e.preventDefault();
    to.focus();
  };

  // Dialogs above this one may have been opened from inside it. When it goes, in whatever way, they
  // should return to where it came from, not to an element that is gone.
  const passOpenerAlong = (index) => {
    for (let k = index; k < stack.length; k++) {
      const above = stack[k];
      if (entry.opener && (!above.opener || !above.opener.isConnected || node.contains(above.opener))) above.opener = entry.opener;
    }
  };

  const unregister = () => {
    entry.released = true;
    doc.removeEventListener("keydown", onKey, true);
    const index = stack.indexOf(entry), wasTop = index === stack.length - 1;
    if (index >= 0) { stack.splice(index, 1); total--; }
    if (entry.addedTabindex) { node.removeAttribute("tabindex"); entry.addedTabindex = false; }
    return { index, wasTop };
  };

  // Registered before focus moves: moving focus runs the page's focus handlers, and one
  // of them may open a dialog of its own, which must end up above this one, not below it.
  doc.addEventListener("keydown", onKey, true);
  stack.push(entry); total++;

  try {
    const ours = () => !entry.released && stack[stack.length - 1] === entry;
    const wanted = typeof initialFocus === "function" ? initialFocus(node) : initialFocus;
    const chosen = wanted && node.contains(wanted) && canFocus(wanted) ? [wanted] : [];
    let landed = false;
    // A candidate can be refused (hidden by a style, say), so check that focus arrived, and
    // try the next. If a handler opened another dialog meanwhile, focus is where it belongs.
    for (const target of [...chosen, ...focusables(node).filter((el) => !chosen.includes(el))]) {
      if (!ours()) { landed = true; break; }
      target.focus({ preventScroll: true });
      if (doc.activeElement === target) { landed = true; break; }
    }
    if (!landed && ours()) entry.focusContainer();
  } catch (error) {
    const { index, wasTop } = unregister();
    if (!wasTop) passOpenerAlong(index);
    throw error;
  }

  return function release() {
    if (entry.released) return "already-released";
    const { index, wasTop } = unregister();
    if (!wasTop) {
      // Closed out of order, with dialogs still above it.
      passOpenerAlong(index);
      return "not-top";
    }
    if (!restore) return "kept";
    const now = doc.activeElement;
    // Somebody who has already moved focus on, by tapping a field behind the
    // closing dialog say, is not pulled back.
    if (now && now !== doc.body && !node.contains(now)) return "kept";
    // From here on, caller code runs: focus handlers, the fallback. Any of it may open a dialog,
    // and then that dialog owns focus. Notice, and stop, rather than treating its success as a refusal.
    const size = stack.length, below = stack[size - 1];
    const unchanged = () => stack.length === size && stack[size - 1] === below;
    const tryEach = (list) => {
      for (const [get, outcome, trusted] of list) {
        if (!unchanged()) return "kept";
        const target = typeof get === "function" ? get() : get;
        if (!unchanged()) return "kept";
        if (!target || (!trusted && !canFocus(target))) continue;
        target.focus();
        if (doc.activeElement === target) return outcome;
        if (!unchanged()) return "kept";
      }
      return null;
    };
    if (below) {
      // A dialog is still open underneath, and it must keep focus. Go back to the opener if that is
      // inside it; otherwise into it, since an opener outside it would let focus out of a modal.
      const inside = entry.opener && below.node.contains(entry.opener) ? entry.opener : null;
      const found = tryEach([[inside, "restored", false], ...below.focusables(below.node).map((el) => [el, "beneath", true])]);
      if (found) return found;
      if (!unchanged()) return "kept";
      const landed = below.focusContainer();
      return unchanged() ? (landed ? "beneath" : "none") : "kept";
    }
    return tryEach([[entry.opener, "restored", false], [fallback, "fallback", false]]) || "none";
  };
}
