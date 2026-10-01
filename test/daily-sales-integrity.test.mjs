import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DAILY_TOTALS_UNAVAILABLE, createDigestReader, createDigestSelection,
  digestIdentity, inspectLegacyDigests } from "../api/_digest-integrity.mjs";
import { BEFORE_COMMIT, decisions, proposalPage } from "../scripts/daily-sales-integrity-proposal.mjs";

const record = (day, u, rest = {}, store = "store-a") => ({
  key: `lpc:store:${store}:digest:${day}`, value: { d: day, u, nu: u / 2, uu: u / 2, ...rest },
});
const unavailable = (state, status) => {
  assert.equal(state.status, status);
  assert.equal(state.daily, null, "unknown must not be a valid zero");
  assert.deepEqual(state.history, {}, "no legacy daily values reach a consumer");
  assert.equal(state.label, DAILY_TOTALS_UNAVAILABLE);
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

for (const [name, rows] of [
  ["adjacent rising snapshots", [record("2026-09-10", 20), record("2026-09-11", 29)]],
  ["a multi-day gap", [record("2026-09-10", 20), record("2026-09-20", 40)]],
  ["a decreasing correction", [record("2026-09-10", 20), record("2026-09-11", 19)]],
  ["stale equal snapshots", [record("2026-09-10", 20), record("2026-09-11", 20)]],
  ["legacy zeroes", [record("2026-09-10", 0), record("2026-09-11", 0)]],
  ["a missing baseline", [record("2026-09-11", 20)]],
  ["the month boundary", [record("2026-09-30", 20), record("2026-10-01", 22)]],
  ["the year boundary", [record("2026-12-31", 20), record("2027-01-01", 22)]],
  ["the spring DST boundary", [record("2026-03-07", 20), record("2026-03-08", 22)]],
  ["the autumn DST boundary", [record("2026-10-31", 20), record("2026-11-01", 22)]],
]) test(`${name} cannot establish daily store sales`, () => {
  const before = structuredClone(rows);
  unavailable(inspectLegacyDigests("store-a", "2026-10-01", rows), "incomplete");
  assert.deepEqual(rows, before, "audit evidence is not altered");
});

test("missing, malformed, and identity-rejected evidence remain distinct", () => {
  unavailable(inspectLegacyDigests("store-a", "2026-10-01", []), "missing");
  unavailable(inspectLegacyDigests("store-a", "2026-10-01", null), "error");
  for (const row of [record("2026-09-10", 20, {}, "store-b"), record("2026-09-10", 20, { d: "2026-09-11" }),
    record("2026-09-31", 20), record("2026-09-10", 20, { storeId: "store-b" })])
    unavailable(inspectLegacyDigests("store-a", "2026-10-01", [row]), "rejected");
  for (const id of [undefined, "store-b"])
    unavailable(digestIdentity("store-a", id, "2026-10-01"), "rejected");
  assert.equal(digestIdentity("store-a", "store-a", "2026-10-01"), null);
});

test("load failures are not empty success, cached for the day, or disclosed", async () => {
  let calls = 0;
  const diagnostics = [];
  const reader = createDigestReader(async () => {
    if (++calls <= 2) throw new Error("PRIVATE backend details and business figures");
    return [record("2026-09-10", 20)];
  }, { diagnose: (value) => diagnostics.push(value) });
  unavailable(await reader.read("store-a", "2026-10-01"), "error");
  unavailable(await reader.read("store-a", "2026-10-01"), "error");
  unavailable(await reader.read("store-a", "2026-10-01"), "incomplete");
  assert.equal(calls, 3);
  assert.ok(!JSON.stringify(diagnostics).includes("PRIVATE"));
  assert.ok(diagnostics.every((item) => Object.keys(item).sort().join() === "component,day,reason,status,storeId"));
  assert.ok(diagnostics.every((item) => item.storeId === "store-a" && item.day === "2026-10-01"));
});

test("an unavailable backend and rejected identity can both be retried", async () => {
  let n = 0;
  const reader = createDigestReader(async () => ++n === 1 ? [record("2026-09-10", 20, {}, "store-b")] : []);
  unavailable(await reader.read("store-a", "2026-10-01"), "rejected");
  unavailable(await reader.read("store-a", "2026-10-01"), "missing");
  assert.equal(n, 2);
});

test("a hung read times out and does not occupy the next retry", async () => {
  let n = 0;
  const reader = createDigestReader(() => ++n === 1 ? new Promise(() => {}) : [], { timeoutMs: 5 });
  unavailable(await reader.read("store-a", "2026-10-01"), "error");
  unavailable(await reader.read("store-a", "2026-10-01"), "missing");
  assert.equal(n, 2);
});

test("successful reads have bounded store/day caches and pending reads are shared", async () => {
  let time = 0, count = 0;
  const first = deferred();
  const reader = createDigestReader(() => { count++; return count === 1 ? first.promise : []; },
    { now: () => time, ttlMs: 10, maxEntries: 2 });
  const a = reader.read("store-a", "2026-10-01"), b = reader.read("store-a", "2026-10-01");
  await Promise.resolve(); assert.equal(count, 1);
  first.resolve([]); await Promise.all([a, b]);
  await reader.read("store-a", "2026-10-01"); assert.equal(count, 1);
  time = 11;
  await reader.read("store-a", "2026-10-01"); assert.equal(count, 2);
  await reader.read("store-a", "2026-10-02");
  await reader.read("store-b", "2026-10-02");
  await reader.read("store-a", "2026-10-01"); assert.equal(count, 5, "old entries are bounded, not retained forever");
  await reader.read("store-a", "2026-10-01", { force: true }); assert.equal(count, 6);
});

test("uncached A to B rejects A's late completion before it can paint under B", async () => {
  const a = deferred(), b = deferred(), seen = [], diagnostics = [];
  const reader = createDigestReader((store) => store === "store-a" ? a.promise : b.promise,
    { diagnose: (event) => diagnostics.push(event) });
  const selection = createDigestSelection(reader, (value) => seen.push(value));
  const pa = selection.select("store-a", "store-a", "2026-10-01");
  const pb = selection.select("store-b", "store-b", "2026-10-01");
  assert.equal(seen.at(-1).storeId, "store-b");
  assert.equal(seen.at(-1).status, "loading");
  b.resolve([]); await pb;
  a.resolve([record("2026-09-10", 20)]); await pa;
  assert.equal(seen.at(-1).storeId, "store-b");
  assert.equal(seen.at(-1).status, "missing");
  assert.ok(!seen.some((v) => v.storeId === "store-a" && v.status !== "loading"));
  assert.deepEqual(diagnostics.map((event) => event.storeId), ["store-b", "store-a"], "late diagnostics retain their source store, not the current selection");
});

test("invalid identities never enter the diagnostic sink", async () => {
  const diagnostics = [];
  const reader = createDigestReader(() => { throw new Error("must not load"); }, { diagnose: (event) => diagnostics.push(event) });
  unavailable(await reader.read("bad:private/input", "2026-10-01"), "rejected");
  unavailable(await reader.read("store-a", "not-a-day"), "rejected");
  assert.deepEqual(diagnostics, []);
});

test("negative cache capacity disables retention without looping", async () => {
  let count = 0;
  const reader = createDigestReader(async () => { count++; return []; }, { maxEntries: -1 });
  await reader.read("store-a", "2026-10-01");
  await reader.read("store-a", "2026-10-01");
  assert.equal(count, 2);
});

test("cached A to B to A, mismatched documents and unmount remain isolated", async () => {
  let reads = 0;
  const seen = [];
  const reader = createDigestReader(async (id) => { reads++; return [record("2026-09-10", 20, {}, id)]; });
  const selection = createDigestSelection(reader, (value) => seen.push(value));
  await selection.select("store-a", "store-a", "2026-10-01");
  await selection.select("store-b", "store-b", "2026-10-01");
  await selection.select("store-a", "store-a", "2026-10-01");
  assert.equal(reads, 2);
  await selection.select("store-b", "store-a", "2026-10-01");
  unavailable(seen.at(-1), "rejected"); assert.equal(reads, 2);
  const pending = selection.select("store-a", "store-a", "2026-10-01");
  selection.cancel(); const before = seen.length; await pending;
  assert.equal(seen.length, before);
});

test("the shipped Manager holds every legacy consumer without changing real activity or monthly code", () => {
  const source = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  const proposed = source;
  assert.equal(proposed.split("useDigestIntegrity(store.id, data.__storeId)").length - 1, 3);
  assert.ok(!proposed.includes("function buildDigest"));
  assert.ok(!proposed.includes("saveShared(digestKey"));
  assert.ok(!proposed.includes("ruWritten"));
  assert.ok(!proposed.includes("loadDigests("));
  // Fingerprints of the immutable reviewed-before commit, not a second copy
  // of the application or a transform that could mask the shipped code.
  const preserved = [
  [
    "function CheckOutTracker(",
    "function drawDayReport(",
    "2fb78b31f76376f122f442a57013648b729d9654b5802a6b158b19edb5c64e4d"
  ],
  [
    "function ImportPanel(",
    "function TrendsPanel(",
    "3a5dc5255ccd3e5f40f316e815b0b26a4ee8c948ea3a5b3e344c6e532fcde48b"
  ],
  [
    "const statedSplitOf =",
    "\n};",
    "c092112ae3cf800cf570b5249be8eeafce8fd73031e3603367d1312dd90d69e9"
  ]
];
  for (const [start, end, expected] of preserved) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, `preservation anchor: ${start}`);
    assert.equal(createHash("sha256").update(source.slice(a, b)).digest("hex"), expected,
      `${start} remains byte-for-byte unchanged from ${BEFORE_COMMIT}`);
  }
  assert.equal(proposed.split("statedSplitOf(M)").length - 1, 2, "the hero and phone still read the same monthly stock split");
  assert.ok(!proposed.includes("From tomorrow this also shows who cleared"));
  assert.ok(!proposed.includes("until two daily readings"));
  assert.ok(!proposed.includes("The line draws once two days"));
  assert.ok(!proposed.includes('data-daily-unavailable="desktop-best-day"'), "the calendar has one quiet unavailable footer");
  assert.ok(proposed.includes('data-daily-unavailable="desktop-day-detail"'));
  assert.ok(proposed.includes('Pace: {pace.daysDone} of {pace.daysAll} selling days elapsed'));
  assert.equal(decisions.length, 4);
  assert.equal((proposalPage().match(/data-choice=/g) || []).length, 4);
});

test("the after browser build uses checked-in Manager, while before uses the immutable reviewed commit", () => {
  const script = fs.readFileSync(new URL("../scripts/daily-sales-integrity-proposal.mjs", import.meta.url), "utf8");
  assert.equal(BEFORE_COMMIT, "8d2befb7db44fb8ab8dcd855a5d09ccd62005906");
  assert.ok(script.includes('if (before && file.endsWith("/src/Manager.jsx")) return beforeManager;'));
  assert.ok(!script.includes("dailyIntegrityTransform"));
});
