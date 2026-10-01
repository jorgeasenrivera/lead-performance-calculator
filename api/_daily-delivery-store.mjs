/* Only the server writes this namespace. Each receipt is an immutable row, so
   two imports cannot lose a correction by replacing a shared month document. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildDailyDeliveryEvidence, deliveryLedger, resolveDailyBusinessDate } from "./_daily-deliveries.mjs";
import { makeReportVersion, validStoreId, validBusinessDay, canonicalTimestamp, sourceHash } from "./_report-version.mjs";

export const FACT_PREFIX = "lpc:dailyfacts:";
export function factPrefix(storeId) {
  if (!validStoreId(storeId)) throw new Error("invalid_store_identity");
  return `${FACT_PREFIX}${storeId}:v1:`;
}
export function factKey(candidate) {
  const { storeId, businessDate, source } = candidate;
  if (!validBusinessDay(businessDate) || !/^[a-f0-9]{64}$/.test(source?.sha256 || "")
    || !/^[a-f0-9]{64}$/.test(source?.receiptId || "")) throw new Error("invalid_fact_identity");
  return `${factPrefix(storeId)}${businessDate}:${source.sha256}:${source.receiptId}`;
}

async function insertVerified(storage, key, value) {
  // An ambiguous network result is safe to retry later, but never licenses a
  // fact now. The read also verifies an existing duplicate's exact contents.
  await storage.insertOnly(key, value);
  const saved = await storage.get(key);
  if (!isDeepStrictEqual(saved, value)) throw new Error("immutable_record_mismatch");
}

function dailySourcePlan({ bytes, metadata, storeId }) {
  const raw = Buffer.from(bytes || []);
  if (metadata?.reportType !== "activity" || !validStoreId(storeId)) throw new Error("invalid_daily_scope");
  const hash = sourceHash(raw), date = resolveDailyBusinessDate(metadata);
  let source = null;
  try { source = makeReportVersion({ ...metadata, storeId, bytes: raw }); } catch (_) { /* Coverage still needs a hold. */ }
  const receiptId = source?.receiptId || createHash("sha256").update(JSON.stringify([hash, metadata])).digest("hex");
  const hold = { schemaVersion: 1, kind: "coverage_hold", storeId,
    businessDate: date.status === "supported" ? date.businessDate : null,
    sourceId: `${storeId}:activity:sha256:${hash}`, receiptId,
    receivedAt: canonicalTimestamp(metadata.receivedAt), reason: "source_verification_incomplete" };
  return { raw, source, hold, key: `${factPrefix(storeId)}hold:${hash}:${receiptId}` };
}
export async function registerDailyCoverage(input, storage) {
  const { hold, key } = dailySourcePlan(input);
  await insertVerified(storage, key, hold);
}
export async function acceptDailyReport({ bytes, metadata, stores, storeId }, { storage, extractLines, signal, onHold }) {
  let holdRecorded = false;
  try {
    const { raw, source, hold, key } = dailySourcePlan({ bytes, metadata, storeId });
    // A crash or unreadable new report must not leave an older count looking
    // complete. Batch callers register every hold before parsing the first PDF.
    await insertVerified(storage, key, hold);
    holdRecorded = true;
    onHold?.();
    if (!source || raw.length > 4_500_000 || signal?.aborted) throw new Error("daily_source_held");
    const lines = await extractLines(Buffer.from(raw));
    if (signal?.aborted) throw new Error("daily_timeout");
    const candidate = buildDailyDeliveryEvidence({ lines, bytes: raw, metadata, stores, storeId });
    if (!candidate.source || !candidate.businessDate) return { status: "held", unrecorded: false };
    const archive = { schemaVersion: 1, sourceId: source.sourceId, sha256: source.sha256,
      byteLength: source.byteLength, storeId, reportType: source.reportType,
      mime: "application/pdf", b64: raw.toString("base64") };
    await insertVerified(storage, source.proposedArchiveKey, archive);
    if (signal?.aborted || candidate.status !== "provisional") return { status: "held", unrecorded: false };
    const evidence = { ...candidate, source: { ...source, archiveState: "verified" } };
    await insertVerified(storage, factKey(evidence), evidence);
    return { status: candidate.status === "provisional" ? "accepted" : "held", unrecorded: false };
  } catch (_) {
    return { status: "held", unrecorded: !holdRecorded };
  }
}

export function publicDailyMonth({ storeId, month, records }) {
  if (!Array.isArray(records)) throw new Error("invalid_fact_records");
  const resolutions = records.filter(({ value }) => value?.kind === "coverage_resolution");
  const holds = records.filter(({ value }) => value?.kind === "coverage_hold");
  for (const { key, value } of holds) {
    const hash = value.sourceId?.split(":").at(-1);
    if (value.storeId !== storeId || value.sourceId !== `${storeId}:activity:sha256:${hash}` || !/^[a-f0-9]{64}$/.test(hash || "")
      || !/^[a-f0-9]{64}$/.test(value.receiptId || "")
      || key !== `${factPrefix(storeId)}hold:${hash}:${value.receiptId}`
      || (value.businessDate !== null && !validBusinessDay(value.businessDate))) throw new Error("invalid_coverage_hold");
  }
  const candidates = records.filter(({ value }) => !["coverage_hold", "coverage_resolution"].includes(value?.kind)).map(({ key, value }) => {
    if (!value || value.storeId !== storeId || value.source?.archiveState !== "verified"
      || factKey(value) !== key) throw new Error("invalid_fact_record");
    if (value.status === "provisional") {
      const timestamp = canonicalTimestamp(value.asOf?.timestamp);
      const expected = value.source.receipt?.sentAt || value.source.receipt?.receivedAt;
      const basis = value.source.receipt?.sentAt ? "report_sent" : "report_received";
      if (!timestamp || timestamp !== value.asOf.timestamp || timestamp !== expected || value.asOf.basis !== basis)
        throw new Error("invalid_fact_asof");
    }
    return value;
  });
  const ledger = deliveryLedger({ storeId, month, candidates });
  const completed = new Set(candidates.filter((c) => c.status === "provisional").map((c) => c.source.receiptId));
  const resolved = new Set();
  for (const { key, value } of resolutions) {
    const hold = holds.find((r) => r.key === value.holdKey)?.value;
    const replacement = candidates.find((c) => factKey(c) === value.replacementKey);
    if (!hold || !replacement || value.storeId !== storeId || replacement.status !== "provisional"
      || replacement.businessDate !== value.businessDate
      || (hold.businessDate && hold.businessDate !== value.businessDate)
      || key !== resolutionKey(value)) throw new Error("invalid_coverage_resolution");
    const proof = deliveryLedger({ storeId, month: value.businessDate.slice(0, 7), candidates: [replacement] });
    if (proof.days.find((d) => d.date === value.businessDate)?.status !== "provisional") throw new Error("invalid_coverage_resolution");
    resolved.add(value.holdKey);
  }
  const unresolved = holds.filter(({ key, value }) => !completed.has(value.receiptId) && !resolved.has(key));
  return { storeId, month, days: ledger.days.map((day) => {
    if (unresolved.some(({ value }) => !value.businessDate || value.businessDate === day.date))
      return { date: day.date, status: "incomplete", count: null, vehicles: { new: null, used: null }, asOf: null };
    const known = day.status === "provisional" && Number.isFinite(day.count) && day.count >= 0
      && !!canonicalTimestamp(day.asOf?.timestamp) && canonicalTimestamp(day.asOf.timestamp) === day.asOf.timestamp;
    const split = day.vehicles;
    const validSplit = known && Number.isFinite(split?.new) && split.new >= 0
      && Number.isFinite(split?.used) && split.used >= 0 && split.new + split.used === day.count;
    return { date: day.date, status: known ? "provisional" : day.status === "provisional" ? "incomplete" : day.status,
      count: known ? day.count : null,
      vehicles: { new: validSplit ? split.new : null, used: validSplit ? split.used : null },
      asOf: known ? { timestamp: day.asOf.timestamp, basis: day.asOf.basis } : null };
  }) };
}

function resolutionKey(value) {
  return `${factPrefix(value.storeId)}resolution:${createHash("sha256").update(JSON.stringify([
    value.holdKey, value.replacementKey, value.businessDate])).digest("hex")}`;
}
/* Administrative recovery only, never a request handler. The caller must have
   explicit approval for the exact hold, replacement and date. No raw record or
   hold is deleted; the reviewed resolution remains immutable evidence. */
export async function resolveDailyCoverageHold({ holdKey, replacementKey, businessDate }, storage) {
  const hold = await storage.get(holdKey), replacement = await storage.get(replacementKey);
  if (hold?.kind !== "coverage_hold" || !replacement || hold.storeId !== replacement.storeId
    || !validBusinessDay(businessDate) || businessDate !== replacement.businessDate
    || (hold.businessDate && hold.businessDate !== businessDate)) throw new Error("invalid_coverage_resolution");
  const record = { schemaVersion: 1, kind: "coverage_resolution", storeId: hold.storeId,
    holdKey, replacementKey, businessDate };
  const key = resolutionKey(record);
  // Run the same provenance validation as the reader before persisting release.
  publicDailyMonth({ storeId: hold.storeId, month: businessDate.slice(0, 7), records: [
    { key: holdKey, value: hold }, { key: replacementKey, value: replacement }, { key, value: record }] });
  await insertVerified(storage, key, record);
}

/* PostgREST insert, never upsert. Only a unique-key conflict is a duplicate;
   all other write failures hold the daily fact. No client RLS grants needed. */
export function dailyStorage(db, signal) {
  return {
    insertOnly: async (key, value) => {
      const { error } = await db.from("app_data").insert({ key, value }).abortSignal(signal);
      if (error && error.code !== "23505") throw error;
    },
    get: async (key) => {
      const { data, error } = await db.from("app_data").select("value").eq("key", key).maybeSingle().abortSignal(signal);
      if (error) throw error;
      return data?.value ?? null;
    },
    list: async (storeId) => {
      const prefix = factPrefix(storeId), records = [];
      // Keyset pages avoid the API's row cap and offset shifts during imports.
      // Read every month to detect a raw source claimed for two different days.
      let after = prefix;
      for (;;) {
        const { data, error } = await db.from("app_data").select("key,value")
          .gte("key", prefix).lt("key", prefix + "\uffff").gt("key", after)
          .order("key").limit(500).abortSignal(signal);
        if (error || !Array.isArray(data)) throw error || new Error("fact_read_failed");
        if (!data.length) return records;
        records.push(...data); after = data.at(-1).key;
        if (records.length > 50_000) throw new Error("fact_read_limit");
      }
    },
  };
}
