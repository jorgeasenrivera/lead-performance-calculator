import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { norm } from "../api/_report-parsers.mjs";

const manager = await readFile(new URL("../src/Manager.jsx", import.meta.url), "utf8");
const core = await readFile(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const phone = manager.slice(manager.indexOf("function BoardRoomPhone("), manager.indexOf("\nfunction StoreHero("));
// Execute the production selector, including its actual memo dependencies.
const selector = phone.slice(phone.indexOf("  const q = norm(query);"), phone.indexOf("\n  const goalMonth ="));
assert.ok(selector.includes("const rows = useMemo"));
const select = new Function("people", "roleFilter", "limitOnly", "drill", "query", "norm", "useMemo", selector + "\nreturn rows;");
const person = (id, name, roleId, units, atLimit, state, pct) => ({ a: { id, name, roleId }, units, atLimit, five: [{ key: "engagedVideoPct", state }], st: { internetPct: pct } });
const people = [
  person("a", "Peter Tran", "sales", 8, false, "ok", .3),
  person("b", "Petra Lee", "sales", 12, true, "warn", .2),
  person("c", "Peter Alvarez", "internet", 10, true, "bad", .4),
  person("d", "Jo Lee", "sales", 12, false, "bad", null),
];
const rows = (query = "", { role = "sales", limit = false, drill = null, memo = (fn) => fn() } = {}) => select(people, role, limit, drill, query, norm, memo);
const ids = (list) => list.map((p) => p.a.id);

test("the existing manager search value reaches the phone board", () => {
  assert.match(core, /<BoardRoomPhone\b[^>]*query=\{assocQuery\}/);
  assert.match(phone, /^function BoardRoomPhone\([^\n]*query = ""/);
});

test("the legacy phone CSS cannot hide the search row before its mobile layout", () => {
  const legacyPhone = core.slice(core.indexOf("@media (max-width: 720px) {"), core.indexOf("@media (max-width: 640px) {"));
  assert.doesNotMatch(legacyPhone, /\.seg-wrap\s*\{[^}]*display\s*:\s*none/);
  assert.match(core, /\.seg-wrap \{ display:flex;/);
  assert.match(core, /\.seg-wrap \.seg \{ display:none; \}/);
  assert.match(core, /\.no-print, \.topbar, \.seg-wrap \{ display:none !important; \}/);
});

test("phone search normalizes case and whitespace and supports partial names", () => {
  assert.deepEqual(ids(rows("  pETer   tR ")), ["a"]);
  assert.deepEqual(ids(rows("pet")), ["b", "a"]);
  assert.deepEqual(ids(rows("absent")), []);
});

test("clearing search restores the original role list and units/name order", () => {
  const before = structuredClone(people);
  assert.deepEqual(ids(rows("pet")), ["b", "a"]);
  assert.deepEqual(ids(rows("")), ["d", "b", "a"]);
  assert.deepEqual(ids(rows("   ")), ["d", "b", "a"]);
  assert.deepEqual(people, before, "search and sorting do not mutate the full board data");
});

test("search intersects role, lead-cap and below-standard filters", () => {
  assert.deepEqual(ids(rows("peter", { role: "internet" })), ["c"]);
  assert.deepEqual(ids(rows("peter", { limit: true })), ["c"]);
  assert.deepEqual(ids(rows("pet", { drill: { kind: "below", id: "engagedVideoPct" } })), ["b"]);
  assert.deepEqual(ids(rows("peter", { role: null })), ["c", "a"]);
});

test("channel drill retains its channel ranking within the search results", () => {
  assert.deepEqual(ids(rows("pet", { role: null, drill: { kind: "channel", id: "internet" } })), ["c", "a", "b"]);
});

test("typing and clearing invalidate the actual memo even when board data is unchanged", () => {
  let last, result, calls = 0;
  const memo = (fn, deps) => {
    if (!last || deps.some((v, i) => !Object.is(v, last[i]))) { result = fn(); calls++; }
    last = deps;
    return result;
  };
  assert.deepEqual(ids(rows("pet", { memo })), ["b", "a"]);
  assert.deepEqual(ids(rows("peter", { memo })), ["a"]);
  assert.deepEqual(ids(rows(" PETER ", { memo })), ["a"]);
  assert.deepEqual(ids(rows("", { memo })), ["d", "b", "a"]);
  assert.equal(calls, 3);
});
