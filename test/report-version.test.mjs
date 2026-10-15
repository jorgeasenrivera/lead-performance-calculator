import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalTimestamp, easternDay, makeReportVersion, reportVersionKey, sourceHash } from "../api/_report-version.mjs";
const input = { storeId: "fictional-a", reportType: "activity", bytes: Buffer.from("fictional original bytes"),
  filename: "report.pdf", receivedAt: "2026-10-01T00:02:00Z", sentAt: "2026-10-01T00:01:00Z" };

test("source versions distinguish stores, report types and bytes, never filenames alone", () => {
  const a = makeReportVersion(input);
  assert.notEqual(a.proposedArchiveKey, makeReportVersion({...input, reportType:"delivery-summary"}).proposedArchiveKey);
  assert.notEqual(a.proposedArchiveKey, makeReportVersion({...input, bytes:Buffer.from("corrected bytes")}).proposedArchiveKey);
  assert.notEqual(a.sourceId, makeReportVersion({...input, storeId:"fictional-b"}).sourceId);
  assert.equal(a.sourceId, makeReportVersion({...input, filename:"renamed.pdf"}).sourceId);
  assert.match(a.proposedArchiveKey, /^lpc:reportfile:fictional-a:2026-09-30:v1:activity:[a-f0-9]{64}$/);
  assert.equal(a.archiveState, "not_written");
  assert.ok(!("bytes" in a) && !("b64" in a), "review output does not copy the raw source");
});
test("identical resends keep source identity while recording independent receipts", () => {
  const a=makeReportVersion(input), b=makeReportVersion({...input, receivedAt:"2026-10-01T00:04:00Z"});
  assert.equal(a.sourceId,b.sourceId); assert.equal(a.proposedArchiveKey,b.proposedArchiveKey);
  assert.notEqual(a.receiptId,b.receiptId);
  assert.equal(a.receiptId,makeReportVersion(input).receiptId);
  const later=makeReportVersion({...input, receivedAt:"2026-10-02T00:04:00Z"});
  assert.equal(a.sourceId,later.sourceId); assert.notEqual(a.proposedArchiveKey,later.proposedArchiveKey);
});
test("raw bytes and valid scoped metadata are required; aggregate-only evidence cannot qualify", () => {
  for (const bytes of [null,undefined,"hash only",new Uint8Array()]) assert.throws(()=>makeReportVersion({...input,bytes}),/raw_source_bytes_required/);
  assert.throws(()=>makeReportVersion({...input,storeId:"store:other"}),/invalid_source_identity/);
  assert.throws(()=>makeReportVersion({...input,reportType:"guessed"}),/invalid_source_identity/);
  assert.throws(()=>reportVersionKey("fictional-a","2026-02-30","activity",sourceHash(input.bytes)),/invalid_source_identity/);
  assert.throws(()=>makeReportVersion({...input,sentAt:"2026-10-02T00:00:00Z"}),/sent_after_receipt/);
});
test("timestamps require explicit zones and preserve midnight and DST boundaries", () => {
  for (const t of ["2026-02-30T12:00:00Z","2026-09-30T24:00:00Z","2026-09-30T12:00:00","2026-09-30T12:00:00+15:00","2026-09-30T12:00:00+14:01","yesterday"])
    assert.equal(canonicalTimestamp(t),null);
  assert.equal(canonicalTimestamp("2026-09-30T20:01:00-04:00"),"2026-10-01T00:01:00.000Z");
  assert.equal(easternDay("2026-10-01T03:59:59Z"),"2026-09-30");
  assert.equal(easternDay("2026-10-01T04:00:00Z"),"2026-10-01");
  assert.equal(easternDay("2026-03-08T06:59:59Z"),"2026-03-08");
  assert.equal(easternDay("2026-11-01T06:01:00Z"),"2026-11-01");
});
