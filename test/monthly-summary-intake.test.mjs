import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import handler, { extractPdfLines } from "../api/ingest.mjs";
import { mapDeliverySummaryGrid, parseDeliverySummaryRows } from "../api/_report-parsers.mjs";
import { storeKey, boardKey, restoreKey } from "../api/_store-keys.mjs";
import { mergeAgainstServer } from "../api/_store-merge.mjs";

// All report names, people, totals, headers and PDF bytes below are fictional.
const STORE = { id: "fictional-demo", name: "Fictional Demo Motors" };
const people = ["Alex Example", "Bailey Example", "Casey Example"];
const heading = (name) => `${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`;
function report({ period = ["9/1/2026 - 9/7/2026"], count = "12", name = STORE.name } = {}) {
  return ["Daily Summary Test for The Board", ...period, heading(name),
    "Internet 50 0 0 0 5 10%", "Phone 20 0 0 0 3 15%", "Showroom 20 8 3 1 2 10%", "Campaign 10 0 0 0 1 10%",
    ...(count === undefined ? [] : [`Total 100 8 3 1 ${count} 12%`]),
    ...people.flatMap((person) => [heading(person), "Internet 10 0 0 0 1.5 15%", "Phone 8 0 0 0 0.5 6.25%",
      "Showroom 6 2 1 0 2 33%", "Campaign 4 0 0 0 0.5 12.5%", "New 10 0 0 0 1.5 15%", "Used 8 0 0 0 3.5 43.75%", "Total 28 2 1 0 5 18%"]),
  ];
}
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
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const observations = (state, store = STORE.id, month = "2026-09") => state.db.get(storeKey(store)).deliverySummaryObservations?.[month];

test("the existing source helper is ported unchanged and intake uses only its byte hash", () => {
  const helper = fs.readFileSync(new URL("../api/_report-version.mjs", import.meta.url));
  assert.equal(helper.byteLength, 3208);
  assert.equal(digest(helper), "0274f5267a12e41873880e6adafb236bac8db252939c9655b7b6820bbe4ecbbf");
  const ingest = fs.readFileSync(new URL("../api/ingest.mjs", import.meta.url), "utf8");
  assert.ok(ingest.includes('import { sourceHash } from "./_report-version.mjs";'));
  assert.equal(ingest.includes("makeReportVersion("), false);
});

test("the printed month comes only from one valid month-start range before the store header", () => {
  const baseline = mapDeliverySummaryGrid(lines(report({ period: [] })));
  for (const period of [["9/1/2026 - 9/7/2026"], ["Report period: 09/01/2026 - 09/07/2026"]]) {
    const value = mapDeliverySummaryGrid(lines(report({ period })));
    assert.equal(value.reportMonth, "2026-09");
    assert.deepEqual(value.printedRange, { startDay: "2026-09-01", endDay: "2026-09-07" });
    assert.deepEqual(value.rows, baseline.rows); assert.deepEqual(value.stated, baseline.stated); assert.deepEqual(value.pairings, baseline.pairings);
    assert.equal(parseDeliverySummaryRows(value.rows)["alex example"].phoneUnits, 0.5);
  }
  for (const period of [[], ["9/7/2026"], ["9/2/2026 - 9/7/2026"], ["9/1/2026 - 10/7/2026"], ["9/1/2026 - 9/31/2026"],
    ["9/1/2026 - 9/7/2026", "9/1/2026 - 9/7/2026"], ["9/1/2026 - 9/7/2026", "10/1/2026 - 10/7/2026"]]) {
    const value = mapDeliverySummaryGrid(lines(report({ period })));
    assert.equal(value.reportMonth, null); assert.equal(value.printedRange, null);
    assert.deepEqual(value.rows, baseline.rows); assert.deepEqual(value.stated, baseline.stated);
  }
});

test("actual fictional PDF and MIME intake binds printed Total, exact store, month and bytes", async () => {
  const state = database(), bytes = pdf(report()), hash = digest(bytes);
  const result = await receive(state, bytes);
  assert.equal(result.code, 200, JSON.stringify(result.body));
  const value = observations(state)[hash];
  assert.equal(value.count, 12); assert.equal(value.metric, "printed_store_total_delivered");
  assert.equal(value.storeId, STORE.id); assert.equal(value.printedStoreName, STORE.name); assert.equal(value.reportMonth, "2026-09");
  assert.deepEqual(value.printedRange, { startDay: "2026-09-01", endDay: "2026-09-07" });
  assert.equal(value.source.sha256, hash); assert.equal(value.source.byteLength, bytes.byteLength);
  assert.equal(value.source.archiveState, "unverified"); assert.equal(value.status, "provisional");
  assert.equal(value.sentAt, null); assert.equal(value.asOf, null); assert.equal(value.publicationEligible, false);
  assert.ok(Number.isFinite(Date.parse(value.processingAt)));
  assert.deepEqual(value.sourceAssertions, [{ date: [], messageId: [] }]);
  assert.equal(JSON.stringify(value).includes("Alex Example"), false);
  assert.equal(JSON.stringify(result.body).includes("sourceAssertions"), false);
  const board = JSON.stringify(state.db.get(boardKey(STORE.id)));
  assert.equal(board.includes("deliverySummaryObservations"), false); assert.equal(board.includes(hash), false);
  assert.equal(Object.hasOwn(state.db.get(restoreKey(STORE.id)).data, "deliverySummaryObservations"), false);
  assert.equal(parseDeliverySummaryRows(mapDeliverySummaryGrid(await extractPdfLines(bytes)).rows)["alex example"].phoneUnits, 0.5);
});

test("MIME Date and Message-ID remain assertions including duplicates, malformed dates and future dates", async () => {
  const state = database(), bytes = pdf(report()), hash = digest(bytes);
  const result = await receive(state, bytes, ["Date: malformed", "Date: Thu, 01 Jan 2099 00:00:00 +0000", "Message-ID: <fictional-first>", "Message-ID: <fictional-second>"]);
  assert.equal(result.code, 200);
  const value = observations(state)[hash];
  assert.deepEqual(value.sourceAssertions, [{ date: ["malformed", "Thu, 01 Jan 2099 00:00:00 +0000"], messageId: ["<fictional-first>", "<fictional-second>"] }]);
  assert.equal(value.sentAt, null); assert.equal(value.asOf, null); assert.equal(value.publicationEligible, false);
  assert.equal(JSON.stringify(state.db.get(boardKey(STORE.id))).includes("fictional-first"), false);
});

test("delayed intake binds the printed month while preserving legacy processing-month writes", async () => {
  const state = database(), bytes = pdf(report({ period: ["1/1/2020 - 1/7/2020"] }));
  state.db.get(storeKey(STORE.id)).months["2020-01"] = { stats: { preserved: { units: 7.5 } } };
  assert.equal((await receive(state, bytes)).code, 200);
  const value = observations(state, STORE.id, "2020-01")[digest(bytes)], row = state.db.get(storeKey(STORE.id));
  assert.equal(value.reportMonth, "2020-01"); assert.equal(value.sentAt, null); assert.equal(value.asOf, null);
  assert.deepEqual(row.months["2020-01"], { stats: { preserved: { units: 7.5 } } });
  const processingMonth = new Date(value.processingAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
  assert.equal(row.months[processingMonth].stated.deliveries, 12);
  assert.equal(row.months[processingMonth].stats["alex example"].phoneUnits, 0.5);
});

test("explicit zero is retained and an unavailable printed Total stays unknown", async () => {
  for (const [count, expected, status] of [["0", 0, "provisional"], ["-", null, "unknown"], ["1.5", null, "unknown"]]) {
    const state = database(), bytes = pdf(report({ count }));
    assert.equal((await receive(state, bytes)).code, 200);
    const value = observations(state)[digest(bytes)];
    assert.equal(value.count, expected); assert.equal(value.status, status); assert.equal(value.publicationEligible, false);
  }
});

test("missing or ambiguous printed month does not create a bound observation or break legacy intake", async () => {
  for (const period of [[], ["9/1/2026 - 10/7/2026"], ["9/1/2026 - 9/7/2026", "9/1/2026 - 9/7/2026"]]) {
    const state = database();
    assert.equal((await receive(state, pdf(report({ period })))).code, 200);
    assert.equal(Object.hasOwn(state.db.get(storeKey(STORE.id)), "deliverySummaryObservations"), false);
  }
});

test("prefix and ambiguous store matches cannot qualify observations", async () => {
  for (const [stores, name] of [[[STORE], STORE.name + " West"], [[STORE, { id: "fictional-other", name: STORE.name }], STORE.name]]) {
    const state = database(stores);
    assert.equal((await receive(state, pdf(report({ name })))).code, 200);
    for (const store of stores) assert.equal(Object.hasOwn(state.db.get(storeKey(store.id)), "deliverySummaryObservations"), false);
  }
});

test("all PDF pages must agree on the printed range before a source month can qualify", async () => {
  for (const period of [["10/1/2026 - 10/7/2026"], ["9/1/2026 - 9/31/2026"], ["9/1/2026 - 9/8/2026"]]) {
    const state = database(), bytes = pdf([report(), report({ period, name: "Fictional Other Motors", count: "10" })]);
    assert.equal((await receive(state, bytes)).code, 200);
    assert.equal(Object.hasOwn(state.db.get(storeKey(STORE.id)), "deliverySummaryObservations"), false);
  }
  const state = database(), bytes = pdf([report(), ["Daily Summary Test for The Board", "9/1/2026 - 9/7/2026", heading("Casey Example"), "Internet 10 0 0 0 1.5 15%"]]);
  assert.equal((await receive(state, bytes)).code, 200);
  assert.equal(observations(state)[digest(bytes)].count, 12);
  assert.equal(observations(state)[digest(bytes)].reportMonth, "2026-09");
});

test("invalid colliding store IDs remain ambiguous and a unique invalid ID cannot qualify", async () => {
  const invalid = { id: "fictional/invalid", name: STORE.name };
  for (const stores of [[invalid, STORE], [STORE, invalid], [invalid], [STORE, { ...STORE }]]) {
    const state = database(stores);
    assert.equal((await receive(state, pdf(report()))).code, 200);
    for (const store of stores) assert.equal(Object.hasOwn(state.db.get(storeKey(store.id)), "deliverySummaryObservations"), false);
  }
});

test("duplicate bytes are one content observation and later assertions do not advance coverage", async () => {
  const state = database(), bytes = pdf(report()), hash = digest(bytes);
  assert.equal((await receive(state, bytes, ["Date: Mon, 07 Sep 2026 10:00:00 -0400", "Message-ID: <fictional-original>"])).code, 200);
  const first = structuredClone(observations(state)[hash]);
  assert.equal((await receive(state, bytes, ["Date: Mon, 07 Sep 2026 10:00:00 -0400", "Message-ID: <fictional-original>"])).code, 200);
  assert.deepEqual(observations(state)[hash], first);
  assert.equal((await receive(state, bytes, ["Date: Mon, 07 Sep 2026 15:00:00 -0400", "Message-ID: <fictional-resend-or-regeneration>"], "renamed.pdf")).code, 200);
  assert.equal(Object.keys(observations(state)).length, 1);
  const value = observations(state)[hash];
  assert.equal(value.sourceAssertions.length, 2); assert.equal(value.processingAt, first.processingAt);
  assert.equal(value.count, 12); assert.equal(value.sentAt, null); assert.equal(value.asOf, null); assert.equal(value.publicationEligible, false);
});

test("different sources including equal-time and downward counts remain distinct and unordered", async () => {
  const originals = [pdf(report({ count: "12" }), "source-a"), pdf(report({ count: "10" }), "source-b")];
  for (const sources of [originals, [...originals].reverse()]) {
    const state = database();
    for (const bytes of sources) assert.equal((await receive(state, bytes, ["Date: Mon, 07 Sep 2026 10:00:00 -0400"])).code, 200);
    const values = observations(state);
    assert.deepEqual(Object.keys(values).sort(), originals.map(digest).sort());
    assert.equal(values[digest(originals[0])].count, 12); assert.equal(values[digest(originals[1])].count, 10);
    for (const value of Object.values(values)) { assert.equal(value.sentAt, null); assert.equal(value.asOf, null); assert.equal(value.publicationEligible, false); }
    assert.equal(Object.hasOwn(state.db.get(storeKey(STORE.id)), "selectedSummary"), false);
  }
});

test("CAS retries retain a competing private observation and ordinary stale saves preserve the combined map", async () => {
  const state = database(), bytes = pdf(report()), competing = pdf(report({ count: "10" }), "competing");
  const stale = structuredClone(state.db.get(storeKey(STORE.id)));
  assert.equal((await receive(state, competing)).code, 200);
  const concurrent = structuredClone(state.db.get(storeKey(STORE.id)));
  state.db.set(storeKey(STORE.id), structuredClone(stale));
  state.beforePatch = () => { state.db.set(storeKey(STORE.id), concurrent); };
  assert.equal((await receive(state, bytes)).code, 200);
  assert.equal(state.retries, 1);
  const current = state.db.get(storeKey(STORE.id));
  assert.deepEqual(Object.keys(observations(state)).sort(), [digest(bytes), digest(competing)].sort());
  const saved = mergeAgainstServer(structuredClone(stale), structuredClone(current), { baseline: stale });
  assert.deepEqual(saved.deliverySummaryObservations, current.deliverySummaryObservations);
  assert.equal(Object.hasOwn(stale, "deliverySummaryObservations"), false);
});

test("a failed or overwritten archive is not promoted into retained-byte proof", async () => {
  const state = database(), a = pdf(report({ count: "12" }), "archive-a"), b = pdf(report({ count: "10" }), "archive-b");
  state.failArchives = true;
  assert.equal((await receive(state, a)).code, 200);
  state.failArchives = false;
  assert.equal((await receive(state, b)).code, 200);
  for (const value of Object.values(observations(state))) { assert.equal(value.source.archiveState, "unverified"); assert.equal(value.publicationEligible, false); }
  assert.equal(observations(state)[digest(a)].count, 12); assert.equal(observations(state)[digest(b)].count, 10);
});
