/* Every prune the migrations define is also scheduled.
   C90, 23 September: three prune functions had been written for twelve days
   and nothing ever called them, so the times the privacy policy promises were
   true on paper only. This fails the next time one is written and not run. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");

test("every prune function the migrations define is called by a scheduled job", () => {
  const defined = [...new Set([...sql.matchAll(/create or replace function public\.(prune_\w+)\(\)/g)].map((m) => m[1]))];
  assert.ok(defined.length >= 3, "the three prunes are found, so the check is looking at the right files");
  const jobs = [...sql.matchAll(/cron\.schedule\(([\s\S]*?\$\$[\s\S]*?\$\$)/g)].map((m) => m[1]).join("\n");
  for (const fn of defined) assert.ok(jobs.includes(`public.${fn}()`), `${fn} is written but never scheduled`);
});

test("the daily job runs when nobody is on the lot", () => {
  assert.ok(/cron\.schedule\(\s*'prune-daily',\s*'0 9 \* \* \*'/.test(sql), "09:00 UTC, five in the morning Eastern");
});
