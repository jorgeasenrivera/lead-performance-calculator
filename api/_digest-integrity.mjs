/* A browser visit is not a report period. Legacy digests have no verified
   coverage or store provenance, so even adjacent, rising totals cannot prove
   sales for a day. Keep the audit rows, but give consumers no daily values. */
export const DAILY_TOTALS_UNAVAILABLE = "Daily totals unavailable";
export const DIGEST_RETRY_MS = 5000;

const EMPTY = Object.freeze({});
const validStore = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
const validDay = (day) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day + "T12:00:00Z"))
  && new Date(day + "T12:00:00Z").toISOString().slice(0, 10) === day;

export function digestState(storeId, day, status, reason, rowCount = 0) {
  return Object.freeze({ storeId, day, status, reason, rowCount,
    daily: null, history: EMPTY, label: DAILY_TOTALS_UNAVAILABLE });
}

export function digestIdentity(storeId, dataStoreId, day) {
  if (!validStore(storeId) || !validDay(day))
    return digestState(storeId, day, "rejected", "invalid_identity");
  if (dataStoreId !== storeId)
    return digestState(storeId, day, "rejected", "store_identity_mismatch");
  return null;
}

export function inspectLegacyDigests(storeId, day, records) {
  if (!validStore(storeId) || !validDay(day))
    return digestState(storeId, day, "rejected", "invalid_identity");
  if (!Array.isArray(records)) return digestState(storeId, day, "error", "invalid_response");
  if (records.length === 0) return digestState(storeId, day, "missing", "no_legacy_rows");
  const prefix = `lpc:store:${storeId}:digest:`;
  for (const record of records) {
    if (typeof record?.key !== "string" || !record.key.startsWith(prefix))
      return digestState(storeId, day, "rejected", "row_identity_mismatch");
    const recordDay = record.key.slice(prefix.length);
    if (!validDay(recordDay) || (record.value?.d != null && record.value.d !== recordDay)
      || (record.value?.storeId != null && record.value.storeId !== storeId))
      return digestState(storeId, day, "rejected", "row_identity_mismatch");
  }
  return digestState(storeId, day, "incomplete", "unverified_legacy_snapshots", records.length);
}

/* A bounded successful-read cache shares work across the two boards and recap.
   A failed read is never turned into an empty success or retained for the day.
   Only safe reason codes reach the optional diagnostic sink, never report
   figures, names, backend messages or account details. No sink is installed by
   this module; notification routing needs its own explicit authorization. */
export function createDigestReader(load, { now = Date.now, ttlMs = 60000, maxEntries = 20, timeoutMs = 10000,
  diagnose = () => {} } = {}) {
  const cache = new Map(), pending = new Map();
  const capacity = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 20;
  return {
    read: async (storeId, day, { force = false } = {}) => {
      const invalid = digestIdentity(storeId, storeId, day);
      if (invalid) return invalid;
      const key = storeId + ":" + day;
      if (pending.has(key)) return pending.get(key);
      const hit = cache.get(key);
      if (!force && hit && now() - hit.at < ttlMs) return hit.value;
      cache.delete(key);
      let timeout;
      const timed = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs); });
      const request = Promise.race([Promise.resolve().then(() => load(storeId)), timed]).then(
        (rows) => inspectLegacyDigests(storeId, day, rows),
        () => digestState(storeId, day, "error", "read_failed"),
      ).then((value) => {
        if (value.status === "missing" || value.status === "incomplete") {
          cache.set(key, { value, at: now() });
          while (cache.size > capacity) cache.delete(cache.keys().next().value);
        }
        try { diagnose({ component: "legacy_digest", storeId, day, status: value.status, reason: value.reason }); } catch {}
        return value;
      }).finally(() => { clearTimeout(timeout); pending.delete(key); });
      pending.set(key, request);
      return request;
    },
  };
}

/* Every selection publishes its own neutral state before reading. Old promises
   may finish, but cannot repaint store A's metadata under store B's name. */
export function createDigestSelection(reader, publish) {
  let generation = 0;
  return {
    select: async (storeId, dataStoreId, day, options) => {
      const token = ++generation;
      const invalid = digestIdentity(storeId, dataStoreId, day);
      const initial = invalid || digestState(storeId, day, "loading", "reading_legacy_rows");
      publish(initial);
      if (invalid) return initial;
      const result = await reader.read(storeId, day, options);
      if (token === generation) publish(result);
      return result;
    },
    cancel() { generation++; },
  };
}
