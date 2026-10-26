/* The centred "Save not completed" message is a way of speaking, never a way of acting.
 *
 * What this protects. The notice on the page keeps every refused save and is the record. The centred message (approved as A1R1b, body
 * "Your attempted changes are kept here for review. Some updates may already have been saved.") only tells the person, once. Rules:
 *   - closing it (Keep working, Escape) retries nothing, discards nothing, loads nothing and changes no kept attempt;
 *   - one message per refused save the person has not been told about; one that arrives while it is open is counted into it, and a
 *     dismissed one never comes back when the screen re-renders;
 *   - it waits while somebody is typing or has just typed, or another dialog is open, so it never takes the focus from newer work;
 *   - it shows only this person's, this store's, this sign-in's records, and goes when they go;
 *   - it is a real dialog: labelled, modal, the app behind it inert, Tab kept inside, Escape closes, focus goes back to where it was,
 *     and Review attempted changes opens the kept attempt's own list of changes (a click on its notice, no write) and focuses its button.
 *
 * How it tests. The real source is cut out of src/LeadPerformanceCalculator.jsx by anchor (each must occur exactly once) and the pure parts
 * (warnNext, warnHeld) are run against stubs. The component and the wiring are checked as source text. Mutation controls rebuild a bad
 * variant from the real text by one replacement and the same check fails.
 * Limits. Not mounted here; the mounted cases (real failures, queue, store and sign-in switch, keyboard, small and wide) run separately in
 * a browser against a local mock. Nothing here was tried on a phone. Dependency-free: node:test only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const once = (a, what) => { assert.equal(app.split(a).length - 1, 1, what + " anchor must occur exactly once"); return app.indexOf(a); };
const cut = (start, end, what) => { const a = once(start, what); const b = app.indexOf(end, a); assert.ok(b > a, what + " end"); return app.slice(a, b + end.length); };
const WARN = cut("const warnNext = (visible, seen, shown, held, other) => {", "\n};\nconst WARN_OTHER", "warnNext").replace(/\nconst WARN_OTHER$/, "");
const HELD = cut("const WARN_OTHER = ", "\n};\n// The app behind the message", "warnHeld").replace(/\n\/\/ The app behind the message$/, "");
const INERT = cut("let warnInertHolds = 0, warnInertPrior = false;", "\nfunction FailedSaveWarning", "inert hold").replace(/\nfunction FailedSaveWarning$/, "");
const inertApi = () => run(INERT, {}, "{ hold: warnInertHold, release: warnInertRelease, busy: warnRootBusy }");
const COMPONENT = cut("function FailedSaveWarning({ items, onClose, owner, ownerRef }) {", "\n}\n", "FailedSaveWarning");
const WIRING = cut("  const warnSeen = useRef(new Set());", "setReviewReq({ id: ids[0], n: ++reviewN.current });\n  };\n", "wiring");
const ITEM_EFFECT = cut("  const noticeRef = useRef(null), reviewRef = useRef(null);", "  }, [reviewReq]); // eslint-disable-line\n", "FailedSaveItem review request");
const run = (code, ctx, ret) => new Function("ctx", `with (ctx) { ${code}\n return ${ret}; }`)(ctx);
const nextOf = (code = WARN) => run(code, {}, "warnNext");
const rec = (id) => ({ id });

/* ---- once per unseen refused save, coalesced, never again after it was seen ---- */
test("an unseen refused save opens one message, and marks itself told", () => {
  const p = nextOf()([rec(1)], new Set(), [], false);
  assert.deepEqual(p, { shown: [1], mark: [1] });
});
test("several arriving together are one message that counts them", () => {
  const p = nextOf()([rec(1), rec(2), rec(3)], new Set(), [], false);
  assert.deepEqual(p, { shown: [1, 2, 3], mark: [1, 2, 3] });
});
test("a failure that arrives while the message is open is counted into it and never opens a second", () => {
  const p = nextOf()([rec(1), rec(2)], new Set([1]), [1], false);
  assert.deepEqual(p, { shown: [1, 2], mark: [2] });
  assert.equal(nextOf()([rec(1), rec(2)], new Set([1]), [1], true).shown.length, 2, "even while the screen is busy: it is already open");
});
test("after Keep working the same records do not come back on a re-render", () => {
  assert.deepEqual(nextOf()([rec(1), rec(2)], new Set([1, 2]), [], false), { shown: [], mark: [] });
});
test("a failure after a dismissal is a new, unseen one and gets its own single message", () => {
  assert.deepEqual(nextOf()([rec(1), rec(2)], new Set([1]), [], false), { shown: [2], mark: [2] });
});
test("while the screen is busy nothing opens and nothing is marked told, so it comes later", () => {
  assert.deepEqual(nextOf()([rec(1)], new Set(), [], true), { shown: [], mark: [] });
  assert.deepEqual(nextOf()([rec(1)], new Set(), [], false), { shown: [1], mark: [1] });
});
test("a message goes with its records: another store, another person or another sign-in shows none of them", () => {
  assert.deepEqual(nextOf()([], new Set([1]), [1], false), { shown: [], mark: [] });
  assert.deepEqual(nextOf()([rec(9)], new Set([1]), [1], false), { shown: [9], mark: [9] }, "an old id that is no longer visible is dropped; only visible ones count");
});

/* ---- when it waits ---- */
const heldFn = (ctx = {}) => run(HELD, { warnRootBusy: () => false, ...ctx }, "warnHeld");
const otherFn = () => run(HELD, { warnRootBusy: () => false }, "warnOther");
// A stand-in dialog element: open and visible unless told otherwise; closest() answers the way the real one would for the two kinds of hiding.
const dlg = (o = {}) => ({ closest: (sel) => ((o.hiddenByOther && sel.includes("aria-hidden")) || (o.inertByUs && sel.includes("[inert]:not(#root)") === false) ? {} : null), getClientRects: () => (o.noBox ? [] : [1]) });
const docWith = (active, other) => ({ activeElement: active, querySelectorAll: (sel) => (other && sel.includes("[role=\"dialog\"]") ? [other] : []) });
test("typing in a field holds it, and so does having just typed, and so does another dialog", () => {
  const h = heldFn();
  assert.equal(h(docWith({ tagName: "INPUT", type: "text" }, null), 0, 100000), true);
  assert.equal(h(docWith({ tagName: "TEXTAREA" }, null), 0, 100000), true);
  assert.equal(h(docWith({ tagName: "DIV", isContentEditable: true }, null), 0, 100000), true);
  assert.equal(h(docWith({ tagName: "BUTTON" }, null), 99000, 100000), true, "typed a second ago");
  assert.equal(h(docWith({ tagName: "BUTTON" }, dlg()), 0, 100000), true, "another dialog is open");
  assert.equal(h(docWith({ tagName: "BUTTON" }, dlg({ hiddenByOther: true })), 0, 100000), false, "a closed dialog the app keeps in the page (aria-hidden, inert) is not open");
  assert.equal(h(docWith({ tagName: "BUTTON" }, dlg({ noBox: true })), 0, 100000), false, "one with no box on screen is not open");
});
test("a button, a checkbox, nothing focused, and a quiet screen do not hold it", () => {
  const h = heldFn();
  assert.equal(h(docWith({ tagName: "BUTTON" }, null), 0, 100000), false);
  assert.equal(h(docWith({ tagName: "INPUT", type: "checkbox" }, null), 0, 100000), false);
  assert.equal(h(docWith(null, null), 0, 100000), false);
  assert.equal(h(docWith({ tagName: "BODY" }, null), 96000, 100000), false, "the last key was four seconds ago");
});
test("the other-dialog test sees every dialog the app has, and never counts this message itself", () => {
  const sel = app.slice(once("const WARN_OTHER = '", "other"), app.indexOf("';", once("const WARN_OTHER = '", "other")) + 2);
  for (const part of ['[role="dialog"]:not([data-fs-warn])', '[aria-modal="true"]:not([data-fs-warn])', ".mc-ov:not(.fsw-ov)", ".ru-scrim"]) assert.ok(sel.includes(part), "selector covers " + part);
});

/* ---- the message itself ---- */
test("the approved words, title and the two actions, and no other action", () => {
  assert.ok(COMPONENT.includes(">Save not completed</h2>"));
  assert.ok(COMPONENT.includes("Your attempted changes are kept here for review. Some updates may already have been saved."));
  assert.ok(COMPONENT.includes(">Keep working</button>") && COMPONENT.includes(">Review attempted changes</button>"));
  assert.ok(COMPONENT.includes('"1 attempt is kept in this tab."') && COMPONENT.includes('" attempts are kept in this tab."'));
  assert.equal((COMPONENT.match(/<button /g) || []).length, 2);
});
test("it is a modal dialog: labelled and described, focus to the heading, the app inert, Tab kept inside, Escape closes", () => {
  for (const s of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby="fsw-t"', 'aria-describedby="fsw-d"', "tabIndex={-1}", 'warnInertHold(root)', 'warnInertRelease(root)', "headRef.current.focus()", 'e.key === "Escape"', 'e.key !== "Tab"', "e.shiftKey"]) assert.ok(COMPONENT.includes(s), "has " + s);
});
test("the dim ground never closes or discards it: no click handler on the ground, and the ground does not take the focus", () => {
  assert.equal(/onClick=\{[^}]*currentTarget/.test(COMPONENT), false);
  assert.ok(COMPONENT.includes("onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}"));
});
test("closing returns the focus only to an element still on this screen and usable, else to the notice or page that is there now", () => {
  assert.ok(COMPONENT.includes("openerRef.current = a && a !== document.body ? a : null;"));
  for (const s of ["o.isConnected", "!o.disabled", '!o.closest("[inert]")', "o.getClientRects().length > 0", 'document.querySelector("[data-fs-notice]") || document.querySelector(".page")', 'howRef.current !== "review"']) assert.ok(COMPONENT.includes(s), "has " + s);
  assert.ok(app.includes("data-fs-review={rec.id}") && app.includes("data-fs-notice={rec.id}"), "the notice carries the targets");
});
test("Review attempted changes opens that attempt's own list of changes, and the notice acts once", () => {
  assert.ok(ITEM_EFFECT.includes("reviewReq.id !== rec.id") && ITEM_EFFECT.includes("setOpen(true)") && ITEM_EFFECT.includes("reviewRef.current || noticeRef.current"));
  assert.equal(/persistStore|onLoad|onDiscard|onReturn/.test(ITEM_EFFECT), false, "opening the list is not an action on the attempt");
  assert.ok(WIRING.includes("useEffect(() => { if (reviewReq) setReviewReq(null); }, [reviewReq]);"), "cleared after one render, so a notice that mounts later never reopens or takes the focus");
  assert.ok(WIRING.includes('if (how === "review" && ids.length) setReviewReq({ id: ids[0], n: ++reviewN.current });'));
  assert.ok(app.includes("<FailedSaveNotice items={visibleFailed} reviewReq={reviewReq}"));
});
test("it never saves, retries, discards or loads, and touches no kept attempt", () => {
  const code = COMPONENT + WIRING + WARN + HELD;
  for (const bad of ["persistStore", "saveStoreCAS", "loadLatestSaved", "discardFailed", "dropFailed", "patchFailed", "setFailedSaves", "returnToEditor", "rec.attempted", "rec.baseline", "absenceProof", "fetch(", "setTimeout(() => { const el"]) assert.equal(code.includes(bad), false, "must not contain " + bad);
});
test("closing only marks what the message covered as told, empties it, and (for Review) asks the notice to open", () => {
  const close = WIRING.slice(WIRING.indexOf("  const closeWarn"));
  assert.equal(close.trim(), 'const closeWarn = (how) => {\n    const ids = warnShownRef.current;\n    ids.forEach((id) => warnSeen.current.add(id)); warnShownRef.current = []; setWarnShown([]);\n    if (how === "review" && ids.length) setReviewReq({ id: ids[0], n: ++reviewN.current });\n  };');
});
test("what the message covers is kept current where it is decided, so a close in the same moment as an arrival works from the newest answer", () => {
  assert.ok(WIRING.includes("warnShownRef.current = plan.shown;"));
  assert.equal(WIRING.includes("warnShownRef.current = warnShown;"), false, "not overwritten by an older render");
});
test("a refresh of the notice (the same record, a new object) is not a new failure", () => {
  const p = nextOf()([{ id: 4, refresh: { state: "loaded" }, busy: false }], new Set([4]), [], false);
  assert.deepEqual(p, { shown: [], mark: [] });
  assert.deepEqual(nextOf()([{ id: 4, refresh: null }, { id: 5 }], new Set([4]), [], false), { shown: [5], mark: [5] }, "only the genuinely new record speaks");
});

/* ---- the wiring ---- */
test("only this person's, this store's, this sign-in's records feed both the notice and the message", () => {
  assert.ok(WIRING.includes("const visibleFailed = failedSaves.filter((f) => f.storeId === view && f.actor === (session && session.id) && f.epoch === authEpoch);"));
  assert.ok(app.includes("<FailedSaveNotice items={visibleFailed}"), "the on-page notice, with every record, is still rendered from the same list");
  assert.ok(app.includes("{visibleFailed.some((f) => warnShown.includes(f.id)) && <FailedSaveWarning items={visibleFailed.filter((f) => warnShown.includes(f.id))} onClose={closeWarn} owner={warnOwner} ownerRef={warnOwnerRef} />}"));
});
test("a change of sign-in forgets what was told and closes the message, in the same breath as the list is cleared", () => {
  assert.ok(WIRING.includes("useEffect(() => { warnSeen.current = new Set(); warnShownRef.current = []; setWarnShown([]); setReviewReq(null); }, [session && session.id]);"));
});
test("it re-checks while something waits and stops when nothing does", () => {
  assert.ok(WIRING.includes("visibleFailed.some((f) => !warnSeen.current.has(f.id))"));
  assert.ok(WIRING.includes("setTimeout(() => setWarnTick((n) => n + 1), 700)") && WIRING.includes("clearTimeout(t)"));
});
test("styling: reduced motion, safe areas through the shell's own variables, above the round-up, no raw top inset", () => {
  assert.ok(app.includes("@media (prefers-reduced-motion: reduce) { .fsw-ov, .fsw-sheet { animation-duration:.01ms; } }"));
  assert.ok(app.includes("padding:calc(var(--sat, 0px) + 16px) 14px calc(var(--sab, 0px) + 16px);"));
  assert.ok(/\.fsw-ov \{[^}]*z-index:500/.test(app));
  assert.ok(/\.fsw-ov \{[^}]*box-sizing:border-box/.test(app) && /\.fsw-sheet \{ box-sizing:border-box/.test(app), "border-box on both, as in the approved prototype: the page has no global box-sizing, and content-box makes the overlay 28px and the card 40px wider than designed");
  assert.ok(/\.fsw-ov \{[^}]*width:100vw/.test(app), "the full width of the screen, so the card is centred on it and not on what is left of a desktop scrollbar gutter");
});

/* ---- a later dialog wins, and the message gives back only what it took ---- */
test("a dialog that opens after the message stops it: all its records count as told, nothing comes back by itself", () => {
  const p = nextOf()([rec(1), rec(2)], new Set([1]), [1], true, true);
  assert.deepEqual(p, { shown: [], mark: [1, 2] });
  assert.deepEqual(nextOf()([rec(1), rec(2)], new Set([1, 2]), [], false, false), { shown: [], mark: [] }, "and on the next check nothing reopens");
  assert.deepEqual(nextOf()([rec(1)], new Set(), [], true, true), { shown: [], mark: [] }, "a message that never opened because something was already open still waits");
});
test("warnOther sees an open dialog and never this message", () => {
  const sel = [];
  const other = run(HELD, { warnRootBusy: () => false }, "warnOther");
  assert.equal(other({ querySelectorAll: (s) => { sel.push(s); return [dlg()]; } }), true);
  assert.equal(other({ querySelectorAll: () => [] }), false);
  assert.equal(other({ querySelectorAll: () => [dlg({ hiddenByOther: true })] }), false);
  const seen = (vis) => ({ ...dlg(), ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: vis }) } } });
  assert.equal(other({ querySelectorAll: () => [seen("visible")] }), true, "a visible dialog counts");
  assert.equal(other({ querySelectorAll: () => [seen("hidden")] }), false, "visibility:hidden is not open");
  assert.ok(sel[0].includes(":not([data-fs-warn])"));
  assert.ok(HELD.includes("'[inert]:not(#root), [aria-hidden=\"true\"]'"), "inert by this message (the app root) does not hide a later dialog; inert or aria-hidden by anything else does");
});
const rootStub = (inert) => ({ inert, hasAttribute() { return this.inert; }, setAttribute() { this.inert = true; }, removeAttribute() { this.inert = false; } });
test("the app is made inert while the message is open and is given back as it was", () => {
  const { hold, release } = inertApi();
  const root = rootStub(false); hold(root); assert.equal(root.inert, true); release(root); assert.equal(root.inert, false);
});
test("an app that was already inert when the message opened is still inert when it closes", () => {
  const { hold, release } = inertApi();
  const root = rootStub(true); hold(root); release(root); assert.equal(root.inert, true);
});
test("a second hold does not release the first, and a stray release does nothing", () => {
  const { hold, release } = inertApi();
  const root = rootStub(false); hold(root); hold(root); release(root); assert.equal(root.inert, true); release(root); assert.equal(root.inert, false); release(root); assert.equal(root.inert, false);
});
test("focus is given back only to the owner it was captured for: person, store and sign-in", () => {
  assert.ok(COMPONENT.includes("ownerRef.current === ownedBy.current") && COMPONENT.includes("ownedBy = useRef(owner)"));
  assert.ok(WIRING.includes('const warnOwner = (session && session.id) + "|" + view + "|" + authEpoch;') && WIRING.includes("warnOwnerRef.current = warnOwner;"));
  assert.ok(COMPONENT.includes('!!o.closest("#root")'));
});
test("the browser's own pop-up for a refused save is gone, including for an attempt that was not kept (a stale sign-in shows nothing to the new one)", () => {
  assert.equal(app.split('alert("Save not completed.').length - 1, 0, "no Save not completed pop-up remains");
  const at = app.indexOf("if (!recordFailedSave(storeId, next, audit, baseline, reportedFields, epoch0, actor0)) console.info(");
  assert.ok(at > 0, "an attempt that was not kept is logged only");
  assert.equal(app.slice(at, at + 400).includes("alert("), false);
  for (const keep of ["This store's data didn't finish loading", "That change was NOT saved, on purpose.", "That change was blocked because it would have wiped"]) assert.ok(app.includes(keep), "the other guard alert stays: " + keep.slice(0, 30));
});
test("the keys yield at once to a later dialog, before the next check has stopped the message", () => {
  assert.ok(COMPONENT.includes("const onKey = (e) => {\n      if (warnOther(document)) return;"));
  assert.ok(COMPONENT.indexOf("if (warnOther(document)) return;") < COMPONENT.indexOf('e.key === "Escape"'), "before Escape and Tab are handled");
});
function PIECES_RECORD() { return cut("  const recordFailedSave = (storeId,", "\n  };\n  const patchFailed", "recordFailedSave"); }
test("recordFailedSave says whether it kept the attempt", () => {
  const ctx = { authEpoch: 3, failedSeq: { current: 0 }, tab: "t", appModule: "m", lastSaveError: "x", sessionIdRef: { current: "u1" }, globalThis, setFailedSaves: () => {}, setImportLog: () => {} };
  const fn = run(PIECES_RECORD().replace(/\n  const patchFailed$/, "") + "\n", ctx, "recordFailedSave");
  assert.equal(fn("s1", {}, { action: "a" }, null, [], 3, "u1"), true);
  assert.equal(fn("s1", {}, { action: "a" }, null, [], 3, "u2"), false, "another person is signed in now");
  assert.equal(fn("s1", {}, { action: "a" }, null, [], 4, "u1"), false, "the sign-in generation moved");
});

/* ---- the arrival owns the screen: wait, keep the warning pending, never take a second snapshot ---- */
const arrDoc = (flight, rootInert) => ({ documentElement: { classList: { contains: (c) => flight && c === "sage-flight-owned" } }, getElementById: () => ({ hasAttribute: () => rootInert }), querySelectorAll: () => [] });
test("while the sign-in arrival owns the screen, the app counts as owned by someone else", () => {
  const other = run(HELD, { warnRootBusy: () => false }, "warnOther");
  assert.equal(other(arrDoc(true, true)), true);
  assert.equal(other(arrDoc(false, false)), false);
});
test("the root being inert for any reason but this message holds the message back; its own hold does not", () => {
  const { hold, release, busy } = inertApi();
  const root = rootStub(false);
  const doc = { getElementById: () => root };
  assert.equal(busy(doc), false, "nothing inert");
  root.inert = true; assert.equal(busy(doc), true, "inert by someone else");
  root.inert = false; hold(root); assert.equal(busy(doc), false, "inert by this message is not busy");
  release(root); assert.equal(root.inert, false);
});
test("a message that has not opened keeps its records unseen while held, and is presented when the screen is free", () => {
  assert.deepEqual(nextOf()([rec(1)], new Set(), [], true, false), { shown: [], mark: [] });
  assert.deepEqual(nextOf()([rec(1)], new Set(), [], false, false), { shown: [1], mark: [1] });
});
test("the opening check includes the arrival and the busy root, and the wait polls until free", () => {
  assert.ok(HELD.includes('classList.contains("sage-flight-owned")') && HELD.includes("warnRootBusy(doc)"));
  assert.ok(app.includes('function warnRootBusy(doc) { const r = doc.getElementById("root"); return warnInertHolds === 0 && !!r && r.hasAttribute("inert"); }'));
});

/* ---- mutation controls: each bad variant is built from the real text by one replacement and must be caught ---- */
test("MUTATION: forgetting what was told reopens a dismissed message", () => {
  const bad = WARN.replace("visible.filter((f) => !seen.has(f.id))", "visible.filter((f) => true)");
  assert.notEqual(bad, WARN);
  assert.notDeepEqual(nextOf(bad)([rec(1)], new Set([1]), [], false), { shown: [], mark: [] });
});
test("MUTATION: opening a second message for a failure that arrives while one is open", () => {
  const bad = WARN.replace("if (live.length) return { shown: [...live, ...fresh], mark: fresh };", "");
  assert.notEqual(bad, WARN);
  assert.notDeepEqual(nextOf(bad)([rec(1), rec(2)], new Set([1]), [1], true), { shown: [1, 2], mark: [2] });
});
test("MUTATION: opening while the screen is busy takes the focus from newer work", () => {
  const bad = WARN.replace("fresh.length && !held", "fresh.length");
  assert.notEqual(bad, WARN);
  assert.notDeepEqual(nextOf(bad)([rec(1)], new Set(), [], true), { shown: [], mark: [] });
});
test("MUTATION: counting typing in a button as typing, or dropping the recent-typing window, is caught", () => {
  const bad = HELD.replace("now - lastEditAt < 2500 || ", "");
  assert.notEqual(bad, HELD);
  assert.equal(run(bad, { warnRootBusy: () => false }, "warnHeld")(docWith({ tagName: "BUTTON" }, null), 99000, 100000), false, "the mutant no longer waits after typing");
});
