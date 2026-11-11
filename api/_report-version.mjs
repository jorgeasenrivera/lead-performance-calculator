/* Source identity is independent of a filename and a parser release. This is
   pure planning code: it neither stores bytes nor extends archive retention. */
import { createHash } from "node:crypto";

export const REPORT_VERSION_SCHEMA = 1;
export const REPORT_TYPES = Object.freeze(["activity", "delivery-summary", "store-rollup", "appointment", "video"]);
export const BUSINESS_TIME_ZONE = "America/New_York";
export const validStoreId = (s) => typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s);
export const validBusinessDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;

export function canonicalTimestamp(value) {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!m || !validBusinessDay(m[1]) || +m[2] > 23 || +m[3] > 59 || +m[4] > 59) return null;
  if (m[5] !== "Z") {
    const [hours, minutes] = m[5].slice(1).split(":").map(Number);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function easternDay(timestamp) {
  const t = canonicalTimestamp(timestamp);
  return t ? new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(new Date(t)) : null;
}
export function sourceHash(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("raw_source_bytes_required");
  return createHash("sha256").update(bytes).digest("hex");
}
export function reportVersionKey(storeId, receivedDay, reportType, hash) {
  if (!validStoreId(storeId) || !validBusinessDay(receivedDay) || !REPORT_TYPES.includes(reportType)
    || !/^[a-f0-9]{64}$/.test(hash || "")) throw new Error("invalid_source_identity");
  // Keep the existing arrival-day position and store prefix. The existing
  // 60-day archive boundary is not changed by this proposed version identity.
  return `lpc:reportfile:${storeId}:${receivedDay}:v1:${reportType}:${hash}`;
}
export function makeReportVersion({ storeId, reportType, bytes, filename, receivedAt, sentAt = null }) {
  const received = canonicalTimestamp(receivedAt);
  const sent = sentAt === null ? null : canonicalTimestamp(sentAt);
  if (!received || (sentAt !== null && !sent)) throw new Error("invalid_source_timestamp");
  if (sent && sent > received) throw new Error("sent_after_receipt");
  const hash = sourceHash(bytes);
  const key = reportVersionKey(storeId, easternDay(received), reportType, hash);
  const sourceId = `${storeId}:${reportType}:sha256:${hash}`;
  const receipt = { filename: String(filename || ""), receivedAt: received, sentAt: sent };
  const receiptId = createHash("sha256").update(JSON.stringify([sourceId, receipt])).digest("hex");
  return Object.freeze({ schemaVersion: REPORT_VERSION_SCHEMA, sourceId, sha256: hash,
    byteLength: bytes.byteLength, storeId, reportType, proposedArchiveKey: key,
    rawBytesHashed: true, archiveState: "not_written", receiptId, receipt: Object.freeze(receipt) });
}
