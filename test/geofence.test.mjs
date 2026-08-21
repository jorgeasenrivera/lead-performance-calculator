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

// ---- at the door: can this person join the line right now? ----
import { doorCheck } from "../api/_geofence.mjs";

const FENCE = { ring: LOT };
const onLot = { lat: 28.5976, lng: -81.3500, accuracy: 12 };
const downTheRoad = { lat: 28.6050, lng: -81.3400, accuracy: 12 };

test("somebody standing on the lot is let on", () => {
  const r = doorCheck(onLot, FENCE);
  assert.equal(r.allow, true);
  assert.equal(r.why, "inside");
});

test("somebody a street away is turned back, and told how far", () => {
  const r = doorCheck(downTheRoad, FENCE);
  assert.equal(r.allow, false);
  assert.equal(r.why, "outside");
  assert.ok(r.metres > 100, `${r.metres}m`);
  assert.match(r.note, /Sign on when you get here/);
});

test("a store with no lot drawn has no opinion", () => {
  /* Otherwise the first store to open this screen without a fence locks out its
     whole floor, which is a worse first morning than any cheat it would stop. */
  for (const f of [null, undefined, {}, { ring: [] }, { ring: [{ lat: 1, lng: 1 }] }]) {
    const r = doorCheck(onLot, f);
    assert.equal(r.allow, true, JSON.stringify(f));
    assert.equal(r.why, "no-fence");
  }
});

test("a phone that will not say where it is does not stop anybody", () => {
  /* A permission prompt is not a disciplinary matter. */
  const r = doorCheck(null, FENCE);
  assert.equal(r.allow, true);
  assert.equal(r.why, "no-reading");
});

test("a vague fix lets them on and says so", () => {
  /* A phone inside a steel showroom is routinely fifty to a hundred metres out.
     "Probably outside" is not grounds for sending somebody home, and the first
     time it happens to a real salesperson the tool is finished. */
  const r = doorCheck({ ...onLot, accuracy: 90 }, FENCE);
  assert.equal(r.allow, true);
  assert.equal(r.why, "unsure");
  assert.match(r.note, /not sure/);
});

test("a fix so poor it is worthless is not treated as evidence either way", () => {
  const r = doorCheck({ ...downTheRoad, accuracy: 5000 }, FENCE);
  assert.equal(r.allow, true, "a 5km error bar cannot prove somebody is off the lot");
  assert.equal(r.why, "unsure");
});

test("standing at the kerb is unsure, not out", () => {
  /* The point says one thing and its own error bar says the other is just as
     likely. Refusing here would turn away somebody at the entrance. */
  const kerb = { lat: LOT[0].lat + 0.00012, lng: LOT[0].lng, accuracy: 25 };
  const r = doorCheck(kerb, FENCE);
  assert.equal(r.allow, true);
  assert.equal(r.why, "unsure");
});

test("only a confident outside ever refuses", () => {
  /* The whole rule, stated once: everything that is not a certain "out" lets
     somebody get on with their morning. */
  const cases = [onLot, null, { ...onLot, accuracy: 90 }, { ...downTheRoad, accuracy: 400 }];
  for (const c of cases) assert.equal(doorCheck(c, FENCE).allow, true, JSON.stringify(c));
  assert.equal(doorCheck(downTheRoad, FENCE).allow, false);
});
