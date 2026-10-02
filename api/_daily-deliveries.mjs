/* The calendar metric is the report's printed store delivery total. These pure
   helpers prepare evidence for review; nothing here writes or publishes it.
   The caller must extract lines from the same bytes supplied here. The local
   dry-run runner owns that boundary; serialized candidates cannot prove it. */
import { readDailyActivityStoreTotals, squashT } from "./_report-parsers.mjs";
import { BUSINESS_TIME_ZONE, canonicalTimestamp, easternDay, validBusinessDay,
  validStoreId, makeReportVersion } from "./_report-version.mjs";

export const DAILY_DELIVERY_METRIC = "printed_store_units_delivered";
export const DAILY_DATE_CONTRACT = "daily-activity-day-sent-america-new-york:v1";
export const DAILY_DELIVERY_PARSER = "daily-store-deliveries:v1";

export function filenameBusinessDays(filename) {
  const s = String(filename || ""), found = [];
  const ymd = /(?<!\d)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/g;
  const mdy = /(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})(?!\d)/g;
  for (const m of s.matchAll(ymd)) found.push(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`);
  for (const m of s.matchAll(mdy)) found.push(`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`);
  return [...new Set(found)];
}
export function resolveDailyBusinessDate({ sentAt = null, receivedAt, filename, printedDay = null }) {
  const received = canonicalTimestamp(receivedAt), sent = sentAt === null ? null : canonicalTimestamp(sentAt);
  const fail = (status, reason) => ({ status, reason, businessDate: null, authority: null,
    contract: DAILY_DATE_CONTRACT, timezone: BUSINESS_TIME_ZONE });
  if (!received || (sentAt !== null && !sent)) return fail("rejected", "invalid_source_timestamp");
  if (sent && sent > received) return fail("rejected", "sent_after_receipt");
  const days = filenameBusinessDays(filename);
  if (days.some((day) => !validBusinessDay(day)) || (printedDay !== null && !validBusinessDay(printedDay)))
    return fail("rejected", "invalid_business_date");
  if (days.length > 1) return fail("conflict", "ambiguous_filename_dates");
  const named = days[0] || null, sentDay = sent && easternDay(sent), receivedDay = easternDay(received);
  if ((named && printedDay && named !== printedDay) || (sentDay && named && sentDay !== named)
    || (sentDay && printedDay && sentDay !== printedDay)) return fail("conflict", "report_date_disagreement");
  if (sentDay) return { status: "supported", reason: null, businessDate: sentDay,
    authority: "sent_timestamp_under_owner_contract", contract: DAILY_DATE_CONTRACT,
    timezone: BUSINESS_TIME_ZONE, receivedOnDifferentDay: receivedDay !== sentDay };
  const reported = printedDay || named;
  if (!reported) return fail("missing", "sent_or_report_date_required");
  if (reported !== receivedDay) return fail("incomplete", "sent_date_needed_for_delayed_or_midnight_receipt");
  return { status: "supported", reason: null, businessDate: reported,
    authority: "report_date_and_receipt_under_owner_contract", contract: DAILY_DATE_CONTRACT,
    timezone: BUSINESS_TIME_ZONE, receivedOnDifferentDay: false };
}
export function resolvePrintedStore(stores, printedName, expectedStoreId) {
  if (!validStoreId(expectedStoreId)) return { status: "rejected", reason: "invalid_store_identity" };
  if (!Array.isArray(stores)) return { status: "rejected", reason: "invalid_store_catalog" };
  const text = squashT(printedName || "");
  // Explicit aliases are allowed. Prefix guesses are not enough to certify a
  // historical store total, even where the older employee importer accepts one.
  const matches = (stores || []).filter((s) => validStoreId(s.id) && text &&
    [s.name, s.id, ...(Array.isArray(s.reportAliases) ? s.reportAliases : [])].some((n) => squashT(n || "") === text));
  const ids = [...new Set(matches.map((s) => s.id))];
  if (ids.length !== 1) return { status: "rejected", reason: ids.length ? "ambiguous_printed_store" : "unresolved_printed_store" };
  if (ids[0] !== expectedStoreId) return { status: "rejected", reason: "printed_store_mismatch" };
  return { status: "supported", storeId: ids[0], printedName };
}
export function buildDailyDeliveryEvidence({ lines, bytes, metadata = {}, stores, storeId }) {
  const summary = readDailyActivityStoreTotals(lines || []);
  const base = { schemaVersion: 1, metric: DAILY_DELIVERY_METRIC, parserVersion: DAILY_DELIVERY_PARSER,
    storeId, businessDate: null, status: "missing", reason: null, count: null,
    vehicles: { new: null, used: null }, isFinal: false, source: null,
    publicationEligible: false, publicationHold: "source_only_dry_run" };
  if (metadata.reportType !== "activity") return { ...base, status: "rejected", reason: "not_daily_activity" };
  if (!summary.storeName) return { ...base, status: summary.status === "missing" ? "missing" : "incomplete",
    reason: summary.reason || "printed_store_required" };
  const identity = resolvePrintedStore(stores, summary.storeName, storeId);
  if (identity.status !== "supported") return { ...base, status: identity.status, reason: identity.reason };
  const date = resolveDailyBusinessDate(metadata);
  if (date.status !== "supported") return { ...base, status: date.status, reason: date.reason, date };
  let source;
  try { source = makeReportVersion({ ...metadata, bytes, storeId }); }
  catch (e) { return { ...base, businessDate: date.businessDate, status: "incomplete", reason: e.message, date }; }
  if (summary.status !== "available" || !Number.isFinite(summary.total) || summary.total < 0)
    return { ...base, businessDate: date.businessDate, status: summary.status === "conflict" ? "conflict" : "incomplete",
      reason: summary.reason || "printed_total_unavailable", source, date };
  return { ...base, status: "provisional", reason: "exact_report_total_finality_unknown", businessDate: date.businessDate,
    count: summary.total, vehicles: summary.vehicles, printedStoreName: summary.storeName, source, date,
    asOf: { timestamp: source.receipt.sentAt || source.receipt.receivedAt,
      basis: source.receipt.sentAt ? "report_sent" : "report_received" },
    scope: "printed_store_all", sourceLimitations: summary.reason ? [summary.reason] : [], readyForReview: true };
}
export function deliveryLedger({ storeId, month, candidates = [] }) {
  if (!validStoreId(storeId) || !/^\d{4}-\d{2}$/.test(month || "") || !validBusinessDay(month + "-01"))
    throw new Error("invalid_ledger_scope");
  const [y, m] = month.split("-").map(Number), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rejected = candidates.filter((c) => c.storeId !== storeId || !validBusinessDay(c.businessDate) || !c.businessDate.startsWith(month + "-"));
  const sourceDates = new Map();
  for (const c of candidates) {
    if (c.storeId !== storeId || !validBusinessDay(c.businessDate) || !c.source?.sourceId) continue;
    const dates = sourceDates.get(c.source.sourceId) || new Set();
    dates.add(c.businessDate); sourceDates.set(c.source.sourceId, dates);
  }
  const days = Array.from({ length: dim }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const all = candidates.filter((c) => c.storeId === storeId && c.businessDate === date);
    const unknown = (status, reason) => ({ date, status, reason, count: null, isFinal: false,
      publicationEligible: false, candidates: all });
    if (!all.length) return unknown("missing", "no_source_for_date");
    if (all.some((c) => sourceDates.get(c.source?.sourceId)?.size > 1))
      return unknown("conflict", "same_raw_source_claims_multiple_dates");
    const unresolved = all.filter((c) => c.status !== "provisional");
    if (unresolved.length) {
      const status = unresolved.some((c) => c.status === "conflict") ? "conflict" :
        unresolved.every((c) => c.status === "missing") && unresolved.length === all.length ? "missing" : "incomplete";
      return unknown(status, all.length === 1 ? unresolved[0].reason : "unresolved_source_for_date");
    }
    if (all.some((c) => c.metric !== DAILY_DELIVERY_METRIC || c.parserVersion !== DAILY_DELIVERY_PARSER
      || c.date?.status !== "supported" || c.date.businessDate !== date || !Number.isFinite(c.count) || c.count < 0
      || c.source?.rawBytesHashed !== true || c.source.storeId !== storeId || c.source.reportType !== "activity"
      || !/^[a-f0-9]{64}$/.test(c.source.sha256 || "")
      || c.source.sourceId !== `${storeId}:activity:sha256:${c.source.sha256}`
      || !c.source.receipt || !canonicalTimestamp(c.source.receipt.receivedAt)
      || canonicalTimestamp(c.source.receipt.receivedAt) !== c.source.receipt.receivedAt
      || (c.source.receipt.sentAt !== null && canonicalTimestamp(c.source.receipt.sentAt) !== c.source.receipt.sentAt)
      || (c.source.receipt.sentAt && c.source.receipt.sentAt > c.source.receipt.receivedAt)))
      return unknown("incomplete", "raw_source_provenance_required");
    const versions = new Map();
    for (const c of all) {
      const key = c.source?.sourceId;
      if (!key) return unknown("incomplete", "raw_source_provenance_required");
      const prior = versions.get(key);
      if (prior && (prior.count !== c.count || JSON.stringify(prior.vehicles) !== JSON.stringify(c.vehicles)))
        return unknown("conflict", "same_source_disagrees");
      const sent = c.source.receipt.sentAt, priorSent = prior?.source.receipt.sentAt;
      // A delayed duplicate must not replace a later known sent timestamp and
      // make another report look newer. All receipts remain in candidates.
      if (!prior || (sent && (!priorSent || sent > priorSent))
        || (!sent && !priorSent && c.source.receipt.receivedAt > prior.source.receipt.receivedAt)) versions.set(key, c);
    }
    const ordered = [...versions.values()];
    if (ordered.length > 1 && ordered.some((c) => !c.source.receipt.sentAt))
      return unknown("conflict", "source_order_unconfirmed");
    ordered.sort((a,b) => (a.source.receipt.sentAt || "").localeCompare(b.source.receipt.sentAt || ""));
    if (ordered.some((c,i) => i && c.source.receipt.sentAt === ordered[i - 1].source.receipt.sentAt))
      return unknown("conflict", "different_versions_same_sent_time");
    const selected = ordered.at(-1), preceding = ordered.at(-2);
    return { date, status: "provisional", count: selected.count, vehicles: selected.vehicles,
      isFinal: false, asOf: selected.asOf, selectionBasis: ordered.length > 1 ? "latest_sent_report" : "only_distinct_source",
      revision: !!preceding && selected.count < preceding.count, selectedSourceId: selected.source.sourceId,
      publicationEligible: false, publicationHold: "archive_commit_and_application_review_required",
      sourceVersions: ordered.map((c) => c.source), candidates: all };
  });
  return { schemaVersion: 1, dryRun: true, writes: 0, metric: DAILY_DELIVERY_METRIC,
    storeId, month, timezone: BUSINESS_TIME_ZONE, dateContract: DAILY_DATE_CONTRACT, days, rejected };
}
