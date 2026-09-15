/**
 * Backfilling the stock split onto months already filed.
 * -------------------------------------------------------------------------
 * #341 made the app read New and Used off the report's own rows instead of
 * scaling the people's credited ones. It only helps a month whose report is
 * parsed after it shipped, so every month filed before that still carries the
 * estimate, decimals and all. The reports themselves are on file, so the split
 * can be recovered rather than left wrong.
 *
 * What it does: for each store and each month, finds the NEWEST stored report,
 * reads it with the same reader the pipeline uses, and writes the store's own
 * New and Used counts onto that month's `stated`. Nothing else is touched.
 *
 * Why the newest and not all of them: the grid is month to date. Holler Ford's
 * report of the 15th says 74 deliveries for September, not the 15th's handful.
 * So one file per store per month carries the whole month, and re-reading the
 * other thirteen would be thirteen chances to write an older figure over a
 * newer one.
 *
 *   node scripts/backfill-stock-split.mjs                 # says what it would do
 *   node scripts/backfill-stock-split.mjs --write         # does it
 *   node scripts/backfill-stock-split.mjs --store holler-ford --month 2026-09
 *
 * It needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, the same pair the ingest
 * function reads. It refuses to run against a URL that looks like the local
 * mock, because a backfill that silently rewrites the demo store teaches you
 * nothing and a backfill you think ran but did not is worse than none.
 *
 * It prints two warnings about DOMMatrix and Path2D on the way in. They are
 * pdf.js looking for `canvas`, which it only needs to DRAW a page. Reading the
 * text does not touch it, and the email pipeline prints the same two.
 */
import * as P from "../api/_report-parsers.mjs";
/* The pipeline's own reader, not a second one. The browser and the email path
   already share everything downstream of the page-to-lines step; a backfill
   that rolled its own would drift on the first ligature, and a name set with
   "ff" in it would stop matching the roster. */
import { extractPdfLines } from "../api/ingest.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WRITE = has("--write");
const ONLY_STORE = val("--store");
const ONLY_MONTH = val("--month");

const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
/* Checked when it runs, not when it loads, so the choosing above can be tested
   without a database in the room. A module that exits on import cannot be. */
function checkCredentials() {
  if (!URL_ || !KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The ingest function reads the same pair.");
    process.exit(1);
  }
  if (/127\.0\.0\.1|localhost/.test(URL_)) {
    console.error(`SUPABASE_URL is ${URL_}, which is the local mock. Point it at the real project.`);
    process.exit(1);
  }
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const api = (path) => `${URL_}/rest/v1/${path}`;

async function get(path) {
  const r = await fetch(api(path), { headers: H });
  if (!r.ok) throw new Error(`read ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* The same compare-and-set the import uses. A backfill that blind-writes would
   drop whatever a manager saved between the read and the write, which is the
   exact failure the revision number exists to stop. */
async function swap(key, apply, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const rows = await get(`app_data?key=eq.${encodeURIComponent(key)}&select=value`);
    const cur = rows.length ? rows[0].value : null;
    if (!cur) return { ok: false, why: "row does not exist" };
    const rev = Number(cur.rev) || 0;
    const next = { ...apply(cur), rev: rev + 1 };
    const revFilter = cur.rev == null ? "value->>rev=is.null" : `value->>rev=eq.${rev}`;
    const r = await fetch(api(`app_data?key=eq.${encodeURIComponent(key)}&${revFilter}`), {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ value: next }),
    });
    if (!r.ok) throw new Error(`write ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if ((await r.json()).length) return { ok: true, rev: next.rev };
    await new Promise((res) => setTimeout(res, 120 * (attempt + 1)));
  }
  return { ok: false, why: "the row kept changing underneath" };
}

/* Newest report per store per month. The grid is month to date, so the last one
   filed is the one that knows the whole month, and reading the older ones would
   only be more chances to write a staler figure over a fresher one. Exported so
   the choosing can be tested without a database or a PDF anywhere near it. */
export function newestPerStoreMonth(keys, { store: onlyStore = null, month: onlyMonth = null } = {}) {
  const newest = new Map();
  for (const key of keys) {
    const m = /^lpc:reportfile:([^:]+):([0-9]{4}-[0-9]{2}-[0-9]{2}):/.exec(key);
    if (!m) continue;
    const [, store, day] = m;
    if (onlyStore && store !== onlyStore) continue;
    const month = day.slice(0, 7);
    if (onlyMonth && month !== onlyMonth) continue;
    const id = `${store}|${month}`;
    if (!newest.has(id) || day > newest.get(id).day) newest.set(id, { store, month, day, key });
  }
  return newest;
}

const fmt = (v) => (v == null ? "-" : String(v));
const monthOf = (day) => String(day).slice(0, 7);

async function main() {
  checkCredentials();
  console.log(WRITE ? "WRITING to the live project.\n" : "Dry run. Nothing is written. Add --write to do it.\n");

  const rows = await get("app_data?key=like.lpc:reportfile:*&select=key&limit=5000");
  const newest = newestPerStoreMonth(rows.map((r) => r.key), { store: ONLY_STORE, month: ONLY_MONTH });
  if (!newest.size) { console.log("No stored reports matched."); return; }
  console.log(`${rows.length} reports on file, ${newest.size} to read (the newest per store per month).\n`);

  let read = 0, wouldWrite = 0, wrote = 0, already = 0, noSplit = 0, failed = 0;
  for (const { store, month, day, key } of [...newest.values()].sort((a, b) => a.store.localeCompare(b.store) || a.month.localeCompare(b.month))) {
    const label = `${store} ${month} (from ${day})`;
    try {
      const got = await get(`app_data?key=eq.${encodeURIComponent(key)}&select=value`);
      const file = got.length ? got[0].value : null;
      if (!file?.b64) { console.log(`  skip  ${label}: the row carries no file`); failed++; continue; }
      const parsed = P.mapDeliverySummaryGrid(await extractPdfLines(Buffer.from(file.b64, "base64")));
      read++;
      const veh = parsed?.stated?.vehicles;
      if (!veh) { console.log(`  none  ${label}: the report prints no New or Used rows`); noSplit++; continue; }

      const storeKey = `lpc:store:${store}:v2`;
      const sRows = await get(`app_data?key=eq.${encodeURIComponent(storeKey)}&select=value`);
      const cur = sRows.length ? sRows[0].value : null;
      const M = cur?.months?.[month];
      if (!M?.stated) { console.log(`  skip  ${label}: no stated block on that month to attach it to`); failed++; continue; }
      if (M.stated.vehicles) { console.log(`  have  ${label}: already counted, left alone`); already++; continue; }

      const before = `${fmt(M.stated.deliveries)} delivered, split estimated`;
      const after = `new ${fmt(veh.new)}, used ${fmt(veh.used)}${veh.other != null ? `, other ${veh.other}` : ""}`;
      const sum = (veh.new || 0) + (veh.used || 0) + (veh.other || 0);
      const note = M.stated.deliveries != null && Math.abs(sum - M.stated.deliveries) > 0.5
        ? `  [the split sums to ${sum} against ${M.stated.deliveries} delivered, worth a look]` : "";
      console.log(`  ${WRITE ? "write" : " would"} ${label}: ${before}  ->  ${after}${note}`);
      wouldWrite++;
      if (!WRITE) continue;

      const res = await swap(storeKey, (row) => {
        const next = JSON.parse(JSON.stringify(row));
        // Only this. A backfill that touches anything else is a restore.
        next.months[month].stated = { ...next.months[month].stated, vehicles: veh };
        return next;
      });
      if (res.ok) { wrote++; console.log(`        written, rev ${res.rev}`); }
      else { failed++; console.log(`        NOT written: ${res.why}`); }
    } catch (e) {
      failed++;
      console.log(`  fail  ${label}: ${String(e.message || e).slice(0, 160)}`);
    }
  }

  console.log(`\nread ${read}, ${WRITE ? `written ${wrote}` : `would write ${wouldWrite}`}` +
    `, already counted ${already}, no split in the report ${noSplit}, failed ${failed}`);
  if (!WRITE && wouldWrite) console.log("Run it again with --write to make these changes.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
