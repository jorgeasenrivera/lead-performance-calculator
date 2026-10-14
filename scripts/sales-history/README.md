# The sales-history load (C111)

Jorge's workbook of daily deliveries per store, January 2014 on, read into the
`sales_daily` table (`supabase/pending/03-sales-history.sql`). Decided by Jorge
on 2 October: two tables, managers of the store and admins read, only the server
writes, and the workbook is fixed first and then loaded once.

The workbook is the business's own figures. It is never committed (`*.xlsx` is
ignored, and a test fails if one is tracked) and the loader refuses to read it
from, or write beside, this repository.

```
node scripts/sales-history/load.mjs --file ~/Sales_Daily_Metrics.xlsx \
     --out ~/sales-out --source workbook-2026-10
```

It writes, to `--out`:

- `report.txt`: what was found, in a few lines;
- `fix-1-sheets-disagree.csv`: days two or more sheets give different counts
  for, with no majority. Left unknown (no row) until settled in the workbook;
- `fix-2-days-in-no-sheet.csv`: days a store has no figure for, between its
  first and last day. A holiday blank is probably a closed day; a month-turn
  day is worth a look at both sheets;
- `manifest.json`: exactly the files of this run, in order, with row counts and
  SHA-256. Apply those and only those; the output folder must be new or empty,
  so a chunk from an older run cannot be there;
- `sales_daily-NNN.sql`: the load, a thousand rows each, with an upsert that
  only ever replaces a row whose source starts `workbook-`, so the daily report
  can top the table up later without a rerun undoing it.

Reading the workbook: a closed day (the workbook's `NA`) is a row with
`closed = true`; an empty cell is unknown and has no row; neither is a zero.
Where several sheets show the same day, the count MORE THAN HALF of those sheets
agree on wins; a plurality is not enough, and a sheet that shows a day with two
different counts votes for nothing. Either way the day is left unknown and listed.
Store names map through `stores.mjs`; a name that is not there is reported and
skipped.

## Applying it, once, with Jorge's yes

1. Run the check on a throwaway Postgres: `sudo -u postgres scripts/sales-history-check.sh`.
2. Apply `03-sales-history.sql` through the migration tool; it then moves to
   `supabase/migrations` under the version the project records, and the advisors
   are read (no new line is expected: no new function, RLS on, a read policy each).
3. Run the files named in `manifest.json`, in order, with `execute_sql`; check each
   file's SHA-256 first; count the rows per store and compare with `report.txt`.
4. Compare August 2026 with `stated.deliveries` in the stores' own documents
   (Holler Hyundai was 17% under when last compared).

Not part of this: keeping the table current (Codex's daily delivery reader, X15),
and anything on screen.
