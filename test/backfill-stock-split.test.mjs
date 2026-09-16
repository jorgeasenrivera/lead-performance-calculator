/**
 * Choosing which stored reports to re-read.
 * -------------------------------------------------------------------------
 * The backfill's one real decision. Everything else it does is a fetch, a parse
 * the parser tests already cover, and a compare-and-set copied from the import.
 * This is the part that would quietly do the wrong thing: read every file and
 * the last one written wins, which on a month-to-date grid means an older
 * figure landing on top of a newer one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newestPerStoreMonth } from "../scripts/backfill-stock-split.mjs";

const k = (store, day) => `lpc:reportfile:${store}:${day}:scheduled-report-${day}.pdf`;

test("one report per store per month, and it is the newest", () => {
  const got = newestPerStoreMonth([
    k("holler-ford", "2026-09-08"),
    k("holler-ford", "2026-09-15"),
    k("holler-ford", "2026-09-11"),
    k("classic-honda", "2026-09-15"),
  ]);
  assert.equal(got.size, 2, "two stores, one row each");
  assert.equal(got.get("holler-ford|2026-09").day, "2026-09-15", "the newest of the three");
  assert.equal(got.get("classic-honda|2026-09").day, "2026-09-15");
});

test("a month is its own row, so August is not overwritten by September", () => {
  const got = newestPerStoreMonth([
    k("mazda-lakeland", "2026-08-31"),
    k("mazda-lakeland", "2026-09-15"),
  ]);
  assert.equal(got.size, 2, "August and September are separate months");
  assert.equal(got.get("mazda-lakeland|2026-08").day, "2026-08-31");
  assert.equal(got.get("mazda-lakeland|2026-09").day, "2026-09-15");
});

test("the filters narrow it, so one store can be tried before all ten", () => {
  const keys = [k("holler-ford", "2026-09-15"), k("classic-honda", "2026-09-15"),
    k("holler-ford", "2026-08-31")];
  assert.equal(newestPerStoreMonth(keys, { store: "holler-ford" }).size, 2);
  assert.equal(newestPerStoreMonth(keys, { month: "2026-09" }).size, 2);
  assert.equal(newestPerStoreMonth(keys, { store: "holler-ford", month: "2026-09" }).size, 1);
});

test("anything that is not a report key is ignored rather than guessed at", () => {
  const got = newestPerStoreMonth([
    "lpc:store:holler-ford:v2",
    "lpc:board:holler-ford:v1",
    "lpc:reportfile:holler-ford:not-a-date:x.pdf",
    k("holler-ford", "2026-09-15"),
  ]);
  assert.equal(got.size, 1, "only the one real report key");
  assert.equal(got.get("holler-ford|2026-09").day, "2026-09-15");
});

/**
 * Running directly, without being unrunnable or unimportable.
 * -------------------------------------------------------------------------
 * Found reviewing Codex's Windows branch (#336) and then in my own script: a
 * main-module guard built by gluing "file://" onto argv[1] is false on Windows
 * and false on any path with a space in it, so the script exits 0 having done
 * nothing. For a backfill that is the worst shape a failure can take, because
 * it is indistinguishable from a clean dry run.
 *
 * The fix has its own edge, which is why this is a test and not just a patch:
 * pathToFileURL throws on undefined where the glued form merely came out false,
 * and this module has to stay importable or the test above cannot run at all.
 */
test("the script knows when it is being run, and stays importable when it is not", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../scripts/backfill-stock-split.mjs", import.meta.url), "utf8"));
  assert.ok(!/`file:\/\/\$\{process\.argv\[1\]\}`/.test(src),
    "the main-module guard is not built by gluing a string onto argv[1]");
  assert.ok(/pathToFileURL\(process\.argv\[1\]\)\.href/.test(src),
    "it goes through pathToFileURL, which handles a drive letter and a space");
  assert.ok(/process\.argv\[1\] && import\.meta\.url ===/.test(src),
    "and argv[1] is checked first, because pathToFileURL throws on undefined and this module is imported by this file");
});
