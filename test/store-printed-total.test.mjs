import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDeliverySummaryGrid, parseDeliverySummaryRows } from "../api/_report-parsers.mjs";

// Fictional report geometry and values, not an archived dealership report.
const line = (text) => ({ pg: 1, y: 0, parts: [{ str: text, x: 0 }] });
const header = (name) => line(`${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`);
const total = (value) => `Total 100 8 3 1 ${value} 12%`;
const channels = ["Internet 50 0 0 0 5 10%", "Phone 20 0 0 0 3 15%",
  "Showroom 20 8 3 1 2 10%", "Campaign 10 0 0 0 1 10%"];
const vehicles = ["New 60 5 2 1 7 12%", "Used 40 3 1 0 5 12%", "Other 0 0 0 0 0 0%"];
function report(storeRows) {
  return [header("Fictional Demo Motors"), ...storeRows.map(line),
    ...["Alex Example", "Bailey Example", "Casey Example"].flatMap((name) => [header(name),
      line("Internet 10 0 0 0 1.5 15%"), line("Phone 8 0 0 0 0.5 6.25%"),
      line("Showroom 6 2 1 0 2 33%"), line("Campaign 4 0 0 0 0.5 12.5%"),
      line("New 10 0 0 0 1.5 15%"), line("Used 8 0 0 0 3.5 43.75%"),
      line("Total 28 2 1 0 5 18%")])];
}
const read = (totals = [], other = channels) => mapDeliverySummaryGrid(report([...other, ...vehicles, ...totals]));

test("printed store total wins when channel figures disagree, without changing other output", () => {
  const got = read([total("12")]), missing = read();
  assert.equal(got.stated.total, 12);
  assert.deepEqual(got.stated.units, { internet: 5, phone: 3, showroom: 2, campaign: 1 });
  assert.deepEqual(got.stated.vehicles, { new: 7, used: 5, other: 0 });
  assert.deepEqual(got.stated.leads, { internet: 50, phone: 20, showroom: 20 });
  assert.deepEqual(got.rows, missing.rows);
  assert.deepEqual(got.pairings, missing.pairings);
  assert.equal(got.storeName, "Fictional Demo Motors");
  const people = parseDeliverySummaryRows(got.rows);
  assert.equal(people["alex example"].internetUnits, 1.5);
  assert.equal(people["alex example"].phoneUnits, 0.5);
  assert.equal(people["alex example"].campaignUnits, 0.5);
  assert.equal(people["alex example"].newUnits, 1.5);
  assert.equal(people["alex example"].usedUnits, 3.5);
});

test("explicit printed zero is valid even with positive channels", () => {
  assert.equal(read([total("0")]).stated.total, 0);
  assert.equal(mapDeliverySummaryGrid(report([total("0")])).stated.total, 0);
});

test("a missing printed total remains unknown while the stated object and channels survive", () => {
  const got = read();
  assert.ok(got.stated);
  assert.equal(got.stated.total, null);
  assert.equal(got.stated.units.internet, 5);
});

test("whole printed numbers retain valid comma grouping and exact zero decimals", () => {
  for (const [value, expected] of [["1,234", 1234], ["12.0", 12], ["0.00", 0]]) {
    assert.equal(read([total(value)]).stated.total, expected, value);
  }
});

test("malformed, fractional, negative, missing and unsafe printed totals stay unknown", () => {
  for (const value of ["-", "1.5", "-1", "NaN", "Infinity", "1e2", "1,2", "9007199254740992", "", "12%", "bad"]) {
    assert.equal(read([total(value)]).stated.total, null, value);
  }
  assert.equal(read(["Total 100 8 3 1 12"]).stated.total, null, "missing closing column must not shift the total");
  assert.equal(read(["Total 100 8 3 1 bad 12 12%"]).stated.total, null, "filtering bad tokens must not create a valid total");
  const onlyMalformed = mapDeliverySummaryGrid(report([total("bad")]));
  assert.ok(onlyMalformed.stated);
  assert.equal(onlyMalformed.stated.total, null);
});

test("duplicate store totals remain ambiguous even when identical or one is malformed", () => {
  for (const rows of [[total("12"), total("12")], [total("12"), total("13")],
    [total("bad"), total("12")], [total("12"), total("bad")],
    [total("12"), "Total bad bad bad bad bad bad"],
    [total("12"), "Total ? ? ? ? ? ?"],
    [total("12"), "Total \u2013 \u2013 \u2013 \u2013 \u2013 \u2013"],
    [total("12"), "Total \u2014 \u2014 \u2014 \u2014 \u2014 \u2014"]]) {
    assert.equal(read(rows).stated.total, null);
  }
  const repeatedBlock = report([total("12")]);
  repeatedBlock.splice(2, 0, header("Fictional Demo Motors"), line(total("12")));
  assert.equal(mapDeliverySummaryGrid(repeatedBlock).stated.total, null, "a repeated store block is ambiguous too");
});

test("column-only headers and split closing-percent tokens do not supply extra totals", () => {
  const got = read(["Total Leads Total Ups Unsold In Showroom Be Backs Total Delivered/ F&I Closing %", "Total 100 8 3 1 12 12 %"]);
  assert.equal(got.stated.total, 12);
  assert.equal(read([total("12"), "Total Delivered/F&I Closing %"]).stated.total, 12);
});

test("fractional store channel and vehicle figures remain unchanged", () => {
  const got = mapDeliverySummaryGrid(report(["Internet 50 0 0 0 5.5 11%", "New 60 5 2 1 7.5 12%", total("12")]));
  assert.equal(got.stated.total, 12);
  assert.equal(got.stated.units.internet, 5.5);
  assert.equal(got.stated.vehicles.new, 7.5);
});
