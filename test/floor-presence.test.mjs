/**
 * Leaving the lot while you are in line.
 * -------------------------------------------------------------------------
 * Honest lunch, honest test drive, and gaming the line look identical from
 * outside the building. Only one of them is a problem, and these are the checks
 * that keep the other two from being treated like it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onLeft, onReturned, answerLeft, dueToPassOver, skipSet, reconcile, judge, upheldFor, emptyPresence }
  from "../api/_floor-presence.mjs";
const T = (h,m=0) => Date.UTC(2026,7,20,h,m,0);
const iso = (t) => new Date(t).toISOString();

// ---- somebody off the clock is nobody's business ----
test("somebody off the clock is nobody's business", () => {
    const e = onLeft({ personId:"p1", label:"Luis", at:T(12), inLine:false, status:"waiting" });
    assert.ok(
      e.asked === false, e);
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, []).length === 0, reconcile(p, []));
});

// ---- the grace: answer quickly and you are never skipped ----
test("the grace: answer quickly and you are never skipped", () => {
    let e = onLeft({ personId:"p1", label:"Luis", at:T(12), inLine:true, status:"waiting" });
    e = answerLeft(e, "customer", T(12,0) + 20_000);
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      dueToPassOver(p, T(12,10)).length === 0, dueToPassOver(p, T(12,10)));
});
test("saying nothing for two minutes is not yet actionable", () => {
    const e = onLeft({ personId:"p1", label:"Luis", at:T(12), inLine:true, status:"waiting" });
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      dueToPassOver(p, T(12,2)).length === 0);
    assert.ok(
      dueToPassOver(p, T(12,5)).length === 1);
});

// ---- passed over, not removed ----
test("passed over, not removed", () => {
    const p = { ...emptyPresence(), events:[ onLeft({ personId:"p1", at:T(12), inLine:true, status:"waiting" }) ] };
    assert.ok(
      skipSet(p, T(12,30)).has("p1"));
    p.events.push(onReturned({ personId:"p1", at:T(13) }));
    assert.ok(
      !skipSet(p, T(13,1)).has("p1"));
});

// ---- case 1: honest lunch ----
test("case 1: honest lunch", () => {
    let e = onLeft({ personId:"p1", label:"Luis", at:T(12), inLine:true, status:"waiting" });
    e = answerLeft(e, "lunch", T(12,1));
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, []).length === 0, reconcile(p, []));
});

// ---- case 2: honest test drive, customer WAS checked in ----
test("case 2: honest test drive, customer WAS checked in", () => {
    let e = onLeft({ personId:"p1", label:"Luis", at:T(14), inLine:true, status:"waiting" });
    e = answerLeft(e, "customer", T(14,1));
    const p = { ...emptyPresence(), events:[e] };
    const history = [{ id:"p1", t: iso(T(13,40)), action:"customer" }];
    assert.ok(
      reconcile(p, history).length === 0, reconcile(p, history));
});

// ---- case 3: claimed a customer, nothing on the record all day ----
test("case 3: claimed a customer, nothing on the record all day", () => {
    let e = onLeft({ personId:"p1", label:"Luis", at:T(14), inLine:true, status:"waiting" });
    e = answerLeft(e, "customer", T(14,1));
    const p = { ...emptyPresence(), events:[e] };
    const flags = reconcile(p, []);
    assert.ok(
      flags.length === 1, flags);
    assert.ok(
      flags[0].status === "unverified", flags[0]);
    assert.ok(
      /visit count shows/.test(flags[0].reason) && !/dishonest|lying|cheat|stole/i.test(flags[0].reason), flags[0].reason);
});

// ---- the forgotten check-in: same flag, and that is the point ----
test("the forgotten check-in: same flag, and that is the point", () => {
    let e = onLeft({ personId:"p2", label:"Jason", at:T(15), inLine:true, status:"waiting" });
    const p = { ...emptyPresence(), events:[e] };            // never answered at all
    const flags = reconcile(p, []);
    assert.ok(
      flags.length === 1, flags);
    assert.ok(
      judge(flags[0], "excused", "Jorge", T(18), "phone died").status === "excused");
    assert.ok(
      upheldFor([judge(flags[0], "excused", "Jorge", T(18))], "p2").length === 0);
    assert.ok(
      upheldFor([judge(flags[0], "upheld", "Jorge", T(18))], "p2").length === 1);
    assert.ok(
      judge(flags[0], "excused", "Jorge", T(18), "phone died").note === "phone died");
});

// ---- a check-in hours away from the trip does not cover it ----
test("a check-in hours away from the trip does not cover it", () => {
    let e = answerLeft(onLeft({ personId:"p1", at:T(16), inLine:true, status:"waiting" }), "customer", T(16,1));
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, [{ id:"p1", t: iso(T(9)), action:"customer" }]).length === 1);
    assert.ok(
      reconcile(p, [{ id:"p1", t: iso(T(15,30)), action:"customer" }]).length === 0);
});

// ---- somebody else's check-in is not yours ----
test("somebody else's check-in is not yours", () => {
    let e = answerLeft(onLeft({ personId:"p1", at:T(14), inLine:true, status:"waiting" }), "customer", T(14,1));
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, [{ id:"p2", t: iso(T(14)), action:"customer" }]).length === 1);
});

// ---- junk in the history never crashes the reckoning ----
test("junk in the history never crashes the reckoning", () => {
    let e = answerLeft(onLeft({ personId:"p1", at:T(14), inLine:true, status:"waiting" }), "customer", T(14,1));
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, [null, {}, { id:"p1" }, { id:"p1", t:"not a date" }, "junk"]).length === 1);
});


// ---- the secondary salesperson: the case the Visit column exists for ----
test("the secondary salesperson: the case the Visit column exists for", () => {
    let e = answerLeft(onLeft({ personId:"p1", label:"Luis", at:T(14), inLine:true, status:"waiting" }), "customer", T(14,1));
    const p = { ...emptyPresence(), events:[e] };
    assert.ok(
      reconcile(p, []).length === 1);
    assert.ok(
      reconcile(p, [], { visits: { p1: 1 } }).length === 0, reconcile(p, [], { visits: { p1: 1 } }));
    assert.ok(
      reconcile(p, [], { visits: { p1: 0 } }).length === 1);
    assert.ok(
      reconcile(p, [], { visits: { p2: 3 } }).length === 1);
    assert.ok(
      /line|visit/i.test(reconcile(p, [])[0].reason), reconcile(p, [])[0].reason);
});
