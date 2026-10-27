/* The identity history of a sign-in arrival attempt: ordered, never revived, bound to the sign-in RESPONSE subject. Pure, no browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHoldAttempt } from "../src/arrival-hold.mjs";

const A = "user-A", B = "user-B", R = "user-R";
const run = (baseline, events, response, live) => { const h = createHoldAttempt({ baseline }); for (const e of events) h.observe(e); const ok = response === undefined ? null : h.accept(response, live === undefined ? response : live); return { h, ok }; };

test("anonymous to A is accepted when the response is for A and A is live", () => { const { h, ok } = run(null, [A], A); assert.equal(ok, true); assert.equal(h.isAccepted(), true); assert.equal(h.canHandOver(A), true); assert.deepEqual(h.history(), [null, A]); });
test("same-user re-sign-in: baseline A, no new subject (or repeats of A) is accepted", () => { for (const evs of [[], [A], [A, A, A]]) { const { h, ok } = run(A, evs, A); assert.equal(ok, true); assert.deepEqual(h.history(), [A]); } });
test("baseline existing A, a direct A to B and a response for B is POSITIVE", () => { const { h, ok } = run(A, [B], B); assert.equal(ok, true); assert.equal(h.subject(), B); assert.equal(h.canHandOver(B), true); assert.equal(h.canHandOver(A), false); });
test("A to B to A to B is NEGATIVE: the return to the baseline kills the attempt for good, and a later B does not revive it", () => { const h = createHoldAttempt({ baseline: A }); assert.equal(h.observe(B), true); assert.equal(h.observe(A), false); assert.equal(h.observe(B), false); assert.equal(h.accept(B, B), false); assert.equal(h.isDead(), true); assert.deepEqual(h.history(), [A, B, A], "history keeps order up to the kill and stops there; only consecutive repeats collapse"); });
test("null to A to null to A stays dead", () => { const h = createHoldAttempt({ baseline: null }); assert.equal(h.observe(A), true); assert.equal(h.observe(null), false); assert.equal(h.observe(A), false); assert.equal(h.accept(A, A), false); assert.equal(h.canHandOver(A), false); });
test("B before A's response: null to B, then A (the response's subject) arrives: dead at A, never accepted", () => { const h = createHoldAttempt({ baseline: null }); assert.equal(h.observe(B), true); assert.equal(h.observe(A), false); assert.equal(h.accept(A, A), false); });
test("B arrives and stays, A's response is for A: not accepted (the live subject is not the response's)", () => { const { ok, h } = run(null, [B], A, B); assert.equal(ok, false); assert.equal(h.isDead(), true); });
test("the first event is not assumed to be the intended user: events for B, response for A", () => { const { ok } = run(null, [B], A, A); assert.equal(ok, false); });
test("the response user id is mandatory, and must equal the live subject", () => { for (const [u, l] of [[undefined, A], [null, A], ["", A], [A, null], [A, B], [A, undefined]]) { const h = createHoldAttempt({ baseline: null }); h.observe(A); assert.equal(h.accept(u, l), false, JSON.stringify([u, l])); assert.equal(h.isDead(), true); } });
test("a response for A with no event delivered yet and no live subject is not accepted", () => { const h = createHoldAttempt({ baseline: null }); assert.equal(h.accept(A, null), false); });
test("after acceptance any other subject kills, and a return to the bound subject does not revive", () => { const h = createHoldAttempt({ baseline: null }); h.observe(A); assert.equal(h.accept(A, A), true); assert.equal(h.observe(B), false); assert.equal(h.observe(A), false); assert.equal(h.canHandOver(A), false); assert.equal(h.isAccepted(), false); });
test("after acceptance a logout (anonymous) kills", () => { const h = createHoldAttempt({ baseline: null }); h.observe(A); h.accept(A, A); assert.equal(h.observe(null), false); });
test("duplicate events collapse only when consecutive", () => { const h = createHoldAttempt({ baseline: null }); for (const e of [A, A, A, A]) assert.equal(h.observe(e), true); assert.deepEqual(h.history(), [null, A]); assert.equal(h.accept(A, A), true); });
test("canHandOver needs acceptance, a live attempt and the live subject equal to the bound one", () => { const h = createHoldAttempt({ baseline: null }); assert.equal(h.canHandOver(A), false); h.observe(A); h.accept(A, A); assert.equal(h.canHandOver(A), true); assert.equal(h.canHandOver(B), false); assert.equal(h.canHandOver(null), false); h.kill(); assert.equal(h.canHandOver(A), false); });
test("accept is once only", () => { const h = createHoldAttempt({ baseline: null }); h.observe(A); assert.equal(h.accept(A, A), true); assert.equal(h.accept(A, A), false); });
test("custom attempt (the recovery save): the known recovery subject stays, any other kills for good, null at the press is dead, and accept is not for it", () => {
  const h = createHoldAttempt({ baseline: R, custom: true }); assert.equal(h.isAccepted(), true); assert.equal(h.canHandOver(R), true); assert.equal(h.observe(R), true); assert.equal(h.accept(R, R), false);
  assert.equal(h.observe(B), false); assert.equal(h.observe(R), false); assert.equal(h.canHandOver(R), false);
  const none = createHoldAttempt({ baseline: null, custom: true }); assert.equal(none.isDead(), true);
});
test("non-string subjects are treated as anonymous", () => { const h = createHoldAttempt({ baseline: undefined }); assert.equal(h.observe(undefined), true); assert.equal(h.observe(0), true); assert.deepEqual(h.history(), [null]); });
test("attempts do not share state", () => { const a = createHoldAttempt({ baseline: null }), b = createHoldAttempt({ baseline: null }); a.observe(A); a.observe(null); assert.equal(a.isDead(), true); assert.equal(b.isDead(), false); });
