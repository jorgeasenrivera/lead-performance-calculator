/**
 * Where a store's figures live, and which of them travel.
 * -------------------------------------------------------------------------
 * Both the app and the pipeline write these rows. When the two lists of fields
 * disagreed, a report landed differently depending on how it arrived, and said
 * nothing about it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as K from "../api/_store-keys.mjs";
// The rows both sides write, and the two drifts that were live before this file.

// ---- the drift that half-shipped the visits feature ----
test("the drift that half-shipped the visits feature", () => {
    const day = { "fin smith": { calls: 10, visits: 3, units: 2, opps: 40, uploadedAt: "t" } };
    const slim = K.slimFloorStats(day);
    assert.ok(
      slim["fin smith"].visits === 3, slim);
    assert.ok(
      slim["fin smith"].calls === 10 && slim["fin smith"].units === 2, slim);
    assert.ok(
      slim["fin smith"].opps === undefined, slim);
});
test("a day with no visit figure stays silent about it", () => {
    // A day from before the column existed must not gain a fabricated zero.
    const slim = K.slimFloorStats({ "fin smith": { calls: 10 } });
    assert.ok(
      !("visits" in slim["fin smith"]), slim);
});
test("an empty day slims to an empty object", () => {
    assert.ok(
      Object.keys(K.slimFloorStats({})).length === 0);
    assert.ok(
      Object.keys(K.slimFloorStats(null)).length === 0);
    assert.ok(
      Object.keys(K.slimFloorStats({ a: null })).length === 0);
});

// ---- the drift that published a board without its lead counts ----
test("the drift that published a board without its lead counts", () => {
    for (const f of ["internetLeads", "phoneLeads", "showroomLeads"]) {
      assert.ok(
      K.BOARD_STAT_FIELDS.includes(f), K.BOARD_STAT_FIELDS);
    }
    assert.ok(
      ["internetUnits", "internetPct", "phoneUnits", "campaignUnits", "prevUnits"]
            .every((f) => K.BOARD_STAT_FIELDS.includes(f)), K.BOARD_STAT_FIELDS);
    const slim = K.slimTo(K.BOARD_STAT_FIELDS, { "fin smith": { internetUnits: 5, internetLeads: 110, pin: "4821" } });
    assert.ok(
      slim["fin smith"].pin === undefined, slim);
});

// ---- the keys themselves ----
test("the keys themselves", () => {
    assert.ok(
      K.storeKey("classic-mazda") === "lpc:store:classic-mazda:v2");
    assert.ok(
      K.actKey("classic-mazda", "2026-08-19") === "lpc:store:classic-mazda:act:2026-08-19");
    assert.ok(
      K.floorStatsKey("classic-mazda", "2026-08-19") === "lpc:board:classic-mazda:act:2026-08-19");
    assert.ok(
      K.boardKey("classic-mazda") === "lpc:board:classic-mazda:v1");
    assert.ok(
      K.storeKey("a") !== K.storeKey("b"));
    assert.ok(
      K.actKey("a", "2026-08-19") !== K.actKey("a", "2026-08-20"));
});
