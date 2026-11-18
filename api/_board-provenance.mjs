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

  const valid = [];
  for (const [hash, observation] of Object.entries(bucket)) {
    if (!digest(hash) || !record(observation) || observation.schemaVersion !== 1
      || observation.metric !== "printed_store_total_delivered" || observation.storeId !== storeId
      || observation.reportMonth !== month || typeof observation.printedStoreName !== "string"
      || observation.printedStoreName.trim() === "" || !printedRange(observation.printedRange, month)
      || !(observation.count === null || (Number.isSafeInteger(observation.count) && observation.count >= 0))
      || observation.status !== (observation.count === null ? "unknown" : "provisional")
      || observation.sentAt !== null || observation.asOf !== null || observation.publicationEligible !== false
      || !processingInstant(observation.processingAt) || !Array.isArray(observation.sourceAssertions)
      || observation.sourceAssertions.length === 0 || !observation.sourceAssertions.every((assertion) => record(assertion)
        && Array.isArray(assertion.date) && assertion.date.every((value) => typeof value === "string")
        && Array.isArray(assertion.messageId) && assertion.messageId.every((value) => typeof value === "string"))
      || !record(observation.source) || observation.source.sha256 !== hash
      || !Number.isSafeInteger(observation.source.byteLength) || observation.source.byteLength <= 0
      || observation.source.parserVersion !== "delivery-summary-printed-total-month:v1"
      || observation.source.archiveState !== "unverified") return result;
    valid.push(observation);
  }

  /* The reports are month-to-date, so each day's prints a bigger total than the
     day before. Comparing all of them made every month "disagree" from its second
     report on. The printed end day is the report's own content, not an arrival,
     processing or header time, so it can say which reports describe the same
     stretch of the month: only those ending on the latest printed day count. An
     older report that could not be read is superseded, not a blocker. */
  const latest = valid.reduce((day, observation) => observation.printedRange.endDay > day ? observation.printedRange.endDay : day, "");
  const sameDay = valid.filter((observation) => observation.printedRange.endDay === latest);

  /* DriveCentric can send the same day's report more than once, and the counts
     move between sends: a deal delivered or unwound that afternoon. The report
     prints its dates but no time, so its own content cannot say which send came
     second. Jorge chose the newest arrival: the report Sage processed last for
     that day sets the total, corrections down included. processingAt is Sage's
     own clock at intake, not a header the sender wrote, and the same bytes sent
     again keep the instant they first arrived, so a duplicate cannot reorder. */
  const newest = sameDay.reduce((a, b) => b.processingAt > a.processingAt ? b : a);
  if (newest.count === null) return result;

  /* Two sends that arrived at the same instant, or came in the same email, have
     no order between them. If they differ, the board still says so rather than
     pick one. */
  const messageIds = (observation) => new Set(observation.sourceAssertions.flatMap((assertion) => assertion.messageId));
  const newestIds = messageIds(newest);
  for (const observation of sameDay) {
    if (observation === newest) continue;
    const unordered = observation.processingAt === newest.processingAt
      || [...messageIds(observation)].some((id) => newestIds.has(id));
    if (!unordered) continue;
    if (observation.count === null) return result;
    if (observation.count !== newest.count) return { ...result, status: "conflict" };
  }
  return { ...result, count: newest.count, status: "provisional" };
}
