import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { selectReportedTotal } from "../api/_board-provenance.mjs";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

// Fictional observations match the reviewed private ingest schema. They do not
// prove source authenticity, live publisher wiring, or any store's current total.
const STORE = "fictional-demo", MONTH = "2026-09";
const hashes = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const unknown = (month = MONTH) => ({ count: null, status: "unknown", month, asOf: null });
const provisional = (count, month = MONTH) => ({ count, status: "provisional", month, asOf: null });
function observation(count = 4, hash = hashes[0], month = MONTH) {
  return {
    schemaVersion: 1, metric: "printed_store_total_delivered", storeId: STORE,
    printedStoreName: "Fictional Demo Motors", reportMonth: month,
    printedRange: { startDay: month + "-01", endDay: month + "-07" },
    count, status: count === null ? "unknown" : "provisional", sentAt: null, asOf: null,
    source: { sha256: hash, byteLength: 2400, parserVersion: "delivery-summary-printed-total-month:v1", archiveState: "unverified" },
    sourceAssertions: [{ date: [], messageId: [] }],
    processingAt: "2026-11-12T14:00:00.000Z", publicationEligible: false,
  };
}
const map = (...values) => ({ [MONTH]: Object.fromEntries(values.map((value) => [value.source.sha256, value])) });
const select = (value) => selectReportedTotal(value, STORE, MONTH);
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function permutations(values) {
  return values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => j !== i)).map((rest) => [value, ...rest])) : [[]];
}

test("one scoped whole report total is provisional with unknown as-of, even on delayed processing", () => {
  const value = observation();
  assert.deepEqual(select(map(value)), provisional(4));
  value.processingAt = "2099-01-01T00:00:00.000Z";
  assert.deepEqual(select(map(value)), provisional(4));
  // No reading of current date, report header or processing time makes it current.
  value.sourceAssertions = [{ date: ["unverified source assertion"], messageId: ["fictional-message"] }];
  assert.deepEqual(select(map(value)), provisional(4));
});

test("explicit printed zero is distinct from absent, unknown and fractional evidence", () => {
  assert.deepEqual(select(map(observation(0))), provisional(0));
  assert.deepEqual(select(map(observation(null))), unknown());
  for (const count of [undefined, "4", false, [], {}, -1, 0.5, 3.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const value = observation(); value.count = count;
    assert.deepEqual(select(map(value)), unknown());
  }
  assert.deepEqual(select(map(observation(Number.MAX_SAFE_INTEGER))), provisional(Number.MAX_SAFE_INTEGER));
});

test("a transport retry keeps the same reported value without claiming a new report issuance", () => {
  const value = observation(), data = map(value);
  data[MONTH][hashes[0]] = { ...value, sourceAssertions: [...value.sourceAssertions, { date: ["another assertion"], messageId: ["retry"] }] };
  assert.deepEqual(select(data), provisional(4));
});

test("distinct sources agreeing on one count stay provisional in every arrival order", () => {
  const values = hashes.map((hash) => observation(4, hash));
  for (const order of permutations(values)) assert.deepEqual(select(map(...order)), provisional(4));
});

test("conflicting counts including downward corrections never select by arrival, processing or header time", () => {
  const values = [observation(4), observation(3, hashes[1]), observation(4, hashes[2])];
  values[1].processingAt = "2099-01-01T00:00:00.000Z";
  values[1].sourceAssertions = [{ date: ["later sender assertion"], messageId: ["later"] }];
  for (const order of permutations(values)) {
    assert.deepEqual(select(map(...order)), { ...unknown(), status: "conflict" });
  }
});

test("incomplete relevant evidence prevents cherry-picking a convenient known total", () => {
  for (const order of [[observation(4), observation(null, hashes[1])], [observation(null, hashes[1]), observation(4)]]) {
    assert.deepEqual(select(map(...order)), unknown());
  }
  const malformed = map(observation()); malformed[MONTH][hashes[1]] = null;
  assert.deepEqual(select(malformed), unknown());
});

test("unrelated month buckets cannot contaminate the selected month or supply a rollover fallback", () => {
  const data = { ...map(observation()), "2026-08": null, "2026-10": ["unrelated malformed bucket"] };
  assert.deepEqual(select(data), provisional(4));
  assert.deepEqual(selectReportedTotal(data, STORE, "2026-11"), unknown("2026-11"));
  const december = observation(8, hashes[1], "2026-12"), january = observation(2, hashes[2], "2027-01");
  const year = { "2026-12": { [hashes[1]]: december }, "2027-01": { [hashes[2]]: january } };
  assert.deepEqual(selectReportedTotal(year, STORE, "2026-12"), provisional(8, "2026-12"));
  assert.deepEqual(selectReportedTotal(year, STORE, "2027-01"), provisional(2, "2027-01"));
});

test("evidence inside the selected bucket must match exact store and printed month", () => {
  for (const change of [
    { storeId: "other-store" }, { storeId: STORE.toUpperCase() }, { reportMonth: "2026-08" },
    { printedStoreName: "" }, { printedStoreName: ["Fictional Demo Motors"] },
    { printedRange: null }, { printedRange: { startDay: "2026-09-02", endDay: "2026-09-07" } },
    { printedRange: { startDay: "2026-09-01", endDay: "2026-10-07" } },
    { printedRange: { startDay: "2026-09-01", endDay: "2026-09-31" } },
  ]) assert.deepEqual(select(map({ ...observation(), ...change })), unknown());
  const swapped = map(observation()); swapped[MONTH][hashes[0]].reportMonth = "2026-10";
  assert.deepEqual(select(swapped), unknown());
});

test("actual byte-identity metadata must have the expected types and internally matching digest", () => {
  const changes = [null, [], "source", {}, { sha256: hashes[1] }, { sha256: [hashes[0]] },
    { byteLength: 0 }, { byteLength: "2400" }, { byteLength: 1.5 }, { byteLength: Infinity },
    { parserVersion: "another-parser" }, { archiveState: "verified" }];
  for (const change of changes) {
    const value = observation();
    value.source = change && !Array.isArray(change) && typeof change === "object" ? { ...value.source, ...change } : change;
    if (change && Object.keys(change).length === 0) value.source = {};
    const data = { [MONTH]: { [hashes[0]]: value } };
    assert.deepEqual(select(data), unknown());
  }
  for (const key of ["", hashes[0].toUpperCase(), "not-a-digest"]) {
    assert.deepEqual(select({ [MONTH]: { [key]: observation() } }), unknown());
  }
});

test("incomplete or purportedly verified records cannot be promoted to current authority", () => {
  for (const key of ["schemaVersion", "metric", "storeId", "reportMonth", "printedStoreName", "printedRange", "count", "status", "source", "sentAt", "asOf", "publicationEligible", "sourceAssertions", "processingAt"]) {
    const value = observation(); delete value[key];
    assert.deepEqual(select({ [MONTH]: { [hashes[0]]: value } }), unknown());
  }
  for (const change of [{ schemaVersion: 2 }, { metric: "associate_credits" }, { status: "verified" },
    { publicationEligible: true }, { sentAt: "2026-09-07T12:00:00Z" }, { asOf: "2026-09-07T12:00:00Z" }]) {
    assert.deepEqual(select(map({ ...observation(), ...change })), unknown());
  }
  // Arbitrary caller flags do not change the four-field provisional result.
  assert.deepEqual(select(map({ ...observation(), verified: true, authentic: true, current: true })), provisional(4));
});

test("processing metadata and source assertions must retain their actual schema without becoming report time", () => {
  for (const processingAt of [null, {}, "invalid", "2026-02-30T00:00:00.000Z", "2026-09-07"]) {
    assert.deepEqual(select(map({ ...observation(), processingAt })), unknown());
  }
  for (const sourceAssertions of [null, {}, [], [null], [{}], [{ date: "date", messageId: [] }],
    [{ date: [], messageId: [123] }], [{ date: [{}], messageId: [] }]]) {
    assert.deepEqual(select(map({ ...observation(), sourceAssertions })), unknown());
  }
  const value = observation(); value.sourceAssertions = [{ date: ["invalid sender date"], messageId: [""] }];
  assert.deepEqual(select(map(value)), provisional(4));
});

test("absent and malformed maps, buckets and lookup arguments remain unknown", () => {
  for (const data of [undefined, null, false, 4, "map", [], {}, { [MONTH]: null }, { [MONTH]: [] }, { [MONTH]: {} },
    Object.create({ [MONTH]: { [hashes[0]]: observation() } })]) assert.deepEqual(select(data), unknown());
  for (const store of [null, "", [], {}, "other-store", "fictional demo"]) {
    assert.deepEqual(selectReportedTotal(map(observation()), store, MONTH), unknown());
  }
  for (const month of [null, "", [], {}, "2026-9", "2026-00", "2026-13", "0000-09", "2026-09<script>"]) {
    assert.deepEqual(selectReportedTotal(map(observation()), STORE, month), unknown(null));
  }
  const bucket = Object.assign(Object.create(null), { [hashes[0]]: observation() });
  assert.deepEqual(select(Object.assign(Object.create(null), { [MONTH]: bucket })), provisional(4));
});

test("only count, status, month and null asOf escape, without raw report or private metadata", () => {
  const sentinel = "PRIVATE_SENTINEL_must_not_escape";
  const value = observation();
  value.source.filename = sentinel + ".pdf"; value.source.extra = { reportText: sentinel };
  value.sourceAssertions = [{ date: [sentinel], messageId: [sentinel], headers: { subject: sentinel, from: sentinel + "@example.invalid" } }];
  value.filename = sentinel; value.reportText = sentinel; value.email = { raw: sentinel };
  value.unrelated = { password: sentinel, people: [{ name: sentinel, credit: 0.5 }] };
  const data = map(value), result = select(data);
  assert.deepEqual(Object.keys(result).sort(), ["asOf", "count", "month", "status"]);
  assert.deepEqual(result, provisional(4));
  const output = JSON.stringify(result);
  assert.equal(output.includes(sentinel), false); assert.equal(output.includes(hashes[0]), false);
  for (const status of [result, select(map(observation(null))), select(map(observation(4), observation(3, hashes[1])))]) {
    assert.deepEqual(Object.keys(status).sort(), ["asOf", "count", "month", "status"]);
    assert.equal(status.asOf, null);
  }
});

test("selection is deterministic and does not mutate private evidence", () => {
  const data = freeze(map(observation())), before = JSON.stringify(data);
  const first = select(data); first.count = 900;
  assert.deepEqual(select(data), provisional(4)); assert.equal(JSON.stringify(data), before);
});

// Compile the complete production modules with test-only exports. The tested
// publisher functions and their helpers are not copied or reimplemented here.
async function publisherModule(path, name) {
  const url = new URL(path, import.meta.url);
  const output = await build({ stdin: { contents: fs.readFileSync(url, "utf8") + `\nexport { ${name} };\n`,
    resolveDir: fileURLToPath(new URL(".", url)), sourcefile: fileURLToPath(url), loader: path.endsWith("jsx") ? "jsx" : "js" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent", loader: { ".css": "text" },
    define: { "import.meta.env": "{}", "import.meta.url": JSON.stringify(url.href) } });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(url), module, module.exports);
  return module.exports;
}
const clientModule = publisherModule("../src/LeadPerformanceCalculator.jsx", "buildBoardPayload");
const clientPublisher = clientModule.then((module) => module.buildBoardPayload);
const serverPublisher = publisherModule("../api/ingest.mjs", "refreshBoardRow").then((module) => module.refreshBoardRow);
const currentMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
function publisherFixture(values) {
  const month = currentMonth();
  const config = { stores: [{ id: STORE, name: "Fictional Demo Motors" }], roles: [{ id: "sales", onBoard: true }, { id: "bdc", onBoard: false }] };
  const data = { roster: [{ id: "a", name: "Alex Example", roleId: "sales" }, { id: "b", name: "Bailey Example", roleId: "sales" },
    { id: "c", name: "Casey Example", roleId: "bdc" }], months: { [month]: { stats: {
      "alex example": { internetUnits: 1, phoneUnits: 0.5, showroomUnits: 0, campaignUnits: 0 },
      "bailey example": { internetUnits: 1, phoneUnits: 1, showroomUnits: 0, campaignUnits: 0 },
      "casey example": { internetUnits: 100, phoneUnits: 0, showroomUnits: 0, campaignUnits: 0 },
    } } }, deliverySummaryObservations: { [month]: Object.fromEntries(values.map((count, i) => {
      const value = observation(count, hashes[i], month);
      value.source.filename = "PRIVATE_SOURCE_SENTINEL.pdf";
      value.sourceAssertions = [{ date: ["PRIVATE_SOURCE_SENTINEL"], messageId: ["PRIVATE_SOURCE_SENTINEL"] }];
      return [hashes[i], value];
    })) } };
  return { month, config, data };
}
async function publishBoth(fixture) {
  const client = (await clientPublisher)(fixture.config, STORE, fixture.data);
  const savedFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = names.map((name) => ({ name, exists: Object.hasOwn(process.env, name), value: process.env[name] }));
  process.env.SUPABASE_URL = "http://127.0.0.1:5433"; process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-key";
  let server;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(url).origin, "http://127.0.0.1:5433", "no live request is permitted");
    if ((options.method || "GET") === "GET") return { ok: true, json: async () => [{ value: client }] };
    assert.equal(options.method, "POST");
    const rows = JSON.parse(options.body); assert.equal(rows.length, 1); server = rows[0].value;
    return { ok: true, text: async () => "", json: async () => [] };
  };
  try { assert.equal((await (await serverPublisher)(STORE, fixture.data)).published, true); }
  finally {
    globalThis.fetch = savedFetch;
    for (const old of saved) { if (old.exists) process.env[old.name] = old.value; else delete process.env[old.name]; }
  }
  return [client, server];
}

test("actual browser and ingest publishers agree and expose only the derived aggregate", async () => {
  for (const counts of [[4], [4, 4], [4, 3], [3, 4], [0], [null], []]) {
    const fixture = publisherFixture(counts), rows = await publishBoth(fixture);
    const expected = selectReportedTotal(fixture.data.deliverySummaryObservations, STORE, fixture.month);
    for (const row of rows) {
      assert.deepEqual(row.months[fixture.month].reportedTotal, expected);
      assert.deepEqual(row.months[fixture.month].stats, fixture.data.months[fixture.month].stats && {
        "alex example": fixture.data.months[fixture.month].stats["alex example"],
        "bailey example": fixture.data.months[fixture.month].stats["bailey example"],
      });
      assert.equal(row.months[fixture.month].stats["alex example"].phoneUnits, 0.5);
      const serialized = JSON.stringify(row);
      assert.equal(serialized.includes("PRIVATE_SOURCE_SENTINEL"), false);
      assert.equal(serialized.includes(hashes[0]), false);
      assert.equal(serialized.includes("deliverySummaryObservations"), false);
      assert.deepEqual(Object.keys(row.months[fixture.month].reportedTotal).sort(), ["asOf", "count", "month", "status"]);
    }
  }
});

test("both actual publishers withhold wrong-store, wrong-month and incomplete report evidence", async () => {
  for (const change of [{ storeId: "other-store" }, { reportMonth: "2026-08" }, { source: null }]) {
    const fixture = publisherFixture([4]);
    Object.assign(fixture.data.deliverySummaryObservations[fixture.month][hashes[0]], change);
    for (const row of await publishBoth(fixture)) assert.deepEqual(row.months[fixture.month].reportedTotal, unknown(fixture.month));
  }
});

async function renderEmbedded(payload, at = "2026-09-07T16:00:00Z") {
  const elements = new Map(), intervals = [];
  const element = () => ({ innerHTML: "", textContent: "", style: { setProperty() {} }, classList: { add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => [], addEventListener() {}, getAttribute: () => null });
  let instant = at;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new Date(instant).getTime(); } }
  const window = { innerHeight: 1080, innerWidth: 1920, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  window.parent = window;
  const context = vm.createContext({ window, Date: Clock, Intl, Number, console, URL, Math,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      body: element(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => [{ value: payload }] }),
  });
  const html = LEADERBOARD_HTML({ ...payload, storeKey: "fictional-board", db: { url: "http://127.0.0.1:5433", anonKey: "fictional" } }, (await clientModule).PIX);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.equal(scripts.length, 1);
  vm.runInContext(scripts[0][1], context);
  for (let i = 0; i < 20 && !elements.get("root")?.innerHTML; i++) await Promise.resolve();
  const root = elements.get("root"); assert.ok(root.innerHTML);
  return { root, rollover(next) { instant = next; intervals.find((timer) => timer.ms === 10000).fn(); } };
}
async function renderFixture(total) {
  const fixture = publisherFixture([4]);
  const row = (await clientPublisher)(fixture.config, STORE, fixture.data);
  row.months = { [MONTH]: { ...row.months[fixture.month], reportedTotal: total } };
  return row;
}

test("real embedded renderer separates whole report count from visible fractional associate credits", async () => {
  const board = await renderEmbedded(await renderFixture(provisional(4)));
  assert.match(board.root.innerHTML, /class="total-num">4<\/div>/);
  assert.match(board.root.innerHTML, /Reported Total Delivered/);
  assert.match(board.root.innerHTML, /role="status">Provisional &middot; Report time unknown/);
  assert.match(board.root.innerHTML, /Displayed associate credits: 3\.5/);
  assert.match(board.root.innerHTML, /data-to="1\.5"/);
  assert.doesNotMatch(board.root.innerHTML, /class="total-num"><span[^>]*>0/);
});

test("real renderer keeps zero, conflict, unknown and malformed public evidence distinct", async () => {
  const cases = [[provisional(0), "0", /Provisional/], [{ ...unknown(), status: "conflict" }, "-", /Reports disagree/],
    [undefined, "-", /Unknown/], [provisional(3.5), "-", /Unknown/], [provisional(4, "2026-08"), "-", /Unknown/],
    [{ ...provisional(4), status: "verified" }, "-", /Unknown/], [{ ...provisional(4), asOf: "2026-09-07T12:00:00Z" }, "-", /Unknown/],
    [{ ...provisional(4), source: "PRIVATE_SOURCE_SENTINEL" }, "-", /Unknown/]];
  for (const [value, headline, label] of cases) {
    const { root } = await renderEmbedded(await renderFixture(value));
    assert.ok(root.innerHTML.includes('class="total-num">' + headline + '</div>'));
    assert.match(root.innerHTML, label); assert.doesNotMatch(root.innerHTML, /PRIVATE_SOURCE_SENTINEL/);
    assert.match(root.innerHTML, /Displayed associate credits: 3\.5/);
  }
});

test("the real store headline does not depend on eligible associate rows", async () => {
  const row = await renderFixture(provisional(4)); row.roster = []; row.months[MONTH].stats = {};
  const { root } = await renderEmbedded(row);
  assert.match(root.innerHTML, /class="total-num">4<\/div>/);
  assert.match(root.innerHTML, /Displayed associate credits: 0/);
  assert.match(root.innerHTML, /Provisional/);
});

test("an already-open embedded board does not carry last month's report across Eastern rollover", async () => {
  const board = await renderEmbedded(await renderFixture(provisional(4)), "2026-10-01T03:59:59Z");
  assert.match(board.root.innerHTML, /Reported Total Delivered/);
  board.rollover("2026-10-01T04:00:00Z");
  assert.match(board.root.innerHTML, /No data yet/);
  assert.doesNotMatch(board.root.innerHTML, /Reported Total Delivered|class="total-num">4/);
});
