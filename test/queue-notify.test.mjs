/**
 * What the queue changing means for the people in it.
 * -------------------------------------------------------------------------
 * The module said its rules "are read off the app, not invented here… if those
 * rules ever change in the app, they change here, and the tests should fail
 * loudly." There were no tests. These are they.
 *
 * The two mistakes worth catching are opposite and both bad: a salesperson
 * standing around because nobody told them they were up, and a phone buzzing
 * for something that was not theirs. The second is worse — it teaches the floor
 * to ignore the first.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { standings, decide, contentState } from "../api/_queue-notify.mjs";

const row = (line) => ({ line });
const P = (id, status = "waiting", extra = {}) => ({ id, label: id.toUpperCase(), status, ...extra });

test("standings: only waiting people count as ahead", () => {
  const s = standings([P("a"), P("b", "customer"), P("c"), P("d", "lunch"), P("e")]);
  assert.equal(s.get("a").ahead, 0);
  assert.equal(s.get("a").up, true);
  assert.equal(s.get("b").ahead, 1);       // a is ahead; b is not waiting so cannot be up
  assert.equal(s.get("b").up, false);
  assert.equal(s.get("c").ahead, 1);       // only a is waiting ahead of c
  assert.equal(s.get("e").ahead, 2);       // a and c
});

test("standings: someone at the front who is not waiting does not block", () => {
  const s = standings([P("a", "customer"), P("b")]);
  assert.equal(s.get("b").up, true, "b is up: the person in front is with a customer");
});

test("decide: being up is worth interrupting for, once", () => {
  const before = row([P("a"), P("b")]);
  const after = row([P("a", "customer"), P("b")]);
  const plan = decide(before, after);
  const up = plan.find((x) => x.id === "b");
  assert.equal(up.kind, "up");
  assert.match(up.title, /up/i);
  // and not again on the next unrelated write
  assert.equal(decide(after, after).length, 0);
});

test("decide: leaving the waiting list takes the standing display down", () => {
  const plan = decide(row([P("a")]), row([P("a", "lunch")]));
  assert.deepEqual(plan.map((p) => [p.id, p.kind]), [["a", "end"]]);
});

test("decide: dropping out of the line entirely ends it too", () => {
  const plan = decide(row([P("a"), P("b")]), row([P("b")]));
  assert.equal(plan.find((p) => p.id === "a").kind, "end");
});

test("decide: moving up quietly is a position change, not a buzz", () => {
  const plan = decide(row([P("a"), P("b"), P("c")]), row([P("b"), P("c")]));
  const c = plan.find((x) => x.id === "c");
  assert.equal(c.kind, "position");
  assert.equal(c.ahead, 1);
});

/* ---- the nudge ---- */

test("nudge: the desk asking for somebody buzzes them", () => {
  const before = row([P("a", "customer")]);
  const after = row([P("a", "customer", { nudgedAt: "2026-08-25T15:00:00Z" })]);
  const plan = decide(before, after);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, "nudge");
  assert.match(plan[0].title, /desk/i);
});

test("nudge: fires once, not on every write that follows", () => {
  const nudged = row([P("a", "away", { nudgedAt: "2026-08-25T15:00:00Z" })]);
  assert.equal(decide(nudged, nudged).length, 0, "the same stamp must not fire again");
  // an unrelated change to the line still must not re-fire it
  const later = row([P("a", "away", { nudgedAt: "2026-08-25T15:00:00Z" }), P("b")]);
  assert.equal(decide(nudged, later).filter((p) => p.id === "a").length, 0);
});

test("nudge: asking again later does fire again", () => {
  const first = row([P("a", "away", { nudgedAt: "2026-08-25T15:00:00Z" })]);
  const again = row([P("a", "away", { nudgedAt: "2026-08-25T15:30:00Z" })]);
  assert.equal(decide(first, again)[0].kind, "nudge");
});

test("nudge: outranks the position update in the same change", () => {
  const before = row([P("a"), P("b")]);
  const after = row([P("a"), P("b", "waiting", { nudgedAt: "2026-08-25T15:00:00Z" })]);
  const forB = decide(before, after).filter((p) => p.id === "b");
  assert.equal(forB.length, 1, "one message, not two");
  assert.equal(forB[0].kind, "nudge");
});

test("nudge: someone nudged while up still gets told they are up first time round", () => {
  // they were not up before and are now: the nudge is the louder of the two and
  // carries their standing on it, so nothing is lost
  const before = row([P("a"), P("b")]);
  const after = row([P("b", "waiting", { nudgedAt: "2026-08-25T15:00:00Z" })]);
  const plan = decide(before, after);
  const b = plan.find((x) => x.id === "b");
  assert.equal(b.kind, "nudge");
  assert.equal(b.ahead, 0, "the nudge still says where they stand");
});

test("contentState carries what a standing display reads", () => {
  const s = standings([P("a"), P("b")]).get("b");
  const st = contentState(s, { store: "hh" });
  assert.equal(st.ahead, 1);
  assert.equal(st.up, false);
  assert.equal(st.store, "hh");
});
