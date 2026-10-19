/**
 * The month review provider, held to one idea: it adds no algorithm. Whatever the
 * planner computes for a month, the provider computes from explicit input and gets
 * the same rows, and refuses everything it was not told. Stores and assignments
 * below are the preview's synthetic ones; the provider itself imports none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fixtures } from "../scheduler-proposal/model.mjs";
import { fixtureAssignments } from "./assignment-view.mjs";
import { createPlanner } from "./month-model.mjs";
import { seedTeams } from "./team-model.mjs";
import {
  REVIEW_DEFINITION, ReviewInputError, LIMITS, canonicalJson, exportReviewInput, hydrateReviewPlanner,
  reviewMonth, reviewSpan, validateReviewInput, verifyReview,
} from "./month-review.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
// The planner seeds placeholder teams when a store has none. The provider refuses that, so these stores say it outright.
const explicit = (store) => ({ ...store, ...seedTeams(store) });
const make = (assign = fixtureAssignments) => {
  const stores = fixtures().map(explicit);
  const planner = createPlanner(stores, { assignmentForDay: assign });
  return { stores, planner, assign };
};
const input = (ctx, month, index = 0) => exportReviewInput({ planner: ctx.planner, stores: ctx.stores, index, storeId: ctx.stores[index].id === "fictional-0" ? "fictional-0" : ctx.stores[index].id, month, assignmentForDay: ctx.assign });
const plain = (v) => JSON.parse(JSON.stringify(v));
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ReviewInputError && (code === undefined || e.code === code), `expected ${code}`);

test("the span is the planner's: complete Monday to Sunday weeks", () => {
  const s = reviewSpan("2026-10");
  assert.equal(s.from, "2026-09-28");
  assert.equal(s.to, "2026-11-01");
  assert.deepEqual(s.months, ["2026-09", "2026-10", "2026-11"]);
  assert.equal(reviewSpan("2027-02").days.length, 28, "a 28 day month that starts on a Monday has no neighbours");
  assert.deepEqual(reviewSpan("2026-12").months, ["2026-11", "2026-12", "2027-01"]);
  throwsCode(() => reviewSpan("2026-13"), "scope");
  // The independent check: the planner asks for exactly these days, no more and no fewer.
  for (const month of ["2026-10", "2026-11", "2027-02", "2028-02", "2026-12"]) {
    const seen = new Set();
    const open = fixtures().map((s) => explicit({ ...s, rules: [{ effective: "2014-01-01", open: 9, close: 17, minimum: 1, useCapacity: false, capacity: 6, closedDays: [], holidays: {} }] }));
    createPlanner(open, { assignmentForDay: (day) => { seen.add(day); return null; } }).rows(0, month);
    assert.deepEqual([...seen].sort(), [...reviewSpan(month).days], month);
  }
});

test("the provider returns the planner's own rows, byte for byte", () => {
  const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2028-02"];
  const ctx = make();
  for (let index = 0; index < ctx.stores.length; index++) for (const month of months) {
    const review = reviewMonth(input(ctx, month, index));
    const live = ctx.planner.rows(index, month);
    assert.equal(review.legacyFingerprint, JSON.stringify(live), `${ctx.stores[index].id} ${month}: the whole-row fingerprint is unchanged`);
    assert.deepEqual(plain(review.rows), plain(live));
    assert.equal(review.openIssues, live.reduce((n, r) => n + r.issues.length, 0));
  }
});

test("forecast, policy, history and neighbour drafts are in the rows, so they are in the review", () => {
  const ctx = make();
  const base = reviewMonth(input(ctx, "2026-10"), { sha256 });
  assert.ok(base.rows.some((r) => r.estimate), "the rows carry forecasts");
  // history
  const h = make();
  const hs = h.planner.get(0, "2026-10").store;
  hs.history = hs.history.map((r) => (r.state === "known" ? { ...r, units: r.units + 20 } : r));
  assert.notEqual(reviewMonth(input(h, "2026-10"), { sha256 }).digest, base.digest, "history changes the review");
  // policy
  const p = make();
  p.planner.get(0, "2026-10").store.planningPolicy = { people: Object.fromEntries(p.stores[0].people.map((x) => [x.id, { eligible: true, roles: ["sales"] }])), requiredRoles: { sales: 1 } };
  const withPolicy = reviewMonth(input(p, "2026-10"), { sha256 });
  assert.notEqual(withPolicy.digest, base.digest, "policy changes the review");
  assert.equal(withPolicy.legacyFingerprint, JSON.stringify(p.planner.rows(0, "2026-10")));
  // a neighbouring month's own draft: its store and its overrides
  const n = make();
  const nd = n.planner.get(0, "2026-11");
  nd.store.rules = [{ ...nd.store.rules[0], closedDays: [0, 1, 6] }];
  const nb = reviewMonth(input(n, "2026-10"), { sha256 });
  assert.equal(nb.legacyFingerprint, JSON.stringify(n.planner.rows(0, "2026-10")), "parity with a neighbour draft");
  assert.ok(nb.span.to === "2026-11-01");
  const o = make();
  const person = o.stores[0].people[0].id;
  o.planner.setAssignment(0, "2026-11-01", { on: [person], off: [], shifts: [] });
  o.planner.setAssignment(0, "2026-10-30", { on: [person], off: [], shifts: [] });
  const ov = reviewMonth(input(o, "2026-10"), { sha256 });
  assert.equal(ov.legacyFingerprint, JSON.stringify(o.planner.rows(0, "2026-10")));
  assert.notEqual(ov.digest, base.digest, "a neighbour override changes the scope month");
  // no draft for the neighbour means the base store with no overrides, as the planner does
  assert.equal(Object.hasOwn(input(ctx, "2026-10").months, "2026-11"), false);
});

test("ordered teams and memberships, current and initial, are in the review", () => {
  const ctx = make();
  const first = ctx.stores[0];
  const before = reviewMonth(input(ctx, "2026-10"), { sha256 });
  ctx.planner.addTeam(0, "Birch team");
  ctx.planner.setMembership(0, { storeId: first.id, personId: first.people[0].id, teamIds: [ctx.planner.teamState[0].teams.at(-1).id], from: "2026-10-10", to: "2026-10-20", source: { kind: "manager" } });
  const after = reviewMonth(input(ctx, "2026-10"), { sha256 });
  assert.equal(after.legacyFingerprint, JSON.stringify(ctx.planner.rows(0, "2026-10")));
  assert.notEqual(after.inputDigest, before.inputDigest);
  // order is part of the input: the same memberships reordered is a different input
  const swapped = plain(input(ctx, "2026-10"));
  swapped.teamState.teams.reverse();
  assert.notEqual(reviewMonth(swapped, { sha256 }).inputDigest, after.inputDigest);
  // the base seed matters too: initial teams come from the base store, and a record's snapshot is built from them
  const changedBase = plain(input(make(), "2026-10"));
  changedBase.baseStore.memberships = [];
  assert.notEqual(reviewMonth(changedBase, { sha256 }).digest, before.digest);
});

test("every property the planner reads is one the input contract declares", () => {
  const ctx = make();
  const allowed = { store: new Set(["id", "name", "timezone", "people", "rules", "history", "planningPolicy", "teams", "memberships"]),
    person: new Set(["id", "name", "off", "start", "end", "maxHours"]),
    rule: new Set(["effective", "open", "close", "minimum", "useCapacity", "capacity", "closedDays", "holidays"]) };
  const seen = { store: new Set(), person: new Set(), rule: new Set() };
  const watch = (obj, kind) => new Proxy(obj, { get(t, k) { if (typeof k === "string") seen[kind].add(k); return t[k]; } });
  for (const m of ["2026-09", "2026-10", "2026-11"]) {
    const d = ctx.planner.get(0, m);
    const store = d.store;
    d.store = new Proxy({ ...store, people: store.people.map((p) => watch(p, "person")), rules: store.rules.map((r) => watch(r, "rule")) }, { get(t, k) { if (typeof k === "string") seen.store.add(k); return t[k]; } });
  }
  ctx.planner.rows(0, "2026-10");
  for (const kind of Object.keys(seen)) for (const k of seen[kind]) assert.ok(allowed[kind].has(k), `${kind}.${k} is read by the planner but not declared by the contract`);
  for (const k of ["history", "people", "planningPolicy", "rules"]) assert.ok(seen.store.has(k), `the guard observed the draft store reading ${k}`);
  // The base store is read too: it seeds team snapshots and the timezone of months with no draft.
  const baseSeen = new Set();
  const stores = fixtures().map(explicit);
  const watched = [new Proxy(stores[0], { get(t, k) { if (typeof k === "string") baseSeen.add(k); return t[k]; } })];
  createPlanner(watched, { assignmentForDay: fixtureAssignments }).rows(0, "2026-10");
  for (const k of baseSeen) assert.ok(allowed.store.has(k), `store.${k} is read from the base store but not declared`);
  assert.ok(baseSeen.has("memberships") && baseSeen.has("teams"), "the guard observed the base store reading teams and memberships");
});

test("rows depend on the declared fields and nothing else", () => {
  const ctx = make();
  const base = reviewMonth(input(ctx, "2026-10"), { sha256 }).digest;
  const mutate = (fn) => { const i = plain(input(make(), "2026-10")); fn(i); return reviewMonth(i, { sha256 }).digest; };
  const changed = {
    "a rule's hours": (i) => { i.months["2026-10"].store.rules[0].close = 18; },
    "a rule's minimum": (i) => { i.months["2026-10"].store.rules[0].minimum = 3; },
    "a holiday": (i) => { i.months["2026-10"].store.rules[0].holidays["2026-10-13"] = "closed"; },
    "closed weekdays": (i) => { i.months["2026-10"].store.rules[0].closedDays = [0, 6]; },
    "a person's limit": (i) => { i.months["2026-10"].store.people[0].maxHours = 4; },
    "a person's days off": (i) => { i.months["2026-10"].store.people[0].off = [1, 2, 3]; },
    "a person's availability": (i) => { i.months["2026-10"].store.people[0].end = 12; },
    "history": (i) => { i.months["2026-10"].store.history.push({ day: "2026-09-30", state: "known", units: 99 }); },
    "the base for a day": (i) => { i.base["2026-10-14"] = { on: [], off: [] }; },
    "an override": (i) => { i.months["2026-10"].overrides["2026-10-14"] = { on: [i.months["2026-10"].store.people[0].id], off: [] }; },
  };
  for (const [name, fn] of Object.entries(changed)) assert.notEqual(mutate(fn), base, name);
  // the store's display name is not part of any row
  const renamed = plain(input(make(), "2026-10"));
  renamed.months["2026-10"].store.name = "Another name";
  assert.equal(reviewMonth(renamed, { sha256 }).digest, base);
});

test("the base assignment is explicit for every span day, and nothing synthetic is added", () => {
  const ctx = make(() => null);
  const i = input(ctx, "2026-10");
  const span = reviewSpan("2026-10");
  assert.deepEqual(Object.keys(i.base).sort(), [...span.days]);
  assert.ok(Object.values(i.base).every((v) => v === null));
  const review = reviewMonth(i);
  assert.ok(review.rows.filter((r) => r.state === "open").every((r) => r.record === null && r.issues.includes("Needs schedule: no entered assignments.")), "no assignment appears that the input did not carry");
  const src = readFileSync(new URL("./month-review.mjs", import.meta.url), "utf8");
  assert.ok(!/fixtureAssignments|assignment-view|scheduler-proposal|\bfixtures\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "the provider reads no fixture module");
});

test("missing or unknown context is refused, never defaulted", () => {
  const good = plain(input(make(), "2026-10"));
  const without = (fn) => { const i = plain(good); fn(i); return i; };
  const cases = {
    "a missing span day": [without((i) => { delete i.base["2026-10-14"]; }), "missing"],
    "a base day outside the span": [without((i) => { i.base["2026-12-25"] = null; }), "unknown key"],
    "no scope month draft": [without((i) => { delete i.months["2026-10"]; }), "missing"],
    "a month outside the span": [without((i) => { i.months["2027-05"] = i.months["2026-10"]; }), "unknown key"],
    "no base teams": [without((i) => { delete i.baseStore.teams; }), "missing"],
    "no base memberships": [without((i) => { delete i.baseStore.memberships; }), "missing"],
    "no team state": [without((i) => { delete i.teamState; }), "missing"],
    "no history": [without((i) => { delete i.months["2026-10"].store.history; }), "missing"],
    "a draft store with no timezone": [without((i) => { delete i.months["2026-10"].store.timezone; }), "missing"],
    "another store's draft": [without((i) => { i.months["2026-10"].store.id = "other"; }), "scope"],
    "a bad store id": [without((i) => { i.scope.storeId = "has space"; }), "scope"],
    "a bad month": [without((i) => { i.scope.month = "2026-13"; }), "scope"],
    "another definition": [without((i) => { i.definition = "month-review/2"; }), "definition"],
    "an unknown top-level key": [without((i) => { i.recomputedFingerprint = "x"; }), "unknown key"],
    "a caller's issue count": [without((i) => { i.openIssues = 0; }), "unknown key"],
    "an unknown store key": [without((i) => { i.months["2026-10"].store.extra = 1; }), "unknown key"],
    "an unknown person key": [without((i) => { i.months["2026-10"].store.people[0].role = "x"; }), "unknown key"],
    "a duplicate person": [without((i) => { i.months["2026-10"].store.people.push(i.months["2026-10"].store.people[0]); }), "shape"],
    "a person day off that is not a weekday": [without((i) => { i.months["2026-10"].store.people[0].off = [9]; }), "shape"],
    "an impossible history day": [without((i) => { i.months["2026-10"].store.history[0].day = "2026-99-01"; }), "shape"],
    "a history state that is not one of three": [without((i) => { i.months["2026-10"].store.history[0].state = "guess"; }), "shape"],
    "an override on a day of another month": [without((i) => { i.months["2026-10"].overrides["2026-11-01"] = { on: [], off: [] }; }), "shape"],
  };
  for (const [name, [bad, code]] of Object.entries(cases)) throwsCode(() => reviewMonth(bad), code);
  assert.doesNotThrow(() => reviewMonth(good));
});

test("input is bounded, plain JSON, and copied", () => {
  const good = plain(input(make(), "2026-10"));
  const big = plain(good);
  big.months["2026-10"].store.people = Array.from({ length: LIMITS.people + 1 }, (_, i) => ({ id: "p" + i, name: "x", off: [], start: 9, end: 17, maxHours: 40 }));
  throwsCode(() => reviewMonth(big), "shape");
  const hist = plain(good);
  hist.months["2026-10"].store.history = Array.from({ length: LIMITS.history + 1 }, () => ({ day: "2026-01-01", state: "unknown", units: null }));
  throwsCode(() => reviewMonth(hist), "shape");
  const deep = plain(good);
  let node = (deep.base["2026-10-14"] = { on: [], off: [], teamSnapshot: {} }).teamSnapshot;
  for (let i = 0; i < LIMITS.depth + 2; i++) node = node.x = {};
  throwsCode(() => reviewMonth(deep), "too deep");
  const long = plain(good);
  long.base["2026-10-14"] = { on: ["x".repeat(LIMITS.string + 1)], off: [] };
  throwsCode(() => reviewMonth(long), "string too long");
  const nan = plain(good);
  nan.months["2026-10"].store.people[0].maxHours = NaN;
  throwsCode(() => reviewMonth(nan), "not finite");
  const fn = plain(good);
  fn.base["2026-10-14"] = { on: [], off: [], teamSnapshot: { f() {} } };
  throwsCode(() => reviewMonth(fn), "not JSON");
  const undef = plain(good);
  undef.base["2026-10-14"] = { on: [], off: [], teamSnapshot: { x: undefined } };
  throwsCode(() => reviewMonth(undef), "not JSON");
  const proto = plain(good);
  proto.base["2026-10-14"] = JSON.parse('{"on":[],"off":[],"teamSnapshot":{"__proto__":{"x":1}}}');
  throwsCode(() => reviewMonth(proto), "forbidden key");
  const date = plain(good);
  date.base["2026-10-14"] = { on: [], off: [], teamSnapshot: { d: new Date() } };
  throwsCode(() => reviewMonth(date), "not plain");
  const accessor = plain(good);
  Object.defineProperty(accessor.base, "2026-10-14", { enumerable: true, get() { return null; } });
  throwsCode(() => reviewMonth(accessor), "accessor");
  const huge = plain(good);
  huge.base["2026-10-14"] = { on: Array.from({ length: LIMITS.idsPerRecord + 1 }, (_, i) => "p" + i), off: [] };
  throwsCode(() => reviewMonth(huge), "shape");
  // immutable: the result and the validated input are frozen, and later edits to the raw input change nothing
  const raw = plain(good);
  const validated = validateReviewInput(raw);
  const before = reviewMonth(raw, { sha256 });
  raw.months["2026-10"].store.people[0].maxHours = 1;
  raw.base["2026-10-14"] = { on: [], off: [] };
  assert.equal(reviewMonth(validated, { sha256 }).digest, before.digest);
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.months["2026-10"].store.people[0]));
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.rows) && Object.isFrozen(before.rows[0]));
  assert.throws(() => { "use strict"; before.rows[0].issues.push("x"); });
});

test("hashing is the caller's and is checked, and the digest is the versioned one", () => {
  const i = input(make(), "2026-10");
  assert.equal(reviewMonth(i).digest, null, "no hash, no digest");
  throwsCode(() => reviewMonth(i, { sha256: () => "0".repeat(64) }), "hash");
  throwsCode(() => reviewMonth(i, { sha256: (t) => (t === "abc" ? "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" : "1".repeat(64)) }), "hash");
  throwsCode(() => reviewMonth(i, { sha256: "sha256" }), "hash");
  const r = reviewMonth(i, { sha256 });
  assert.equal(r.digest, sha256(r.canonical));
  assert.equal(r.definition, REVIEW_DEFINITION);
  assert.match(r.canonical, /^\{"definition":"month-review\/1"/);
  // The legacy fingerprint is not the digest, and is exactly what the editor compares today.
  assert.notEqual(r.digest, r.legacyFingerprint);
  assert.equal(r.legacyFingerprint, JSON.stringify(r.rows));
});

test("the digest is pinned: changing canonical serialization needs a new definition", () => {
  // A small fixed input. If this value ever changes, the definition string must change with it,
  // old digests must stay verifiable under their own definition, and this test is updated on purpose.
  const stores = [explicit({ id: "pin-store", name: "Pinned", timezone: "America/New_York",
    people: [{ id: "a", name: "Ada", off: [0], start: 9, end: 17, maxHours: 40 }, { id: "b", name: "Bo", off: [], start: 9, end: 17, maxHours: 40 }],
    rules: [{ effective: "2026-01-01", open: 9, close: 17, minimum: 1, useCapacity: false, capacity: 6, closedDays: [0], holidays: {} }],
    history: [{ day: "2026-01-05", state: "known", units: 3 }] })];
  const planner = createPlanner(stores, { assignmentForDay: (day) => (day === "2026-02-03" ? { on: ["a"], off: ["b"] } : null) });
  const i = exportReviewInput({ planner, stores, storeId: "pin-store", month: "2026-02", assignmentForDay: (day) => (day === "2026-02-03" ? { on: ["a"], off: ["b"] } : null) });
  const r = reviewMonth(i, { sha256 });
  assert.equal(r.digest, PINNED_DIGEST);
  assert.equal(r.inputDigest, PINNED_INPUT_DIGEST);
});
const PINNED_DIGEST = "11dce3f988bf1cadceedc49634e40dc72a1aaaba15087350935a66e86497ed79";
const PINNED_INPUT_DIGEST = "6f38e1eba605a80e1188198f6157d74821d7790601f6eacc8d05504045bb1270";

test("key order cannot change the digest, and legacy compatibility is kept apart", () => {
  const ctx = make();
  const i = plain(input(ctx, "2026-10"));
  const shuffle = (v) => (Array.isArray(v) ? v.map(shuffle) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, shuffle(v[k])])) : v);
  const a = reviewMonth(i, { sha256 }), b = reviewMonth(shuffle(i), { sha256 });
  assert.equal(a.digest, b.digest);
  assert.equal(a.inputDigest, b.inputDigest);
  assert.deepEqual(plain(a.rows), plain(b.rows));
  // array order is meaningful and does change the digest
  const reversed = plain(i);
  reversed.months["2026-10"].store.people.reverse();
  assert.notEqual(reviewMonth(reversed, { sha256 }).digest, a.digest);
});

test("a claim is verified by recomputation and carries nothing else", () => {
  const i = input(make(), "2026-10");
  const r = reviewMonth(i, { sha256 });
  const claim = { definition: REVIEW_DEFINITION, digest: r.digest };
  assert.equal(verifyReview(i, claim, { sha256 }).ok, true);
  assert.deepEqual(verifyReview(i, { ...claim, digest: "0".repeat(64) }, { sha256 }), { ok: false, reason: "digest" });
  assert.equal(verifyReview(i, { ...claim, definition: "month-review/2" }, { sha256 }).reason, "definition");
  for (const extra of [{ rows: [] }, { openIssues: 0 }, { legacyFingerprint: "x" }, { recomputedFingerprint: r.digest }])
    assert.deepEqual(verifyReview(i, { ...claim, ...extra }, { sha256 }), { ok: false, reason: "claim" });
  assert.equal(verifyReview(i, { definition: REVIEW_DEFINITION, digest: "short" }, { sha256 }).reason, "claim");
  assert.equal(verifyReview(i, null, { sha256 }).reason, "claim");
  assert.deepEqual(verifyReview(i, claim), { ok: false, reason: "hash" }, "no hash implementation, no verification");
  // the same claim against input that differs by one person's limit, one month, or one store does not verify
  const edited = plain(i);
  edited.months["2026-10"].store.people[0].maxHours = 1;
  assert.equal(verifyReview(edited, claim, { sha256 }).reason, "digest");
  const other = input(make(), "2026-11");
  assert.equal(verifyReview(other, claim, { sha256 }).reason, "digest");
  const bad = plain(i);
  delete bad.base["2026-10-14"];
  assert.equal(verifyReview(bad, claim, { sha256 }).reason, "missing");
});

test("export refuses a planner whose teams were seeded as placeholders", () => {
  const raw = fixtures();
  const planner = createPlanner(raw, { assignmentForDay: fixtureAssignments });
  throwsCode(() => exportReviewInput({ planner, stores: raw, storeId: raw[0].id, month: "2026-10", assignmentForDay: fixtureAssignments }), "missing");
  const ctx = make();
  throwsCode(() => exportReviewInput({ planner: ctx.planner, stores: ctx.stores, storeId: "not a store id", month: "2026-10", assignmentForDay: ctx.assign }), "scope");
  throwsCode(() => exportReviewInput({ planner: ctx.planner, stores: ctx.stores, storeId: ctx.stores[0].id, month: "2026-10" }), "missing");
});

test("a hydrated planner is independent of the input it came from", () => {
  const i = validateReviewInput(plain(input(make(), "2026-10")));
  const a = hydrateReviewPlanner(i), b = hydrateReviewPlanner(i);
  a.setAssignment(0, "2026-10-14", { on: [], off: [] });
  assert.notEqual(JSON.stringify(a.rows(0, "2026-10")), JSON.stringify(b.rows(0, "2026-10")));
  assert.equal(JSON.stringify(b.rows(0, "2026-10")), reviewMonth(i).legacyFingerprint);
});

/* ---- Independent review findings, each held by a regression ---------------------------- */
const fresh = () => plain(input(make(), "2026-10"));
const day14 = "2026-10-14";

test("arrays are plain, dense and bounded before they are walked", () => {
  // a subclass could override every/map/toJSON and so change what is checked or hashed
  class Evil extends Array { every() { return true; } }
  const evil = new Evil(); evil.push(5);
  const a = fresh(); a.baseStore.memberships = [{ storeId: a.scope.storeId, personId: "x", teamIds: evil, from: "2026-01-01", to: "2026-12-31" }];
  throwsCode(() => validateReviewInput(a), "not plain");
  class Forge extends Array { toJSON() { return [{ id: "t", name: "T" }]; } }
  const b = fresh(); b.teamState.teams = new Forge();
  throwsCode(() => validateReviewInput(b), "not plain");
  class Species extends Array { static get [Symbol.species]() { return Array; } }
  const c = fresh(); c.base[day14] = { on: new Species(), off: [] };
  throwsCode(() => validateReviewInput(c), "not plain");
  // a huge sparse array is refused at once, not after it has been walked
  const d = fresh(); const big = []; big.length = 2 ** 30; d.base[day14] = { on: big, off: [] };
  const t0 = Date.now();
  throwsCode(() => validateReviewInput(d), "too large");
  assert.ok(Date.now() - t0 < 500, "refused without walking the array");
  // holes and extra properties are not plain arrays
  const e = fresh(); e.base[day14] = { on: [, "x"], off: [] };
  throwsCode(() => validateReviewInput(e), "not a plain array");
  const f = fresh(); const withExtra = ["x"]; withExtra.foo = 1; f.base[day14] = { on: withExtra, off: [] };
  throwsCode(() => validateReviewInput(f), "not a plain array");
  const g = fresh(); const getter = ["x"]; Object.defineProperty(getter, 0, { get() { return "x"; }, enumerable: true }); g.base[day14] = { on: getter, off: [] };
  throwsCode(() => validateReviewInput(g), "not a plain array");
  // and the digest cannot be forged through any of them: input that differs has a different inputDigest
  const h = fresh(); h.teamState.teams = [{ id: "t", name: "T" }];
  assert.notEqual(reviewMonth(h, { sha256 }).inputDigest, reviewMonth(fresh(), { sha256 }).inputDigest);
});

test("every record key the planner reads is named and typed, so it cannot fail inside the planner", () => {
  const cases = {
    "generationLocks that is not a list": [(r) => { r.generationLocks = 5; }, "shape"],
    "an unknown record key": [(r) => { r.zzz = 1; }, "unknown key"],
    "shifts that is not a list": [(r) => { r.shifts = "x"; }, "shape"],
    "a shift with an unknown key": [(r) => { r.shifts = [{ personId: "a", extra: 1 }]; }, "unknown key"],
    "a shift with no person": [(r) => { r.shifts = [{ startMinute: 1 }]; }, "missing"],
    "a shift minute that is text": [(r) => { r.shifts = [{ personId: "a", startMinute: "9" }]; }, "shape"],
    "absences that is a list": [(r) => { r.absences = []; }, "shape"],
    "generation with the wrong parts": [(r) => { r.generation = { unlocked: 5 }; }, "shape"],
    "generation with an unknown part": [(r) => { r.generation = { extra: 1 }; }, "unknown key"],
    "an on list holding a number": [(r) => { r.on = [5]; }, "shape"],
  };
  for (const [name, [edit, code]] of Object.entries(cases)) {
    const i = fresh(); const r = { on: [], off: [] }; edit(r); i.base[day14] = r;
    throwsCode(() => reviewMonth(i), code);
    assert.deepEqual(verifyReview(i, { definition: REVIEW_DEFINITION, digest: "0".repeat(64) }, { sha256 }).ok, false, name);
  }
  const ok = fresh(); ok.base[day14] = { on: [ok.baseStore.people[0].id], off: [], shifts: [], generationLocks: [], generation: { unlocked: [], signatures: {} }, absences: {}, unknownNotes: {}, teamSnapshot: {} };
  assert.doesNotThrow(() => reviewMonth(ok));
});

test("months the planner cannot hold are refused by name, and verify does not throw", () => {
  const early = fresh(); early.scope.month = "2013-12";
  throwsCode(() => reviewMonth(early), "scope");
  throwsCode(() => reviewSpan("2013-12"), "scope");
  throwsCode(() => reviewSpan("2101-01"), "scope");
  assert.deepEqual(verifyReview(early, { definition: REVIEW_DEFINITION, digest: "0".repeat(64) }, { sha256 }), { ok: false, reason: "scope" });
  // a neighbour draft before the planner's first month is refused too
  const ctx = make();
  const jan = plain(exportReviewInput({ planner: ctx.planner, stores: ctx.stores, storeId: ctx.stores[0].id, month: "2014-01", assignmentForDay: ctx.assign }));
  jan.months["2013-12"] = jan.months["2014-01"];
  throwsCode(() => reviewMonth(jan), "scope");
  assert.doesNotThrow(() => reviewMonth(plain(exportReviewInput({ planner: ctx.planner, stores: ctx.stores, storeId: ctx.stores[0].id, month: "2014-01", assignmentForDay: ctx.assign }))), "the first month itself is fine");
});

test("time and size are bounded together, not just node counts", () => {
  const many = fresh();
  const names = Array.from({ length: LIMITS.idsPerRecord }, (_, i) => "p" + i);
  many.baseStore.memberships = Array.from({ length: LIMITS.memberships }, () => ({ storeId: many.scope.storeId, personId: "x", teamIds: [], from: "2026-01-01", to: "2026-12-31" }));
  many.base[day14] = { on: names, off: [] };
  const t0 = Date.now();
  throwsCode(() => validateReviewInput(many), "too much work");
  assert.ok(Date.now() - t0 < 2000, "refused before the planner runs");
  const wide = fresh();
  for (const d of reviewSpan("2026-10").days.slice(0, 7)) wide.base[d] = { on: [], off: [], unknownNotes: Object.fromEntries(Array.from({ length: 400 }, (_, i) => ["k" + i, { note: "x".repeat(LIMITS.string) }])) };
  throwsCode(() => validateReviewInput(wide), "too large");
  const longKey = fresh(); longKey.base[day14] = { on: [], off: [], absences: { ["k".repeat(LIMITS.key + 1)]: {} } };
  throwsCode(() => validateReviewInput(longKey), "key too long");
});

test("the hash is held to more than two easy answers", () => {
  const real = sha256;
  const i = fresh();
  const latin1 = (t) => createHash("sha256").update(Buffer.from(t, "latin1")).digest("hex");
  throwsCode(() => reviewMonth(i, { sha256: latin1 }), "hash");
  throwsCode(() => reviewMonth(i, { sha256: (t) => (t.length < 56 ? real(t) : "f".repeat(64)) }), "hash");
  throwsCode(() => reviewMonth(i, { sha256: (t) => (t.length < 64 ? real(t) : real(t.slice(0, 63))) }), "hash");
  const short = new Set(["abc", ""]);
  const specialised = (t) => (short.has(t) ? real(t) : "not hex");
  throwsCode(() => reviewMonth(i, { sha256: specialised }), "hash");
  const easy = (t) => (["abc", ""].includes(t) ? real(t) : "z".repeat(64));
  throwsCode(() => reviewMonth(i, { sha256: easy }), "hash");
  // a correct hash that answers differently the second time about the real input is refused when it is used
  let calls = 0;
  const vectors = new Set(["abc", "", "José", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "a".repeat(1000), "b".repeat(55), "b".repeat(56), "b".repeat(64), "€uro €"]);
  const drifting = (t) => (vectors.has(t) ? real(t) : (++calls % 2 ? real(t) : real(t + " ")));
  throwsCode(() => reviewMonth(i, { sha256: drifting }), "hash");
  assert.doesNotThrow(() => reviewMonth(i, { sha256: real }));
});

test("export proves itself against the live planner, and a verified match returns no rows", () => {
  // a base store changed after the planner was made cannot be represented: refused, not quietly different
  const ctx = make();
  ctx.stores[0].memberships = [];
  throwsCode(() => exportReviewInput({ planner: ctx.planner, stores: ctx.stores, storeId: ctx.stores[0].id, month: "2026-10", assignmentForDay: ctx.assign }), "parity");
  // a falsy answer from assignmentForDay is "no assignment", as in the planner
  const falsy = make((d) => (d === day14 ? 0 : d === "2026-10-15" ? false : d === "2026-10-16" ? "" : fixtureAssignments(d, 0)));
  const i = input(falsy, "2026-10");
  assert.equal(i.base[day14], null);
  assert.equal(reviewMonth(i).legacyFingerprint, JSON.stringify(falsy.planner.rows(0, "2026-10")));
  const r = reviewMonth(i, { sha256 });
  const verified = verifyReview(i, { definition: REVIEW_DEFINITION, digest: r.digest }, { sha256 });
  assert.deepEqual(Object.keys(verified).sort(), ["digest", "ok", "openIssues"]);
  assert.equal(verified.openIssues, r.openIssues);
  // like rows(), export creates the month's draft; that is the planner's own behaviour
  const bare = make();
  assert.equal(bare.planner.drafts.size, 0);
  input(bare, "2026-10");
  assert.ok(bare.planner.drafts.size >= 1);
});
