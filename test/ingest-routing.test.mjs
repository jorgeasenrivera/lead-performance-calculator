/**
 * One message, more than one dealership.
 * -------------------------------------------------------------------------
 * Classic Mazda spent a fortnight showing Drivers Mart Winter Park's
 * salespeople because the ingest had one store variable for a whole email.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchStoreByName } from "../api/_report-parsers.mjs";
// One email, two dealerships. Does each set of figures land in its own store?
import fs from "fs";
const SRC = "/home/user/lead-performance-calculator/api/ingest.mjs";
const all = fs.readFileSync(SRC, "utf8").split("\n");
const at = (n) => all.findIndex((l) => l.startsWith(n)) + 1;
const endOfBlock = (s) => { for (let i = s; i < all.length; i++) if (/^[}\)]/.test(all[i])) return i + 1; return s; };
const block = (n) => { const s = at(n); return all.slice(s - 1, endOfBlock(s)).join("\n"); };
const one = (n) => all[at(n) - 1];

const M = { ...new Function(block("function groupByStore(") + "\nreturn { groupByStore };")(),
            matchStoreByName };


const MAZDA = { id: "classic-mazda", name: "Classic Mazda" };
const DMWP  = { id: "drivers-mart-winter-park", name: "Drivers Mart Winter Park" };
const STORES = [MAZDA, DMWP, { id: "holler-hyundai", name: "Holler Hyundai/Genesis North Orlando" }];

// ---- the bug the user hit: two stores' reports in one message ----
test("the bug the user hit: two stores' reports in one message", () => {
    const entries = [
      { store: MAZDA, type: "delivery-summary", fileName: "mazda.pdf", rows: [["ds"], ["h"], ["Alejandro Marquez"]] },
      { store: DMWP,  type: "activity", fileName: "dmwp.pdf", rows: [["da"], ["h"], ["Jason Campion"], ["Mitch Marius"]] },
    ];
    const g = M.groupByStore(entries);
    assert.ok(
      g.size === 2, [...g.keys()]);
    const mz = g.get("classic-mazda"), dm = g.get("drivers-mart-winter-park");
    assert.ok(
      mz.entries.length === 1 && mz.entries[0].fileName === "mazda.pdf", mz.entries.map(e=>e.fileName));
    assert.ok(
      !JSON.stringify(mz.entries).includes("Jason Campion"), mz.entries);
    assert.ok(
      dm.entries.length === 1 && dm.entries[0].fileName === "dmwp.pdf", dm.entries.map(e=>e.fileName));
    assert.ok(
      !JSON.stringify(dm.entries).includes("Alejandro Marquez"), dm.entries);
});

// ---- the ordinary case must be untouched ----
test("the ordinary case must be untouched", () => {
    const g = M.groupByStore([
      { store: MAZDA, type: "activity", fileName: "a.pdf", rows: [] },
      { store: MAZDA, type: "delivery-summary", fileName: "b.pdf", rows: [] },
    ]);
    assert.ok(
      g.size === 1 && g.get("classic-mazda").entries.length === 2, [...g.keys()]);
});

// ---- an entry that does not know where it belongs is dropped, not guessed ----
test("an entry that does not know where it belongs is dropped, not guessed", () => {
    const g = M.groupByStore([{ store: null, type: "activity", fileName: "orphan.csv", rows: [] },
                              { store: MAZDA, type: "activity", fileName: "a.pdf", rows: [] }]);
    assert.ok(
      g.size === 1 && !JSON.stringify([...g.values()]).includes("orphan"), [...g.keys()]);
});
test("and an empty message groups to nothing", () => {
    assert.ok(
      M.groupByStore([]).size === 0);
    assert.ok(
      M.groupByStore(null).size === 0);
});

// ---- the store matcher must not reach across dealerships ----
test("the store matcher must not reach across dealerships", () => {
    assert.ok(
      M.matchStoreByName(STORES, "Drivers Mart Winter Visit Park") === null,
          M.matchStoreByName(STORES, "Drivers Mart Winter Visit Park"));
    assert.ok(
      M.matchStoreByName(STORES, "Drivers Mart Winter Park")?.store.id === "drivers-mart-winter-park");
    assert.ok(
      M.matchStoreByName(STORES, "Drivers Mart Winter Park")?.store.id !== "classic-mazda");
    assert.ok(
      M.matchStoreByName(STORES, "Classic Mazda Fin Smith")?.store.id === "classic-mazda");
    assert.ok(
      M.matchStoreByName(STORES, "Some Other Dealership") === null);
});

