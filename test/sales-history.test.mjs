import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readXlsx } from "../scripts/sales-history/xlsx-lite.mjs";
import { parseSheets, reconcile, missingDays, salesDailySql, resolveMonday, sheetMonth } from "../scripts/sales-history/parse-workbook.mjs";
import { storeIdFor } from "../scripts/sales-history/stores.mjs";
import { run } from "../scripts/sales-history/load.mjs";
import { buildXlsx, monthSheet } from "./sales-history-xlsx.mjs";

const read = (...sheets) => parseSheets(readXlsx(buildXlsx(sheets)));
const get = (p, store, date) => p.readings.filter((r) => r.store === store && r.date === date);

test("the reader gets strings, numbers, empty cells and entities out of a real zip", () => {
  const [s] = readXlsx(buildXlsx([{ name: "A & B", rows: [["x < y", 5, null, "NA"], [], [null, null, 7]] }]));
  assert.equal(s.name, "A & B");
  assert.deepEqual(s.rows[0], ["x < y", 5, null, "NA"]);
  assert.deepEqual(s.rows[2], [null, null, 7]);
  assert.throws(() => readXlsx(Buffer.from("not a zip file at all, just text")), /not a zip/);
});

test("sheet names: a month and a year, with the workbook's spellings", () => {
  assert.deepEqual(sheetMonth("Sept 2026"), { year: 2026, month: 9 });
  assert.deepEqual(sheetMonth(" April 2014"), { year: 2014, month: 4 });
  assert.deepEqual(sheetMonth("March  2014"), { year: 2014, month: 3 });
  assert.equal(sheetMonth("Summary"), null);
});

test("a block reads Monday to Sunday with the dates under the day numbers", () => {
  const p = read(monthSheet("Sept 2026", [{ nums: [null, 1, 2, 3, 4, 5, 6], stores: { "Holler Honda": [null, 4, 6, 6, 16, 26, 10] } }]));
  assert.equal(get(p, "Holler Honda", "2026-09-01")[0].value, 4);   // 1 September 2026 is a Tuesday
  assert.equal(get(p, "Holler Honda", "2026-09-05")[0].value, 26);
  assert.equal(get(p, "Holler Honda", "2026-08-31").length, 0, "the empty Monday is unknown, not zero");
});

test("a prior-year block is its own year, whether the label is '2025 Sales' or a bare 'SALES' under '2019 SALES'", () => {
  const p = read(monthSheet("Sept 2026", [
    { label: "2026 Sales", nums: [null, 1, 2, 3, 4, 5, 6], stores: { "Holler Honda": [null, 4, 6, 6, 16, 26, 10] } },
    { label: "2025 Sales", nums: [1, 2, 3, 4, 5, 6, 7], stores: { "Holler Honda": [14, 6, 3, 8, 10, 8, 9] } },
    // the layout a first pass dated as 2026: the year sits on the row above, the header row says only "SALES"
    { label: "SALES", labelAbove: "2024 SALES", nums: [2, 3, 4, 5, 6, 7, 8], stores: { "Holler Honda": [10, 7, 8, 4, 5, 20, 5] } },
  ]));
  assert.equal(get(p, "Holler Honda", "2025-09-01")[0].value, 14);      // Monday 1 Sept 2025
  assert.equal(get(p, "Holler Honda", "2024-09-02")[0].value, 10);      // Monday 2 Sept 2024
  assert.equal(get(p, "Holler Honda", "2026-09-02").length, 1, "and nothing from 2024 landed on 2026's dates");
  assert.equal(get(p, "Holler Honda", "2026-09-02")[0].value, 6);
});

test("a week across two months takes its month from the numbers, not the sheet", () => {
  const p = read(monthSheet("Oct 2026", [{ nums: [28, 29, 30, 1, 2, 3, 4], stores: { "Holler Honda": [1, 2, 3, 4, 5, 6, 7] } }]));
  assert.equal(get(p, "Holler Honda", "2026-09-28")[0].value, 1);       // Monday 28 September 2026
  assert.equal(get(p, "Holler Honda", "2026-10-01")[0].value, 4);
  assert.equal(get(p, "Holler Honda", "2026-10-04")[0].value, 7);
});

test("a typo in the day numbers is outvoted by the other six, and said so", () => {
  const r = resolveMonday([3, 4, 5, 9, 7, 8, 9], 2023, 7);   // 3 July 2023 is a Monday; Thu should be 6
  assert.equal(new Date(r.monday).toISOString().slice(0, 10), "2023-07-03");
  assert.equal(r.quality, "repaired");
  const p = read(monthSheet("July 2023", [{ label: "2023 Sales", nums: [3, 4, 5, 9, 7, 8, 9], stores: { "Holler Honda": [1, 2, 3, 4, 5, 6, 7] } }]));
  assert.equal(p.stats.repaired, 1);
  assert.equal(get(p, "Holler Honda", "2023-07-06")[0].value, 4);
  assert.deepEqual(resolveMonday([null, null, null, null, null, null, null], 2023, 7), { why: "no day numbers" });
  assert.deepEqual(resolveMonday([1, 2, 3, 4, 5, 6, 7], 2023, 7), { why: "no Monday fits" }, "numbers no Monday near that month can have are refused, not forced");
});

test("NA is a closed day and an empty cell is unknown: neither is a zero", () => {
  const p = read(monthSheet("Sept 2026", [{ nums: [null, 1, 2, 3, 4, 5, 6], stores: { "Holler Honda": [null, 0, "NA", "N/A", 3, null, 5] } }]));
  const r = reconcile(p.readings);
  const day = (d) => r.days.find((x) => x.day === d);
  assert.deepEqual([day("2026-09-01").units, day("2026-09-01").closed], [0, false]);
  assert.deepEqual([day("2026-09-02").units, day("2026-09-02").closed], [null, true]);
  assert.equal(day("2026-09-03").closed, true);
  assert.equal(day("2026-09-05"), undefined, "an empty cell has no row");
  assert.deepEqual(missingDays(r.days).map((m) => m.day), ["2026-09-05"]);
});

test("the sheets that show the same day vote; a tie is left unknown and listed", () => {
  // the 2026 week as it appears on three sheets (the year's own, and two later sheets comparing back to it)
  const week = (honda) => [{ label: "2026 Sales", nums: [null, 1, 2, 3, 4, 5, 6], stores: { "Holler Honda": honda } }];
  const p = read(
    monthSheet("Sept 2026", week([null, 4, 6, 6, 16, 26, 10])),
    monthSheet("Sept 2027", week([null, 4, 6, 6, 16, 26, 10])),
    monthSheet("Sept 2028", week([null, 5, 6, 6, 16, 26, 10])),
  );
  assert.equal(get(p, "Holler Honda", "2026-09-01").length, 3, "three sheets show the same day");
  const r = reconcile(p.readings);
  assert.equal(r.days.find((d) => d.day === "2026-09-01").units, 4, "two sheets against one");
  assert.equal(r.disagreeing, 1);
  const tie = reconcile([
    { sheet: "A", store: "Holler Honda", date: "2026-09-02", value: 6 },
    { sheet: "B", store: "Holler Honda", date: "2026-09-02", value: 7 },
  ]);
  assert.equal(tie.days.length, 0, "one against one has no winner");
  assert.deepEqual(tie.ties[0].sheets, ["A=6", "B=7"]);
});

test("workbook names map to Sage stores; the rest are reported and skipped, never guessed", () => {
  assert.equal(storeIdFor("Drivers Mart"), "driver-s-mart-winter-park");
  assert.equal(storeIdFor("Drivers Mart- Sanford"), "driver-s-mart-sanford");
  assert.equal(storeIdFor("Drivers  Mart -  Sanford"), "driver-s-mart-sanford");
  assert.equal(storeIdFor("Drivers Mart- WP"), "driver-s-mart-winter-park");
  assert.equal(storeIdFor("Holler Nissan Columbia"), null);
  const r = reconcile([{ sheet: "A", store: "Holler Nissan Columbia", date: "2026-09-01", value: 3 }, { sheet: "A", store: "Genesis N Orlando", date: "2026-09-01", value: 1 }]);
  assert.equal(r.days.length, 0);
  assert.deepEqual([...r.unmapped.keys()], ["Holler Nissan Columbia", "Genesis N Orlando"]);
});

test("a count that is not a whole number is left out and said so, not rounded", () => {
  const r = reconcile([{ sheet: "A", store: "Holler Honda", date: "2026-09-01", value: 4.5 }, { sheet: "A", store: "Holler Honda", date: "2026-09-02", value: 1001 }]);
  assert.equal(r.days.length, 0);
  assert.equal(r.fractional.length, 2);
});

test("the SQL carries only integers, dates and the source, and never overwrites the daily report", () => {
  const days = [
    { store: "holler-honda", day: "2026-09-01", units: 4, closed: false },
    { store: "holler-honda", day: "2026-09-02", units: null, closed: true },
    { store: "holler-honda", day: "2026-09-03", units: 0, closed: false },
  ];
  const [one] = salesDailySql(days, "workbook-2026-10");
  assert.match(one, /\('holler-honda','2026-09-01',4,false,'workbook-2026-10'\)/);
  assert.match(one, /\('holler-honda','2026-09-02',null,true,'workbook-2026-10'\)/);
  assert.match(one, /\('holler-honda','2026-09-03',0,false,'workbook-2026-10'\)/);
  assert.match(one, /on conflict \(store, day\) do update set/);
  assert.match(one, /where public\.sales_daily\.source like 'workbook-%';/);
  assert.equal(salesDailySql(Array.from({ length: 2500 }, (_, i) => ({ store: "a", day: "2026-01-01", units: i % 9, closed: false })), "workbook-2026-10").length, 3, "in chunks of a thousand");
  assert.throws(() => salesDailySql(days, "workbook'; drop table x; --"), /source label/);
  assert.throws(() => salesDailySql([{ store: "x'; drop", day: "2026-09-01", units: 1, closed: false }], "workbook-2026-10"), /store and a day/);
  assert.throws(() => salesDailySql([{ store: "a", day: "2026-09-01", units: 1.5, closed: false }], "workbook-2026-10"), /closed nor a count/);
  assert.throws(() => salesDailySql([{ store: "a", day: "2026-09-01", units: 3, closed: true }], "workbook-2026-10"), /closed nor a count/);
});

test("the load writes its lists and SQL outside the repo, and refuses to read or write inside it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sales-history-"));
  try {
    const file = path.join(dir, "book.xlsx"), out = path.join(dir, "out");
    fs.writeFileSync(file, buildXlsx([monthSheet("Sept 2026", [{ nums: [null, 1, 2, 3, 4, 5, 6], stores: { "Holler Honda": [null, 4, "NA", 6, 16, null, 10], "Genesis N Orlando": [null, 1, 1, 1, 1, 1, 1] } }])]));
    const r = run({ file, out, source: "workbook-2026-10" });
    assert.match(r.lines.join("\n"), /store-days to load: 5 \(1 closed, 4 counted\)/);
    assert.match(r.lines.join("\n"), /Genesis N Orlando \(6\)/);
    assert.ok(fs.existsSync(path.join(out, "sales_daily-001.sql")) && fs.existsSync(path.join(out, "report.txt")));
    assert.match(fs.readFileSync(path.join(out, "fix-2-days-in-no-sheet.csv"), "utf8"), /2026-09-05,Sat,holler-honda/);
    const repo = path.resolve(import.meta.dirname, "..");
    assert.throws(() => run({ file: path.join(repo, "book.xlsx"), out, source: "workbook-2026-10" }), /outside the repository/);
    assert.throws(() => run({ file, out: path.join(repo, "out"), source: "workbook-2026-10" }), /outside the repository/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the real workbook cannot be committed by accident", () => {
  const root = path.resolve(import.meta.dirname, "..");
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^\*\.xlsx$/m);
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
  assert.deepEqual(tracked.filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f)), []);
});

test("the table SQL is the shape Jorge decided on 2 October (T1 a, T2 a)", () => {
  const sql = fs.readFileSync(new URL("../supabase/pending/03-sales-history.sql", import.meta.url), "utf8");
  assert.match(sql, /create table public\.sales_daily \(/);
  assert.match(sql, /create table public\.schedule_rules \(/);
  assert.match(sql, /alter table public\.sales_daily enable row level security;/);
  assert.match(sql, /alter table public\.schedule_rules enable row level security;/);
  assert.match(sql, /revoke all on public\.sales_daily, public\.schedule_rules from anon, authenticated;/);
  assert.match(sql, /grant select on public\.sales_daily, public\.schedule_rules to authenticated;/);
  assert.ok(!/create policy [^\n]*\bfor (insert|update|delete|all)\b/i.test(sql), "no policy lets anyone but the server write");
  assert.ok(!/can_use_store/.test(sql.replace(/--[^\n]*/g, "")), "a salesperson linked through the floor does not read the history");
  assert.ok(!/create (or replace )?function/i.test(sql.replace(/--[^\n]*/g, "")), "no new function, so no new advisor line");
});
