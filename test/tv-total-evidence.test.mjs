/* TV Board Total Delivered: evidence for review. Every store, person, count and
   report line below is fictional. These tests exercise real production modules
   in a sandbox (parser, selector, browser publisher, embedded TV renderer). They
   do not prove a live report source, a physical TV, or any store's real total. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { mapDeliverySummaryGrid } from "../api/_report-parsers.mjs";
import { selectReportedTotal } from "../api/_board-provenance.mjs";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

const STORE = { id: "fictional-demo", name: "Fictional Demo Motors" };
const MONTH = "2026-09";
const OPEN_AT = "2026-09-07T16:00:00Z";

async function moduleWith(path, name) {
  const url = new URL(path, import.meta.url);
  const out = await build({ stdin: { contents: fs.readFileSync(url, "utf8") + `\nexport { ${name} };\n`,
    resolveDir: fileURLToPath(new URL(".", url)), sourcefile: fileURLToPath(url), loader: path.endsWith("jsx") ? "jsx" : "js" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent", loader: { ".css": "text" },
    define: { "import.meta.env": "{}", "import.meta.url": JSON.stringify(url.href) } });
  const m = { exports: {} };
  new Function("require", "module", "exports", out.outputFiles[0].text)(createRequire(url), m, m.exports);
  return m.exports;
}
const app = moduleWith("../src/LeadPerformanceCalculator.jsx", "buildBoardPayload");

// The printed store Total (12) deliberately differs from the channel sum (5+3+2+1 = 11)
// and from the associates' split credits, which include halves.
const heading = (name) => `${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`;
const people = ["Alex Example", "Bailey Example", "Casey Example"]; // the grid needs three people
function grid(printedTotal = "12") {
  const texts = ["Daily Summary Test for The Board", "9/1/2026 - 9/7/2026", heading(STORE.name),
    "Internet 50 0 0 0 5 10%", "Phone 20 0 0 0 3 15%", "Showroom 20 8 3 1 2 10%", "Campaign 10 0 0 0 1 10%",
    `Total 100 8 3 1 ${printedTotal} 12%`,
    ...people.flatMap((p) => [heading(p), "Internet 10 0 0 0 1.5 15%", "Phone 8 0 0 0 0.5 6.25%",
      "Showroom 6 2 1 0 2 33%", "Campaign 4 0 0 0 0.5 12.5%", "New 10 0 0 0 1.5 15%", "Used 8 0 0 0 3.5 43.75%", "Total 28 2 1 0 5 18%"])];
  return texts.map((str, i) => ({ pg: 1, y: i * 16, parts: [{ str, x: 20 }] }));
}
// Same shape api/ingest.mjs builds from a mapped grid (the handler itself is
// exercised end to end in test/monthly-summary-intake.test.mjs).
function observationFrom(mapped, hash) {
  const count = Number.isSafeInteger(mapped.stated?.total) && mapped.stated.total >= 0 ? mapped.stated.total : null;
  return { schemaVersion: 1, metric: "printed_store_total_delivered", storeId: STORE.id, printedStoreName: mapped.storeName,
    reportMonth: mapped.reportMonth, printedRange: mapped.printedRange, count, status: count === null ? "unknown" : "provisional",
    sentAt: null, asOf: null,
    source: { sha256: hash, byteLength: 2400, parserVersion: "delivery-summary-printed-total-month:v1", archiveState: "unverified" },
    sourceAssertions: [{ date: [], messageId: [] }], processingAt: "2026-09-07T15:00:00.000Z", publicationEligible: false };
}
const H = ["a", "b", "c"].map((c) => c.repeat(64));
const statsFor = (credits) => Object.fromEntries(people.map((p, i) => [p.toLowerCase(),
  { internetUnits: credits[i], phoneUnits: 0.5, showroomUnits: 0, campaignUnits: 0 }]));

async function payload(reportedTotal, credits = [1.5, 1, 0]) {
  const config = { stores: [{ id: STORE.id, name: STORE.name }], roles: [{ id: "sales", onBoard: true }] };
  const data = { roster: people.map((name, i) => ({ id: `p${i}`, name, roleId: "sales" })), months: { [MONTH]: { stats: statsFor(credits) } } };
  const row = (await app).buildBoardPayload(config, STORE.id, data);
  const key = Object.keys(row.months)[0];
  row.months = { [MONTH]: { ...row.months[key], stats: statsFor(credits), reportedTotal } }; row.ym = MONTH;
  return row;
}

/* The real embedded board in a sandbox. `serve` is what the next database read
   returns; refresh() fires the board's own 15 minute data timer, no reload. */
async function openBoard(first) {
  const elements = new Map(), intervals = [];
  const element = () => { const cls = new Set(); return { innerHTML: "", textContent: "", style: { setProperty() {} },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {}, getAttribute: () => null,
    setAttribute() {}, appendChild(c) { return c; }, removeChild() {}, remove() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }) }; };
  let serve = first;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [OPEN_AT])); } static now() { return new Date(OPEN_AT).getTime(); } }
  const window = { innerHeight: 1080, innerWidth: 1920, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  window.parent = window;
  const ctx = vm.createContext({ window, Date: Clock, Intl, Number, console, URL, Math,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      body: element(), createElement: () => element(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {},
    fetch: async () => (serve instanceof Error ? Promise.reject(serve) : { ok: true, status: 200, json: async () => [{ value: serve }] }),
  });
  const html = LEADERBOARD_HTML({ ...first, storeKey: "fictional-board", db: { url: "http://127.0.0.1:5433", anonKey: "fictional" } }, (await app).PIX);
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], ctx);
  const root = () => elements.get("root");
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  await settle();
  return {
    html: () => root().innerHTML,
    headline: () => (/class="total-num">([^<]*)<\/div>/.exec(root().innerHTML) || [])[1],
    staleNote: () => elements.get("stale-note")?.classList.contains("on") === true,
    timers: () => intervals.map((t) => t.ms),
    async refresh(next) { serve = next; intervals.find((t) => t.ms === 15 * 60 * 1000).fn(); await settle(); },
  };
}

test("printed whole-store total reaches the board; channel sum and split credits do not replace it", async () => {
  const mapped = mapDeliverySummaryGrid(grid("12"));
  const channelSum = Object.values(mapped.stated.units).reduce((n, u) => n + u, 0);
  assert.equal(mapped.stated.total, 12); assert.equal(channelSum, 11);
  const total = selectReportedTotal({ [MONTH]: { [H[0]]: observationFrom(mapped, H[0]) } }, STORE.id, MONTH);
  assert.deepEqual(total, { count: 12, status: "provisional", month: MONTH, asOf: null });
  const board = await openBoard(await payload(total));
  assert.equal(board.headline(), "12");
  assert.match(board.html(), /Reported Total Delivered/);
  assert.match(board.html(), /Displayed associate credits: 4/);   // 2 + 1.5 + 0.5, halves kept
  assert.match(board.html(), /data-to="2"/); assert.match(board.html(), /data-to="1\.5"/); assert.match(board.html(), /data-to="0\.5"/);
});

test("before the fix shape: a summed headline would have read 11, the printed report says 12", () => {
  const mapped = mapDeliverySummaryGrid(grid("12"));
  const summed = Object.values(mapped.stated.units).reduce((n, u) => n + u, 0);
  assert.notEqual(summed, mapped.stated.total);
});

test("the board refreshes its total on its own timer without a reload", async () => {
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  assert.ok(board.timers().includes(15 * 60 * 1000), "data timer is 15 minutes");
  await board.refresh(await payload({ count: 13, status: "provisional", month: MONTH, asOf: null }, [2, 1, 0]));
  assert.equal(board.headline(), "13");
});

test("missing and confirmed zero stay distinct after a refresh", async () => {
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  await board.refresh(await payload({ count: 0, status: "provisional", month: MONTH, asOf: null }, [1.5, 1, 0]));
  assert.equal(board.headline(), "0");
  await board.refresh(await payload({ count: null, status: "unknown", month: MONTH, asOf: null }, [1.5, 1, 0]));
  assert.equal(board.headline(), "-"); assert.match(board.html(), /Unknown/);
});

test("disagreeing reports are shown as a conflict; no prior unverified number is held", async () => {
  const a = observationFrom(mapDeliverySummaryGrid(grid("12")), H[0]);
  const b = observationFrom(mapDeliverySummaryGrid(grid("10")), H[1]);
  for (const order of [[a, b], [b, a]]) {
    const total = selectReportedTotal({ [MONTH]: Object.fromEntries(order.map((o) => [o.source.sha256, o])) }, STORE.id, MONTH);
    assert.deepEqual(total, { count: null, status: "conflict", month: MONTH, asOf: null });
  }
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  await board.refresh(await payload({ count: null, status: "conflict", month: MONTH, asOf: null }));
  assert.equal(board.headline(), "-"); assert.match(board.html(), /Reports disagree/);
  assert.match(board.html(), /Displayed associate credits: 4/);
});

test("every reported total is provisional with report time unknown; nothing is marked verified", async () => {
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  assert.match(board.html(), /Provisional &middot; Report time unknown/);
  const verified = observationFrom(mapDeliverySummaryGrid(grid("12")), H[0]);
  verified.source.archiveState = "verified";
  assert.equal(selectReportedTotal({ [MONTH]: { [H[0]]: verified } }, STORE.id, MONTH).status, "unknown");
});

test("FINDING: the credit-drop failsafe never engages for current publisher rows, so a lower total shows at once", async () => {
  // tooDifferent() in the renderer requires prev.store and next.store. Current
  // publishers send storeId and storeName, never store, so it always returns false.
  const first = await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }, [5, 1, 0]);
  assert.equal("store" in first, false);
  const board = await openBoard(first);
  await board.refresh(await payload({ count: 8, status: "provisional", month: MONTH, asOf: null }, [0, 0, 0]));
  assert.equal(board.headline(), "8"); assert.equal(board.staleNote(), false);
});

test("FINDING: if a row did carry a store field, a credit drop over half would hold the old total, including a genuine correction", async () => {
  const withStore = async (total, credits) => ({ ...(await payload(total, credits)), store: STORE.id });
  const board = await openBoard(await withStore({ count: 12, status: "provisional", month: MONTH, asOf: null }, [5, 1, 0]));
  await board.refresh(await withStore({ count: 8, status: "provisional", month: MONTH, asOf: null }, [0, 0, 0]));
  assert.equal(board.headline(), "12"); assert.equal(board.staleNote(), true);
});

test("a failed read does not blank or invent a total", async () => {
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  await board.refresh(new Error("fictional network failure"));
  assert.ok(["12", undefined].includes(board.headline()), `headline after failed read: ${board.headline()}`);
  assert.doesNotMatch(board.html(), /class="total-num">(?!12<)\d/);
});
