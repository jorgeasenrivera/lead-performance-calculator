import { test } from "node:test";
import assert from "node:assert/strict";
import { selectReportedTotal } from "../api/_board-provenance.mjs";

/* Every store, total and report here is fictional. DriveCentric can send the
   same day's Delivery Summary more than once, and the store total moves between
   sends. The report prints dates but no time, so the TV used to refuse to pick
   one and showed "Unknown, Reports disagree" for the rest of the day. Jorge chose
   the newest arrival: the send Sage processed last sets the total. */
const STORE = "fictional-demo", MONTH = "2026-11";
const hash = (c) => c.repeat(64);
function send(count, at, { c = "a", end = 17, ids = [] } = {}) {
  return {
    schemaVersion: 1, metric: "printed_store_total_delivered", storeId: STORE,
    printedStoreName: "Fictional Demo Motors", reportMonth: MONTH,
    printedRange: { startDay: MONTH + "-01", endDay: `${MONTH}-${String(end).padStart(2, "0")}` },
    count, status: count === null ? "unknown" : "provisional", sentAt: null, asOf: null,
    source: { sha256: hash(c), byteLength: 2400, parserVersion: "delivery-summary-printed-total-month:v1", archiveState: "unverified" },
    sourceAssertions: [{ date: [], messageId: ids }], processingAt: `${MONTH}-17T${at}:00.000Z`, publicationEligible: false,
  };
}
const select = (...sends) => selectReportedTotal({ [MONTH]: Object.fromEntries(sends.map((s) => [s.source.sha256, s])) }, STORE, MONTH);
const provisional = (count) => ({ count, status: "provisional", month: MONTH, asOf: null });
const unknown = { count: null, status: "unknown", month: MONTH, asOf: null };
const conflict = { ...unknown, status: "conflict" };

test("an afternoon resend with a higher total shows the higher total", () => {
  const morning = send(41, "12:00", { c: "a" }), afternoon = send(43, "19:30", { c: "b" });
  assert.deepEqual(select(morning, afternoon), provisional(43));
  assert.deepEqual(select(afternoon, morning), provisional(43));
});

test("a resend after a deal unwinds shows the lower total", () => {
  assert.deepEqual(select(send(43, "12:00", { c: "a" }), send(42, "19:30", { c: "b" })), provisional(42));
});

test("three sends in one day: the last one processed wins, however they are stored", () => {
  const sends = [send(41, "12:00", { c: "a" }), send(44, "21:00", { c: "c" }), send(43, "16:00", { c: "b" })];
  assert.deepEqual(select(...sends), provisional(44));
  assert.deepEqual(select(...sends.reverse()), provisional(44));
});

test("yesterday's report never competes with today's, even if it arrives last", () => {
  const today = send(43, "12:00", { c: "a", end: 17 }), lateYesterday = send(40, "23:00", { c: "b", end: 16 });
  assert.deepEqual(select(today, lateYesterday), provisional(43));
});

test("an unreadable earlier send is superseded; an unreadable newest send leaves the total unknown", () => {
  assert.deepEqual(select(send(null, "12:00", { c: "a" }), send(43, "19:30", { c: "b" })), provisional(43));
  assert.deepEqual(select(send(43, "12:00", { c: "a" }), send(null, "19:30", { c: "b" })), unknown);
});

test("two different totals in one email have no order, so the board still says they disagree", () => {
  const first = send(41, "19:30", { c: "a", ids: ["fictional-mail-1"] });
  const second = send(43, "19:31", { c: "b", ids: ["fictional-mail-1"] });
  assert.deepEqual(select(first, second), conflict);
  assert.deepEqual(select(second, first), conflict);
});

test("two sends processed at the same instant with different totals stay a conflict", () => {
  assert.deepEqual(select(send(41, "19:30", { c: "a" }), send(43, "19:30", { c: "b" })), conflict);
  assert.deepEqual(select(send(43, "19:30", { c: "a" }), send(43, "19:30", { c: "b" })), provisional(43));
});
