/**
 * Reading the scheduled reports.
 * -------------------------------------------------------------------------
 * These are the checks for the one copy of the reader that both the app and the
 * email pipeline import. Most of them exist because the thing they check went
 * wrong in production first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../api/_report-parsers.mjs";
// The consolidated reader: both sides now import this, so it is tested directly.
const line = (s) => ({ parts: [{ str: s }] });

const H1 = "Net Leads Showroom Phone Ups ILM leads Campaign App Created App Scheduled";
const H2 = "App Confirmed App Show Calls Made Connects Texts Emails Videos Video % Visit";
const H3 = "Open Tasks Completed Tasks Total Delivered Total Closing %";
const ROW = "All 14 1 3 6 4 5 4 ? 0 71 11 164 33 8 29% 730 79 0 0% 4";
const heading = (name) => {
  const b = name.split(" ");
  return [line(`${b.slice(0, -1).join(" ")} ${H1}`), line(H2), line(`${b.slice(-1)[0]} ${H3}`)];
};
const doc = (store, people) => {
  const out = [...heading(store), line(ROW.replace(/^All/, "New")), line(ROW)];
  for (const p of people) out.push(...heading(p), line(ROW.replace(/^All/, "New")), line(ROW));
  return out;
};

// ---- the two live defects, against the one copy that now exists ----
test("the two live defects, against the one copy that now exists", () => {
    const got = P.mapDailyActivityGrid(doc("Drivers Mart Winter Park",
      ["Chase Cabney", "Luke Pancake", "Mike Ganus", "Earl Jarrett"]));
    const names = (got?.rows || []).slice(2).map((r) => r[0]);
    assert.ok(
      got.storeName === "Drivers Mart Winter Park", got.storeName);
    assert.ok(
      !names.some((n) => /visit/i.test(n)), names);
    assert.ok(
      !names.some((n) => n.split(" ").length > 2), names);
    assert.ok(
      names.length === 4, names);
    const head = got.rows[1];
    assert.ok(
      head.includes("Visit"), head);
    assert.ok(
      got.rows[2][head.indexOf("Visit")] === 4, got.rows[2]);
});

// ---- the drifts the diff turned up: figures the pipeline used to drop ----
test("the drifts the diff turned up: figures the pipeline used to drop", () => {
    const rows = [["Delivery"],
      ["Name", "Opportunities", "Sold", "Sold %", "Units Delivered", "Delivered %"],
      ["Fin Smith", "110", "7", "6.4", "5", "4.5"]];
    const out = P.parseReport(rows, "delivery-phone");
    assert.ok(
      out["fin smith"].phoneLeads === 110, out["fin smith"]);
    assert.ok(
      out["fin smith"].phoneUnits === 5, out["fin smith"]);
});
test("and internet leads land in their own field", () => {
    const rows = [["Delivery"],
      ["Name", "Opportunities", "Sold", "Sold %", "Units Delivered", "Delivered %"],
      ["Fin Smith", "110", "7", "6.4", "5", "4.5"]];
    const out = P.parseReport(rows, "delivery-internet");
    assert.ok(
      out["fin smith"].internetLeads === 110, out["fin smith"]);
});
test("an appointment-show column under another spelling is still read", () => {
    const rows = [["Activity"], ["Name", "Calls", "Total Show"], ["Fin Smith", "10", "3"]];
    const out = P.parseReport(rows, "activity");
    assert.ok(
      out["fin smith"].actApptShow === 3, out["fin smith"]);
});
test("and 'Visits' as well as 'Visit'", () => {
    const rows = [["Activity"], ["Name", "Calls", "Visits"], ["Fin Smith", "10", "6"]];
    assert.ok(
      P.parseReport(rows, "activity")["fin smith"].actVisits === 6);
});

// ---- a store still on the export that has no Visit column at all ----
test("a store still on the export that has no Visit column at all", () => {
    const H2old = "App Confirmed App Show Calls Made Connects Texts Emails Videos Video %";
    const ROWold = "All 14 1 3 6 4 5 4 ? 0 71 11 164 33 8 29% 730 79 0 0%";
    const head2 = (name) => { const b = name.split(" ");
      return [line(`${b.slice(0, -1).join(" ")} ${H1}`), line(H2old), line(`${b.slice(-1)[0]} ${H3}`)]; };
    const ls = [...head2("Holler Ford"), line(ROWold.replace(/^All/, "New")), line(ROWold)];
    for (const p of ["Fin Smith", "Jimmy Loy", "Rick Dawkins"]) {
      ls.push(...head2(p), line(ROWold.replace(/^All/, "New")), line(ROWold));
    }
    const got = P.mapDailyActivityGrid(ls);
    assert.ok(
      got.storeName === "Holler Ford", got.storeName);
    assert.ok(
      got.rows.length - 2 === 3, got.rows.map((r) => r[0]));
    const head = got.rows[1];
    assert.ok(
      got.rows[2][head.indexOf("Visit")] === null, got.rows[2]);
});

// ---- the vocabulary must strike out columns without eating names ----
test("the vocabulary must strike out columns without eating names", () => {
    assert.ok(
      P.stripVocabWith(P.DA_VOCAB, ["Chase", "Cabney", "Visit"]).join(" ") === "Chase Cabney");
    assert.ok(
      P.stripVocabWith(P.DA_VOCAB, ["Chase", "Visits"]).join(" ") === "Chase");
    assert.ok(
      P.stripVocabWith(P.DA_VOCAB, ["Visitacion", "Reyes"]).join(" ") === "Visitacion Reyes");
});

// ---- the ordinary paths still behave ----
test("the ordinary paths still behave", () => {
    assert.ok(
      P.detectReportType([[], ["Name", "Call Contacted", "Personalized Video"]]) === "activity");
    assert.ok(
      P.detectReportType([[], ["Name", "Units Delivered"]], "delivery-report.csv") === "delivery");
    assert.ok(
      P.detectReportType([[], ["Name", "Units Delivered"]], "Standard-Phone.csv") === "wrong-channel-report");
    assert.ok(
      P.detectReportType([[], ["Name", "Widgets"]]) === null);
});
test("norm folds case and spacing", () => {
    assert.ok(
      P.norm("  Fin   SMITH ") === "fin smith");
    assert.ok(
      P.toNum("$1,234") === 1234);
    assert.ok(
      P.toNum("-") === null);
    assert.ok(
      P.toNum("0") === 0);
});

// ---- dropping a PDF into the wrong store by hand ----
test("dropping a PDF into the wrong store by hand", () => {
    const STORES = [{ id: "classic-mazda", name: "Classic Mazda" },
                    { id: "drivers-mart-winter-park", name: "Drivers Mart Winter Park" },
                    { id: "holler-ford", name: "Holler Ford" }];
    const at = (name, here) => P.reportBelongsElsewhere(STORES, name, here);
    assert.ok(
      at("Drivers Mart Winter Park", "classic-mazda")?.id === "drivers-mart-winter-park",
          at("Drivers Mart Winter Park", "classic-mazda"));
    assert.ok(
      at("Drivers Mart Winter Park", "classic-mazda")?.name === "Drivers Mart Winter Park");
    assert.ok(
      at("Classic Mazda", "classic-mazda") === null);
    assert.ok(
      at("Classic Mazda Fin Smith", "classic-mazda") === null);
    assert.ok(
      at("Some Dealership We Do Not Have", "classic-mazda") === null);
    assert.ok(
      at("", "classic-mazda") === null);
    assert.ok(
      at("Holler Ford", "classic-mazda")?.id === "holler-ford");
});


/* ---- the Delivery Summary's own store block ----
   DriveCentric prints the store's totals above the people, and the reader used
   to drop that block on the floor: `if (!curName) continue`. It is the only
   figure in the report the report itself is authoritative about, and the app
   now quotes it back to check the board against, so it has to survive. */
const DS_HEAD = [
  "Total Leads Total Ups Unsold In Showroom Be Backs Delivered F I Closing %",
];
const dsBlock = (name, rows) => [
  line(`${name} ${DS_HEAD[0]}`),
  ...rows.map((r) => line(r)),
];
const dsDoc = (store, storeRows, people) => {
  const out = [...dsBlock(store, storeRows)];
  for (const [nm, rs] of people) out.push(...dsBlock(nm, rs));
  return out;
};

test("the Delivery Summary keeps the store's own totals", () => {
  const got = P.mapDeliverySummaryGrid(dsDoc(
    "Holler Honda",
    ["Internet 400 0 0 0 200 50%", "Phone 100 0 0 0 40 40%",
     "Showroom 300 20 5 2 15 5%", "Campaign 0 0 0 0 0 0%"],
    [["Alex Demo", ["Internet 40 0 0 0 20.5 51%", "Phone 10 0 0 0 4 40%",
                    "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]],
     ["Brianna Demo", ["Internet 40 0 0 0 20 50%", "Phone 10 0 0 0 4 40%",
                       "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]],
     ["Carlos Demo", ["Internet 40 0 0 0 20 50%", "Phone 10 0 0 0 4 40%",
                      "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]]],
  ));
  assert.ok(got, "the grid should read");
  assert.equal(got.storeName, "Holler Honda");
  assert.ok(got.stated, "the store block should be kept");
  assert.equal(got.stated.total, 255);
  assert.equal(got.stated.units.internet, 200);
  assert.equal(got.stated.units.showroom, 15);
  assert.equal(got.stated.leads.internet, 400);
  // and the store block must not have become a person
  const names = got.rows.slice(2).map((r) => r[0]);
  assert.ok(!names.includes("Holler Honda"), names.join(", "));
  assert.equal(names.length, 3);
});

test("a split deal's half unit survives the read", () => {
  const got = P.mapDeliverySummaryGrid(dsDoc(
    "Holler Honda",
    ["Internet 400 0 0 0 200 50%", "Phone 100 0 0 0 40 40%",
     "Showroom 300 20 5 2 15 5%", "Campaign 0 0 0 0 0 0%"],
    [["Alex Demo", ["Internet 40 0 0 0 20.5 51%", "Phone 10 0 0 0 4 40%",
                    "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]],
     ["Brianna Demo", ["Internet 40 0 0 0 20 50%", "Phone 10 0 0 0 4 40%",
                       "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]],
     ["Carlos Demo", ["Internet 40 0 0 0 20 50%", "Phone 10 0 0 0 4 40%",
                      "Showroom 30 2 1 0 1 3%", "Campaign 0 0 0 0 0 0%"]]],
  ));
  const parsed = P.parseDeliverySummaryRows(got.rows);
  assert.equal(parsed["alex demo"].internetUnits, 20.5);
});

/* ---- the store roll-up: the one figure that counts a delivery once ---- */

const rollupRows = [
  ["Delivery Summary", "8/1/2026 - 8/27/2026"],
  ["Store", "Opportunities", "Net Opportunities", "Sold", "Sold %", "Deals Delivered", "Delivered %"],
  ["Holler Honda", "1620", "1549", "257", "16.6%", "254", "16.4%"],
];

test("the store roll-up reads, and is detected as its own report", () => {
  const got = P.parseStoreRollup(rollupRows);
  assert.ok(got, "the roll-up should read");
  assert.equal(got.storeName, "Holler Honda");
  assert.equal(got.deals, 254);
  assert.equal(got.sold, 257);
  assert.equal(got.opps, 1549);
  assert.equal(P.detectReportType(rollupRows, "StandardDelivery_Summary_20260827.csv"), "store-rollup");
});

test("the per-person list is never read as the store roll-up", () => {
  const rows = [
    ["Delivery Summary", "8/1/2026 - 8/27/2026"],
    ["User", "Store", "Opportunities", "Net Opportunities", "Sold", "Sold %",
     "Units Delivered", "Deals Delivered", "Delivered %"],
    ["Alex Demo", "Holler Honda", "60", "58", "9", "15%", "8.5", "9", "15%"],
  ];
  assert.equal(P.parseStoreRollup(rows), null);
  assert.notEqual(P.detectReportType(rows, "StandardDelivery_Summary_20260827_1.csv"), "store-rollup");
});

test("a file with no Deals Delivered column is not a roll-up", () => {
  assert.equal(P.parseStoreRollup([["Store", "Sold"], ["Holler Honda", "257"]]), null);
});
