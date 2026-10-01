import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import PostalMime from "postal-mime";
import { acceptDailyReport, publicDailyMonth, dailyStorage, factPrefix, resolveDailyCoverageHold } from "../api/_daily-delivery-store.mjs";
import { handle, mayReadDaily } from "../api/daily-deliveries.mjs";
import { retainDailyReports, reportSentAt, mailSentAt, dailyAttemptFrom } from "../api/ingest.mjs";
const stores = [{ id: "fictional-a", name: "Fictional Store Alpha" }];
const line = (str) => ({ pg: 1, parts: [{ str }] });
const heading = [line("Fictional Store Alpha Net Leads Showroom Phone Ups ILM leads Campaign App Created App Scheduled"),
  line("App Confirmed App Show Calls Made Connects Texts Emails Videos Video % Visit"),
  line("Open Tasks Completed Tasks Total Delivered Total Closing %")];
const row = (tag, total) => line(`${tag} 14 1 3 6 4 5 4 ? 0 71 11 164 33 8 29% 730 79 ${total} 0% 4`);
const extractLines = async (bytes) => [line("Daily Activity"), ...heading,
  row("New", Number(bytes.toString())), row("Used", 0), row("All", Number(bytes.toString()))];
const metadata = { reportType: "activity", filename: "report-2026-09-30.pdf",
  receivedAt: "2026-10-01T00:02:00Z", sentAt: "2026-10-01T00:01:00Z" };
const input = (n = 7, meta = {}) => ({ bytes: Buffer.from(String(n)), storeId: stores[0].id, stores, metadata: { ...metadata, ...meta } });
const recordsOf = (storage) => [...storage.rows].filter(([key]) => key.startsWith(factPrefix("fictional-a")))
  .map(([key, value]) => ({ key, value }));
const acceptedOf = (storage) => recordsOf(storage).filter(({ value }) => !value.kind);
const monthOf = (storage, month = "2026-09") => publicDailyMonth({ storeId: "fictional-a", month, records: recordsOf(storage) });
function memory() {
  const rows = new Map(), calls = [];
  return { rows, calls, async insertOnly(key, value) { calls.push(["insert", key]);
    if (!rows.has(key)) rows.set(key, structuredClone(value)); },
  async get(key) { calls.push(["get", key]); return structuredClone(rows.get(key)); } };
}
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(v) { this.body = v; return this; } };
}
const request = (change = {}) => ({ method: "GET", query: { store: "fictional-a", month: "2026-09" },
  headers: { authorization: "Bearer token" }, ...change });

test("archive is inserted and read back before evidence, with no client-writable keys", async () => {
  const storage = memory(); assert.equal((await acceptDailyReport(input(), { storage, extractLines })).status, "accepted");
  assert.deepEqual(storage.calls.map(([op]) => op), ["insert", "get", "insert", "get", "insert", "get"]);
  assert.match(storage.calls[2][1], /^lpc:reportfile:fictional-a:2026-09-30:v1:activity:[a-f0-9]{64}$/);
  assert.match(storage.calls[4][1], /^lpc:dailyfacts:/);
  assert.ok(storage.calls.every(([, key]) => !key.startsWith("lpc:store:")));
  const day = monthOf(storage).days[29]; assert.equal(day.count, 7); assert.equal(day.status, "provisional");
  assert.deepEqual(Object.keys(day).sort(), ["asOf", "count", "date", "status", "vehicles"]);
  assert.equal(monthOf(storage).days[12].count, null);
});
test("archive exceptions, uncertain writes and mismatching collisions never accept a fact", async () => {
  for (const kind of ["throw", "missing", "collision"]) {
    const storage = memory();
    if (kind === "throw") storage.insertOnly = async () => { throw new Error("private details"); };
    if (kind === "missing") storage.get = async () => null;
    if (kind === "collision") storage.get = async () => ({ b64: "wrong bytes" });
    assert.deepEqual(await acceptDailyReport(input(), { storage, extractLines }), { status: "held", unrecorded: true });
    assert.equal(acceptedOf(storage).length, 0);
  }
});
test("fact failure leaves the raw archive intact and a later retry is idempotent", async () => {
  const storage = memory(), original = storage.insertOnly;
  storage.insertOnly = async (key, value) => { if (key.startsWith(factPrefix("fictional-a")) && !key.includes(":hold:")) throw new Error("failed"); return original(key, value); };
  assert.equal((await acceptDailyReport(input(), { storage, extractLines })).status, "held");
  assert.equal(storage.rows.size, 2);
  storage.insertOnly = original;
  await acceptDailyReport(input(), { storage, extractLines });
  await acceptDailyReport(input(), { storage, extractLines });
  assert.equal(storage.rows.size, 3);
});
test("concurrent corrections and resends preserve every receipt without summing", async () => {
  const storage = memory();
  await Promise.all([input(), input(5, { sentAt: "2026-10-01T01:01:00Z", receivedAt: "2026-10-01T01:02:00Z" }),
    input(7, { receivedAt: "2026-10-01T02:02:00Z" })].map((i) => acceptDailyReport(i, { storage, extractLines })));
  assert.equal(acceptedOf(storage).length, 3); assert.equal(monthOf(storage).days[29].count, 5);
});
test("same-source cross-month claims and tied distinct versions stay unknown", async () => {
  const storage = memory();
  await acceptDailyReport(input(), { storage, extractLines });
  await acceptDailyReport(input(7, { filename: "report-2026-10-01.pdf", sentAt: "2026-10-01T05:01:00Z", receivedAt: "2026-10-01T05:02:00Z" }), { storage, extractLines });
  assert.equal(monthOf(storage).days[29].status, "conflict"); assert.equal(monthOf(storage, "2026-10").days[0].count, null);
  const tied = memory(); await acceptDailyReport(input(), { storage: tied, extractLines });
  await acceptDailyReport(input(6), { storage: tied, extractLines }); assert.equal(monthOf(tied).days[29].status, "conflict");
});
test("zero stays known and malformed scope or forged records fail closed", async () => {
  const storage = memory(); await acceptDailyReport(input(0), { storage, extractLines }); assert.equal(monthOf(storage).days[29].count, 0);
  const records = acceptedOf(storage); records[0].value.source.archiveState = "not_written";
  assert.throws(() => publicDailyMonth({ storeId: "fictional-a", month: "2026-09", records }), /invalid_fact/);
  assert.throws(() => factPrefix("a:%"), /invalid_store/);
});
test("sidecar re-extracts the bytes it archives and isolates extraction failure", async () => {
  const storage = memory(), entry = { type: "activity", dailySource: metadata, fileMime: "application/pdf",
    fileName: metadata.filename, fileB64: Buffer.from("3").toString("base64"), store: stores[0] };
  const before = structuredClone(entry);
  await retainDailyReports([entry], stores, { storage, extractLines });
  assert.deepEqual(entry, before); assert.equal(monthOf(storage).days[29].count, 3);
  await retainDailyReports([entry], stores, { storage, extractLines: async () => { throw new Error("bad PDF"); } });
  assert.equal(monthOf(storage).days[29].count, 3);
});
test("email timestamps must carry a timezone and never inherit the server's", () => {
  assert.equal(reportSentAt("Wed, 30 Sep 2026 20:01:00 -0400"), "2026-10-01T00:01:00.000Z");
  assert.equal(reportSentAt(null), null); assert.equal(reportSentAt("2026-09-30 20:01:00"), "invalid");
});
test("reader validates session then current active, approved DB membership before accessing facts", async () => {
  const storage = memory(); await acceptDailyReport(input(), { storage, extractLines });
  let reads = 0; const base = { userFor: async () => ({ id: "user", user_metadata: { role: "admin" } }),
    profileOf: async () => ({ active: true, pending: false, role: "manager", stores: ["fictional-a"] }),
    list: async () => { reads++; return recordsOf(storage); } };
  for (const profile of [null, { active: false, pending: false, role: "admin" }, { active: true, pending: true, role: "admin" },
    { active: true, pending: false, stores: ["fictional-b"] }, { role: "admin" }]) {
    const res = response(); await handle(request(), res, { ...base, profileOf: async () => profile }); assert.equal(res.code, 403);
  }
  assert.equal(reads, 0);
  const noSession = response(); await handle(request(), noSession, { ...base, userFor: async () => null }); assert.equal(noSession.code, 401);
  const ok = response(); await handle(request(), ok, base); assert.equal(ok.code, 200); assert.equal(reads, 1);
  assert.equal(ok.headers["Cache-Control"], "private, no-store");
  for (const banned of ["sha256", "sourceId", "receipt", "b64", "printedStore", "reason", "candidate", "parser"]) assert.ok(!JSON.stringify(ok.body).includes(banned));
  assert.equal(mayReadDaily({ active: true, pending: false, role: "admin" }, "fictional-b"), true);
});
test("reader rejects invalid requests and sanitizes all dependency errors", async () => {
  const never = new Proxy({}, { get() { throw new Error("should not read dependencies"); } });
  for (const [req, status] of [[request({ method: "POST" }), 405], [request({ query: { store: "a:%", month: "2026-09" } }), 400],
    [request({ query: { store: "fictional-a", month: "2026-13" } }), 400], [request({ headers: {} }), 401]]) {
    const res = response(); await handle(req, res, never); assert.equal(res.code, status);
  }
  const res = response(); await handle(request(), res, { userFor() { throw new Error("secret detail"); } });
  assert.equal(res.code, 503); assert.deepEqual(res.body, { error: "daily deliveries unavailable" });
});
test("storage never upserts and reads beyond the server page cap", async () => {
  let after = "", pages = 0;
  const db = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle() { return { abortSignal: async () => ({ data: { value: 7 } }) }; },
    insert() { return { abortSignal: async () => ({ error: { code: "23505" } }) }; }, gte() { return this; }, lt() { return this; }, gt(_, value) { after = value; return this; },
    order() { return this; }, limit() { pages++; return { abortSignal: async () => ({ data: pages === 1 ? [{ key: "next", value: {} }] : [] }) }; } }; } };
  const s = dailyStorage(db); await s.insertOnly("key", {}); assert.equal(await s.get("key"), 7);
  assert.equal((await s.list("fictional-a")).length, 1); assert.equal(pages, 2); assert.equal(after, "next");
});
test("production source keeps sidecar after the successful old import, separate from its swap", async () => {
  const source = await fs.readFile(new URL("../api/ingest.mjs", import.meta.url), "utf8");
  assert.ok(source.lastIndexOf("const dailyEvidence = await retainDailyReports(dailyAttempts") > source.indexOf("stores.push({ store:"));
  assert.ok(source.lastIndexOf("const dailyEvidence = await retainDailyReports(dailyAttempts") > source.indexOf("/* ---- the report files themselves"));
  assert.ok(!source.includes('sbPut("lpc:dailyfacts:'));
});

test("the original MIME date cannot acquire an invented timezone or normalized date", async () => {
  for (const date of ["Wed, 30 Sep 2026 23:30:00", "Mon, 30 Feb 2026 23:30:00 +0000", "Wed, 30 Sep 2026 23:30:00 -0000"]) {
    const mail = await PostalMime.parse(`Date: ${date}\r\nSubject: Synthetic\r\n\r\nhello`);
    assert.equal(mailSentAt(mail), "invalid");
  }
  const good = await PostalMime.parse("Date: Wed, 30 Sep 2026 23:30:00 -0400\r\n\r\nhello");
  assert.equal(mailSentAt(good), "2026-10-01T03:30:00.000Z");
  assert.equal(mailSentAt({ headers: [{ key: "date", value: metadata.sentAt }, { key: "date", value: metadata.sentAt }] }), "invalid");
});

test("damaged as-of metadata cannot publish a provisional count", async () => {
  const storage = memory(); await acceptDailyReport(input(), { storage, extractLines });
  for (const asOf of [{ timestamp: null, basis: "arbitrary" }, { timestamp: metadata.receivedAt, basis: "report_received" },
    { timestamp: "2026-10-01T00:01:00.000Z", basis: "raw private detail" }]) {
    const records = structuredClone(acceptedOf(storage)); records[0].value.asOf = asOf;
    assert.throws(() => publicDailyMonth({ storeId: "fictional-a", month: "2026-09", records }), /invalid_fact_asof/);
  }
});
test("a failed later correction reports a hold while preserving the earlier count and as-of", async () => {
  const storage = memory(); await acceptDailyReport(input(), { storage, extractLines });
  const before = monthOf(storage).days[29];
  const entry = { type: "activity", dailySource: { ...metadata, sentAt: "2026-10-01T01:01:00Z", receivedAt: "2026-10-01T01:02:00Z" },
    fileMime: "application/pdf", fileName: metadata.filename, fileB64: Buffer.from("4").toString("base64"), store: stores[0] };
  storage.insertOnly = async () => { throw new Error("private failure"); };
  assert.deepEqual(await retainDailyReports([entry], stores, { storage, extractLines }), { accepted: 0, held: 1, unrecorded: 1 });
  assert.deepEqual(monthOf(storage).days[29], before);
});

test("a stalled sidecar returns a hold within its budget and cannot later publish a fact", async () => {
  const storage = memory(); let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  const entry = { type: "activity", dailySource: metadata, fileMime: "application/pdf",
    fileName: metadata.filename, fileB64: Buffer.from("3").toString("base64"), store: stores[0] };
  const outcome = await retainDailyReports([entry], stores, { storage, budgetMs: 10, extractLines: async (bytes) => { await wait; return extractLines(bytes); } });
  assert.deepEqual(outcome, { accepted: 0, held: 1, unrecorded: 0 });
  resume(); await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(acceptedOf(storage).length, 0);
  assert.equal(monthOf(storage).days[29].status, "incomplete");
});

test("a newer malformed or archive-failed report durably holds earlier daily coverage", async () => {
  for (const failure of ["parse", "archive"]) {
    const storage = memory(); await acceptDailyReport(input(), { storage, extractLines });
    const insert = storage.insertOnly;
    if (failure === "archive") storage.insertOnly = async (key, value) => { if (key.startsWith("lpc:reportfile:")) throw new Error("archive unavailable"); return insert(key, value); };
    const latest = input(4, { sentAt: "2026-10-01T01:01:00Z", receivedAt: "2026-10-01T01:02:00Z" });
    const outcome = await acceptDailyReport(latest, { storage, extractLines: failure === "parse" ? async () => [] : extractLines });
    assert.deepEqual(outcome, { status: "held", unrecorded: false });
    assert.equal(monthOf(storage).days[29].status, "incomplete"); assert.equal(monthOf(storage).days[29].count, null);
    storage.insertOnly = insert; await acceptDailyReport(latest, { storage, extractLines });
    assert.equal(monthOf(storage).days[29].count, 4, "exact verified retry clears its receipt hold");
  }
});
test("unscoped holds require an explicit immutable resolution to verified same-store evidence", async () => {
  const storage = memory(); await acceptDailyReport(input(), { storage, extractLines });
  await acceptDailyReport(input(4, { sentAt: "invalid" }), { storage, extractLines });
  assert.ok(monthOf(storage).days.every((d) => d.status === "incomplete"));
  const hold = recordsOf(storage).find(({ value }) => value.kind === "coverage_hold" && value.businessDate === null);
  const replacement = acceptedOf(storage)[0];
  await assert.rejects(() => resolveDailyCoverageHold({ holdKey: hold.key, replacementKey: replacement.key, businessDate: "2026-09-29" }, storage), /invalid_coverage_resolution/);
  await resolveDailyCoverageHold({ holdKey: hold.key, replacementKey: replacement.key, businessDate: "2026-09-30" }, storage);
  assert.equal(monthOf(storage).days[29].count, 7); assert.ok(storage.rows.has(hold.key));
  assert.equal(recordsOf(storage).filter(({ value }) => value.kind === "coverage_resolution").length, 1);
});

test("a supported store/date with unreadable total never leaves an irrecoverable invalid fact", async () => {
  const storage = memory();
  await acceptDailyReport(input(8), { storage, extractLines: async () => [line("Daily Activity"), ...heading, row("All", "?")] });
  assert.equal(acceptedOf(storage).length, 0);
  const hold = recordsOf(storage).find(({ value }) => value.kind === "coverage_hold");
  await acceptDailyReport(input(5, { sentAt: "2026-10-01T01:01:00Z", receivedAt: "2026-10-01T01:02:00Z" }), { storage, extractLines });
  assert.equal(monthOf(storage).days[29].status, "incomplete");
  const replacement = acceptedOf(storage)[0];
  await resolveDailyCoverageHold({ holdKey: hold.key, replacementKey: replacement.key, businessDate: "2026-09-30" }, storage);
  assert.equal(monthOf(storage).days[29].count, 5);
});
test("Daily Activity coverage discovery is independent of employee-mapper success", async () => {
  const attachment = { filename: "daily-activity-2026-09-30.pdf", content: Buffer.from("broken") };
  const args = { attachment, subject: "scheduled", stores, addressStore: stores[0], receivedAt: metadata.receivedAt, sentAt: metadata.sentAt };
  const attempt = dailyAttemptFrom(args); assert.equal(attempt.store.id, "fictional-a");
  const storage = memory(); const outcome = await retainDailyReports([attempt], stores, { storage, extractLines: async () => [] });
  assert.deepEqual(outcome, { accepted: 0, held: 1, unrecorded: 0 }); assert.equal(monthOf(storage).days[29].status, "incomplete");
  assert.deepEqual(await retainDailyReports([dailyAttemptFrom({ ...args, addressStore: null })], stores), { accepted: 0, held: 1, unrecorded: 1 });
  assert.equal(dailyAttemptFrom({ ...args, attachment: { ...attachment, filename: "delivery-summary.pdf" } }), null);
});

test("one stalled parser cannot prevent the remaining batch coverage holds", async () => {
  const storage = memory(); let resume; const wait = new Promise((resolve) => { resume = resolve; });
  const entry = { type: "activity", dailySource: metadata, fileMime: "application/pdf",
    fileName: metadata.filename, fileB64: Buffer.from("3").toString("base64"), store: stores[0] };
  const second = { ...entry, fileName: "daily-activity-2026-09-29.pdf", dailySource: {
    receivedAt: "2026-09-29T23:02:00Z", sentAt: "2026-09-29T23:01:00Z" } };
  const outcome = await retainDailyReports([entry, second], stores, { storage, budgetMs: 10,
    extractLines: async (bytes) => { await wait; return extractLines(bytes); } });
  assert.deepEqual(outcome, { accepted: 0, held: 2, unrecorded: 0 });
  assert.equal(monthOf(storage).days[28].status, "incomplete"); assert.equal(monthOf(storage).days[29].status, "incomplete");
  resume(); await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(acceptedOf(storage).length, 0);
});

test("attachment structure wins over generic names and mixed email subjects", async () => {
  const args = { attachment: { filename: "scheduled-report-2026-09-30.pdf", content: Buffer.from("3") },
    subject: "Scheduled reports", stores, addressStore: null, receivedAt: metadata.receivedAt, sentAt: metadata.sentAt };
  const lines = (await extractLines(Buffer.from("3"))).slice(1);
  assert.equal(dailyAttemptFrom({ ...args, lines }).store.id, "fictional-a");
  const mixed = { ...args, subject: "Daily Activity and Delivery Summary", addressStore: stores[0] };
  assert.equal(dailyAttemptFrom({ ...mixed, attachment: { ...args.attachment, filename: "delivery-summary.pdf" } }), null);
  assert.equal(dailyAttemptFrom({ ...mixed, attachment: { ...args.attachment, filename: "appointment-summary.pdf" } }), null);
});

test("a damaged explicit Daily Activity report keeps its hold despite ordinary Video columns", () => {
  const attempt = dailyAttemptFrom({ attachment: { filename: "daily-activity-2026-09-30.pdf", content: Buffer.from("broken") },
    lines: [line("Daily Activity"), line("Videos Video % Visit")], subject: "Scheduled", stores, addressStore: stores[0],
    receivedAt: metadata.receivedAt, sentAt: metadata.sentAt });
  assert.equal(attempt.store.id, "fictional-a");
});
