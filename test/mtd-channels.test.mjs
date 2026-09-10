/**
 * The month's closing, stamped on the day.
 * -------------------------------------------------------------------------
 * A salesperson asking "is my closing down, or does it just feel down" is
 * asking about a trend, and nothing on the phone could answer it: the day rows
 * carry units and visits with no channel split, and the Daily Activity report
 * does not break units down by channel at all.
 *
 * So the Delivery Summary's month-to-date figures ride along on each day's row.
 * What matters about them is the two ways they can be read, and both are
 * checked here: straight, as the running rate; and diffed against yesterday,
 * as that day's own closing. The diff is the reason the LEADS are stored and
 * not just the percentage — a percentage cannot be differenced back into the
 * counts it came from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withChannels, slimFloorStats, FLOOR_STAT_FIELDS } from "../api/_store-keys.mjs";

const sdataWith = (month, stats) => ({ months: { [month]: { stats } } });
const DEV = "dev okonjo";

test("the month's channel figures land on the day row", () => {
  const sdata = sdataWith("2026-09", {
    [DEV]: { internetUnits: 3, internetLeads: 28, phoneUnits: 1, phoneLeads: 12,
             showroomUnits: 4, showroomLeads: 16 },
  });
  const out = withChannels({ [DEV]: { units: 1, visits: 2 } }, sdata, "2026-09-09");
  assert.deepEqual(out[DEV].mtd, { iu: 3, il: 28, pu: 1, pl: 12, su: 4, sl: 16 });
});

test("it survives the slimming that writes the row", () => {
  /* A field list that drifts writes a row of the right shape in the right place
     with one column missing and says nothing at all. This is that check. */
  assert.ok(FLOOR_STAT_FIELDS.includes("mtd"));
  const sdata = sdataWith("2026-09", { [DEV]: { internetUnits: 2, internetLeads: 20 } });
  const row = slimFloorStats(withChannels({ [DEV]: { units: 1, calls: 30 } }, sdata, "2026-09-09"));
  assert.deepEqual(row[DEV].mtd, { iu: 2, il: 20 });
});

test("somebody with no month figures keeps their day, without an empty stamp", () => {
  /* A new hire, or anybody the Delivery Summary has not credited yet. An empty
     mtd object would read downstream as "zero closing" rather than "not known",
     which is the difference between a flat line and no line. */
  const out = withChannels({ [DEV]: { units: 0, visits: 1 } }, sdataWith("2026-09", {}), "2026-09-09");
  assert.deepEqual(out[DEV], { units: 0, visits: 1 });
  assert.equal("mtd" in out[DEV], false);
});

test("the month is taken from the day, not from today", () => {
  /* Reports are pulled the next morning and imports get aimed at a past date,
     so a row for the 31st must read the 31st's month even when it is written in
     the following one. */
  const sdata = { months: {
    "2026-08": { stats: { [DEV]: { internetUnits: 9, internetLeads: 40 } } },
    "2026-09": { stats: { [DEV]: { internetUnits: 1, internetLeads: 4 } } },
  } };
  const out = withChannels({ [DEV]: { units: 1 } }, sdata, "2026-08-31");
  assert.deepEqual(out[DEV].mtd, { iu: 9, il: 40 });
});

test("two days differenced give that day's own closing", () => {
  /* The whole point of storing counts rather than a percentage. Yesterday the
     month stood at 2 of 20 internet; today at 3 of 24. That day sold one car
     out of four leads, which is 25% — a number no percentage-only row could
     recover, and the difference between "my rate is 12%" and "yesterday was
     good". */
  const mk = (iu, il) => withChannels({ [DEV]: { units: 1 } },
    sdataWith("2026-09", { [DEV]: { internetUnits: iu, internetLeads: il } }), "2026-09-09")[DEV].mtd;
  const y = mk(2, 20), t = mk(3, 24);
  const units = t.iu - y.iu, leads = t.il - y.il;
  assert.equal(units, 1);
  assert.equal(leads, 4);
  assert.equal(Math.round((units / leads) * 100), 25);
});

test("a month boundary is a gap, not a cliff", () => {
  /* Month-to-date resets on the 1st, so differencing across the boundary would
     read as a large negative. A reader has to treat that as no data for the
     day rather than as a collapse in closing, and this is the shape it sees. */
  const aug = withChannels({ [DEV]: { units: 1 } },
    sdataWith("2026-08", { [DEV]: { internetUnits: 9, internetLeads: 40 } }), "2026-08-31")[DEV].mtd;
  const sep = withChannels({ [DEV]: { units: 1 } },
    sdataWith("2026-09", { [DEV]: { internetUnits: 1, internetLeads: 4 } }), "2026-09-01")[DEV].mtd;
  assert.ok(sep.il - aug.il < 0, "the reset shows as negative and must be discarded");
});

/* ---- and what the phone draws from them ---- */
import { channelSeries } from "../api/_phone-rows.mjs";

const dayRow = (day, mtd) => ({ day, row: mtd ? { units: 1, mtd } : { units: 1 } });

test("the running rate is the month-to-date percentage", () => {
  const s = channelSeries([
    dayRow("2026-09-07", { iu: 1, il: 10 }),
    dayRow("2026-09-08", { iu: 2, il: 16 }),
  ], "internet");
  assert.equal(s.length, 2);
  assert.equal(Math.round(s[0].rate), 10);
  assert.equal(Math.round(s[1].rate * 10) / 10, 12.5);
});

test("the day's own closing comes from the difference", () => {
  const s = channelSeries([
    dayRow("2026-09-07", { iu: 1, il: 10 }),
    dayRow("2026-09-08", { iu: 2, il: 14 }),
  ], "internet");
  assert.equal(s[0].daily, null, "the first day has nothing to difference against");
  assert.equal(Math.round(s[1].daily), 25);
});

test("a day with no new leads is not a nought per cent day", () => {
  /* Somebody who took no opportunities has not closed badly, they have not been
     up. Drawing that as a zero would be a lie told in a colour. */
  const s = channelSeries([
    dayRow("2026-09-07", { iu: 1, il: 10 }),
    dayRow("2026-09-08", { iu: 1, il: 10 }),
  ], "internet");
  assert.equal(s[1].daily, null);
});

test("a month reset is discarded rather than drawn as a collapse", () => {
  const s = channelSeries([
    dayRow("2026-08-31", { iu: 9, il: 60 }),
    dayRow("2026-09-01", { iu: 0, il: 3 }),
    dayRow("2026-09-02", { iu: 1, il: 6 }),
  ], "internet");
  assert.equal(s[1].daily, null, "the reset day has no honest daily figure");
  assert.equal(Math.round(s[2].daily), 33, "the day after it is fine again");
});

test("days with no figures break the run rather than joining across the gap", () => {
  /* A missing import is not a flat stretch. Differencing across it would credit
     one day with a week of leads. */
  const s = channelSeries([
    dayRow("2026-09-05", { iu: 1, il: 10 }),
    dayRow("2026-09-06", null),
    dayRow("2026-09-07", { iu: 4, il: 40 }),
  ], "internet");
  assert.equal(s.length, 2);
  assert.equal(s[1].daily, null);
});

test("each channel reads its own pair, and an unknown one is empty", () => {
  const days = [dayRow("2026-09-08", { iu: 1, il: 10, pu: 2, pl: 8, su: 3, sl: 12 })];
  assert.equal(Math.round(channelSeries(days, "phone")[0].rate), 25);
  assert.equal(Math.round(channelSeries(days, "showroom")[0].rate), 25);
  assert.deepEqual(channelSeries(days, "campaign"), []);
  assert.deepEqual(channelSeries(null, "internet"), []);
});
