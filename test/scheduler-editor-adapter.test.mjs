/**
 * The editor adapter, held to real ids and honest gaps: it binds the planner to the store it was
 * handed, invents no people, teams, hours or shifts, and refuses a mismatched store or a clock it cannot read.
 * Every record here is synthetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToday, editorStore, assignmentResolver, editorProps, EditorInputError } from "../src/scheduler-editor-adapter.mjs";
import { mountMonthApp } from "../scripts/scheduler-performance/month-app-core.mjs";
import { createPlanner } from "../scripts/scheduler-performance/month-model.mjs";

const NY = "America/New_York";
const store = { id: "store-a", name: "Store A" };
const data = (extra = {}) => ({
  __storeId: "store-a",
  roster: [
    { id: "r1", name: "Rae", roleId: "sales" },
    { id: "r2", name: "Sam", roleId: "sales", hiredAt: "2026-10-10" },
    { id: "r3", name: "Tia", roleId: "sales" },
    { id: "bad", name: "No role" },
  ],
  departed: [{ id: "r3", at: "2026-10-12" }],
  daysOff: { r1: ["2026-10-05"], r2: ["2026-10-05", "2026-10-12"], r3: ["2026-10-13"] },
  forcedOff: {}, presentAnyway: {}, scheduleSource: {},
  ...extra,
});

test("the clock is the store's zone, and an unreadable zone or instant is null", () => {
  assert.equal(zonedToday(NY, new Date("2026-10-14T02:00:00Z")), "2026-10-13");
  assert.equal(zonedToday("Pacific/Auckland", new Date("2026-10-14T02:00:00Z")), "2026-10-14");
  for (const zone of [undefined, null, "", "Not/AZone", 5]) assert.equal(zonedToday(zone), null);
  assert.equal(zonedToday(NY, new Date("nope")), null);
  assert.equal(zonedToday(NY, "2026-10-14"), null);
});

test("people are the roster's real ids, first record wins, nothing about them is invented", () => {
  const s = editorStore(store, data({ roster: [...data().roster, { id: "r1", name: "Other", roleId: "x" }] }), NY);
  assert.deepEqual(s.people.map((p) => p.id), ["r1", "r2", "r3"]);
  assert.equal(s.people[0].name, "Rae");
  for (const p of s.people) assert.deepEqual([p.off, p.start, p.end, p.maxHours], [null, null, null, null]);
  assert.deepEqual([s.rules, s.history, s.teams, s.memberships], [[], [], [], []]);
  assert.equal(s.timezone, NY);
  assert.equal(JSON.stringify(s).includes("p0"), false, "no fixture person");
  assert.throws(() => editorStore({ id: "bad id!" }, data()), (e) => e instanceof EditorInputError && e.code === "store");
  assert.throws(() => editorStore({ id: "x" }, { roster: Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, roleId: "r" })) }), (e) => e.code === "roster");
  assert.deepEqual(editorStore(store, undefined).people, []);
});

test("people who are not employed in the month the editor opens are left out, and never reach the planner as strangers", () => {
  const d = data({ departed: [{ id: "r3", at: "2026-09-20" }], roster: [...data().roster, { id: "late", name: "Late", roleId: "sales", hiredAt: "2026-11-02" }], daysOff: { r3: ["2026-10-13"], r1: ["2026-10-05"] } });
  const oct = editorStore(store, d, NY, "2026-10-14");
  assert.deepEqual(oct.people.map((p) => p.id), ["r1", "r2"], "r3 left in September; Late starts in November");
  const props = editorProps({ store, data: d, timezone: NY, now: new Date("2026-10-14T16:00:00Z") });
  assert.deepEqual(props.stores[0].people.map((p) => p.id), ["r1", "r2"]);
  assert.deepEqual(props.assignmentForDay("2026-10-05", 0), { on: [], off: ["r1"] });
  assert.equal(props.assignmentForDay("2026-09-15", 0), null);
  const nov = editorStore(store, d, NY, "2026-11-03");
  assert.deepEqual(nov.people.map((p) => p.id), ["r1", "r2", "late"]);
  assert.deepEqual(editorStore(store, d, NY).people.map((p) => p.id), ["r1", "r2", "r3", "late"], "with no date nothing is judged");
});

test("the planner takes the store as given: no Oak, no Pine, no fixture people, even with nothing in the roster", () => {
  for (const d of [data(), { __storeId: "store-a" }]) {
    const stores = [editorStore(store, d, NY)];
    const planner = createPlanner(stores, { assignmentForDay: () => null });
    const draft = planner.get(0, "2026-10");
    assert.deepEqual(draft.store.teams, []);
    assert.deepEqual(draft.store.memberships, []);
    assert.deepEqual(draft.store.people.map((p) => p.id), stores[0].people.map((p) => p.id));
  }
});

test("who is off follows the app's rule and each person's employment, and a day with nobody off is unknown", () => {
  const resolve = assignmentResolver(data());
  assert.deepEqual(resolve("2026-10-05", 0), { on: [], off: ["r1"] }, "r2 was not hired yet");
  assert.deepEqual(resolve("2026-10-12", 0), { on: [], off: ["r2"] }, "r3 left that day but is not listed off");
  assert.equal(resolve("2026-10-13", 0), null, "r3 had left");
  assert.equal(resolve("2026-10-06", 0), null);
  assert.equal(resolve("2026-10-05", 1), null, "only the one store is known");
  for (const bad of ["", "2026-13-01", "2026-10-32", null, 5, undefined]) assert.equal(resolve(bad, 0), null);
  const worked = assignmentResolver(data(), { isOff: (_d, id, date) => !(id === "r1" && date === "2026-10-05") && id === "r2" && date === "2026-10-12" });
  assert.equal(worked("2026-10-05", 0), null, "the app's own rule can say somebody worked a listed day");
  assert.deepEqual(worked("2026-10-12", 0), { on: [], off: ["r2"] });
});

test("props are refused by name when the data is not this store's or the clock cannot be read", () => {
  const ok = editorProps({ store, data: data(), timezone: NY, now: new Date("2026-10-14T16:00:00Z") });
  assert.equal(ok.ok, true);
  assert.equal(ok.today(), "2026-10-14");
  assert.equal(ok.index, 0);
  assert.equal(editorProps({ store, data: data({ __storeId: "store-b" }), timezone: NY }).reason, "not-ready", "the last store's people are never shown");
  assert.equal(editorProps({ store, data: { roster: [] }, timezone: NY }).reason, "not-ready");
  assert.equal(editorProps({ store, data: data(), timezone: NY, ready: false }).reason, "not-ready");
  assert.equal(editorProps({ store, data: { roster: [] }, timezone: NY, ready: true }).ok, true, "the caller's own proof stands in for the mask");
  assert.equal(editorProps({ store, data: data() }).reason, "timezone");
  assert.equal(editorProps({ store, data: data(), timezone: "Bad/Zone" }).reason, "timezone");
  assert.equal(editorProps({ store: null, data: data(), timezone: NY }).reason, "store");
  assert.equal(editorProps({ store: { id: "has space" }, data: data(), timezone: NY }).reason, "store");
  assert.equal(editorProps().reason, "store");
});

test("the clock is asked again each time and for the store on screen", () => {
  let now = new Date("2026-10-14T03:00:00Z");
  const props = editorProps({ store, data: data(), timezone: NY, now: () => now });
  assert.equal(props.today(), "2026-10-13");
  now = new Date("2026-10-14T05:00:00Z");
  assert.equal(props.today(), "2026-10-14");
});

test("mounting refuses what it cannot bind, before it touches the page", () => {
  const root = { nodeType: 1 };
  const good = editorProps({ store, data: data(), timezone: NY });
  const base = { root, stores: good.stores, assignmentForDay: good.assignmentForDay };
  const bad = (o, pattern) => assert.throws(() => mountMonthApp(o), pattern);
  bad(undefined, /options/);
  bad({ ...base, root: null }, /root element/);
  bad({ ...base, root: { nodeType: 3 } }, /root element/);
  bad({ ...base, stores: [] }, /at least one store/);
  bad({ ...base, stores: "x" }, /at least one store/);
  bad({ ...base, stores: [{ id: "s", people: [], rules: [], history: [] }] }, /explicit teams and memberships/);
  bad({ ...base, stores: [{ ...good.stores[0], teams: undefined }] }, /explicit teams and memberships/);
  bad({ ...base, stores: [{ ...good.stores[0], memberships: null }] }, /explicit teams and memberships/);
  bad({ ...base, assignmentForDay: undefined }, /assignmentForDay/);
  bad({ ...base, index: 3 }, /not a store/);
  bad({ ...base, index: 0.5 }, /not a store/);
});

test("an id the editor could not write safely is refused, a throwing clock is no date, and a spaced name still matches its departure", () => {
  const odd = data({ roster: [...data().roster, { id: 'x" data-pwn="1', name: "Odd", roleId: "sales" }] });
  assert.equal(editorProps({ store, data: odd, timezone: NY }).reason, "roster");
  assert.throws(() => editorStore(store, odd, NY), (e) => e instanceof EditorInputError && e.code === "roster");
  assert.equal(editorProps({ store, data: data(), timezone: NY, now: () => { throw new RangeError("boom"); } }).reason, "timezone");
  const props = editorProps({ store, data: data(), timezone: NY, now: (() => { let n = 0; return () => { if (++n > 2) throw new Error("late"); return new Date("2026-10-14T16:00:00Z"); }; })() });
  assert.equal(props.ok, true);
  assert.throws(() => props.today(), (e) => e instanceof EditorInputError && e.code === "timezone");
  const spaced = data({ roster: [{ id: "q1", name: "Rae  Alder", roleId: "sales" }], departed: [{ name: "rae alder", at: "2026-09-01" }], daysOff: {} });
  assert.deepEqual(editorStore(store, spaced, NY, "2026-10-14").people, [], "the calendar's name match also collapses inner spaces");
});
