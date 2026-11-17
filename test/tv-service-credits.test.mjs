import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import handler from "../api/ingest.mjs";
import { selectReportedTotal } from "../api/_board-provenance.mjs";
import { mapDeliverySummaryGrid, parseDeliverySummaryRows } from "../api/_report-parsers.mjs";
import { storeKey, boardKey } from "../api/_store-keys.mjs";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

/* Every store, person, total and report here is fictional. These cover two board
   faults: month-to-date reports read as "Reports disagree", and Service-sourced
   deals left out of a salesperson's delivered number. */
const STORE = { id: "fictional-demo", name: "Fictional Demo Motors" };
const people = ["Alex Example", "Bailey Example", "Casey Example"];
const ym = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
const [Y, M] = ym.split("-").map(Number);
const period = (end) => `${M}/1/${Y} - ${M}/${end}/${Y}`;
const endDay = (end) => `${ym}-${String(end).padStart(2, "0")}`;

// ---------- the store total ----------
const hashes = ["a", "b", "c", "d"].map((c) => c.repeat(64));
function observation(count, end, hash) {
  return {
    schemaVersion: 1, metric: "printed_store_total_delivered", storeId: STORE.id,
    printedStoreName: STORE.name, reportMonth: ym, printedRange: { startDay: ym + "-01", endDay: endDay(end) },
    count, status: count === null ? "unknown" : "provisional", sentAt: null, asOf: null,
    source: { sha256: hash, byteLength: 2400, parserVersion: "delivery-summary-printed-total-month:v1", archiveState: "unverified" },
    sourceAssertions: [{ date: [], messageId: [] }], processingAt: "2026-11-12T14:00:00.000Z", publicationEligible: false,
  };
}
const bucket = (...values) => ({ [ym]: Object.fromEntries(values.map((v) => [v.source.sha256, v])) });
const select = (data) => selectReportedTotal(data, STORE.id, ym);
const provisional = (count) => ({ count, status: "provisional", month: ym, asOf: null });
const unknown = () => ({ count: null, status: "unknown", month: ym, asOf: null });
function permutations(values) {
  return values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => j !== i)).map((rest) => [value, ...rest])) : [[]];
}

test("daily month-to-date reports show the newest printed total instead of 'Reports disagree'", () => {
  const values = [observation(20, 3, hashes[0]), observation(41, 9, hashes[1]), observation(60, 16, hashes[2])];
  for (const order of permutations(values)) assert.deepEqual(select(bucket(...order)), provisional(60));
});

test("a later printed day wins even when it is lower, as when a deal is unwound", () => {
  assert.deepEqual(select(bucket(observation(60, 15, hashes[0]), observation(59, 16, hashes[1]))), provisional(59));
});

test("two reports printed for the same latest day that disagree still read as a conflict", () => {
  const values = [observation(20, 3, hashes[0]), observation(60, 16, hashes[1]), observation(61, 16, hashes[2])];
  for (const order of permutations(values)) assert.deepEqual(select(bucket(...order)), { ...unknown(), status: "conflict" });
  assert.deepEqual(select(bucket(observation(60, 16, hashes[0]), observation(60, 16, hashes[1]))), provisional(60));
});

test("an older unreadable total is superseded, but an unreadable latest one leaves the total unknown", () => {
  assert.deepEqual(select(bucket(observation(null, 3, hashes[0]), observation(60, 16, hashes[1]))), provisional(60));
  assert.deepEqual(select(bucket(observation(60, 16, hashes[0]), observation(null, 16, hashes[1]))), unknown());
  assert.deepEqual(select(bucket(observation(20, 3, hashes[0]), observation(null, 16, hashes[1]))), unknown());
  // A malformed record anywhere in the month still withholds the total.
  const broken = bucket(observation(20, 3, hashes[0]), observation(60, 16, hashes[1]));
  broken[ym][hashes[0]].status = "verified";
  assert.deepEqual(select(broken), unknown());
});

// ---------- Service credits ----------
const head = (name) => `${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`;
const FOUR = ["Internet 10 0 0 0 1 10%", "Phone 8 0 0 0 1 12%", "Showroom 6 2 1 0 1.5 16%", "Campaign 4 0 0 0 0 0%"];
const block = (name, sources = FOUR, total = "3.5") => [head(name), ...sources,
  "New 10 0 0 0 1 10%", "Used 8 0 0 0 1 10%", ...(total === null ? [] : [`Total 28 2 1 0 ${total} 18%`])];
const report = (end, storeTotal, blocks) => ["Delivery Summary", period(end), head(STORE.name),
  "Internet 50 0 0 0 5 10%", "Phone 20 0 0 0 3 15%", "Showroom 20 8 3 1 2 10%", "Campaign 10 0 0 0 1 10%",
  `Total 100 8 3 1 ${storeTotal} 12%`, ...blocks.flat()];
const parse = (texts) => parseDeliverySummaryRows(mapDeliverySummaryGrid(lines(texts)).rows);
const delivered = (r) => (+r.internetUnits || 0) + (+r.phoneUnits || 0) + (+r.showroomUnits || 0) + (+r.campaignUnits || 0) + (+r.serviceUnits || 0);

test("Service credits that only the person's Total row carries are counted", () => {
  // Bailey's sources add to 3.5; the Total row says 6, so 2.5 came from Service.
  const out = parse(report(16, "60", [block("Alex Example"), block("Bailey Example", FOUR, "6"), block("Casey Example")]));
  assert.equal(out["bailey example"].serviceUnits, 2.5);
  assert.equal(delivered(out["bailey example"]), 6);
  assert.equal(out["alex example"].serviceUnits, 0);
  assert.equal(delivered(out["alex example"]), 3.5);
  assert.deepEqual(Object.keys(out), ["alex example", "bailey example", "casey example"]);
});

test("a printed Service row is read as credits, not as a person named Service", () => {
  for (const at of [0, 2, 4]) {
    const sources = [...FOUR]; sources.splice(at, 0, "Service 3 0 0 0 2 66%");
    const out = parse(report(16, "60", [block("Alex Example", sources, "5.5"), block("Bailey Example"), block("Casey Example")]));
    assert.deepEqual(Object.keys(out), ["alex example", "bailey example", "casey example"], `Service row at ${at}`);
    assert.equal(out["alex example"].serviceUnits, 2);
    assert.equal(delivered(out["alex example"]), 5.5);
    assert.equal(delivered(out["bailey example"]), 3.5);
  }
});

test("no Total row means Service is not known, rather than zero", () => {
  const out = parse(report(16, "60", [block("Alex Example", FOUR, null), block("Bailey Example"), block("Casey Example")]));
  assert.equal(out["alex example"].serviceUnits, null);
  assert.equal(out["bailey example"].serviceUnits, 0);
  // A row mapped before the field existed reads as absent.
  assert.equal(parseDeliverySummaryRows([["Delivery Summary"], ["Name", "internetUnits"], ["Old Row", 1]])["old row"].serviceUnits, undefined);
});

// ---------- end to end through intake ----------
const lines = (texts) => texts.map((str, i) => ({ pg: 1, y: i * 16, parts: [{ str, x: 20 }] }));
function pdf(texts, revision = "") {
  const pages = Array.isArray(texts[0]) ? texts : [texts];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /CreationDate (D:20260101000000Z) /ModDate (D:20261231000000Z) >>"];
  for (const [page, values] of pages.entries()) {
    const content = values.map((text, i) => `BT /F1 8 Tf 20 ${2350 - i * 16} Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 2400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + page * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let body = "%PDF-1.4\n", offsets = [0];
  for (const [i, value] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(body + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n% ${revision}\n`);
}
function mime(bytes, headers = [], filename = "fictional-summary.pdf") {
  return Buffer.from(["From: fictional-reports@example.invalid", "To: lpc-fictionaldemo@example.invalid", "Subject: Fictional Summary",
    ...headers, "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="fictional-boundary"', "",
    "--fictional-boundary", "Content-Type: text/plain", "", "Fictional report", "--fictional-boundary",
    "Content-Type: application/pdf", `Content-Disposition: attachment; filename="${filename}"`, "Content-Transfer-Encoding: base64", "",
    bytes.toString("base64"), "--fictional-boundary--", ""].join("\r\n"));
}
function database(stores = [STORE]) {
  const db = new Map([["lpc:config:v2", { stores, roles: [{ id: "sales", onBoard: true }] }]]);
  for (const store of stores) {
    db.set(storeKey(store.id), { rev: 1, roster: people.map((name, i) => ({ id: `fictional-${i}`, name, roleId: "sales" })), months: {} });
    db.set(boardKey(store.id), { storeName: store.name, roles: [{ id: "sales" }], roster: [], months: {} });
  }
  return { db, requests: [], retries: 0, beforePatch: null, failArchives: false };
}
async function receive(state, bytes, headers = [], filename) {
  const savedFetch = globalThis.fetch;
  const names = ["INGEST_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = names.map((name) => ({ name, exists: Object.hasOwn(process.env, name), value: process.env[name] }));
  process.env.INGEST_SECRET = "fictional-intake-secret";
  process.env.SUPABASE_URL = "http://127.0.0.1:5433";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-service-key";
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url), filter = parsed.searchParams.get("key") || "", method = options.method || "GET";
    const key = filter.replace(/^eq\./, "");
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (method === "GET") {
      if (filter.startsWith("like.")) return json([...state.db.keys()].filter((k) => k.startsWith(filter.slice(5).replace(/%$/, ""))).map((key) => ({ key })));
      return json(state.db.has(key) ? [{ value: structuredClone(state.db.get(key)) }] : []);
    }
    if (method === "PATCH") {
      if (state.beforePatch) { const effect = state.beforePatch; state.beforePatch = null; effect(); }
      const current = state.db.get(key), want = parsed.searchParams.get("value->>rev");
      const matches = want === "is.null" ? current?.rev == null : String(current?.rev) === want?.replace(/^eq\./, "");
      if (!matches) { state.retries++; return json([]); }
      const value = JSON.parse(options.body).value;
      state.db.set(key, value); state.requests.push({ method, key, value: structuredClone(value) });
      return json([{ value }]);
    }
    if (method === "POST") {
      for (const row of JSON.parse(options.body)) {
        if (state.failArchives && row.key.startsWith("lpc:reportfile:")) throw new Error("fictional archive failure");
        state.db.set(row.key, row.value); state.requests.push({ method, key: row.key, value: structuredClone(row.value) });
      }
      return json([]);
    }
    if (method === "DELETE") { state.db.delete(key); return json([]); }
    throw new Error(`unlisted fictional request ${method}`);
  };
  const raw = mime(bytes, headers, filename), output = {};
  const req = { method: "POST", headers: { "x-ingest-secret": "fictional-intake-secret" }, async *[Symbol.asyncIterator]() { yield raw; } };
  const res = { status(code) { output.code = code; return this; }, json(body) { output.body = body; return this; } };
  try { await handler(req, res); return output; }
  finally {
    globalThis.fetch = savedFetch;
    for (const old of saved) { if (old.exists) process.env[old.name] = old.value; else delete process.env[old.name]; }
  }
}

test("two daily emailed reports reach the board with the newest total and each person's Service credits", async () => {
  const state = database();
  const first = await receive(state, pdf(report(3, "20", [block("Alex Example"), block("Bailey Example", FOUR, "4"), block("Casey Example")])));
  assert.equal(first.code, 200, JSON.stringify(first.body));
  const second = await receive(state, pdf(report(16, "60", [block("Alex Example"), block("Bailey Example", FOUR, "6"), block("Casey Example")])));
  assert.equal(second.code, 200, JSON.stringify(second.body));
  const row = state.db.get(boardKey(STORE.id)).months[ym];
  assert.deepEqual(row.reportedTotal, provisional(60));
  assert.equal(row.stats["bailey example"].serviceUnits, 2.5);
  assert.equal(delivered(row.stats["bailey example"]), 6);
  assert.equal(state.db.get(storeKey(STORE.id)).months[ym].stats["bailey example"].serviceUnits, 2.5);
});

// ---------- the board ----------
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

async function board(stats, at) {
  const config = { stores: [{ id: STORE.id, name: STORE.name }], roles: [{ id: "sales", onBoard: true }] };
  const data = { roster: people.map((name, i) => ({ id: "p" + i, name, roleId: "sales" })), months: { [ym]: { stats } } };
  return (await clientPublisher)(config, STORE.id, data);
}
async function render(first) {
  const elements = new Map(), intervals = [], added = [];
  const element = () => ({ innerHTML: "", textContent: "", className: "", style: { setProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], addEventListener() {},
    getAttribute: () => null, appendChild(child) { added.push(child); }, remove() {} });
  const at = `${ym}-16T16:00:00Z`;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return new Date(at).getTime(); } }
  const window = { innerHeight: 1080, innerWidth: 1920, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  window.parent = window;
  let payload = first;
  const context = vm.createContext({ window, Date: Clock, Intl, Number, console, URL, Math,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      body: element(), createElement: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => [{ value: payload }] }),
  });
  const html = LEADERBOARD_HTML({ ...first, storeKey: "fictional-board", db: { url: "http://127.0.0.1:5433", anonKey: "fictional" } }, (await clientModule).PIX);
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], context);
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  await settle();
  return {
    root: elements.get("root"),
    congrats: () => added.filter((n) => /cg-card/.test(n.innerHTML)).map((n) => n.innerHTML).join(""),
    async refresh(next) { payload = next; intervals.find((t) => t.ms === 15 * 60 * 1000).fn(); await settle(); },
  };
}
const statsWith = (service) => Object.fromEntries(people.map((name, i) => [name.toLowerCase(),
  { internetUnits: 1, phoneUnits: 1, showroomUnits: 1.5, campaignUnits: 0, ...(service ? { serviceUnits: i === 1 ? 2.5 : 0 } : {}) }]));

test("the board's delivered number and credit line include Service credits", async () => {
  const view = await render(await board(statsWith(true)));
  assert.match(view.root.innerHTML, /data-to="6"/);
  assert.match(view.root.innerHTML, /Displayed associate credits: 13/);
});

test("Service credits arriving for the first time are not celebrated as new deliveries", async () => {
  const view = await render(await board(statsWith(false)));
  await view.refresh(await board(statsWith(true)));
  assert.equal(view.congrats(), "");
  assert.match(view.root.innerHTML, /data-to="6"/);
  // Once both sides carry Service, a new Service deal is celebrated like any other.
  const more = statsWith(true); more["bailey example"].serviceUnits = 3.5;
  await view.refresh(await board(more));
  assert.match(view.congrats(), /Bailey Example<\/b><span>just delivered 1 unit/);
});

test("a person's trend beside the delivered number does not move just because Service is now counted", async () => {
  const cellOf = (html) => html.match(/<span class="soldnum" data-to="6">0<\/span>([\s\S]*?)<\/td>/)?.[1];
  const stats = statsWith(true);
  stats["bailey example"].prevUnits = { internet: 1, phone: 1, showroom: 1.5, campaign: 0 };
  const same = cellOf((await render(await board(stats))).root.innerHTML);
  assert.equal(typeof same, "string", "Bailey's delivered cell is on the board");
  assert.doesNotMatch(same, /class="move"/);
  // Control: a real move since yesterday still shows.
  stats["bailey example"].prevUnits = { internet: 0, phone: 1, showroom: 1.5, campaign: 0 };
  assert.match(cellOf((await render(await board(stats))).root.innerHTML), /class="move"/);
});
