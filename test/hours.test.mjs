/**
 * Keeping the hours the imports would otherwise overwrite.
 * -------------------------------------------------------------------------
 * Phase five, and it ships with no screen attached on purpose: an hour that
 * was never recorded cannot be recovered, so the clock has to start before the
 * thing that reads it exists.
 *
 * The rules worth pinning down are the ones where a wrong answer is plausible
 * rather than obviously broken — a second import inside one hour, a report
 * re-pulled and corrected downward, and the first hour of a day, which has
 * nothing before it to difference against.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hourIn, bucketOf, stampHours, hourDeltas, betweenHours } from "../api/_hours.mjs";

const DEV = "dev okonjo";
const PRI = "priya ramanan";
/* Ten in the morning, New York, on a day the store is open. */
const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 10, h + 4, m));   // EDT is UTC-4

const day = (opp, calls = 0, contacted = 0, appts = 0) =>
  ({ oppPhone: opp, calls, contacted, apptScheduled: appts });

test("the hour is the store's, not the server's", () => {
  /* A row is keyed by the store's day, so its buckets have to be on the same
     clock or the last hour of an evening lands on tomorrow. */
  assert.equal(hourIn(at(10)), "10");
  assert.equal(hourIn(at(19)), "19");
});

test("a day with nothing in it is not written", () => {
  assert.equal(bucketOf({ oppPhone: 0, calls: 0 }), null);
  assert.equal(bucketOf(null), null);
  assert.deepEqual(bucketOf(day(2, 30)), { op: 2, ca: 30 });
});

test("an import stamps the running totals into its own hour", () => {
  const hours = stampHours({}, { [DEV]: day(2, 30) }, at(10));
  assert.deepEqual(Object.keys(hours), ["10"]);
  assert.deepEqual(hours["10"][DEV], { op: 2, ca: 30 });
});

test("a second import in the same hour replaces it, not appends", () => {
  /* It is the more complete reading of that hour, not a second hour's worth.
     Appending would double every figure inside it. */
  let hours = stampHours({}, { [DEV]: day(2, 30) }, at(10, 5));
  hours = stampHours(hours, { [DEV]: day(3, 41) }, at(10, 55));
  assert.deepEqual(Object.keys(hours), ["10"]);
  assert.deepEqual(hours["10"][DEV], { op: 3, ca: 41 });
});

test("earlier hours are left alone", () => {
  /* Re-running today's import must not disturb this morning, and an import
     aimed at a past day must not rewrite hours it is not describing. */
  let hours = stampHours({}, { [DEV]: day(2) }, at(10));
  hours = stampHours(hours, { [DEV]: day(5) }, at(13));
  assert.deepEqual(Object.keys(hours).sort(), ["10", "13"]);
  assert.equal(hours["10"][DEV].op, 2, "ten o'clock is untouched");
});

test("an hour's own figures are the difference from the one before", () => {
  let hours = stampHours({}, { [DEV]: day(2, 30) }, at(10));
  hours = stampHours(hours, { [DEV]: day(5, 44) }, at(11));
  hours = stampHours(hours, { [DEV]: day(6, 51) }, at(12));
  assert.deepEqual(hourDeltas(hours, DEV).map((d) => [d.hour, d.op, d.ca]), [
    ["10", 2, 30],   // the first has nothing before it: everything so far
    ["11", 3, 14],
    ["12", 1, 7],
  ]);
});

test("a corrected-down report yields nothing, not a negative hour", () => {
  /* Reports get re-pulled and revised. An hour where somebody un-took an
     opportunity is not a real thing that occurred. */
  let hours = stampHours({}, { [DEV]: day(5) }, at(10));
  hours = stampHours(hours, { [DEV]: day(3) }, at(11));
  assert.deepEqual(hourDeltas(hours, DEV).map((d) => d.op), [5, 0]);
});

test("a gap spans, rather than inventing the missing hours", () => {
  /* An import that did not arrive is not an hour of zero. Whatever happened
     lands on the next hour that did report, which is where the evidence is. */
  let hours = stampHours({}, { [DEV]: day(2) }, at(9));
  hours = stampHours(hours, { [DEV]: day(9) }, at(13));
  const d = hourDeltas(hours, DEV);
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((x) => [x.hour, x.op]), [["09", 2], ["13", 7]]);
});

test("one person's hours are their own", () => {
  let hours = stampHours({}, { [DEV]: day(2), [PRI]: day(4) }, at(10));
  hours = stampHours(hours, { [DEV]: day(3), [PRI]: day(9) }, at(11));
  assert.deepEqual(hourDeltas(hours, DEV).map((d) => d.op), [2, 1]);
  assert.deepEqual(hourDeltas(hours, PRI).map((d) => d.op), [4, 5]);
  assert.deepEqual(hourDeltas(hours, "nobody"), []);
});

test("a sit collects the hours it covered most of", () => {
  /* The rule, stated rather than discovered: somebody who sat at 10:10 gets
     the ten o'clock hour; somebody who sat at 10:40 does not. */
  let hours = stampHours({}, { [DEV]: day(2) }, at(10));
  hours = stampHours(hours, { [DEV]: day(6) }, at(11));
  hours = stampHours(hours, { [DEV]: day(7) }, at(12));

  const early = betweenHours(hours, DEV, at(10, 10).toISOString(), at(12, 0).toISOString());
  assert.equal(early.hours, 2, "ten and eleven");
  assert.equal(early.op, 2 + 4);

  const late = betweenHours(hours, DEV, at(10, 40).toISOString(), at(12, 0).toISOString());
  assert.equal(late.hours, 1, "ten is mostly gone by the time they sat");
  assert.equal(late.op, 4);
});

test("a window with no width collects nothing", () => {
  const hours = stampHours({}, { [DEV]: day(4) }, at(10));
  const t = at(10, 30).toISOString();
  assert.equal(betweenHours(hours, DEV, t, t).hours, 0);
  assert.equal(betweenHours(hours, DEV, at(11).toISOString(), at(10).toISOString()).hours, 0);
});

test("nothing recorded is nothing attributed", () => {
  /* Which is the honest answer before the first import lands, and for every
     day already behind us — none of this can be backfilled. */
  assert.deepEqual(hourDeltas({}, DEV), []);
  assert.deepEqual(hourDeltas(null, DEV), []);
  assert.equal(betweenHours({}, DEV, at(10).toISOString(), at(12).toISOString()).op, 0);
});
