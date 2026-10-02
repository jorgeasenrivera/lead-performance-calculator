#!/usr/bin/env node
/* Read Jorge's sales workbook and write, to a folder OUTSIDE the repository:
   what it found, the two lists of days to look at, and the SQL to load.
   Nothing is sent anywhere and nothing is written to the live project: the
   SQL is applied by hand, once, with Jorge's yes (C111, T3 c).

     node scripts/sales-history/load.mjs --file ~/Sales_Daily_Metrics.xlsx \
          --out ~/sales-out --source workbook-2026-10

   The workbook holds customers' totals and is the business's own; it must not
   be committed, and this refuses to read it from, or write beside, the repo. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "./xlsx-lite.mjs";
import { parseSheets, reconcile, missingDays, salesDailySql } from "./parse-workbook.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inside = (p) => { const r = path.relative(ROOT, path.resolve(p)); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
const csv = (rows) => rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(",")).join("\n") + "\n";

export function run({ file, out, source }) {
  if (!file || !out || !source) throw new Error("usage: --file workbook.xlsx --out folder --source workbook-YYYY-MM");
  if (inside(file)) throw new Error("the workbook must live outside the repository");
  if (inside(out)) throw new Error("write the output outside the repository");
  const parsed = parseSheets(readXlsx(fs.readFileSync(file)));
  const rec = reconcile(parsed.readings);
  const missing = missingDays(rec.days, rec.ties);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "fix-1-sheets-disagree.csv"), csv([["store", "date", "what each sheet says"], ...rec.ties.map((t) => [t.store, t.day, t.sheets.join(" ; ")])]));
  fs.writeFileSync(path.join(out, "fix-2-days-in-no-sheet.csv"), csv([["date", "weekday", "stores with no figure"], ...missing.map((m) => [m.day, m.weekday, m.stores.join("; ")])]));
  const sql = salesDailySql(rec.days, source);
  sql.forEach((s, i) => fs.writeFileSync(path.join(out, `sales_daily-${String(i + 1).padStart(3, "0")}.sql`), s));
  const closed = rec.days.filter((d) => d.closed).length;
  const lines = [
    `sheets read: ${parsed.stats.blocks ? "yes" : "none"}; week blocks ${parsed.stats.blocks} (${parsed.stats.ok} exact, ${parsed.stats.repaired} repaired, ${parsed.stats.ambiguous} ambiguous), skipped ${parsed.skipped.length}`,
    `readings ${parsed.readings.length}; unrecognised cells ${parsed.odd.length}`,
    `store-days to load: ${rec.days.length} (${closed} closed, ${rec.days.length - closed} counted) in ${sql.length} file(s)`,
    `sheets disagreeing with no majority, left unknown: ${rec.ties.length} (fix-1)`,
    `days a store has no figure for, between its first and last: ${missing.length} (fix-2)`,
    `counts that are not whole numbers, left out: ${rec.fractional.length}`,
    `store names not in Sage, skipped: ${[...rec.unmapped].map(([n, c]) => `${n} (${c})`).join(", ") || "none"}`,
    `sheets whose name is not a month: ${parsed.stats.sheetsSkipped.join(", ") || "none"}`,
  ];
  fs.writeFileSync(path.join(out, "report.txt"), lines.join("\n") + "\n");
  return { lines, parsed, rec, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), get = (k) => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : undefined; };
  try { console.log(run({ file: get("file"), out: get("out"), source: get("source") }).lines.join("\n")); }
  catch (e) { console.error(String(e.message || e)); process.exitCode = 2; }
}
