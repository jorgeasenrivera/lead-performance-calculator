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

