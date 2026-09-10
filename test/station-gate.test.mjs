/**
 * Telling somebody they are below standard for a phone station.
 * -------------------------------------------------------------------------
 * Phase four, and the rules that matter are the ones where being wrong is
 * quiet and unfair rather than obviously broken: a rate computed from three
 * leads, a percentage compared against a fraction, and the grace period the
 * rest of the app already honours.
 *
 * Every case here still lets the person sit down. What is being tested is what
 * the screen says and whether an override has to be written down, not whether
 * anybody is stopped — nobody is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_PHONE_LEADS, phoneCloseOf, stationGate, needsOverride } from "../api/_station-gate.mjs";

/* The store's phone standard the way a store stores it: 25 meaning 25%. */
const BAR = 25;
const month = (units, leads) => ({ phoneUnits: units, phoneLeads: leads });

test("closing is units over leads, once there are enough leads to mean it", () => {
  assert.equal(phoneCloseOf(month(6, 24)), 0.25);
  assert.equal(phoneCloseOf(month(3, 30)), 0.1);
  assert.equal(MIN_PHONE_LEADS, 10);
});

test("a rate off three leads is not a rate", () => {
  /* Zero out of three is not evidence of anything, and reading it as 0%
     against a standard of 25 fails somebody for having a slow week. */
  assert.equal(phoneCloseOf(month(0, 3)), null);
  assert.equal(phoneCloseOf(month(1, 9)), null);
  assert.equal(phoneCloseOf(month(1, 10)), 0.1, "ten is the line");
});

test("nothing on file at all is not a rate either", () => {
  assert.equal(phoneCloseOf(null), null);
  assert.equal(phoneCloseOf({}), null);
  assert.equal(phoneCloseOf(month(undefined, 40)), null);
});

test("at or above the standard is clear", () => {
  assert.equal(stationGate({ stats: month(9, 30), standard: BAR }).state, "clear");
  /* Exactly on the bar passes. Somebody who has hit the number has hit it. */
  const on = stationGate({ stats: month(5, 20), standard: BAR });
  assert.equal(on.state, "clear");
  assert.equal(on.pct, 0.25);
});

test("below the standard warns, and says so as a fraction against a percentage", () => {
  /* The two units are kept apart deliberately: comparing 0.14 against 25 is
     how a gate ends up failing everybody in the building. */
  const g = stationGate({ stats: month(4, 30), standard: BAR });
  assert.equal(g.state, "below");
  assert.equal(g.ok, false);
  assert.equal(needsOverride(g), true);
  assert.ok(Math.abs(g.pct - 0.1333) < 0.001, "a fraction");
  assert.equal(g.standard, 25, "a percentage");
});

test("not enough leads reads as unrated, never as below", () => {
  /* This is the one that lands on a new hire, on somebody back from leave, and
     on anybody whose month has barely started. */
  const g = stationGate({ stats: month(0, 4), standard: BAR });
  assert.equal(g.state, "unrated");
  assert.equal(g.ok, true);
  assert.equal(needsOverride(g), false);
  assert.equal(g.pct, null);
  assert.equal(g.leads, 4, "and it can say how far off having an answer we are");
  assert.equal(g.minLeads, 10);
});

test("the grace period is honoured, in the words the rest of the app uses", () => {
  const g = stationGate({ stats: month(2, 30), standard: BAR, inGrace: true });
  assert.equal(g.state, "grace");
  assert.equal(g.ok, true);
  assert.equal(needsOverride(g), false);
  assert.ok(g.pct < 0.25, "still below — it is the response that changes, not the figure");
});

test("a store that has not set a phone standard judges nobody", () => {
  for (const bar of [null, undefined, 0, "", NaN]) {
    const g = stationGate({ stats: month(0, 40), standard: bar });
    assert.equal(g.state, "no-standard", String(bar));
    assert.equal(g.ok, true);
  }
});

test("every verdict still lets them sit down", () => {
  /* It warns, it does not block. The desk knows things the figures do not. */
  const cases = [
    stationGate({ stats: month(9, 30), standard: BAR }),
    stationGate({ stats: month(1, 30), standard: BAR }),
    stationGate({ stats: month(1, 30), standard: BAR, inGrace: true }),
    stationGate({ stats: month(0, 2), standard: BAR }),
    stationGate({ stats: month(0, 40), standard: null }),
  ];
  assert.equal(cases.filter((g) => needsOverride(g)).length, 1, "only 'below' needs a manager to say so");
  assert.deepEqual(cases.map((g) => g.state),
    ["clear", "below", "grace", "unrated", "no-standard"]);
});

test("a store may set its own floor for how much history counts", () => {
  assert.equal(stationGate({ stats: month(0, 4), standard: BAR, minLeads: 3 }).state, "below");
  assert.equal(stationGate({ stats: month(0, 4), standard: BAR, minLeads: 25 }).state, "unrated");
});
