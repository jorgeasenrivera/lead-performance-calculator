import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDailyActivityGrid, readDailyActivityStoreTotals } from "../api/_report-parsers.mjs";

// Synthetic PDF text only. These names and activity counts describe no store.
const line = (...parts) => ({ parts: parts.map((str) => ({ str })) });
const H1 = "Net Leads Showroom Phone Ups ILM Leads Campaign App Created App Scheduled";
const H2 = "App Confirmed App Show Calls Made Connects Texts Emails Videos Video %";
const H3 = "Open Tasks Completed Tasks Total Delivered Total Closing %";
const STORE = "Northstar Example Motors";
const heading = (name = STORE, visit = true) => [
  line(name, H1), line(`${H2}${visit ? " Visit" : ""}`), line(H3),
];
const splitHeading = (first, last, visit = true) => [
  line(first, H1), line(`${H2}${visit ? " Visit" : ""}`), line(last, H3),
];
const cells = (delivered, visit = true) => {
  const values = ["14", "1", "3", "6", "4", "5", "4", "?", "0", "71", "11",
    "164", "33", "8", "29%", "730", "79", String(delivered), "0%"];
  return visit ? [...values, "4"] : values;
};
const row = (tag, delivered, visit = true) => line(tag, ...cells(delivered, visit));
const person = (name, count, visit = true) => [
  ...heading(name, visit), row("New", count, visit), row("All", count, visit),
];
const people = (visit = true) => [
  ...person("Casey Example", 7.5, visit),
  ...person("Jordan Example", 6.5, visit),
  ...person("Taylor Example", 2, visit),
];
const available = (total, vehicles = { new: null, used: null }, storeName = STORE) => ({
  reportType: "activity", scope: "store", storeName,
  status: "available", reason: null, total, vehicles,
});

// The PDF groups top-baseline words ahead of the single-line captions. Their
// invented column centers, rather than that array order, pair App + Confirmed.
const geometricHeading = (name = STORE, visit = true) => {
  const labels = ["Net Leads", "Showroom", ["Phone", "Ups"], "ILM Leads", "Campaign",
    ["App", "Created"], ["App", "Scheduled"], ["App", "Confirmed"], "App Show",
    ["Calls", "Made"], "Connects", "Texts", "Emails", "Videos", "Video %",
    ["Open", "Tasks"], ["Completed", "Tasks"], ["Total", "Delivered"], ["Total", "Closing %"]];
  if (visit) labels.push("Visit");
  const part = (str, center, y) => ({ str, x: center - str.length / 2, y, w: str.length, pg: 1 });
  const top = [], middle = name ? [part(name, 20, 63)] : [], bottom = [];
  labels.forEach((label, index) => {
    const center = 80 + index * 40;
    if (Array.isArray(label)) {
      top.push(part(label[0], center, 60));
      bottom.push(part(label[1], center + 0.1, 67));
    } else middle.push(part(label, center, 63));
  });
  return [{ parts: [...top, ...middle] }, { parts: bottom }];
};
const geometricRow = (tag, delivered, visit = true) => ({
  parts: [tag, ...cells(delivered, visit)].map((str, index) => ({
    str, x: (index ? 80 + (index - 1) * 40 : 50) - str.length / 2, y: 80, w: str.length, pg: 1,
  })),
});

for (const visit of [false, true]) {
  test(`the ${visit ? 20 : 19}-column geometric header pairs stacked captions without reordering employee parsing`, () => {
    const source = [...geometricHeading(STORE, visit), geometricRow("New", 2, visit),
      geometricRow("Used", 3, visit), geometricRow("All", 5, visit)];
    assert.deepEqual(readDailyActivityStoreTotals(source), available(5, { new: 2, used: 3 }));
  });
}

test("a grouped App Confirmed percentage stays one cell before Units Delivered", () => {
  const values = cells(5.5);
  values[7] = "1,200%";
  const source = [...geometricHeading(), line("All", ...values)];
  assert.deepEqual(readDailyActivityStoreTotals(source), available(5.5));
});

test("unrecognized geometry cannot fall back to guessing from an unordered vocabulary bag", () => {
  const source = geometricHeading();
  const delivered = source[1].parts.find((part) => part.str === "Delivered");
  delivered.x += 10;
  const got = readDailyActivityStoreTotals([...source, row("All", 5)]);
  assert.notEqual(got.status, "available");
  assert.equal(got.total, null);
});

test("positioned numeric cells must still align with their printed column captions", () => {
  const all = geometricRow("All", 5);
  [all.parts[17], all.parts[18]] = [all.parts[18], all.parts[17]];
  const got = readDailyActivityStoreTotals([...geometricHeading(), all]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "malformed-store-row");
  assert.equal(got.total, null);
});

test("column-only geometric page headers preserve repeated store evidence and employee output", () => {
  const source = [...geometricHeading(), geometricRow("New", 2), ...geometricHeading(""),
    geometricRow("Used", 3), geometricRow("All", 5), ...geometricHeading(""), geometricRow("All", 5),
    ...["Casey Example", "Jordan Example", "Taylor Example"].flatMap((name) =>
      [...geometricHeading(name), geometricRow("All", 3)])];
  const mapped = mapDailyActivityGrid(source);
  const before = structuredClone(mapped);
  assert.deepEqual(readDailyActivityStoreTotals(source), available(5, { new: 2, used: 3 }));
  assert.deepEqual(mapDailyActivityGrid(source), before);
  assert.deepEqual(mapped.rows.slice(2).map((r) => r[0]), ["Casey Example", "Jordan Example", "Taylor Example"]);
});

for (const visit of [false, true]) {
  test(`store All is independent of employee credit in the ${visit ? 20 : 19}-column layout`, () => {
    const source = [...heading(STORE, visit), row("New", 2, visit), row("Used", 3, visit),
      row("All", 5, visit), ...people(visit)];
    assert.deepEqual(readDailyActivityStoreTotals(source), available(5, { new: 2, used: 3 }));
  });
  test(`the ${visit ? 20 : 19}-column layout preserves the existing employee mapper output`, () => {
    const source = [...heading(STORE, visit), row("New", 2, visit), row("Used", 3, visit),
      row("All", 5, visit), ...people(visit)];
    const expectedHeader = ["Name", "Total", "Showroom", "Phone", "Internet", "Campaign",
      "Created", "Scheduled", "Confirmed", "Show", "Calls", "Call Contacted", "Text", "Email",
      "Personalized Video", "Open Tasks", "Completed Tasks", "Units Delivered", "Visit"];
    const expectedPerson = (name, count) => [name, 14, 1, 3, 6, 4, 5, 4, null, 0,
      71, 11, 164, 33, 8, 730, 79, count, visit ? 4 : null];
    const expected = { storeName: STORE, rows: [["Daily Activity"], expectedHeader,
      expectedPerson("Casey Example", 7.5), expectedPerson("Jordan Example", 6.5),
      expectedPerson("Taylor Example", 2)] };
    assert.deepEqual(mapDailyActivityGrid(source), expected);
    const before = structuredClone(source);
    readDailyActivityStoreTotals(source);
    assert.deepEqual(source, before, "the evidence read must not mutate PDF lines");
    assert.deepEqual(mapDailyActivityGrid(source), expected);
  });
}

test("zero is printed evidence and a missing vehicle row stays null", () => {
  assert.deepEqual(readDailyActivityStoreTotals([
    ...heading(), row("Used", 0), row("All", 0),
  ]), available(0, { new: null, used: 0 }));
});

test("each vehicle count is independent and decimals are neither rounded nor reconciled", () => {
  assert.deepEqual(readDailyActivityStoreTotals([
    ...heading(), row("New", 1.25), row("Used", 2.5), row("All", 4.75),
  ]), available(4.75, { new: 1.25, used: 2.5 }));
  assert.deepEqual(readDailyActivityStoreTotals([
    ...heading(), row("New", 0), row("All", "1,234.5"),
  ]), available(1234.5, { new: 0, used: null }));
});

test("a store-only report does not need the employee mapper's three-person threshold", () => {
  const source = [...heading(), row("All", 5)];
  assert.equal(mapDailyActivityGrid(source), null);
  assert.deepEqual(readDailyActivityStoreTotals(source), available(5));
});

test("a printed store name split across headings is kept without fuzzy matching", () => {
  assert.deepEqual(readDailyActivityStoreTotals([
    line("Daily Activity Report"), line("Fictional report period"),
    ...splitHeading("Northstar Example", "Motors"), row("New", 2), row("All", 5),
    ...people(),
  ]), available(5, { new: 2, used: null }));
});

test("Visit in a name does not invent the newer column layout", () => {
  const name = "Visitacion Example Motors";
  assert.deepEqual(readDailyActivityStoreTotals([
    ...heading(name, false), row("All", 0, false),
  ]), available(0, undefined, name));
});

test("the evidence name keeps printed spelling, numbers, punctuation and column-like words", () => {
  for (const name of ["Route 7 & EXAMPLE Motors", "Phone Visit Example Motors"]) {
    assert.deepEqual(readDailyActivityStoreTotals([
      ...heading(name), row("All", 5),
    ]), available(5, undefined, name));
  }
});

test("unknown non-delivery cells preserve alignment", () => {
  const values = cells(3);
  values[0] = "?"; values[7] = "?"; values[9] = "-"; values[14] = "∞";
  assert.deepEqual(readDailyActivityStoreTotals([...heading(), line("All", ...values)]), available(3));
});

test("a missing or unknown printed All count is never zero or an employee total", () => {
  for (const missing of ["?", "-", "∞"]) {
    const got = readDailyActivityStoreTotals([...heading(), row("All", missing), ...people()]);
    assert.equal(got.storeName, STORE);
    assert.equal(got.status, "incomplete");
    assert.equal(got.reason, "unknown-store-count");
    assert.equal(got.total, null);
  }
});

test("a malformed first All row cannot promote the first employee", () => {
  for (const bad of [line("All"), line("All", ...cells(5).slice(1)),
    line("All", ...cells(5), "9"), line("All", ...cells(5).map((cell, index) => index === 5 ? "broken" : cell))]) {
    const got = readDailyActivityStoreTotals([...heading(), bad, ...people()]);
    assert.equal(got.storeName, STORE);
    assert.equal(got.status, "incomplete");
    assert.equal(got.reason, "malformed-store-row");
    assert.equal(got.total, null);
  }
});

test("invalid delivery tokens never parse as a prefix, percentage, or infinity", () => {
  for (const token of ["-1", "3cars", "2%", "1,2", "NaN", "Infinity", "9".repeat(400)]) {
    const got = readDailyActivityStoreTotals([...heading(), row("All", token)]);
    assert.equal(got.status, "incomplete", token);
    assert.equal(got.total, null, token);
  }
});

test("missing store All is not manufactured from New and Used", () => {
  const got = readDailyActivityStoreTotals([
    ...heading(), row("New", 2), row("Used", 3), ...people(),
  ]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "missing-store-all-row");
  assert.equal(got.total, null);
  assert.deepEqual(got.vehicles, { new: 2, used: 3 });
});

test("an empty store block remains the first block even when employee rows are valid", () => {
  const got = readDailyActivityStoreTotals([...heading(), ...people()]);
  assert.equal(got.storeName, STORE);
  assert.equal(got.status, "missing");
  assert.equal(got.reason, "missing-store-all-row");
  assert.equal(got.total, null);
});

test("a missing store name cannot be repaired with a salesperson's name", () => {
  const got = readDailyActivityStoreTotals([...heading(""), row("All", 5), ...people()]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "missing-store-name");
  assert.equal(got.storeName, null);
  assert.equal(got.total, null);
});

test("wrong report types and a net-leads-only header do not label unrelated numbers", () => {
  for (const source of [null, [], [line("Delivery Summary"),
    line("Example Store Total Leads Total Ups Be Backs Delivered F I Closing %"),
    line("All 1 2 3 4 5 6%")], [line("Units Delivered"), row("All", 5)]]) {
    const got = readDailyActivityStoreTotals(source);
    assert.equal(got.status, "missing");
    assert.equal(got.reason, "not-daily-activity");
    assert.equal(got.total, null);
  }
  const got = readDailyActivityStoreTotals([line(STORE, H1), row("All", 5)]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "unsupported-activity-header");
});

test("all the right column words in a different order are still unsupported", () => {
  const got = readDailyActivityStoreTotals([
    line(STORE, H1), line(`${H2} Visit`),
    line("Total Delivered Open Tasks Completed Tasks Total Closing %"), row("All", 5),
  ]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "unsupported-activity-header");
  assert.equal(got.total, null);
});

test("the row width must match whether Visit is printed", () => {
  for (const visit of [false, true]) {
    const got = readDailyActivityStoreTotals([...heading(STORE, visit), row("All", 5, !visit)]);
    assert.equal(got.status, "incomplete");
    assert.equal(got.total, null);
  }
});

test("column-only page headers preserve the store block across New, Used and All", () => {
  assert.deepEqual(readDailyActivityStoreTotals([
    ...heading(), row("New", 2), ...heading(""), row("Used", 3), row("All", 5), ...people(),
  ]), available(5, { new: 2, used: 3 }));
});

test("identical repeated All rows and explicitly repeated store headings agree", () => {
  for (const repeat of [[row("All", 5)], [...heading(""), row("All", 5)],
    [...heading(), row("New", 2), row("All", 5)]]) {
    assert.deepEqual(readDailyActivityStoreTotals([
      ...heading(), row("New", 2), row("All", 5), ...repeat, ...people(),
    ]), available(5, { new: 2, used: null }));
  }
});

test("a repeated store total that disagrees is a conflict, never last-write-wins", () => {
  for (const repeat of [[row("All", 6)], [...heading(""), row("All", 6)],
    [...heading(), row("All", 6)]]) {
    const got = readDailyActivityStoreTotals([...heading(), row("All", 5), ...repeat, ...people()]);
    assert.equal(got.status, "conflict");
    assert.equal(got.reason, "conflicting-store-counts");
    assert.equal(got.total, null);
  }
});

test("repeated vehicle evidence is independently checked", () => {
  const got = readDailyActivityStoreTotals([
    ...heading(), row("New", 2), row("Used", 3), row("All", 5),
    ...heading(), row("New", 1), row("Used", 3), row("All", 5),
  ]);
  assert.equal(got.status, "available");
  assert.equal(got.reason, "conflicting-vehicle-counts");
  assert.equal(got.total, 5);
  assert.deepEqual(got.vehicles, { new: null, used: 3 });
});

test("a valid repeat does not conceal an unreadable printed store row", () => {
  const got = readDailyActivityStoreTotals([
    ...heading(), line("All"), ...heading(), row("All", 5),
  ]);
  assert.equal(got.status, "incomplete");
  assert.equal(got.total, null);
});

test("a malformed or unknown optional vehicle row leaves the printed All total available", () => {
  for (const [vehicleRow, reason] of [[line("New"), "malformed-vehicle-row"],
    [row("New", "?"), "unknown-vehicle-count"]]) {
    const got = readDailyActivityStoreTotals([...heading(), vehicleRow, row("Used", 3), row("All", 5)]);
    assert.equal(got.status, "available");
    assert.equal(got.reason, reason);
    assert.equal(got.total, 5);
    assert.deepEqual(got.vehicles, { new: null, used: 3 });
  }
});

test("an unnamed vehicle group cannot silently choose between a pending person and repeated store rows", () => {
  const source = [
    ...splitHeading(STORE, "Casey Example"), row("New", 2), row("All", 5),
    row("New", 7.5), row("All", 7.5),
    ...person("Jordan Example", 6.5), ...person("Taylor Example", 2),
  ];
  const legacy = mapDailyActivityGrid(source);
  assert.equal(legacy.storeName, STORE);
  assert.deepEqual(legacy.rows.slice(2).map((r) => r[0]), ["Casey Example", "Jordan Example", "Taylor Example"]);
  const got = readDailyActivityStoreTotals(source);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "ambiguous-store-heading");
  assert.equal(got.storeName, null);
  assert.equal(got.total, null);
  assert.deepEqual(mapDailyActivityGrid(source), legacy);
});

test("a bare new group after All is also ambiguous with a single-fragment store heading", () => {
  const got = readDailyActivityStoreTotals([
    ...heading(), row("All", 5), row("New", 6), row("All", 6), ...people(),
  ]);
  assert.equal(got.storeName, STORE);
  assert.equal(got.status, "incomplete");
  assert.equal(got.reason, "ambiguous-store-rows");
  assert.equal(got.total, null);
});
