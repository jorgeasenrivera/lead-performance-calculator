import test, { afterEach, beforeEach, describe, before as beforeAll, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { openDialogFocus, dialogDepth, FOCUSABLE_SELECTOR } from '../src/dialog-focus.mjs';

/* There is no DOM in `node --test`, so these run against a small stand-in document.
   It models the browser rules the helper leans on, and only those:
     - focus() does nothing unless the element is connected, enabled, rendered and
       either natively focusable (button, input, select, textarea, a[href], summary)
       or carries a tabindex, which is how a browser treats it;
     - removing the focused element sends focus back to <body>;
     - an unprevented Tab moves focus to the next tabbable element in document order
       (the stand-in wraps; a browser leaves for its own toolbar);
     - listeners on one target all run, and stopPropagation only stops the page's own
       bubble-phase handlers.
   querySelectorAll answers FOCUSABLE_SELECTOR with a hand-written model of it. That
   proves the helper's filtering around the selector (rendered, inert), not the
   selector string itself, and it proves nothing about positive tabindex, shadow DOM,
   iframes, radio groups, the browser toolbar, screen readers or touch. Those need a
   real browser; docs/accessibility-audit.md lists them. */

const NATIVE = new Set(['button', 'input', 'select', 'textarea']);
const FORM = new Set(['button', 'input', 'select', 'textarea', 'fieldset']);
const tabindexOf = (el) => Number.parseInt(el.attrs.get('tabindex'), 10);
class El {
  constructor(doc, tag, props = {}) {
    this.doc = doc; this.tag = tag; this.id = props.id || tag; this.attrs = new Map(); this.children = []; this.parent = null;
    this.disabled = Boolean(props.disabled); this.hiddenSelf = Boolean(props.hidden); this.visHidden = Boolean(props.visHidden);
    this.engineHidden = Boolean(props.engineHidden);   // hidden in a way only checkVisibility reports
    this.contentHidden = Boolean(props.contentHidden); // content-visibility:hidden on this element: its descendants are skipped
    for (const [k, v] of Object.entries(props.attrs || {})) this.attrs.set(k, String(v));
    // Older engines have no checkVisibility; a document can be built without it to exercise the fallback.
    if (!doc.hasCheckVisibility) this.checkVisibility = undefined;
  }
  add(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  remove() {
    const active = this.doc.activeElement;
    this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null;
    if (active && this.contains(active)) this.doc.activeElement = this.doc.body;
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === this.doc.root; }
  get ownerDocument() { return this.doc; }
  get localName() { return this.tag; }
  get parentElement() { return this.parent; }
  contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; }
  hasAttribute(k) { return this.attrs.has(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  closest(sel) { assert.equal(sel, '[inert]'); for (let n = this; n; n = n.parent) if (n.attrs.has('inert')) return n; return null; }
  // Layout: display:none, or inside a closed <details> unless it is the first <summary>. visibility:hidden still has boxes.
  inClosedDetails() {
    for (let n = this; n.parent; n = n.parent) {
      const p = n.parent;
      if (p.tag === 'details' && !p.attrs.has('open') && p.children.find((c) => c.tag === 'summary') !== n) return true;
    }
    return false;
  }
  underContentHidden() { for (let n = this.parent; n; n = n.parent) if (n.contentHidden) return true; return false; }
  // Skipped content (below a content-visibility:hidden element, or in a closed <details>) keeps boxes in Chromium 141
  // and refuses focus; older engines give closed details content no boxes at all. A document chooses which.
  getClientRects() {
    for (let n = this; n; n = n.parent) if (n.hiddenSelf) return [];
    if (this.inClosedDetails() && !this.doc.skippedHasBoxes) return [];
    return [{}];
  }
  visibilityHidden() { for (let n = this; n; n = n.parent) if (n.visHidden) return true; return false; }
  checkVisibility() { return !this.engineHidden && this.getClientRects().length > 0 && !this.visibilityHidden() && !this.inClosedDetails() && !this.underContentHidden(); }
  // :disabled as a browser computes it: own attribute, or inside a disabled fieldset except in its first legend.
  effectivelyDisabled() {
    if (!FORM.has(this.tag)) return false;
    if (this.disabled) return true;
    for (let n = this.parent; n; n = n.parent) {
      if (n.tag === 'fieldset' && n.disabled) {
        const legend = n.children.find((c) => c.tag === 'legend');
        if (!(legend && legend.contains(this))) return true;
      }
    }
    return false;
  }
  matches(sel) { assert.equal(sel, ':disabled'); return this.effectivelyDisabled(); }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  // The model of FOCUSABLE_SELECTOR: what the selector string matches, which includes some elements a browser would not focus.
  matchesFocusable() {
    const ti = this.attrs.get('tabindex');
    if (ti !== undefined && ti !== '-1') return true;
    if (this.tag === 'a' || this.tag === 'area') return this.attrs.has('href');
    if (this.tag === 'input' && this.attrs.get('type') === 'hidden') return false;
    if (['button', 'input', 'select', 'textarea'].includes(this.tag)) return !this.disabled;
    return this.tag === 'summary' || this.attrs.get('contenteditable') === 'true' || this.attrs.get('contenteditable') === '';
  }
  querySelectorAll(sel) { assert.equal(sel, FOCUSABLE_SELECTOR); return this.descendants().filter((e) => e.matchesFocusable()); }
  firstSummary() { return this.tag === 'summary' && this.parent && this.parent.tag === 'details' && this.parent.children.find((c) => c.tag === 'summary') === this; }
  // The browser rule for whether focus() lands.
  canTakeFocus() {
    return this.isConnected && !this.effectivelyDisabled() && this.getClientRects().length > 0 && !this.visibilityHidden() && !this.inClosedDetails() && !this.underContentHidden() && !this.closest('[inert]')
      && (NATIVE.has(this.tag) || (this.tag === 'a' && this.attrs.has('href')) || this.firstSummary() || this.attrs.has('tabindex'));
  }
  focus(options) {
    this.doc.focusLog.push(this.id);
    if (this.canTakeFocus()) { this.doc.activeElement = this; if (this.onFocus) this.onFocus(); }
  }
}

class Doc {
  constructor({ checkVisibility = true, computedStyle = true, skippedHasBoxes = false } = {}) {
    this.hasCheckVisibility = checkVisibility;
    this.skippedHasBoxes = skippedHasBoxes;
    // getComputedStyle(el).visibility is inherited, so it already reflects hidden ancestors, as in a browser.
    this.defaultView = computedStyle ? { getComputedStyle: (el) => ({ visibility: el.visibilityHidden() ? 'hidden' : 'visible', contentVisibility: el.contentHidden ? 'hidden' : 'visible' }) } : undefined;
    this.root = new El(this, 'html', { id: 'html' }); this.body = new El(this, 'body', { id: 'body' }); this.root.add(this.body);
    this.activeElement = this.body; this.listeners = []; this.focusLog = [];
  }
  make(tag, props, ...kids) { return new El(this, tag, props).add(...kids); }
  addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: capture === true }); }
  removeEventListener(type, fn, capture) {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === (capture === true));
    if (i >= 0) this.listeners.splice(i, 1);
  }
  get listenerCount() { return this.listeners.length; }
  dispatchKey(init) {
    const e = { type: 'keydown', defaultPrevented: false, stopped: false, ...init,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const l of [...this.listeners]) if (l.type === 'keydown' && l.capture) l.fn(e);
    if (!e.stopped) for (const l of [...this.listeners]) if (l.type === 'keydown' && !l.capture) l.fn(e);
    return e;
  }
  // A key press including what the browser does with an unprevented Tab.
  press(key, init = {}) {
    const e = this.dispatchKey({ key, ...init });
    if (key === 'Tab' && !e.defaultPrevented) this.nativeTab(Boolean(init.shiftKey));
    return e;
  }
  // What a browser does with an unprevented Tab: positive tabindex values first in ascending order,
  // then everything else in document order. Wraps; a real browser would leave for its own toolbar.
  nativeTab(back) {
    const order = this.root.descendants();
    const list = order.filter((el) => el.canTakeFocus() && !(tabindexOf(el) < 0));
    const rank = (el) => (tabindexOf(el) > 0 ? tabindexOf(el) : Infinity);
    const seq = [...list].sort((x, y) => (rank(x) === rank(y) ? order.indexOf(x) - order.indexOf(y) : rank(x) < rank(y) ? -1 : 1));
    if (!seq.length) return;
    const at = seq.indexOf(this.activeElement);
    if (at >= 0) { this.activeElement = seq[(at + (back ? -1 : 1) + seq.length) % seq.length]; return; }
    // On <body> or on a tabindex=-1 element: the next tabbable element in document order from there.
    const here = order.indexOf(this.activeElement);
    const walk = back ? order.slice(0, here < 0 ? order.length : here).reverse().concat(order.slice(here < 0 ? order.length : here).reverse())
      : order.slice(here + 1).concat(order.slice(0, here + 1));
    const next = walk.find((el) => list.includes(el));
    if (next) this.activeElement = next;
  }
}

// A page with controls before and after, and a dialog of three buttons.
function page({ dialogKids } = {}) {
  const doc = new Doc();
  const before = doc.make('button', { id: 'before' }), opener = doc.make('button', { id: 'opener' }), after = doc.make('button', { id: 'after' });
  const a = doc.make('button', { id: 'a' }), b = doc.make('button', { id: 'b' }), c = doc.make('button', { id: 'c' });
  const dialog = doc.make('div', { id: 'dialog', attrs: { role: 'dialog' } }, ...(dialogKids || [a, b, c]));
  doc.body.add(before, opener, dialog, after);
  return { doc, before, opener, after, a, b, c, dialog };
}

const handles = [];
const show = (node, options) => { const release = openDialogFocus(node, options); handles.push(release); return release; };
// Registrations are module-wide, so a test that leaks one would otherwise fail every test after it.
// Each test is held to what it started with, and the leak is reported against the test that made it.
let baseline = 0;
const depth = () => dialogDepth() - baseline;
beforeEach(() => { baseline = dialogDepth(); });
afterEach(() => { for (const release of handles.splice(0)) release(); assert.equal(depth(), 0, 'this test left a dialog registered'); });

test('opening moves focus to the first tabbable control, and says where it came from', () => {
  const { doc, opener, dialog, a } = page();
  opener.focus();
  show(dialog);
  assert.equal(doc.activeElement, a);
  assert.equal(depth(), 1);
});

test('initial focus can be chosen, and a bad choice falls back to the first control', () => {
  let p = page(); p.opener.focus();
  show(p.dialog, { initialFocus: p.c });
  assert.equal(p.doc.activeElement, p.c);
  handles.splice(0).forEach((r) => r());
  p = page(); p.opener.focus();
  show(p.dialog, { initialFocus: () => p.b });
  assert.equal(p.doc.activeElement, p.b);
  handles.splice(0).forEach((r) => r());
  p = page(); p.opener.focus();
  show(p.dialog, { initialFocus: p.after });          // outside the dialog
  assert.equal(p.doc.activeElement, p.a);
  handles.splice(0).forEach((r) => r());
  p = page({ dialogKids: [] }); p.opener.focus();
  const hidden = p.doc.make('button', { id: 'gone', hidden: true }); p.dialog.add(hidden);
  show(p.dialog, { initialFocus: hidden });           // rendered nowhere
  assert.equal(p.doc.activeElement, p.dialog, 'with nothing usable, focus lives on the container');
});

test('a dialog with nothing to tab to takes focus itself, and gives its tabindex back', () => {
  const { doc, opener, dialog } = page({ dialogKids: [] });
  opener.focus();
  const release = show(dialog);
  assert.equal(doc.activeElement, dialog);
  assert.equal(dialog.hasAttribute('tabindex'), true);
  const tab = doc.press('Tab');
  assert.equal(tab.defaultPrevented, true, 'Tab has nowhere to go and must not leave');
  assert.equal(doc.activeElement, dialog);
  assert.equal(release(), 'restored');
  assert.equal(dialog.hasAttribute('tabindex'), false, 'a tabindex it added is removed');
  assert.equal(doc.activeElement, opener);
});

test('a container that already has its own tabindex keeps it', () => {
  const { doc, opener, dialog } = page({ dialogKids: [] });
  dialog.setAttribute('tabindex', '-1');
  opener.focus();
  const release = show(dialog);
  release();
  assert.equal(dialog.attrs.get('tabindex'), '-1');
  assert.equal(doc.activeElement, opener);
});

test('Tab walks inside, and wraps at both ends instead of leaving', () => {
  const { doc, opener, dialog, a, b, c } = page();
  opener.focus(); show(dialog);
  assert.equal(doc.press('Tab').defaultPrevented, false, 'in the middle the browser does the move');
  assert.equal(doc.activeElement, b);
  doc.press('Tab'); assert.equal(doc.activeElement, c);
  assert.equal(doc.press('Tab').defaultPrevented, true);
  assert.equal(doc.activeElement, a, 'forward from the last control lands on the first');
  assert.equal(doc.press('Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(doc.activeElement, c, 'back from the first control lands on the last');
  doc.press('Tab', { shiftKey: true }); assert.equal(doc.activeElement, b);
  for (let i = 0; i < 12; i++) { doc.press('Tab'); assert.ok(dialog.contains(doc.activeElement), 'focus never left the dialog'); }
});

test('Tab from outside the dialog, or from its container, comes back in', () => {
  const { doc, after, opener, dialog, a, c } = page();
  opener.focus(); show(dialog);
  after.focus();
  doc.press('Tab'); assert.equal(doc.activeElement, a);
  after.focus();
  doc.press('Tab', { shiftKey: true }); assert.equal(doc.activeElement, c);
  dialog.setAttribute('tabindex', '-1'); dialog.focus();
  doc.press('Tab', { shiftKey: true }); assert.equal(doc.activeElement, c);
  dialog.focus(); doc.press('Tab'); assert.equal(doc.activeElement, a);
});

test('a single control keeps focus on itself in both directions', () => {
  const { doc, opener, dialog } = page({ dialogKids: [] });
  const only = doc.make('button', { id: 'only' }); dialog.add(only);
  opener.focus(); show(dialog);
  doc.press('Tab'); assert.equal(doc.activeElement, only);
  doc.press('Tab', { shiftKey: true }); assert.equal(doc.activeElement, only);
});

test('disabled, hidden, inert and non-hidden-input controls are skipped', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const off = doc.make('button', { id: 'off', disabled: true }), gone = doc.make('button', { id: 'gone', hidden: true });
  const hiddenInput = doc.make('input', { id: 'hid', attrs: { type: 'hidden' } });
  const inertWrap = doc.make('div', { id: 'wrap', attrs: { inert: '' } }, doc.make('button', { id: 'inside-inert' }));
  const skip = doc.make('button', { id: 'skip', attrs: { tabindex: '-1' } });
  const first = doc.make('button', { id: 'first' }), last = doc.make('a', { id: 'link', attrs: { href: '#x' } });
  dialog.add(off, gone, hiddenInput, inertWrap, skip, first, last);
  opener.focus(); show(dialog);
  assert.equal(doc.activeElement, first);
  doc.press('Tab'); assert.equal(doc.activeElement, last);
  doc.press('Tab'); assert.equal(doc.activeElement, first, 'wrapped past everything that cannot take focus');
});

test('Escape calls onClose once, is swallowed, and ignores other keys and IME composition', () => {
  const { doc, opener, dialog } = page();
  let closes = 0, bubbled = 0;
  doc.addEventListener('keydown', () => { bubbled++; }, false);
  opener.focus(); show(dialog, { onClose: () => { closes++; } });
  const e = doc.press('Escape');
  assert.equal(closes, 1);
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.stopped, true);
  assert.equal(bubbled, 0, 'the page never sees the Escape that closed the dialog');
  doc.press('Escape', { isComposing: true });
  doc.press('Enter'); doc.press('a');
  assert.equal(closes, 1, 'only the first Escape counted; the rest were composition or other keys');
});

test('a second Escape while the dialog is still animating out does not close it twice', () => {
  const { doc, opener, dialog } = page();
  let closes = 0;
  opener.focus(); const release = show(dialog, { onClose: () => { closes++; } });
  doc.press('Escape'); doc.press('Escape'); doc.press('Escape');
  assert.equal(closes, 1);
  release();
  doc.press('Escape');
  assert.equal(closes, 1, 'and none after it is gone');
});

test('without onClose Escape is left alone for the page', () => {
  const { doc, opener, dialog } = page();
  opener.focus(); show(dialog);
  const e = doc.press('Escape');
  assert.equal(e.defaultPrevented, false);
  assert.equal(e.stopped, false);
});

test('Tab combined with Ctrl, Alt or Meta is not ours', () => {
  const { doc, opener, dialog, c } = page();
  opener.focus(); show(dialog); c.focus();
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(doc.dispatchKey({ key: 'Tab', [mod]: true }).defaultPrevented, false);
});

test('a throwing onClose leaves the dialog usable and the next Escape retries', () => {
  const { doc, opener, dialog } = page();
  let calls = 0;
  opener.focus(); show(dialog, { onClose: () => { calls++; if (calls === 1) throw new Error('boom'); } });
  assert.throws(() => doc.press('Escape'), /boom/);
  doc.press('Escape');
  assert.equal(calls, 2);
});

test('releasing from inside onClose works, and a late release is harmless', () => {
  const { doc, opener, dialog } = page();
  opener.focus();
  let release;
  release = show(dialog, { onClose: () => { release(); } });
  doc.press('Escape');
  assert.equal(doc.activeElement, opener);
  assert.equal(depth(), 0);
  assert.equal(doc.listenerCount, 0);
  assert.equal(release(), 'already-released');
  assert.equal(doc.activeElement, opener, 'and it did not move focus again');
});

test('repeated open and close leaves no listeners, no dialogs and focus where it started', () => {
  const { doc, opener, dialog } = page();
  for (let i = 0; i < 60; i++) {
    opener.focus();
    const release = show(dialog, { onClose() {} });
    assert.equal(doc.listenerCount, 1);
    assert.equal(release(), 'restored');
    assert.equal(doc.activeElement, opener);
    assert.equal(doc.listenerCount, 0);
  }
  assert.equal(depth(), 0);
});

test('the same dialog opened twice without a close does not double its keys', () => {
  const { doc, opener, dialog } = page();
  let closes = 0;
  opener.focus();
  const first = show(dialog, { onClose: () => { closes++; } });
  const second = show(dialog, { onClose: () => { closes++; } });
  doc.press('Escape');
  assert.equal(closes, 1, 'only the newest registration answers');
  second(); first();
  assert.equal(doc.listenerCount, 0);
});

test('focus returns to the opener, including after the dialog was removed first', () => {
  const { doc, opener, dialog } = page();
  opener.focus();
  const release = show(dialog);
  dialog.remove();                                   // an unmount runs before this cleanup
  assert.equal(doc.activeElement, doc.body);
  assert.equal(release(), 'restored');
  assert.equal(doc.activeElement, opener);
});

test('opened from nowhere there is no opener, and a fallback is used if given', () => {
  let p = page();
  show(p.dialog);
  p.dialog.remove();                                 // as an unmount would
  assert.equal(handles.pop()(), 'none');
  assert.equal(p.doc.activeElement, p.doc.body);
  p = page();
  const release = show(p.dialog, { fallback: () => p.after });
  assert.equal(release(), 'fallback');
  assert.equal(p.doc.activeElement, p.after);
});

/* These two were first written expecting focus on <body> after release. They failed
   because the dialog was still attached, and a browser leaves focus on a control
   inside an attached dialog until the dialog is removed or hidden (checked in real
   Chromium). The two tests above now remove the node first, as an unmount does, and
   this one keeps the original situation as a stated behaviour: when there is nowhere
   to return to, the helper reports "none" and does not move focus. */
test('with no opener and no fallback, release reports none and leaves focus where it is', () => {
  const p = page();
  show(p.dialog);
  assert.equal(p.doc.activeElement, p.a);
  assert.equal(handles.pop()(), 'none');
  assert.equal(p.doc.activeElement, p.a, 'the dialog is still attached, so focus is still on its control');
  p.dialog.remove();
  assert.equal(p.doc.activeElement, p.doc.body, 'and it falls to the page only when the node goes');
});

test('an opener that was removed falls back, or reports none, and never throws', () => {
  let p = page(); p.opener.focus(); let release = show(p.dialog, { fallback: p.after });
  p.opener.remove();
  assert.equal(release(), 'fallback');
  assert.equal(p.doc.activeElement, p.after);
  p = page(); p.opener.focus(); release = show(p.dialog);
  p.opener.remove(); p.dialog.remove();
  assert.equal(release(), 'none');
  assert.equal(p.doc.activeElement, p.doc.body, 'focus is left on the page, not forced somewhere arbitrary');
});

test('an opener that became disabled, hidden or inert is not returned to', () => {
  for (const [label, change] of [
    ['disabled', (o) => { o.disabled = true; }],
    ['hidden', (o) => { o.hiddenSelf = true; }],
    ['inert', (o) => { o.setAttribute('inert', ''); }],
  ]) {
    const p = page(); p.opener.focus();
    const release = show(p.dialog, { fallback: p.after });
    change(p.opener);
    assert.equal(release(), 'fallback', label);
    assert.equal(p.doc.activeElement, p.after, label);
    handles.splice(0);
  }
});

test('a canFocus supplied by the caller decides whether the opener is returned to', () => {
  const p = page(); p.opener.focus();
  const release = show(p.dialog, { canFocus: (el) => el !== p.opener, fallback: p.after });
  assert.equal(release(), 'fallback', 'the opener could take focus, but the caller said not to');
  assert.equal(p.doc.activeElement, p.after);
  assert.equal(p.doc.focusLog.filter((id) => id === 'opener').length, 1, 'and it was not even tried on release');
});

test('an opener the browser refuses is treated as gone, not trusted', () => {
  const p = page(); p.opener.focus();
  const release = show(p.dialog, { fallback: p.after });
  p.opener.focus = function () { this.doc.focusLog.push('refused'); };   // focus() silently does nothing
  assert.equal(release(), 'fallback');
  assert.equal(p.doc.activeElement, p.after);
});

test('focus that the person already moved is not pulled back', () => {
  const { doc, opener, after, dialog } = page();
  opener.focus();
  const release = show(dialog);
  after.focus();                                     // a tap on the page behind the closing dialog
  assert.equal(release(), 'kept');
  assert.equal(doc.activeElement, after);
});

test('restore can be switched off', () => {
  const { doc, opener, dialog } = page();
  opener.focus();
  const release = show(dialog, { restore: false });
  assert.equal(release(), 'kept');
  assert.notEqual(doc.activeElement, opener);
});

test('nested: only the top dialog answers, and closing it hands back to the one below', () => {
  const { doc, opener, dialog, a } = page();
  const inner = doc.make('div', { id: 'inner' }, doc.make('button', { id: 'i1' }), doc.make('button', { id: 'i2' }));
  doc.body.add(inner);
  const closed = [];
  opener.focus(); const outerRelease = show(dialog, { onClose: () => closed.push('outer') });
  a.focus();
  const innerRelease = show(inner, { onClose: () => closed.push('inner') });
  assert.equal(doc.activeElement.id, 'i1');
  assert.equal(depth(), 2);
  doc.press('Tab'); doc.press('Tab'); doc.press('Tab');
  assert.ok(inner.contains(doc.activeElement), 'the dialog beneath does not pull Tab into itself');
  doc.press('Escape');
  assert.deepEqual(closed, ['inner'], 'Escape reached only the dialog on top');
  assert.equal(innerRelease(), 'restored');
  assert.equal(doc.activeElement, a, 'back to the control that opened the inner dialog');
  doc.press('Escape');
  assert.deepEqual(closed, ['inner', 'outer']);
  assert.equal(outerRelease(), 'restored');
  assert.equal(doc.activeElement, opener);
});

test('replaced: the old dialog closing first, then the new one opening, hands focus along cleanly', () => {
  const { doc, opener, dialog } = page();
  const next = doc.make('div', { id: 'next' }, doc.make('button', { id: 'n1' }));
  doc.body.add(next);
  opener.focus();
  const oldRelease = show(dialog);
  assert.equal(oldRelease(), 'restored');
  const newRelease = show(next);
  assert.equal(doc.activeElement.id, 'n1');
  assert.equal(newRelease(), 'restored');
  assert.equal(doc.activeElement, opener);
});

test('replaced the other way: the new dialog opens before the old one is released', () => {
  const { doc, opener, dialog, a } = page();
  const next = doc.make('div', { id: 'next' }, doc.make('button', { id: 'n1' }));
  doc.body.add(next);
  opener.focus();
  const oldRelease = show(dialog);                   // focus is on a, inside the old dialog
  assert.equal(doc.activeElement, a);
  const newRelease = show(next);                     // opener of the new one is a, which is about to go
  assert.equal(oldRelease(), 'not-top');
  assert.equal(doc.activeElement.id, 'n1', 'the old dialog did not steal focus from the new one');
  dialog.remove();
  assert.equal(newRelease(), 'restored');
  assert.equal(doc.activeElement, opener, 'and the new one returns to where the old one came from, not to a removed button');
});

test('out of order: the lower dialog released while the upper stays open keeps the upper working', () => {
  const { doc, opener, dialog, a } = page();
  const upper = doc.make('div', { id: 'upper' }, doc.make('button', { id: 'u1' }));
  doc.body.add(upper);
  const closed = [];
  opener.focus(); const lower = show(dialog, { onClose: () => closed.push('lower') });
  a.focus(); const top = show(upper, { onClose: () => closed.push('upper') });
  lower();
  assert.equal(depth(), 1);
  doc.press('Escape');
  assert.deepEqual(closed, ['upper']);
  top();
});

test('an opener that is not inside the dialog beneath is kept by the one above', () => {
  const { doc, opener, dialog, after } = page();
  const upper = doc.make('div', { id: 'upper' }, doc.make('button', { id: 'u1' }));
  doc.body.add(upper);
  opener.focus(); const lower = show(dialog);
  after.focus(); const top = show(upper);            // opened from a control outside the lower dialog
  lower();
  upper.remove();
  assert.equal(top(), 'restored');
  assert.equal(doc.activeElement, after);
});

test('interrupted: the opener goes away between Escape and the release', () => {
  const { doc, opener, dialog, after } = page();
  opener.focus();
  const release = show(dialog, { onClose() {}, fallback: () => after });
  doc.press('Escape');                               // the dialog starts to animate out
  opener.remove();                                   // and the page drops the control meanwhile
  assert.equal(release(), 'fallback');
  assert.equal(doc.activeElement, after);
});

test('interrupted: Escape arrives after the dialog node was already detached', () => {
  const { doc, opener, dialog } = page();
  let closes = 0;
  opener.focus(); show(dialog, { onClose: () => { closes++; } });
  dialog.remove();
  doc.press('Escape');
  assert.equal(closes, 1, 'the dialog is still registered until released, so the key still lands');
});

test('the default filtering reads rendered and inert from the node, and the selector is the one exported', () => {
  assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])') && FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
  assert.ok(!FOCUSABLE_SELECTOR.includes(' '), 'one comma-joined selector, no stray spaces');
});

/* ---- Review round 1 (independent review of 18 October) ------------------------------
   These were run against the first version of the helper before it was changed. Most
   failed there and say why in their messages. Some passed there and are kept anyway:
   "coverage" tests hold a guard that removing used to leave all 32 original tests green,
   and a few (the heading with tabindex -1, the fieldset, the summary and details cases,
   throwing while opening, releasing four dialogs in every order) pin behaviour the
   rewrite could break. The run against the first version is in the review bundle. */

const ids = (els) => els.map((e) => e.id);
const pressAll = (doc, n, init) => Array.from({ length: n }, () => { doc.press('Tab', init); return doc.activeElement.id; });

test('a disabled control that carries a tabindex is not where focus starts', () => {
  const p = page({ dialogKids: [] });
  const bad = p.doc.make('button', { id: 'bad', disabled: true, attrs: { tabindex: '0' } }), good = p.doc.make('button', { id: 'good' });
  p.dialog.add(bad, good);
  p.opener.focus(); show(p.dialog);
  assert.equal(p.doc.activeElement, good, 'the selector matches the disabled one through its tabindex; it must not be tried first');
});

test('a disabled control that carries a tabindex does not let Tab out at the end', () => {
  const p = page({ dialogKids: [] });
  const first = p.doc.make('button', { id: 'first' }), last = p.doc.make('button', { id: 'last' });
  const bad = p.doc.make('button', { id: 'bad', disabled: true, attrs: { tabindex: '0' } });
  p.dialog.add(first, last, bad);
  p.opener.focus(); show(p.dialog); last.focus();
  assert.equal(p.doc.press('Tab').defaultPrevented, true, 'last is the last real stop, so Tab must wrap');
  assert.equal(p.doc.activeElement, first);
  assert.notEqual(p.doc.activeElement, p.after);
});

test('an initialFocus that cannot take focus falls through to the first control that can', () => {
  const p = page();
  const heading = p.doc.make('h2', { id: 'heading' });             // visible, attached, no tabindex: focus() does nothing
  p.dialog.children.unshift(heading); heading.parent = p.dialog;
  p.opener.focus(); show(p.dialog, { initialFocus: heading });
  assert.equal(p.doc.activeElement, p.a, 'not left on the opener behind the dialog');
});

test('a heading with tabindex -1 can be chosen for initial focus but is not a Tab stop', () => {
  const p = page();
  const heading = p.doc.make('h2', { id: 'heading', attrs: { tabindex: '-1' } });
  p.dialog.children.unshift(heading); heading.parent = p.dialog;
  p.opener.focus(); show(p.dialog, { initialFocus: heading });
  assert.equal(p.doc.activeElement, heading);
  p.doc.press('Tab'); assert.equal(p.doc.activeElement, p.a, 'forward goes to the first real control');
  heading.focus(); p.doc.press('Tab', { shiftKey: true }); assert.equal(p.doc.activeElement, p.c, 'back goes to the last, not out of the dialog');
});

test('a first control that refuses focus is skipped, and if all refuse the container takes it', () => {
  let p = page(); p.opener.focus();
  p.a.focus = function () { this.doc.focusLog.push('refused'); };
  show(p.dialog);
  assert.equal(p.doc.activeElement, p.b, 'the next control, not the opener');
  handles.splice(0).forEach((r) => r());
  p = page(); p.opener.focus();
  for (const el of [p.a, p.b, p.c]) el.focus = function () { this.doc.focusLog.push('refused'); };
  show(p.dialog);
  assert.equal(p.doc.activeElement, p.dialog, 'with every control refusing, focus still lands inside the dialog');
});

test('controls disabled by their own attribute or by a disabled fieldset are skipped, except in its first legend', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const own = doc.make('button', { id: 'own', disabled: true });
  const inLegend = doc.make('button', { id: 'in-legend' }), inBody = doc.make('button', { id: 'in-body' });
  const fieldset = doc.make('fieldset', { id: 'fs', disabled: true }, doc.make('legend', { id: 'lg' }, inLegend), inBody);
  const tail = doc.make('button', { id: 'tail' });
  dialog.add(own, fieldset, tail);
  opener.focus(); show(dialog);
  assert.deepEqual([doc.activeElement.id, ...pressAll(doc, 3)], ['in-legend', 'tail', 'in-legend', 'tail'], 'the fieldset body and the disabled button are not stops; the first legend is');
});

test('visibility hidden controls are skipped where the engine can say so, and tolerated where it cannot', () => {
  const build = (opts) => {
    const doc = new Doc(opts);
    const opener = doc.make('button', { id: 'opener' }), ghost = doc.make('button', { id: 'ghost', visHidden: true }), real = doc.make('button', { id: 'real' });
    const dialog = doc.make('div', { id: 'dialog' }, ghost, real); doc.body.add(opener, dialog);
    return { doc, opener, ghost, real, dialog };
  };
  let w = build({ checkVisibility: true }); w.opener.focus(); show(w.dialog);
  assert.equal(w.doc.activeElement, w.real);
  assert.equal(w.doc.press('Tab').defaultPrevented, true, 'one real stop, so Tab wraps onto itself');
  assert.equal(w.doc.press('Tab', { shiftKey: true }).defaultPrevented, true, 'and so does Shift+Tab: the ghost is not a stop before it');
  assert.equal(w.doc.focusLog.includes('ghost'), false, 'the ghost was never even tried');
  handles.splice(0).forEach((r) => r());
  w = build({ checkVisibility: false }); w.opener.focus(); show(w.dialog);     // no checkVisibility: computed style answers
  assert.equal(w.doc.activeElement, w.real);
  assert.equal(w.doc.focusLog.includes('ghost'), false, 'the ghost is not a candidate when computed style can say so');
  handles.splice(0).forEach((r) => r());
  w = build({ checkVisibility: false, computedStyle: false }); w.opener.focus(); show(w.dialog);   // neither: boxes alone
  assert.equal(w.doc.activeElement, w.real, 'focus refused by the ghost is detected and the next control is used');
  assert.equal(w.doc.focusLog.includes('ghost'), true, 'with neither API it is tried: boxes alone call it visible, which is the stated limit');
});

test('only the first summary of a details is a stop, and a closed details hides its content', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const s1 = doc.make('summary', { id: 's1' }), s2 = doc.make('summary', { id: 's2' }), inner = doc.make('button', { id: 'inner' });
  const details = doc.make('details', { id: 'details' }, s1, s2, inner);
  const tail = doc.make('button', { id: 'tail' });
  dialog.add(details, tail);
  opener.focus(); show(dialog);
  assert.deepEqual([doc.activeElement.id, ...pressAll(doc, 2)], ['s1', 'tail', 's1'], 'closed: first summary and the button after it');
  handles.splice(0).forEach((r) => r());
  details.setAttribute('open', ''); opener.focus(); show(dialog);
  assert.deepEqual([doc.activeElement.id, ...pressAll(doc, 3)], ['s1', 'inner', 'tail', 's1'], 'open: the content joins, the second summary still does not');
});

test('a second summary at the end of an open dialog is not a stop, so Tab wraps from the control before it', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const head = doc.make('button', { id: 'head' });
  const s1 = doc.make('summary', { id: 's1' }), s2 = doc.make('summary', { id: 's2' });
  const details = doc.make('details', { id: 'details', attrs: { open: '' } }, s1, s2);
  dialog.add(head, details);
  opener.focus(); show(dialog); s1.focus();
  assert.equal(doc.press('Tab').defaultPrevented, true, 's1 is the last real stop');
  assert.equal(doc.activeElement, head, 'not out to the page, and not onto a second summary that cannot take focus');
});

test('two documents do not share one stack: Escape, Tab and restore in one ignore the other', () => {
  const A = page(), B = page();
  const closed = [];
  A.opener.focus(); const ra = show(A.dialog, { onClose: () => closed.push('A') });
  B.opener.focus(); const rb = show(B.dialog, { onClose: () => closed.push('B') });
  assert.equal(depth(), 2);
  A.doc.press('Escape');
  assert.deepEqual(closed, ['A'], 'Escape in A reaches A even though B opened later');
  A.c.focus();
  assert.equal(A.doc.press('Tab').defaultPrevented, true, 'and A still wraps');
  assert.equal(A.doc.activeElement, A.a);
  A.dialog.remove();
  assert.equal(ra(), 'restored', 'A returns to its opener; B is not above it');
  assert.equal(A.doc.activeElement, A.opener);
  B.doc.press('Escape');
  assert.deepEqual(closed, ['A', 'B']);
  assert.equal(rb(), 'restored');
  assert.equal(A.doc.listenerCount + B.doc.listenerCount, 0);
  assert.equal(depth(), 0);
});

test('dialogDepth can be asked about one document, and without an argument counts them all', () => {
  const A = page(), B = page();
  A.opener.focus(); show(A.dialog); B.opener.focus(); const rb = show(B.dialog);
  assert.equal(dialogDepth(A.doc), 1);
  assert.equal(dialogDepth(B.doc), 1);
  assert.equal(depth(), 2);
  rb();
  assert.equal(dialogDepth(B.doc), 0);
  assert.equal(dialogDepth(A.doc), 1);
  assert.equal(depth(), 1);
});

test('two documents opened and closed in alternation leave nothing behind', () => {
  const A = page(), B = page();
  for (let i = 0; i < 20; i++) {
    A.opener.focus(); const ra = show(A.dialog, {});
    B.opener.focus(); const rb = show(B.dialog, {});
    const order = i % 2 ? [ra, rb] : [rb, ra];
    for (const release of order) assert.equal(release(), 'restored');
    assert.equal(A.doc.activeElement, A.opener); assert.equal(B.doc.activeElement, B.opener);
  }
  assert.equal(A.doc.listenerCount + B.doc.listenerCount, 0);
  assert.equal(depth(), 0);
});

test('a dialog opened from inside another dialog\'s focus event stays on top', () => {
  const { doc, opener, dialog, a } = page();
  const inner = doc.make('div', { id: 'inner' }, doc.make('button', { id: 'i1' }));
  doc.body.add(inner);
  const closed = [];
  a.onFocus = () => { a.onFocus = null; show(inner, { onClose: () => closed.push('inner') }); };
  opener.focus();
  const outer = show(dialog, { onClose: () => closed.push('outer') });
  assert.equal(doc.activeElement.id, 'i1', 'the outer dialog did not take focus back from the one its focus event opened');
  doc.press('Escape');
  assert.deepEqual(closed, ['inner'], 'Escape reaches the inner dialog');
  assert.equal(depth(), 2);
  outer();
});

test('a dialog opened from inside initialFocus stays on top', () => {
  const { doc, opener, dialog, b } = page();
  const inner = doc.make('div', { id: 'inner' }, doc.make('button', { id: 'i1' }));
  doc.body.add(inner);
  const closed = [];
  opener.focus();
  show(dialog, { onClose: () => closed.push('outer'), initialFocus: () => { show(inner, { onClose: () => closed.push('inner') }); return b; } });
  assert.equal(doc.activeElement.id, 'i1');
  doc.press('Escape');
  assert.deepEqual(closed, ['inner']);
});

test('if opening throws, nothing stays registered', () => {
  for (const [label, make] of [
    ['focusables', () => ({ focusables: () => { throw new Error('boom'); } })],
    ['initialFocus', () => ({ initialFocus: () => { throw new Error('boom'); } })],
    ['focus', (p) => { p.a.focus = () => { throw new Error('boom'); }; return {}; }],
  ]) {
    const p = page({ dialogKids: [] });
    const only = p.doc.make('button', { id: 'a' }); p.dialog.add(only);
    p.a = only; p.opener.focus();
    assert.throws(() => openDialogFocus(p.dialog, make(p)), /boom/, label);
    assert.equal(depth(), 0, label);
    assert.equal(p.doc.listenerCount, 0, label);
    assert.equal(p.dialog.hasAttribute('tabindex'), false, label);
  }
});

test('a stale opener two levels down is repaired: the top dialog lands inside the one still open beneath it', () => {
  const { doc, opener, dialog: A, a } = page();
  const B = doc.make('div', { id: 'B' }, doc.make('button', { id: 'b1' }), doc.make('button', { id: 'b2' }));
  const C = doc.make('div', { id: 'C' }, doc.make('button', { id: 'c1' }));
  doc.body.add(B, C);
  opener.focus(); const ra = show(A);
  B.children[0].focus(); const rb = show(B);           // B opened from a control that is inside B's own markup; its opener is whatever had focus
  a.focus();                                           // focus moves to a control in A while B is still registered
  const rc = show(C);                                  // C's opener is a, inside A
  A.remove();
  assert.equal(ra(), 'not-top');
  assert.equal(rc(), 'beneath', 'a, the opener, is gone, and B is still open: focus goes into B');
  assert.ok(B.contains(doc.activeElement), 'contained by the dialog that is still open');
  B.remove();
  assert.equal(rb(), 'restored', 'B then returns to where it came from, not to something removed');
  assert.equal(doc.activeElement, opener);
});

test('three dialogs, the lowest released first: the top one is repaired too, not only the one directly above', () => {
  const { doc, opener, after, dialog: A, a } = page();
  const mk = (id) => doc.make('div', { id }, doc.make('button', { id: id + '1' }));
  const B = mk('B'), C = mk('C');
  doc.body.add(B, C);
  opener.focus(); const ra = show(A);                   // A came from `opener`
  after.focus(); const rb = show(B);                    // B came from `after`, outside A
  a.focus(); const rc = show(C);                        // C came from `a`, inside A
  A.remove(); assert.equal(ra(), 'not-top');            // C's opener is gone with A, so it takes A's
  B.remove(); assert.equal(rb(), 'not-top');            // and must not then be handed B's instead
  assert.equal(rc(), 'restored', 'nothing is left beneath, so C goes to where A came from');
  assert.equal(doc.activeElement, opener, 'A\'s opener, not B\'s');
});

test('with a dialog still open beneath, an opener outside every dialog is not used', () => {
  const { doc, opener, after, dialog: A, a } = page();
  const B = doc.make('div', { id: 'B' }, doc.make('button', { id: 'b1' }));
  doc.body.add(B);
  opener.focus(); const ra = show(A);
  after.focus(); const rb = show(B);                   // B opened from a control outside A
  B.remove();
  assert.equal(rb(), 'beneath');
  assert.ok(A.contains(doc.activeElement), 'A is still open and keeps focus');
  assert.equal(doc.activeElement, a);
  ra();
});

const permutations = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));

test('four dialogs released in all 24 orders never strand focus or leak a registration', () => {
  const orders = permutations([0, 1, 2, 3]);
  assert.equal(orders.length, 24);
  for (const order of orders) {
    const { doc, opener } = page();
    const nodes = [0, 1, 2, 3].map((i) => doc.make('div', { id: 'd' + i }, doc.make('button', { id: 'x' + i }), doc.make('button', { id: 'y' + i })));
    doc.body.add(...nodes);
    opener.focus();
    const releases = nodes.map((n) => show(n, {}));
    for (const i of order) { nodes[i].remove(); releases[i](); }
    assert.equal(depth(), 0, `order ${order}`);
    assert.equal(doc.listenerCount, 0, `order ${order}`);
    assert.ok(doc.activeElement === opener || doc.activeElement === doc.body, `order ${order}: focus is on the opener or on the page, not on a removed control (${doc.activeElement.id})`);
  }
});

test('positive tabindex inside a dialog is not honoured: Tab is moved in document order and never leaves', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const mk = (id, ti) => doc.make('button', { id, attrs: ti ? { tabindex: ti } : {} });
  const [a, p3, p1, p2, z] = [mk('a'), mk('p3', 3), mk('p1', 1), mk('p2', 2), mk('z')];
  dialog.add(a, p3, p1, p2, z);
  doc.body.add(mk('outside-pos', 2));
  opener.focus(); show(dialog);
  assert.equal(doc.activeElement, a);
  assert.deepEqual(pressAll(doc, 6), ['p3', 'p1', 'p2', 'z', 'a', 'p3'], 'document order, wrapping');
  assert.deepEqual(pressAll(doc, 3, { shiftKey: true }), ['a', 'z', 'p2'], 'and back');
  for (let i = 0; i < 20; i++) { doc.press('Tab'); assert.ok(dialog.contains(doc.activeElement)); }
});

test('Shift+Tab from the positive-tabindex control that a browser would visit first stays inside', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const a = doc.make('button', { id: 'a' }), b = doc.make('button', { id: 'b' }), c = doc.make('button', { id: 'c', attrs: { tabindex: '1' } });
  dialog.add(a, b, c);
  opener.focus(); show(dialog); c.focus();
  doc.press('Tab', { shiftKey: true });
  assert.ok(dialog.contains(doc.activeElement), `got ${doc.activeElement.id}`);
  assert.equal(doc.activeElement, b);
});

test('a positive tabindex that appears while the dialog is open takes effect on the next Tab', () => {
  const p = page();
  const { doc, opener, dialog, a, b, c } = p;
  opener.focus(); show(dialog);
  assert.equal(doc.press('Tab').defaultPrevented, false, 'ordinary markup: the browser moves it');
  a.focus(); c.setAttribute('tabindex', '1');
  const e = doc.press('Tab');
  assert.equal(e.defaultPrevented, true, 'now the helper moves it');
  assert.equal(doc.activeElement, b);
});

test('without a positive tabindex the interior Tab is left to the browser', () => {
  const p = page();
  p.opener.focus(); show(p.dialog);
  assert.equal(p.doc.press('Tab').defaultPrevented, false);
});

test('coverage: Escape while composing text, sent before any other Escape, neither closes nor is swallowed', () => {
  const { doc, opener, dialog } = page();
  let closes = 0;
  opener.focus(); show(dialog, { onClose: () => { closes++; } });
  const composing = doc.press('Escape', { isComposing: true });
  assert.equal(closes, 0);
  assert.equal(composing.defaultPrevented, false, 'the IME gets its Escape');
  assert.equal(composing.stopped, false);
  doc.press('Escape');
  assert.equal(closes, 1, 'and the dialog still closes on the next ordinary Escape');
});

test('coverage: the candidate list is read on every Tab, so changes made while open count', () => {
  const p = page({ dialogKids: [] });
  const { doc, opener, dialog } = p;
  const mk = (id, extra) => doc.make('button', { id, ...extra });
  const [a, b, c] = [mk('a'), mk('b'), mk('c')];
  dialog.add(a, b, c);
  opener.focus(); show(dialog);
  c.remove(); b.focus();                                // the former last control is gone
  assert.equal(doc.press('Tab').defaultPrevented, true, 'b is now last');
  assert.equal(doc.activeElement, a);
  const d = mk('d'); dialog.add(d); b.focus();           // a new last control appears
  assert.equal(doc.press('Tab').defaultPrevented, false, 'b is no longer last');
  assert.equal(doc.activeElement, d);
  d.disabled = true; b.focus();                          // the last control becomes disabled
  assert.equal(doc.press('Tab').defaultPrevented, true);
  assert.equal(doc.activeElement, a);
  d.disabled = false; d.hiddenSelf = true; b.focus();    // or hidden
  assert.equal(doc.press('Tab').defaultPrevented, true);
  const wrap = doc.make('div', { id: 'wrap', attrs: { inert: '' } }, mk('w')); dialog.add(wrap); b.focus();
  d.hiddenSelf = false;                                  // or sits under an inert wrapper
  d.parent.children.splice(d.parent.children.indexOf(d), 1); wrap.add(d); d.parent = wrap; b.focus();
  assert.equal(doc.press('Tab').defaultPrevented, true);
  assert.equal(doc.activeElement, a);
});


/* ---- Review round 2 (re-review of revision 2) ---------------------------------------
   Written against revision 2 of the helper and run there first; the failures are in the
   review bundle. The cleanup control at the end is about the test harness, not the helper. */

const openOnce = (doc, node, options) => { let done = false; return () => { if (!done) { done = true; show(node, options); } }; };
const newDialog = (doc, id, count = 2) => { const node = doc.make('div', { id }, ...Array.from({ length: count }, (_, i) => doc.make('button', { id: id.toLowerCase() + (i + 1) }))); doc.body.add(node); return node; };

test('restoring to the opener yields if focusing it opens a newer dialog', () => {
  const { doc, opener, dialog: A, a } = page();
  const B = newDialog(doc, 'B'), C = newDialog(doc, 'C');
  const closed = [];
  opener.focus(); show(A, { onClose: () => closed.push('A') });
  a.focus(); const rb = show(B);                          // B's opener is a, inside A
  a.onFocus = () => { a.onFocus = null; show(C, { onClose: () => closed.push('C') }); };
  B.remove();
  assert.equal(rb(), 'kept', 'a newer dialog now owns focus, so nothing was restored');
  assert.equal(doc.activeElement.id, 'c1');
  doc.press('Escape');
  assert.deepEqual(closed, ['C'], 'and Escape reaches the newer dialog');
});

test('restoring into the dialog beneath yields if focusing its first control opens a newer dialog', () => {
  const { doc, opener, after, dialog: A } = page();
  const B = newDialog(doc, 'B'), C = newDialog(doc, 'C');
  opener.focus(); show(A);
  after.focus(); const rb = show(B);                      // B came from outside A, so focus goes into A
  const { a } = { a: A.children[0] };
  a.onFocus = () => { a.onFocus = null; show(C); };
  B.remove();
  assert.equal(rb(), 'kept');
  assert.equal(doc.activeElement.id, 'c1');
  assert.equal(doc.focusLog.filter((id) => id === 'b').length, 0, 'it did not go on to try A\'s other controls');
});

test('restoring onto the container of the dialog beneath yields if that opens a newer dialog', () => {
  const { doc, opener, after, dialog: A } = page({ dialogKids: [] });
  const B = newDialog(doc, 'B'), C = newDialog(doc, 'C');
  opener.focus(); show(A);                                // nothing to tab to: the container holds focus
  after.focus(); const rb = show(B);
  A.onFocus = () => { A.onFocus = null; show(C); };
  B.remove();
  assert.equal(rb(), 'kept', 'not "none": focus is in the newer dialog');
  assert.equal(doc.activeElement.id, 'c1');
});

test('restoring to an outside opener yields if that opens a newer dialog, and the fallback is not then used', () => {
  const { doc, opener, after, dialog: A } = page();
  const C = newDialog(doc, 'C');
  opener.focus(); const release = show(A, { fallback: after });
  opener.onFocus = () => { opener.onFocus = null; show(C); };
  A.remove();
  assert.equal(release(), 'kept');
  assert.equal(doc.activeElement.id, 'c1');
  assert.equal(doc.focusLog.includes('after'), false, 'the fallback never took focus from the newer dialog');
});

test('a fallback that opens a newer dialog ends the restoration, and the fallback is only asked for when the opener cannot be used', () => {
  let p = page(); p.opener.focus();
  const C = newDialog(p.doc, 'C');
  let release = show(p.dialog, { fallback: () => { show(C); return p.after; } });
  p.opener.remove(); p.dialog.remove();
  assert.equal(release(), 'kept');
  assert.equal(p.doc.activeElement.id, 'c1');
  assert.equal(p.doc.focusLog.includes('after'), false);
  handles.splice(0).forEach((r) => r());
  p = page(); p.opener.focus();
  let asked = 0;
  release = show(p.dialog, { fallback: () => { asked++; return p.after; } });
  assert.equal(release(), 'restored');
  assert.equal(asked, 0, 'the opener worked, so the fallback was never needed');
});

test('without checkVisibility, a visibility-hidden control is not a Tab boundary, last or first', () => {
  for (const [label, order] of [['last', ['real', 'ghost']], ['first', ['ghost', 'real']]]) {
    const doc = new Doc({ checkVisibility: false });
    const opener = doc.make('button', { id: 'opener' }), after = doc.make('button', { id: 'after' });
    const kids = { real: doc.make('button', { id: 'real' }), ghost: doc.make('button', { id: 'ghost', visHidden: true }) };
    const dialog = doc.make('div', { id: 'dlg' }, ...order.map((k) => kids[k]));
    doc.body.add(opener, dialog, after);
    opener.focus(); show(dialog);
    assert.equal(doc.activeElement, kids.real, label);
    assert.equal(doc.press('Tab').defaultPrevented, true, `${label}: the only real stop wraps onto itself`);
    assert.equal(doc.press('Tab', { shiftKey: true }).defaultPrevented, true, `${label}: and so backwards`);
    assert.equal(doc.activeElement, kids.real, label);
    assert.notEqual(doc.activeElement, after, label);
    handles.splice(0).forEach((r) => r());
  }
});

test('if opening throws after a nested dialog opened properly, that dialog survives and its opener is repaired', () => {
  const { doc, opener, dialog: A, a } = page();
  const C = newDialog(doc, 'C');
  const closed = [];
  opener.focus();
  assert.throws(() => show(A, { initialFocus: () => { a.focus(); show(C, { onClose: () => closed.push('C') }); throw new Error('boom'); } }), /boom/);
  assert.equal(depth(), 1, 'only the failed opening is gone');
  assert.equal(doc.activeElement.id, 'c1');
  doc.press('Escape');
  assert.deepEqual(closed, ['C'], 'the child still answers Escape');
  doc.press('Tab'); doc.press('Tab'); doc.press('Tab');
  assert.ok(C.contains(doc.activeElement), 'and still holds Tab');
  A.remove();
  assert.equal(handles[0](), 'restored', 'its opener was inside the dialog that failed, so it returns to where that one came from');
  assert.equal(doc.activeElement, opener);
});

test('an explicit tabindex makes a second summary a stop; a bare second summary still is not', () => {
  let p = page({ dialogKids: [] });
  const head = p.doc.make('button', { id: 'head' }), s1 = p.doc.make('summary', { id: 's1' });
  const s2 = p.doc.make('summary', { id: 's2', attrs: { tabindex: '0' } });
  p.dialog.add(head, p.doc.make('details', { id: 'details', attrs: { open: '' } }, s1, s2));
  p.opener.focus(); show(p.dialog); s1.focus();
  assert.equal(p.doc.press('Tab').defaultPrevented, false, 's1 is no longer the last stop');
  assert.equal(p.doc.activeElement, s2, 'the explicitly indexed summary is reachable');
  assert.equal(p.doc.press('Tab').defaultPrevented, true);
  assert.equal(p.doc.activeElement, head);
  handles.splice(0).forEach((r) => r());
  p = page({ dialogKids: [] });
  const t1 = p.doc.make('summary', { id: 't1' }), t2 = p.doc.make('summary', { id: 't2', attrs: { tabindex: '-1' } });
  p.dialog.add(p.doc.make('details', { id: 'details', attrs: { open: '' } }, t1, t2));
  p.opener.focus(); show(p.dialog, { initialFocus: t2 });
  assert.equal(p.doc.activeElement, t2, 'a tabindex of -1 still allows focusing it by choice');
  p.doc.press('Tab'); assert.equal(p.doc.activeElement, t1, 'but it is not a Tab stop');
});

test('when the engine can say a control is not visible, its answer is used', () => {
  const doc = new Doc();
  const opener = doc.make('button', { id: 'opener' }), ghost = doc.make('button', { id: 'ghost', engineHidden: true }), real = doc.make('button', { id: 'real' });
  const dialog = doc.make('div', { id: 'dlg' }, ghost, real); doc.body.add(opener, dialog);
  opener.focus(); show(dialog);
  assert.equal(doc.activeElement, real);
  assert.equal(doc.focusLog.includes('ghost'), false, 'not even tried: boxes and computed style call it visible, checkVisibility does not');
  assert.equal(doc.press('Tab', { shiftKey: true }).defaultPrevented, true, 'and it is not a boundary either');
});

describe('cleanup control', () => {
  // A registration that exists before a test starts is not that test's leak. The cleanup check once
  // compared an already relative figure to the starting count again, and failed an empty test here.
  let early;
  beforeAll(() => { const p = page(); early = openDialogFocus(p.dialog, {}); });
  afterAll(() => { early(); });
  test('a registration from before the test is not blamed on it', () => {
    assert.equal(dialogDepth() - baseline, 0);
  });
});


/* ---- Skipped content: content-visibility:hidden and closed <details> ----------------------
   Chromium 141 gives such content boxes while refusing it focus (see the browser probe in the review
   bundle), so a candidate list built from boxes alone can end in a control Tab never reaches, and Tab
   from the last real control then leaves the dialog. checkVisibility sees it; without that method the
   helper has to look at the ancestors itself. */

const skipped = (opts) => {
  const doc = new Doc(opts);
  const opener = doc.make('button', { id: 'opener' }), after = doc.make('button', { id: 'after' }), real = doc.make('button', { id: 'real' });
  return { doc, opener, after, real };
};
const withoutMethod = { checkVisibility: false, skippedHasBoxes: true };

test('without checkVisibility, content under content-visibility:hidden is not a candidate, last or first', () => {
  for (const place of ['last', 'first']) {
    const { doc, opener, after, real } = skipped(withoutMethod);
    const hiddenBox = doc.make('div', { id: 'cvbox', contentHidden: true }, doc.make('button', { id: 'cv' }));
    const dialog = doc.make('div', { id: 'dlg' }, ...(place === 'last' ? [real, hiddenBox] : [hiddenBox, real]));
    doc.body.add(opener, dialog, after);
    opener.focus(); show(dialog);
    assert.equal(doc.activeElement, real, place);
    assert.equal(doc.press('Tab').defaultPrevented, true, `${place}: Tab from the only real stop wraps, it does not leave`);
    assert.equal(doc.press('Tab', { shiftKey: true }).defaultPrevented, true, `${place}: and backwards`);
    assert.equal(doc.focusLog.includes('cv'), false, `${place}: never even tried`);
    assert.notEqual(doc.activeElement, after, place);
    handles.splice(0).forEach((r) => r());
  }
});

test('without checkVisibility, content in a closed details is not a candidate, and the first summary still is', () => {
  const { doc, opener, after, real } = skipped(withoutMethod);
  const s1 = doc.make('summary', { id: 's1' }), s2 = doc.make('summary', { id: 's2' }), inner = doc.make('button', { id: 'inner' });
  const dialog = doc.make('div', { id: 'dlg' }, doc.make('details', { id: 'd1' }, s1, s2, inner), real);
  doc.body.add(opener, dialog, after);
  opener.focus(); show(dialog);
  assert.equal(doc.activeElement, s1, 'the summary of a closed details is a stop');
  assert.deepEqual(pressAll(doc, 3), ['real', 's1', 'real'], 'wrapping between the summary and the control after it, never through the hidden content');
  assert.equal(doc.focusLog.includes('inner'), false);
});

test('without checkVisibility, a closed details as the last thing in the dialog does not let Tab out', () => {
  const { doc, opener, after, real } = skipped(withoutMethod);
  const dialog = doc.make('div', { id: 'dlg' }, real, doc.make('details', { id: 'd1' }, doc.make('summary', { id: 's1' }), doc.make('button', { id: 'inner' })));
  doc.body.add(opener, dialog, after);
  opener.focus(); show(dialog); real.focus();
  assert.equal(doc.press('Tab').defaultPrevented, false, 'real is not last: the summary follows');
  assert.equal(doc.activeElement.id, 's1');
  assert.equal(doc.press('Tab').defaultPrevented, true, 'the summary is last: its content is skipped, so Tab wraps');
  assert.equal(doc.activeElement, real);
  assert.notEqual(doc.activeElement, after);
});

test('without checkVisibility, opening a details while the dialog is open makes its content reachable', () => {
  const { doc, opener, after, real } = skipped(withoutMethod);
  const inner = doc.make('button', { id: 'inner' });
  const details = doc.make('details', { id: 'd1' }, doc.make('summary', { id: 's1' }), inner);
  const dialog = doc.make('div', { id: 'dlg' }, real, details);
  doc.body.add(opener, dialog, after);
  opener.focus(); show(dialog); real.focus();
  details.setAttribute('open', '');
  assert.deepEqual(pressAll(doc, 3), ['s1', 'inner', 'real'], 'open: the summary, then the content, then wrapping from the content as the last stop');
});

test('with neither checkVisibility nor computed style, closed details content is still skipped (it needs only the DOM), content-visibility is the stated limit', () => {
  const { doc, opener, after, real } = skipped({ checkVisibility: false, computedStyle: false, skippedHasBoxes: true });
  const dialog = doc.make('div', { id: 'dlg' }, real, doc.make('details', { id: 'd1' }, doc.make('summary', { id: 's1' }), doc.make('button', { id: 'inner' })));
  doc.body.add(opener, dialog, after);
  opener.focus(); show(dialog); real.focus(); doc.press('Tab');
  assert.equal(doc.activeElement.id, 's1');
  assert.equal(doc.press('Tab').defaultPrevented, true, 'closed details content is excluded without any style API');
  handles.splice(0).forEach((r) => r());
  const b = skipped({ checkVisibility: false, computedStyle: false, skippedHasBoxes: true });
  const hiddenBox = b.doc.make('div', { id: 'cvbox', contentHidden: true }, b.doc.make('button', { id: 'cv' }));
  const d2 = b.doc.make('div', { id: 'dlg' }, b.real, hiddenBox);
  b.doc.body.add(b.opener, d2, b.after);
  b.opener.focus(); show(d2);
  assert.equal(b.doc.activeElement, b.real);
  assert.equal(b.doc.press('Tab').defaultPrevented, false, 'the hidden control still counts as a later stop, so the browser is left to move Tab');
  assert.equal(b.doc.activeElement, b.after, 'and it leaves the dialog: the stated limit with no computed style, not a guarantee');
});

test('with checkVisibility available, skipped content is excluded whether or not it has boxes', () => {
  for (const skippedHasBoxes of [true, false]) {
    const { doc, opener, after, real } = skipped({ skippedHasBoxes });
    const hiddenBox = doc.make('div', { id: 'cvbox', contentHidden: true }, doc.make('button', { id: 'cv' }));
    const details = doc.make('details', { id: 'd1' }, doc.make('summary', { id: 's1' }), doc.make('button', { id: 'inner' }));
    const dialog = doc.make('div', { id: 'dlg' }, real, hiddenBox, details);
    doc.body.add(opener, dialog, after);
    opener.focus(); show(dialog);
    assert.equal(doc.activeElement, real);
    doc.press('Tab'); assert.equal(doc.activeElement.id, 's1');
    assert.equal(doc.press('Tab').defaultPrevented, true, `skippedHasBoxes ${skippedHasBoxes}`);
    handles.splice(0).forEach((r) => r());
  }
});
