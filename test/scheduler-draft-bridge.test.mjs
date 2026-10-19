/**
 * The editor's draft bridge: detached per-month state, a saved baseline per month that moves only to what was
 * submitted, change notices, and hydration that checks everything first. Every record is synthetic, nothing here
 * sends, stores or reads from anywhere, and the codec is the test's own stand-in: this file defines no wire format.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanner } from "../scripts/scheduler-performance/month-model.mjs";
import { mountMonthApp } from "../scripts/scheduler-performance/month-app-core.mjs";

const SOURCE = { on: ["b"], off: ["a"], absences: { a: { kind: "legacy-off", source: { file: "original.csv", line: 4 } } }, teamSnapshot: { a: { teamIds: ["old"], unknown: false } }, shifts: [{ personId: "b", startMinute: 540, endMinute: 600 }], unknownNotes: { c: { source: "keep" } }, generationLocks: ["b"] };
const people = () => ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), off: [], start: 9, end: 17, maxHours: 40 }));
const baseStore = () => ({
  id: "store-a", name: "Store A", timezone: "America/New_York", people: people(),
  rules: [{ effective: "2014-01-01", open: 9, close: 17, minimum: 1, closedDays: [], holidays: {} }],
  history: [], teams: [{ id: "old", name: "Old" }, { id: "new", name: "New" }],
  memberships: [{ storeId: "store-a", personId: "a", teamIds: ["old"], from: "2014-01-01", to: "2026-11-30" }, { storeId: "store-a", personId: "a", teamIds: ["new"], from: "2026-12-01", to: "2100-12-31" }],
});
const make = () => createPlanner([baseStore()], { assignmentForDay: (day) => (day === "2026-11-30" ? SOURCE : null) });
// The editor wraps the draft map's `set` to give each NEW month its own roster; this does the same, with a roster of
// people who have no availability, so a hydration that went through it would show.
const withSeededRoster = (planner) => {
  const set = planner.drafts.set.bind(planner.drafts);
  planner.drafts.set = (key, draft) => {
    if (!planner.drafts.has(key)) draft.store.people = people().map((p) => ({ ...p, start: null, end: null, maxHours: null, off: null }));
    return set(key, draft);
  };
  return planner;
};
const allow = (projection) => projection;
const EDIT = { on: ["b"], off: ["a"] };
const SHAPE_KEYS = ["month", "overrides", "storeId", "store"].sort();

test("an export is exactly the persistable shape, a copy, and leaves out what is not saved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const d = p.get(0, "2026-11");
  d.accepted = true; d.reviewFingerprint = "fp";
  const { projection, token } = p.exportMonth(0, "2026-11");
  assert.deepEqual(Object.keys(projection).sort(), SHAPE_KEYS);
  assert.deepEqual(Object.keys(projection.store).sort(), ["memberships", "people", "rules", "teams", "timezone"]);
  assert.equal(projection.storeId, "store-a");
  assert.equal(projection.month, "2026-11");
  assert.ok(projection.overrides["2026-11-10"]);
  assert.equal(JSON.stringify(projection).includes("reviewFingerprint"), false);
  assert.equal(JSON.stringify(projection).includes("accepted"), false);
  assert.equal(Object.isFrozen(token), true);
  // Detached both ways.
  projection.overrides["2026-11-10"].on.push("zz");
  projection.store.people[0].name = "changed";
  assert.deepEqual(p.get(0, "2026-11").overrides["2026-11-10"].on, ["b"]);
  assert.equal(p.get(0, "2026-11").store.people[0].name, "A");
  const again = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);
  assert.equal(again.projection.overrides["2026-11-11"], undefined);
});

test("unsaved means different from what was saved, not edited at some point", () => {
  const p = make();
  assert.equal(p.unsaved, false);
  p.get(0, "2026-11");
  assert.equal(p.unsaved, false, "looking at a month changes nothing");
  p.setAssignment(0, "2026-11-10", EDIT);
  assert.equal(p.unsaved, true);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"]);
  p.reset(0, "2026-11");
  assert.equal(p.unsaved, false, "put back as it began, it is clean");
});

test("an acknowledgment moves the baseline to exactly what was submitted, and edits made during the save stay unsaved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const first = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);   // typed while the first was being sent
  const ok = p.acknowledgeMonth(0, "2026-11", first.token);
  assert.equal(ok.ok, true);
  assert.equal(ok.clean, false);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"], "the later edit is still unsaved");
  const second = p.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", second.token).clean, true);
  assert.equal(p.unsaved, false);
  // Edited back past the baseline is unsaved again.
  p.reset(0, "2026-11");
  assert.equal(p.unsaved, true, "the saved state had two edits; none is different");
});

test("stale, out-of-order, unknown and wrong-scope acknowledgments change nothing", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const older = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-11", EDIT);
  const newer = p.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", newer.token).ok, true);
  const before = JSON.stringify(p.draftStatus(0));
  assert.deepEqual(p.acknowledgeMonth(0, "2026-11", older.token), { ok: false, reason: "stale" });
  assert.deepEqual(p.acknowledgeMonth(0, "2026-11", { ...newer.token }).reason, "unknown-submission", "a copy of a token is not the token");
  assert.equal(p.acknowledgeMonth(0, "2026-11", null).reason, "unknown-submission");
  const other = make();
  other.setAssignment(0, "2026-11-10", EDIT);
  const foreign = other.exportMonth(0, "2026-11");
  assert.equal(p.acknowledgeMonth(0, "2026-11", foreign.token).reason, "unknown-submission", "another planner's token");
  p.setAssignment(0, "2026-12-03", EDIT);
  const dec = p.exportMonth(0, "2026-12");
  assert.equal(p.acknowledgeMonth(0, "2026-11", dec.token).reason, "wrong-scope", "December's token does not save November");
  assert.equal(JSON.stringify(p.draftStatus(0).dirtyMonths), JSON.stringify(["2026-12"]));
  assert.notEqual(before, "", "nothing above threw");
});

test("changes are announced with a rising token, a listener's failure is its own, and unsubscribing stops them", () => {
  const p = make();
  const seen = [];
  const off = p.subscribe((e) => seen.push(e));
  p.subscribe(() => { throw new Error("listener broke"); });
  p.setAssignment(0, "2026-11-10", EDIT);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].months, [{ index: 0, month: "2026-11" }]);
  p.setAssignment(0, "2026-11-11", EDIT);
  assert.ok(seen[1].token > seen[0].token);
  off();
  p.setAssignment(0, "2026-11-12", EDIT);
  assert.equal(seen.length, 2);
  // A change that was made to the draft directly is noticed when asked.
  const quiet = make();
  const heard = [];
  quiet.subscribe((e) => heard.push(e));
  quiet.get(0, "2026-11").store.people[0].start = 10;
  assert.equal(heard.length, 0);
  quiet.observe();
  assert.equal(heard.length, 1);
  assert.equal(quiet.unsaved, true);
});

test("hydration needs the caller's codec and refuses without changing anything when it, or the shape, says no", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const { projection } = p.exportMonth(0, "2026-12");
  const snapshot = () => JSON.stringify([p.exportMonth(0, "2026-11").projection, p.exportMonth(0, "2026-12").projection, p.draftStatus(0)]);
  const before = snapshot();
  assert.equal(p.hydrateMonth(0, projection, undefined).reason, "codec-missing");
  assert.equal(p.hydrateMonth(0, projection, () => false).reason, "codec-refused");
  assert.equal(p.hydrateMonth(0, projection, () => { throw new Error("no"); }).reason, "codec-refused");
  const bad = (change, reason) => assert.equal(p.hydrateMonth(0, change(structuredClone(projection)), allow).reason, reason, reason);
  bad((x) => ({ ...x, extra: 1 }), "shape");
  bad((x) => { delete x.overrides; return x; }, "shape");
  bad((x) => ({ ...x, storeId: "store-b" }), "scope");
  bad((x) => ({ ...x, month: "2026-13" }), "shape");
  bad((x) => ({ ...x, overrides: { "2026-11-05": EDIT } }), "shape");   // a day outside the month
  bad((x) => ({ ...x, overrides: { "2026-12-05": 5 } }), "shape");
  bad((x) => { x.store.people.push({ ...x.store.people[0] }); return x; }, "shape");   // duplicate id
  bad((x) => { x.store.timezone = "Not/AZone"; return x; }, "shape");
  bad((x) => { x.store.extra = 1; return x; }, "shape");
  bad((x) => ({ ...x, store: { ...x.store, people: "none" } }), "shape");
  assert.equal(p.hydrateMonth(0, () => {}, allow).ok, false, "a value that cannot be copied");
  assert.equal(p.hydrateMonth(5, projection, allow).reason, "scope", "no such store");
  assert.equal(snapshot(), before, "nothing was changed by any refusal");
});

test("a hydrated month is a copy of what the caller gave, and the codec's own answer is what is used", () => {
  const p = make();
  const { projection } = make().exportMonth(0, "2026-12");
  projection.overrides["2026-12-02"] = { on: ["a"], off: ["b"] };
  const given = structuredClone(projection);
  const result = p.hydrateMonth(0, projection, (x) => { const y = structuredClone(x); y.overrides["2026-12-03"] = { on: ["c"], off: [] }; return y; });
  assert.equal(result.ok, true);
  projection.overrides["2026-12-02"].on.push("hijack");
  assert.deepEqual(p.get(0, "2026-12").overrides["2026-12-02"], given.overrides["2026-12-02"], "later changes to the caller's object do not reach the planner");
  assert.ok(p.get(0, "2026-12").overrides["2026-12-03"], "the codec's normalized value was taken");
  assert.equal(p.unsaved, false, "a month just loaded is not unsaved");
  assert.equal(p.draftStatus(0).dirtyMonths.length, 0);
  assert.equal(p.revision, 0, "loading is not an edit");
});

test("hydration keeps saved availability; months nobody saved still get the editor's seeded roster", () => {
  const p = withSeededRoster(make());
  const saved = baseStore();
  saved.people = saved.people.map((x, i) => ({ ...x, start: 8 + i, end: 12 + i, maxHours: 20 + i, off: ["2026-12-24"] }));
  const projection = { storeId: "store-a", month: "2026-12", store: { people: saved.people, rules: saved.rules, teams: saved.teams, memberships: saved.memberships, timezone: "America/New_York" }, overrides: {} };
  const out = p.hydrateMonth(0, projection, allow);
  assert.equal(out.ok, true);
  const got = p.get(0, "2026-12").store.people;
  assert.deepEqual(got.map((x) => [x.start, x.end, x.maxHours, x.off]), saved.people.map((x) => [x.start, x.end, x.maxHours, x.off]), "availability survived");
  assert.deepEqual(p.exportMonth(0, "2026-12").projection.store.people, saved.people);
  const fresh = p.get(0, "2026-10").store.people;
  assert.equal(fresh[0].start, null, "a month that was never saved is seeded as before");
});

test("hydration will not overwrite a month that has unsaved changes", () => {
  const p = make();
  const { projection } = p.exportMonth(0, "2026-11");
  p.setAssignment(0, "2026-11-10", EDIT);
  const before = JSON.stringify(p.exportMonth(0, "2026-11").projection);
  assert.equal(p.hydrateMonth(0, projection, allow).reason, "unsaved-changes");
  assert.equal(JSON.stringify(p.exportMonth(0, "2026-11").projection), before);
});

test("shared teams change every month, none is saved by another's success, and the boundary is stated", () => {
  const p = make();
  p.get(0, "2026-10"); p.get(0, "2026-11"); p.get(0, "2026-12");
  assert.equal(p.unsaved, false);
  const events = [];
  p.subscribe((e) => events.push(e));
  p.addTeam(0, "Third");
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-10", "2026-11", "2026-12"], "every month that has a draft carries the new team");
  assert.equal(events.length, 1);
  assert.equal(events[0].months.length, 3);
  const status = p.draftStatus(0);
  assert.equal(status.atomic, false);
  assert.deepEqual(status.unresolved.map((u) => [u.reason, u.months, u.complete]), [["shared-teams", ["2026-10", "2026-11", "2026-12"], false]]);
  const oct = p.exportMonth(0, "2026-10");
  assert.deepEqual(oct.token.linked, ["2026-11", "2026-12"]);
  const ack = p.acknowledgeMonth(0, "2026-10", oct.token);
  assert.equal(ack.clean, true);
  assert.deepEqual(ack.stillLinked, ["2026-11", "2026-12"], "October's success does not stand for the others");
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11", "2026-12"]);
  for (const m of ["2026-11", "2026-12"]) p.acknowledgeMonth(0, m, p.exportMonth(0, m).token);
  assert.deepEqual(p.draftStatus(0).unresolved, []);
  assert.equal(p.unsaved, false);
});

test("a move across a month boundary is two unsaved months until each is acknowledged", () => {
  const p = make();
  const undo = p.applyOffDay(p.reviewOffDay({ index: 0, personId: "a", from: "2026-11-30", to: "2026-12-01", mode: "move" }));
  assert.ok(undo);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11", "2026-12"]);
  const nov = p.exportMonth(0, "2026-11");
  assert.deepEqual(nov.token.linked, ["2026-12"]);
  const ack = p.acknowledgeMonth(0, "2026-11", nov.token);
  assert.equal(ack.clean, true);
  assert.deepEqual(ack.stillLinked, ["2026-12"]);
  const status = p.draftStatus(0);
  assert.deepEqual(status.dirtyMonths, ["2026-12"], "the other month keeps its change");
  assert.equal(status.atomic, false);
  assert.deepEqual(status.unresolved.map((u) => [u.reason, u.complete]), [["cross-month-move", false]]);
  p.acknowledgeMonth(0, "2026-12", p.exportMonth(0, "2026-12").token);
  assert.deepEqual(p.draftStatus(0).unresolved, []);
});

test("saved teams from one month are not written under another month that is unsaved or already saved", () => {
  const p = make();
  const decExport = make().exportMonth(0, "2026-12").projection;
  p.setAssignment(0, "2026-11-10", EDIT);                       // November is unsaved
  const different = structuredClone(decExport);
  different.store.teams = [{ id: "old", name: "Old" }, { id: "other", name: "Other" }];
  different.store.memberships = different.store.memberships.map((m) => ({ ...m, teamIds: ["old"] }));
  const before = JSON.stringify([p.teamState[0], p.draftStatus(0)]);
  assert.equal(p.hydrateMonth(0, different, allow).reason, "shared-teams");
  assert.equal(JSON.stringify([p.teamState[0], p.draftStatus(0)]), before);
  // The same teams are fine.
  assert.equal(p.hydrateMonth(0, decExport, allow).ok, true);
  assert.deepEqual(p.draftStatus(0).dirtyMonths, ["2026-11"], "November's own edit is untouched");
  // With nothing else depending on them, different teams are simply what the store has.
  const q = make();
  q.get(0, "2026-10");
  assert.equal(q.hydrateMonth(0, different, allow).ok, true);
  assert.deepEqual(q.teamState[0].teams.map((t) => t.id), ["old", "other"]);
  assert.equal(q.unsaved, false, "a month that was only ever as it began is still clean under the loaded teams");
});

test("a month that goes away with its editor leaves nothing behind that could be saved", () => {
  const p = make();
  p.setAssignment(0, "2026-11-10", EDIT);
  const { token } = p.exportMonth(0, "2026-11");
  // A fresh planner (a reopened editor) does not know the old one's tokens.
  const reopened = make();
  reopened.get(0, "2026-11");
  assert.equal(reopened.acknowledgeMonth(0, "2026-11", token).reason, "unknown-submission");
  assert.equal(reopened.unsaved, false);
});

test("the editor refuses a codec that cannot verify, and takes no default", () => {
  const root = { nodeType: 1 };
  const base = { root, stores: [baseStore()], assignmentForDay: () => null };
  for (const bad of [null, 5, {}, { verify: "x" }]) assert.throws(() => mountMonthApp({ ...base, draftCodec: bad }), /draftCodec needs a verify function/);
});

test("what is inside the lists is checked here too, so a lax codec cannot poison the planner", () => {
  const p = make();
  const { projection } = p.exportMonth(0, "2026-12");
  const lax = () => true;
  const before = JSON.stringify([p.teamState[0], p.exportMonth(0, "2026-12").projection]);
  const bad = (change, why) => assert.equal(p.hydrateMonth(0, change(structuredClone(projection)), lax).reason, "shape", why);
  bad((x) => { x.store.rules = [null]; return x; }, "a rule that is not an object");
  bad((x) => { x.store.rules = [{ open: 9 }]; return x; }, "a rule with no effective date");
  bad((x) => { x.store.memberships = [7]; return x; }, "a membership that is not an object");
  bad((x) => { x.store.teams = [{ id: "x" }]; return x; }, "a team with no name");
  bad((x) => { x.store.teams.push({ ...x.store.teams[0] }); return x; }, "a duplicate team");
  bad((x) => { x.store.memberships[0].personId = ""; return x; }, "a membership with no person");
  bad((x) => { x.store.memberships[0].teamIds = ["unknown"]; return x; }, "a membership in a team that is not there");
  bad((x) => { x.store.memberships[0].storeId = "store-b"; return x; }, "a membership for another store");
  assert.equal(JSON.stringify([p.teamState[0], p.exportMonth(0, "2026-12").projection]), before, "nothing was taken in");
  assert.doesNotThrow(() => p.rows(0, "2026-12"));
});

test("a move that made its own months is clean again once it is undone, and notices the changes it made", () => {
  const p = make();
  const heard = [];
  p.subscribe((e) => heard.push(e.months.map((m) => m.month).sort().join()));
  const undo = p.applyOffDay(p.reviewOffDay({ index: 0, personId: "a", from: "2026-11-30", to: "2026-12-01", mode: "move" }));
  assert.deepEqual(heard, ["2026-11,2026-12"]);
  assert.equal(p.unsaved, true);
  p.undoOffDay(undo);
  assert.equal(p.unsaved, false, "the months began without those days");
  assert.deepEqual(p.draftStatus(0).unresolved, []);
});

test("a membership for someone who is not on that month's roster is saved data, and a hydrated member does not hide its dirty partner", () => {
  const p = make();
  const { projection } = make().exportMonth(0, "2026-03");
  projection.store.memberships.push({ storeId: "store-a", personId: "left-in-february", teamIds: ["old"], from: "2014-01-01", to: "2026-02-28" });
  assert.equal(p.hydrateMonth(0, projection, allow).ok, true);
  // A group of two months; one of them is loaded from saved state while the other is still unsaved.
  const q = make();
  q.get(0, "2026-10"); q.get(0, "2026-11");
  q.addTeam(0, "Third");
  const clean = q.exportMonth(0, "2026-10");
  q.acknowledgeMonth(0, "2026-10", clean.token);
  assert.deepEqual(q.draftStatus(0).dirtyMonths, ["2026-11"]);
  assert.equal(q.hydrateMonth(0, clean.projection, allow).ok, true);
  assert.deepEqual(q.draftStatus(0).unresolved.map((u) => u.months), [["2026-10", "2026-11"]], "the boundary is still stated");
});
