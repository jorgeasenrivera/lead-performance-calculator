/**
 * The lot boundary, and a phone that is not sure where it is.
 * -------------------------------------------------------------------------
 * A phone's own accuracy is routinely tens of metres, so "outside the fence" and
 * "probably outside the fence" are different answers and only one of them is
 * worth acting on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, metersBetween, metersToEdge, watchCircle, readingVerdict, settle }
  from "../api/_geofence.mjs";

// A real-ish dealership: an L-shaped lot in Winter Park, service drive cut out.
const LOT = [
  { lat: 28.5980, lng: -81.3510 },
  { lat: 28.5980, lng: -81.3495 },
  { lat: 28.5972, lng: -81.3495 },
  { lat: 28.5972, lng: -81.3503 },
  { lat: 28.5966, lng: -81.3503 },
  { lat: 28.5966, lng: -81.3510 },
];
const fence = { ring: LOT };
const mid  = { lat: 28.5976, lng: -81.3502 };            // 44m from the nearest edge
const near = { lat: 28.5976, lng: -81.3507 };            // only 29m from the west edge
const road = { lat: 28.5990, lng: -81.3502 };           // up the road, clearly off
const notch = { lat: 28.5968, lng: -81.3498 };          // inside the L's bite: NOT on the lot

// ---- geometry ----
assert.ok(
      pointInPolygon(mid, LOT));
assert.ok(
      !pointInPolygon(road, LOT));
assert.ok(
      !pointInPolygon(notch, LOT), notch);
test("distances come back in metres", () => {
    const span = metersBetween({lat:28.5980,lng:-81.3510},{lat:28.5980,lng:-81.3495});
    assert.ok(
      span > 140 && span < 150, Math.round(span));
});
assert.ok(
      metersBetween({lat:28.6,lng:-81.35},{lat:28.6,lng:-81.34}) < metersBetween({lat:28.6,lng:-81.35},{lat:28.61,lng:-81.35}));

// ---- the circle the phone watches ----
test("the circle the phone watches", () => {
    const c = watchCircle(LOT);
    assert.ok(
      LOT.every(p => metersBetween(c, p) <= c.radius), c);
    assert.ok(
      c.radius > LOT.reduce((m,p)=>Math.max(m, metersBetween(c,p)),0) + 50, c);
});

// ---- drift: the thing that would wrongly punish people ----
test("drift: the thing that would wrongly punish people", () => {
    const edgePt = { lat: 28.59801, lng: -81.3502, accuracy: 30 };   // just outside, sloppy fix
    assert.ok(
      readingVerdict(edgePt, fence) === "unsure", readingVerdict(edgePt, fence));
    assert.ok(
      readingVerdict({ ...edgePt, accuracy: 2 }, fence) === "unsure",
          readingVerdict({ ...edgePt, accuracy: 2 }, fence));
    assert.ok(
      readingVerdict({ lat: 28.5985, lng: -81.3502, accuracy: 5 }, fence) === "out",
          readingVerdict({ lat: 28.5985, lng: -81.3502, accuracy: 5 }, fence));
    assert.ok(
      readingVerdict({ ...road, accuracy: 900 }, fence) === "unsure");
    assert.ok(
      readingVerdict({ ...road }, fence) === "unsure");
    assert.ok(
      readingVerdict({ ...mid, accuracy: 25 }, fence) === "in");
    assert.ok(
      readingVerdict({ ...near, accuracy: 25 }, fence) === "unsure");
    assert.ok(
      readingVerdict({ ...road, accuracy: 25 }, fence) === "out");
});

// ---- nobody moves on one reading ----
test("nobody moves on one reading", () => {
    const t0 = Date.UTC(2026,7,20,17,0,0);
    let st = { where: "in", runVerdict: null, runCount: 0, runSince: null };
    st = settle(st, { ...road, accuracy: 5 }, fence, t0);
    assert.ok(
      st.crossed === null && st.where === "in", st);
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 1000);
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 2000);
    assert.ok(
      st.crossed === null, st);
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 95_000);
    assert.ok(
      st.crossed === "left", st);
    assert.ok(
      st.where === "out", st);
});

// ---- walking past a window does not count ----
test("walking past a window does not count", () => {
    const t0 = Date.UTC(2026,7,20,17,0,0);
    let st = { where: "in" };
    st = settle(st, { ...road, accuracy: 5 }, fence, t0);
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 20_000);
    st = settle(st, { ...mid,  accuracy: 5 }, fence, t0 + 40_000);      // back inside
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 60_000);
    assert.ok(
      st.crossed === null && st.where === "in", st);
});

// ---- coming back ----
test("coming back", () => {
    const t0 = Date.UTC(2026,7,20,18,0,0);
    let st = { where: "out" };
    for (const dt of [0, 1000, 95_000]) st = settle(st, { ...mid, accuracy: 6 }, fence, t0 + dt);
    assert.ok(
      st.crossed === "returned", st);
});

// ---- a phone waking up already on the lot is not an arrival ----
test("a phone waking up already on the lot is not an arrival", () => {
    const t0 = Date.UTC(2026,7,20,15,0,0);
    let st = null;
    for (const dt of [0, 1000, 95_000]) st = settle(st, { ...mid, accuracy: 6 }, fence, t0 + dt);
    assert.ok(
      st.crossed === null && st.where === "in", st);
});

// ---- an unsure reading never disturbs a settled run ----
test("an unsure reading never disturbs a settled run", () => {
    const t0 = Date.UTC(2026,7,20,17,0,0);
    let st = { where: "in" };
    st = settle(st, { ...road, accuracy: 5 }, fence, t0);
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 30_000);
    st = settle(st, { lat: 28.59801, lng: -81.3502, accuracy: 40 }, fence, t0 + 60_000);  // unsure
    st = settle(st, { ...road, accuracy: 5 }, fence, t0 + 95_000);
    assert.ok(
      st.crossed === "left", st);
});

// ---- no fence set: nothing is ever decided ----
test("no fence set: nothing is ever decided", () => {
    assert.ok(
      readingVerdict({ ...road, accuracy: 5 }, { ring: [] }) === "unsure");
    assert.ok(
      settle({ where:"in" }, { ...road, accuracy: 5 }, { ring: [] }, 1).crossed === null);
});
