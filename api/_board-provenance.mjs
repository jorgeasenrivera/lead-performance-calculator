/* Select a reported store aggregate, never a current/verified store count.
   These are private ingest observations. Shape, scope and byte identity are
   checked here; neither a stored hash nor a status flag authenticates a source.
   Only the four derived public fields below may leave this boundary. */
const record = (value) => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const monthKey = (value) => typeof value === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function processingInstant(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function printedRange(range, month) {
  if (!record(range) || range.startDay !== month + "-01" || typeof range.endDay !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(range.endDay) || range.endDay.slice(0, 7) !== month) return false;
  const end = new Date(range.endDay + "T00:00:00Z");
  return Number.isFinite(end.getTime()) && end.toISOString().slice(0, 10) === range.endDay;
}

export function selectReportedTotal(observations, storeId, month) {
  const result = { count: null, status: "unknown", month: monthKey(month) ? month : null, asOf: null };
  if (result.month === null || typeof storeId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(storeId)
    || !record(observations) || !Object.hasOwn(observations, month)) return result;
  const bucket = observations[month];
  if (!record(bucket) || Object.keys(bucket).length === 0) return result;

  const counts = new Set();
  for (const [hash, observation] of Object.entries(bucket)) {
    if (!digest(hash) || !record(observation) || observation.schemaVersion !== 1
      || observation.metric !== "printed_store_total_delivered" || observation.storeId !== storeId
      || observation.reportMonth !== month || typeof observation.printedStoreName !== "string"
      || observation.printedStoreName.trim() === "" || !printedRange(observation.printedRange, month)
      || !Number.isSafeInteger(observation.count) || observation.count < 0 || observation.status !== "provisional"
      || observation.sentAt !== null || observation.asOf !== null || observation.publicationEligible !== false
      || !processingInstant(observation.processingAt) || !Array.isArray(observation.sourceAssertions)
      || observation.sourceAssertions.length === 0 || !observation.sourceAssertions.every((assertion) => record(assertion)
        && Array.isArray(assertion.date) && assertion.date.every((value) => typeof value === "string")
        && Array.isArray(assertion.messageId) && assertion.messageId.every((value) => typeof value === "string"))
      || !record(observation.source) || observation.source.sha256 !== hash
      || !Number.isSafeInteger(observation.source.byteLength) || observation.source.byteLength <= 0
      || observation.source.parserVersion !== "delivery-summary-printed-total-month:v1"
      || observation.source.archiveState !== "unverified") return result;
    counts.add(observation.count === 0 ? 0 : observation.count);
  }

  // Distinct sources have no established ordering. Even a downward correction
  // stays unresolved; processing/arrival/header times cannot pick the winner.
  if (counts.size > 1) return { ...result, status: "conflict" };
  return { ...result, count: counts.values().next().value, status: "provisional" };
}
