/* TV Board Total Delivered: evidence for review, and the credit-drop note. Every store, person, count and
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
   returns (or, for a rotating screen, a function of the store key read);
   refresh() fires the board's own 15 minute data timer, no reload; rollover()
   moves the clock and fires the board's own 10 second clock; runTimers(ms) runs
   the board's own pending timeouts of that length (the hand-over uses them). */
async function openBoard(first, serveFirst = first) {
  const elements = new Map(), intervals = [], created = [];
  let timeouts = [];
  const element = () => { const cls = new Set(); return { innerHTML: "", textContent: "", scrollHeight: 0, clientHeight: 0, style: { setProperty() {} },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {}, getAttribute: () => null,
    setAttribute() {}, appendChild(c) { return c; }, removeChild() {}, remove() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }) }; };
  let serve = serveFirst, instant = OPEN_AT;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [instant])); } static now() { return new Date(instant).getTime(); } }
  const window = { innerHeight: 1080, innerWidth: 1920, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  window.parent = window;
  const ctx = vm.createContext({ window, Date: Clock, Intl, Number, console, URL, Math,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      body: element(), createElement: () => { const e = element(); created.push(e); return e; }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; }, clearTimeout() {},
    setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {},
    fetch: async (url) => { const v = typeof serve === "function" ? serve(decodeURIComponent(String(url))) : serve;
      return v instanceof Error ? Promise.reject(v) : { ok: true, status: 200, json: async () => [{ value: v }] }; },
  });
  const html = LEADERBOARD_HTML({ ...first, storeKey: "fictional-board", db: { url: "http://127.0.0.1:5433", anonKey: "fictional" } }, (await app).PIX);
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], ctx);
  const root = () => elements.get("root");
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  await settle();
  return {
    html: () => root().innerHTML,
    headline: () => (/class="total-num">([^<]*)<\/div>/.exec(root().innerHTML) || [])[1],
    creditNote: () => elements.get("credit-note")?.classList.contains("on") === true,
    timers: () => intervals.map((t) => t.ms),
    congrats: () => created.filter((e) => e.className === "congrats").map((e) => e.innerHTML).join(" "),
    async refresh(next) { serve = next; intervals.find((t) => t.ms === 15 * 60 * 1000).fn(); await settle(); },
    serve(next) { serve = next; },
    rollover(next) { instant = next; intervals.find((t) => t.ms === 10000).fn(); },
    async runTimers(ms) { const due = timeouts.filter((t) => t.ms === ms); timeouts = timeouts.filter((t) => t.ms !== ms);
      for (const t of due) t.fn(); await settle(); },
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

test("a genuine lower printed total shows at once, with its lower credits, and no note", async () => {
  const first = await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }, [5, 1, 0]);
  const board = await openBoard(first);
  await board.refresh(await payload({ count: 8, status: "provisional", month: MONTH, asOf: null }, [0, 0, 0]));
  assert.equal(board.headline(), "8"); assert.equal(board.creditNote(), false);
});

test("the old credit-drop hold is gone: a row carrying a store field no longer keeps the old total", async () => {
  // Before this patch, tooDifferent() held the old board when a row had `store`
  // and credits fell by more than half, even for a genuine correction.
  const withStore = async (total, credits) => ({ ...(await payload(total, credits)), store: STORE.id });
  const board = await openBoard(await withStore({ count: 12, status: "provisional", month: MONTH, asOf: null }, [5, 1, 0]));
  await board.refresh(await withStore({ count: 8, status: "provisional", month: MONTH, asOf: null }, [0, 0, 0]));
  assert.equal(board.headline(), "8"); assert.equal(board.creditNote(), false);
  assert.doesNotMatch(LEADERBOARD_HTML({ storeKey: "x", db: { url: "http://127.0.0.1:5433", anonKey: "x" } }, {}), /tooDifferent|Holding the last board/);
});

test("a failed read does not blank or invent a total", async () => {
  const board = await openBoard(await payload({ count: 12, status: "provisional", month: MONTH, asOf: null }));
  await board.refresh(new Error("fictional network failure"));
  assert.ok(["12", undefined].includes(board.headline()), `headline after failed read: ${board.headline()}`);
  assert.doesNotMatch(board.html(), /class="total-num">(?!12<)\d/);
});

const T12 = { count: 12, status: "provisional", month: MONTH, asOf: null };

test("credits drop while the printed total holds: a note shows, the total still renders as reported", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));
  assert.equal(board.creditNote(), false);
  await board.refresh(await payload(T12, [0, 0, 0]));
  assert.equal(board.headline(), "12"); assert.equal(board.creditNote(), true);
  assert.match(board.html(), /Displayed associate credits: 1\.5</);   // the board under the note is the new one
  assert.equal(board.congrats(), "");
});

test("credits coming back after the drop are not celebrated as new sales, and the note clears", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));
  await board.refresh(await payload(T12, [0, 0, 0]));
  await board.refresh(await payload(T12, [5, 1, 0]));
  assert.equal(board.headline(), "12"); assert.equal(board.creditNote(), false);
  assert.equal(board.congrats(), "");
});

test("a partial return keeps the note up; only units beyond what was lost are celebrated", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));
  await board.refresh(await payload(T12, [0, 0, 0]));
  await board.refresh(await payload(T12, [3, 0, 0]));
  assert.equal(board.creditNote(), true); assert.equal(board.congrats(), "");
  await board.refresh(await payload({ count: 13, status: "provisional", month: MONTH, asOf: null }, [6, 1, 0]));
  assert.equal(board.headline(), "13"); assert.equal(board.creditNote(), false);
  assert.match(board.congrats(), /Alex Example<\/b><span>just delivered 1 unit</);
  assert.doesNotMatch(board.congrats(), /Bailey Example/);
});

test("no note when the printed total is unknown or in conflict, or when credits rise", async () => {
  const unknown = { count: null, status: "unknown", month: MONTH, asOf: null };
  const conflict = { count: null, status: "conflict", month: MONTH, asOf: null };
  for (const t of [unknown, conflict]) {
    const board = await openBoard(await payload(t, [5, 1, 0]));
    await board.refresh(await payload(t, [0, 0, 0]));
    assert.equal(board.creditNote(), false, t.status);
  }
  const board = await openBoard(await payload(T12, [1, 1, 0]));
  await board.refresh(await payload(T12, [2, 1, 0]));
  assert.equal(board.creditNote(), false);
  assert.match(board.congrats(), /Alex Example<\/b><span>just delivered 1 unit</);
});

test("a real new sale with no earlier drop is still celebrated", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));
  await board.refresh(await payload({ count: 13, status: "provisional", month: MONTH, asOf: null }, [6, 1, 0]));
  assert.equal(board.headline(), "13"); assert.equal(board.creditNote(), false);
  assert.match(board.congrats(), /Alex Example<\/b><span>just delivered 1 unit</);
});

/* Two fictional stores on one rotating screen. Store A's row asks the screen to
   rotate to store B; the hand-over is the board's own (dwell timer, convoy,
   swap), driven here by running its pending timeouts. */
const B_ID = "fictional-second";
async function storeRow(id, name, reportedTotal, credits, extra = {}) {
  return { ...(await payload(reportedTotal, credits)), storeId: id, storeName: name, ...extra };
}
const SETTLE = 400, DWELL = 45000, SWAP = 1250, LANE_DONE = 3600;
async function handOver(board) {
  await board.runTimers(SETTLE);     // layout settles; everyone fits, so the dwell timer starts
  await board.runTimers(DWELL);      // the short-list dwell ends: the next store is read
  await board.runTimers(SWAP);       // the convoy covers the screen and the board swaps
  await board.runTimers(LANE_DONE);  // the convoy leaves; the hand-over is finished
}

test("a real store switch clears the note and its tracking: A to B to A with no refresh on B does not bring it back", async () => {
  const rotate = { boardDisplay: { rotate: [B_ID] } };
  const aFull = await storeRow(STORE.id, STORE.name, T12, [5, 1, 0], rotate);
  const aDipped = await storeRow(STORE.id, STORE.name, T12, [0, 0, 0], rotate);
  const b = await storeRow(B_ID, "Fictional Second Motors", { count: 7, status: "provisional", month: MONTH, asOf: null }, [2, 1, 0]);
  const board = await openBoard(aFull);
  await board.refresh(aDipped);
  assert.equal(board.creditNote(), true); assert.equal(board.headline(), "12");
  board.serve((url) => (url.includes(`lpc:board:${B_ID}:v1`) ? b : aDipped));
  await handOver(board);
  assert.equal(board.headline(), "7"); assert.equal(board.creditNote(), false);   // B is on the wall
  await handOver(board);                                                           // back to A, no refresh on B
  assert.equal(board.headline(), "12"); assert.equal(board.creditNote(), false);   // A's printed total, no old note
  assert.equal(board.congrats(), "");
  // A later refresh of A with no further drop does not raise the note again.
  await board.refresh(aDipped);
  assert.equal(board.headline(), "12"); assert.equal(board.creditNote(), false);
});

test("Eastern month rollover clears the note and its tracking with no new report; the printed total is untouched", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));
  await board.refresh(await payload(T12, [0, 0, 0]));
  assert.equal(board.creditNote(), true); assert.equal(board.headline(), "12");
  // Control: the same board with no drop, rolled over the same way.
  const control = await openBoard(await payload(T12, [0, 0, 0]));
  const NEXT = "2026-10-01T04:00:05Z";   // just after midnight Eastern, October 1
  board.rollover(NEXT); control.rollover(NEXT);
  assert.equal(board.creditNote(), false);
  assert.equal(board.headline(), control.headline());   // what prints is what any board prints after rollover
  // The next refresh of the same September row does not bring the note back.
  await board.refresh(await payload(T12, [0, 0, 0]));
  assert.equal(board.creditNote(), false);
  assert.equal(board.headline(), control.headline());
});

test("a late prior-month report after Eastern rollover does not start the note; only the current month is watched", async () => {
  const board = await openBoard(await payload(T12, [5, 1, 0]));       // a September row, opened in September
  const control = await openBoard(await payload(T12, [5, 1, 0]));
  const NEXT = "2026-10-01T04:00:05Z";   // just after midnight Eastern, October 1
  board.rollover(NEXT); control.rollover(NEXT);
  assert.equal(board.creditNote(), false);
  // A late September report arrives in October: September's printed total is unchanged, its credits fell.
  await board.refresh(await payload(T12, [0, 0, 0]));
  assert.equal(board.creditNote(), false);
  assert.equal(board.headline(), control.headline());   // the printed total is shown as it would be anyway
  // A second late September report with the credits back does not raise it either.
  await board.refresh(await payload(T12, [5, 1, 0]));
  assert.equal(board.creditNote(), false);
  assert.equal(board.headline(), control.headline());
});

/* Service credits (counted on the board since main #525) follow the same rule as
   the congratulations: they count toward a drop only when both reports carry them. */
async function withService(row, units) {
  for (const [i, p] of people.entries()) row.months[MONTH].stats[p.toLowerCase()].serviceUnits = units[i];
  return row;
}
test("Service credits that fall while the printed total holds raise the note; Service first appearing or going missing does not", async () => {
  const board = await openBoard(await withService(await payload(T12, [1, 1, 0]), [3, 0, 0]));
  await board.refresh(await withService(await payload(T12, [1, 1, 0]), [0, 0, 0]));
  assert.equal(board.headline(), "12"); assert.equal(board.creditNote(), true);
  await board.refresh(await withService(await payload(T12, [1, 1, 0]), [3, 0, 0]));
  assert.equal(board.creditNote(), false); assert.equal(board.congrats(), "");
  const fresh = await openBoard(await payload(T12, [1, 1, 0]));                       // no Service yet
  await fresh.refresh(await withService(await payload(T12, [1, 1, 0]), [3, 0, 0]));    // Service appears
  await fresh.refresh(await payload(T12, [1, 1, 0]));                                  // Service missing again
  assert.equal(fresh.creditNote(), false); assert.equal(fresh.headline(), "12");
});
